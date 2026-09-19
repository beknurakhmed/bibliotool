"""Статистика: точные агрегаты по всему массиву (group_by) + показатели выборки."""
from __future__ import annotations

from collections import Counter

import pandas as pd
import requests

from .openalex import OpenAlexClient

GROUP_FIELDS = [
    ("publication_year", "Публикаций по годам"),
    ("authorships.countries", "Страны"),
    ("authorships.institutions.id", "Организации"),
    ("primary_location.source.id", "Источники (журналы и репозитории)"),
    ("primary_location.source.type", "Тип источника"),
    ("language", "Языки"),
    ("type", "Типы публикаций"),
    ("open_access.is_oa", "Открытый доступ"),
]


def full_stats(client: OpenAlexClient, flt: str, log=print) -> tuple[dict, int]:
    """Один запрос group_by на поле = точные счётчики по всем найденным работам."""
    total = client.count(flt)
    stats: dict[str, list] = {}
    for fld, title in GROUP_FIELDS:
        try:
            stats[fld] = client.group_by(flt, fld)
        except requests.HTTPError as e:
            log(f"[{title}] пропущено: {e}")
    return stats, total


def sample_stats(df: pd.DataFrame) -> dict:
    """Показатели, которые можно посчитать только по выгруженным записям."""
    if df.empty:
        return {}
    c = df["cited_by"].fillna(0)
    topics = Counter()
    for v in df["topics"].dropna():
        topics.update(x.strip() for x in str(v).split(";") if x.strip())
    return {
        "n": int(len(df)),
        "with_abstract": float(df["abstract"].notna().mean()),
        "with_references": float((df["n_references"] > 0).mean()),
        "english_share": float((df["language"] == "en").mean()),
        "citations_median": float(c.median()),
        "citations_mean": float(c.mean()),
        "citations_max": int(c.max()),
        "zero_cited_share": float((c == 0).mean()),
        "international_share": float((df["n_countries"] > 1).mean()),
        "authors_median": float(df["n_authors"].median()),
        "references_median": float(df["n_references"].median()),
        "top_topics": topics.most_common(15),
        "bias_warning": bool((c == 0).mean() == 0),  # 0% нецитируемых = выборка смещена
    }


def years_table(stats: dict) -> pd.DataFrame:
    rows = stats.get("publication_year", [])
    df = pd.DataFrame(rows, columns=["year", "count"])
    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    return df.dropna().astype({"year": int}).sort_values("year").reset_index(drop=True)


def top_table(stats: dict, field: str, n: int = 15) -> pd.DataFrame:
    rows = stats.get(field, [])[:n]
    return pd.DataFrame(rows, columns=["name", "count"])
