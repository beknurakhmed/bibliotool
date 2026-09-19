"""Подписи для узлов сетей: работы, которых нет в выборке (цитируемые), запрашиваются
пакетами по 50 id (1 кредит за запрос) и кешируются на диске."""
from __future__ import annotations

import json
from pathlib import Path

from .config import settings
from .openalex import OpenAlexClient

CACHE = Path(settings.cache_dir) / "work_labels.json"


def _load() -> dict:
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def resolve(ids: list[str], client: OpenAlexClient | None = None, max_requests: int = 10) -> dict[str, dict]:
    """{id: {title, year, cited_by, doi}}. Неизвестные id остаются без записи."""
    cache = _load()
    missing = [i for i in dict.fromkeys(ids) if i and i not in cache]
    if missing:
        client = client or OpenAlexClient()
        for k in range(0, min(len(missing), 50 * max_requests), 50):
            batch = missing[k:k + 50]
            try:
                data = client.call({"filter": "openalex:" + "|".join(batch), "per_page": 50,
                                    "select": "id,title,publication_year,cited_by_count,doi"})
            except Exception:
                break
            for w in data.get("results", []):
                wid = w["id"].rsplit("/", 1)[-1]
                cache[wid] = {"title": w.get("title") or wid, "year": w.get("publication_year"),
                              "cited_by": w.get("cited_by_count", 0), "doi": w.get("doi")}
            for b in batch:
                cache.setdefault(b, {"title": b, "year": None, "cited_by": None, "doi": None})
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    return {i: cache[i] for i in ids if i in cache}
