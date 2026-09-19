"""Клиент OpenAlex: запросы, кеш, учёт бюджета, два честных режима выборки.

Выборка по релевантности намеренно не реализована: релевантность коррелирует
с цитируемостью, а цитируемость накапливается со временем, поэтому такая
выборка систематически исключает свежие работы (см. описание проекта, §5.1).
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Callable, Iterable

import requests

from .config import settings

BASE = "https://api.openalex.org/works"

SELECT = ",".join([
    "id", "doi", "title", "publication_year", "publication_date",
    "type", "language", "cited_by_count", "authorships",
    "primary_location", "topics", "abstract_inverted_index",
    "referenced_works", "open_access",
])


class BudgetExhausted(RuntimeError):
    """Дневной бюджет OpenAlex исчерпан (HTTP 429). Обновляется в полночь UTC."""


class OpenAlexClient:
    def __init__(self, api_key: str | None = None, mailto: str | None = None,
                 cache_dir: Path | None = None, use_cache: bool = True):
        self.api_key = api_key or settings.openalex_key
        self.mailto = mailto or settings.mailto
        self.cache_dir = Path(cache_dir or settings.cache_dir)
        self.use_cache = use_cache
        self.session = requests.Session()
        self.remaining_usd: str | None = None
        self.requests_made = 0

    # ------------------------------------------------------------ низкий уровень
    def _cache_path(self, params: dict) -> Path:
        key = json.dumps(params, sort_keys=True, ensure_ascii=False)
        return self.cache_dir / (hashlib.sha1(key.encode()).hexdigest() + ".json")

    def call(self, params: dict) -> dict:
        params = dict(params)
        path = self._cache_path(params)
        if self.use_cache and path.exists():
            return json.loads(path.read_text(encoding="utf-8"))

        if self.api_key:
            params["api_key"] = self.api_key
        if self.mailto:
            params["mailto"] = self.mailto
        r = self.session.get(BASE, params=params, timeout=60)
        self.requests_made += 1
        if r.status_code == 429:
            raise BudgetExhausted("Дневной бюджет OpenAlex исчерпан (429). Обновится в полночь UTC.")
        r.raise_for_status()
        self.remaining_usd = r.headers.get("X-RateLimit-Remaining-USD")
        data = r.json()
        if self.use_cache:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return data

    # ------------------------------------------------------------ фильтры
    @staticmethod
    def build_filter(query: str, year_from: int, year_to: int, extra: str = "") -> str:
        flt = (f"title_and_abstract.search:{query},"
               f"from_publication_date:{year_from}-01-01,"
               f"to_publication_date:{year_to}-12-31")
        return f"{flt},{extra}" if extra else flt

    def count(self, flt: str) -> int:
        return self.call({"filter": flt, "per_page": 1, "select": "id"})["meta"]["count"]

    def group_by(self, flt: str, field: str, per_page: int = 200) -> list[tuple[str, int]]:
        """Точные счётчики по ВСЕМУ массиву за 1 запрос (1 кредит)."""
        data = self.call({"filter": flt, "group_by": field, "per_page": per_page})
        return [(g.get("key_display_name") or g.get("key"), g["count"]) for g in data["group_by"]]

    # ------------------------------------------------------------ выгрузка
    def fetch(self, flt: str, mode: str = "sample", limit: int = 2000, seed: int = 42,
              progress: Callable[[int], None] | None = None) -> list[dict]:
        """
        sample    — случайная выборка с фиксированным seed (репрезентативна, воспроизводима)
        recent    — сортировка по дате публикации (современное состояние области)
        relevance — сортировка по релевантности: СМЕЩЁННАЯ выборка. Оставлена только для
                    демонстрации эффекта (§5.1): исключает свежие и малоцитируемые работы.
        """
        if mode not in ("sample", "recent", "relevance"):
            raise ValueError("mode должен быть 'sample', 'recent' или 'relevance'")
        rows: list[dict] = []
        if mode == "sample":
            limit = min(limit, 10_000)  # ограничение sample в API
            page = 1
            while len(rows) < limit:
                data = self.call({"filter": flt, "sample": limit, "seed": seed,
                                  "per_page": 100, "page": page, "select": SELECT})
                got = data["results"]
                if not got:
                    break
                rows.extend(got)
                if progress:
                    progress(len(rows))
                page += 1
                time.sleep(0.05)
        else:
            sort = "publication_date:desc" if mode == "recent" else "relevance_score:desc"
            cursor = "*"
            while cursor and len(rows) < limit:
                data = self.call({"filter": flt, "sort": sort,
                                  "per_page": 100, "cursor": cursor, "select": SELECT})
                rows.extend(data["results"])
                cursor = data["meta"].get("next_cursor")
                if progress:
                    progress(len(rows))
                time.sleep(0.05)
        return rows[:limit]
