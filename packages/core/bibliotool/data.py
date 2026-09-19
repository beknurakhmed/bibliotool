"""Преобразование сырых записей OpenAlex в таблицы и хранение результатов прогона."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd


def restore_abstract(inv: dict | None) -> str | None:
    """OpenAlex хранит аннотации инвертированным индексом {слово: [позиции]}."""
    if not inv:
        return None
    pos = [(p, w) for w, ps in inv.items() for p in ps]
    pos.sort()
    return " ".join(w for _, w in pos)


def short_id(url: str | None) -> str | None:
    return url.rsplit("/", 1)[-1] if url else None


def flatten(works: list[dict]) -> tuple[pd.DataFrame, dict[str, list[str]]]:
    """Список записей API -> (DataFrame, {id: [id цитируемых работ]})."""
    flat, refs = [], {}
    for w in works:
        wid = short_id(w["id"])
        auths = w.get("authorships") or []
        insts = [i["display_name"] for a in auths for i in (a.get("institutions") or [])]
        countries = [c for a in auths for c in (a.get("countries") or [])]
        loc = w.get("primary_location") or {}
        src = loc.get("source") or {}
        topics = [t["display_name"] for t in (w.get("topics") or [])]
        oa = w.get("open_access") or {}

        flat.append({
            "id": wid,
            "doi": w.get("doi"),
            "year": w.get("publication_year"),
            "date": w.get("publication_date"),
            "title": w.get("title"),
            "type": w.get("type"),
            "language": w.get("language"),
            "cited_by": w.get("cited_by_count", 0),
            "is_oa": oa.get("is_oa"),
            "n_authors": len(auths),
            "authors": "; ".join(a.get("author", {}).get("display_name", "") for a in auths),
            "author_ids": "; ".join(short_id(a.get("author", {}).get("id")) or "" for a in auths),
            "institutions": "; ".join(dict.fromkeys(insts)),
            "countries": "; ".join(dict.fromkeys(countries)),
            "n_countries": len(set(countries)),
            "source": src.get("display_name"),
            "source_type": src.get("type"),
            "topics": "; ".join(topics),
            "primary_topic": topics[0] if topics else None,
            "n_references": len(w.get("referenced_works") or []),
            "abstract": restore_abstract(w.get("abstract_inverted_index")),
        })
        refs[wid] = [short_id(r) for r in (w.get("referenced_works") or [])]
    return pd.DataFrame(flat), refs


@dataclass
class Run:
    """Результаты одного прогона: параметры, полная статистика, выборка, сети, семантика."""
    query: str
    year_from: int
    year_to: int
    mode: str
    limit: int
    total: int = 0
    stats: dict = field(default_factory=dict)
    df: pd.DataFrame = field(default_factory=pd.DataFrame)
    refs: dict[str, list[str]] = field(default_factory=dict)
    semantic: dict = field(default_factory=dict)
    network_summary: dict = field(default_factory=dict)

    @property
    def meta(self) -> dict:
        return {"query": self.query, "year_from": self.year_from, "year_to": self.year_to,
                "mode": self.mode, "limit": self.limit, "total": self.total,
                "n_sample": len(self.df), "network_summary": self.network_summary}

    def save(self, out: Path) -> Path:
        out = Path(out)
        out.mkdir(parents=True, exist_ok=True)
        (out / "meta.json").write_text(json.dumps(self.meta, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "stats.json").write_text(json.dumps(self.stats, ensure_ascii=False, indent=2), encoding="utf-8")
        self.df.to_csv(out / "works.csv", index=False)
        (out / "references.json").write_text(json.dumps(self.refs), encoding="utf-8")
        if self.semantic:
            (out / "semantic.json").write_text(
                json.dumps(self.semantic, ensure_ascii=False, indent=2), encoding="utf-8")
        return out

    @classmethod
    def load(cls, path: Path) -> "Run":
        path = Path(path)
        meta = json.loads((path / "meta.json").read_text(encoding="utf-8"))
        run = cls(query=meta["query"], year_from=meta["year_from"], year_to=meta["year_to"],
                  mode=meta["mode"], limit=meta["limit"], total=meta.get("total", 0),
                  network_summary=meta.get("network_summary", {}))
        run.stats = json.loads((path / "stats.json").read_text(encoding="utf-8"))
        run.df = pd.read_csv(path / "works.csv")
        run.refs = json.loads((path / "references.json").read_text(encoding="utf-8"))
        sem = path / "semantic.json"
        if sem.exists():
            run.semantic = json.loads(sem.read_text(encoding="utf-8"))
        return run
