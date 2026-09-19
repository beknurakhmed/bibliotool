"""REST API для bibliotool (FastAPI).

Запуск:  uvicorn apps.api.main:app --port 8000   (из корня монорепозитория)
"""
from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path

import networkx as nx
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from bibliotool import networks, report, semantic
from bibliotool.cli import slug
from bibliotool.config import settings
from bibliotool.data import Run, flatten
from bibliotool.openalex import BudgetExhausted, OpenAlexClient
from bibliotool.stats import full_stats, sample_stats, top_table, years_table

app = FastAPI(title="bibliotool API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

RUNS = Path(settings.runs_dir)
RUNS.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(RUNS)), name="files")

JOBS: dict[str, dict] = {}
_runs_cache: dict[str, tuple[float, Run]] = {}


# ----------------------------------------------------------------- helpers


def run_dir(run_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9_]+", run_id):
        raise HTTPException(400, "bad run id")
    p = RUNS / run_id
    if not (p / "meta.json").exists():
        raise HTTPException(404, "run not found")
    return p


def load_run(run_id: str) -> Run:
    p = run_dir(run_id)
    mtime = max(f.stat().st_mtime for f in p.glob("*.json"))
    cached = _runs_cache.get(run_id)
    if cached and cached[0] == mtime:
        return cached[1]
    run = Run.load(p)
    _runs_cache[run_id] = (mtime, run)
    return run


def clean(obj):
    """NaN → None для JSON."""
    if isinstance(obj, float) and obj != obj:
        return None
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    return obj


def graph_json(G: nx.Graph, top: int, info: dict | None = None, min_weight: int = 1) -> dict:
    if min_weight > 1:
        G = G.edge_subgraph([(u, v) for u, v, d in G.edges(data=True) if d["weight"] >= min_weight]).copy()
    if G.number_of_nodes() > top:
        keep = sorted(G.degree(weight="weight"), key=lambda x: x[1], reverse=True)[:top]
        G = G.subgraph([n for n, _ in keep]).copy()
    comp = {}
    for i, c in enumerate(sorted(nx.connected_components(G), key=len, reverse=True)):
        for n in c:
            comp[n] = i
    info = info or {}
    nodes = []
    for n in G.nodes:
        meta = info.get(n, {})
        nodes.append({"id": n, "label": meta.get("title") or n, "year": meta.get("year"),
                      "cited_by": meta.get("cited_by"), "doi": meta.get("doi"),
                      "publications": G.nodes[n].get("publications"),
                      "degree": G.degree(n), "weight": G.degree(n, weight="weight"), "component": comp[n]})
    return {
        "nodes": nodes,
        "links": [{"source": u, "target": v, "weight": d["weight"]} for u, v, d in G.edges(data=True)],
        "summary": networks.summarize(G),
        "max_weight": max((d["weight"] for _, _, d in G.edges(data=True)), default=1),
    }


# ----------------------------------------------------------------- models


class RunRequest(BaseModel):
    query: str = Field(min_length=2)
    year_from: int = 2015
    year_to: int = 2026
    mode: str = "sample"
    limit: int = Field(default=2000, ge=100, le=10000)
    semantic: bool = True
    llm: bool = True


class AskRequest(BaseModel):
    question: str = Field(min_length=3)


# ----------------------------------------------------------------- pipeline (background)


def _pipeline(job: dict, req: RunRequest):
    log = lambda m: job["log"].append(m)  # noqa: E731
    try:
        client = OpenAlexClient()
        flt = client.build_filter(req.query, req.year_from, req.year_to)
        out = RUNS / job["run_id"]
        run = Run(query=req.query, year_from=req.year_from, year_to=req.year_to, mode=req.mode, limit=req.limit)
        job["stage"] = "stats"
        log("Статистика по всему массиву (group_by)…")
        run.stats, run.total = full_stats(client, flt, log=log)
        log(f"Всего работ в OpenAlex: {run.total:,}")
        job["stage"] = "fetch"
        log(f"Выгрузка {req.limit} записей ({req.mode})…")

        def prog(n):
            job["progress"] = n / req.limit
        works = client.fetch(flt, mode=req.mode, limit=req.limit, progress=prog)
        run.df, run.refs = flatten(works)
        log(f"Выгружено {len(run.df)}; остаток бюджета OpenAlex ${client.remaining_usd}")
        if sample_stats(run.df).get("bias_warning"):
            log("⚠ В выборке нет работ с 0 цитирований — признак смещённой выборки")
        job["stage"] = "networks"
        log("Сети соавторства, коцитирования, сопряжения…")
        net_dir = out / "networks"
        titles = dict(zip(run.df["id"], run.df["title"].fillna("").str.slice(0, 80)))
        run.network_summary = {
            "coauthorship": networks.export(networks.coauthor_network(run.df), net_dir, "coauthors"),
            "cocitation": networks.export(networks.cocitation_network(run.refs), net_dir, "cocitation"),
            "coupling": networks.export(networks.coupling_network(run.refs), net_dir, "coupling", titles),
        }
        run.save(out)
        if req.semantic:
            job["stage"] = "semantic"
            llm = None
            if req.llm:
                try:
                    from bibliotool.llm import LLM
                    llm = LLM()
                    log(f"LLM: {llm.provider}/{llm.model}")
                except Exception as e:
                    log(f"LLM недоступен: {e}")
            result, sem_df = semantic.run_semantic(run.df, req.year_to, llm=llm, query=req.query, log=log)
            run.semantic = result
            sem_df[["id", "cluster", "x", "y", "method", "data_sources", "tools"]].to_csv(
                out / "semantic_docs.csv", index=False)
            run.save(out)
        job["stage"] = "report"
        sem_df = pd.read_csv(out / "semantic_docs.csv") if (out / "semantic_docs.csv").exists() else None
        report.make_markdown(run, out, report.make_charts(run, out, sem_df))
        job["status"] = "done"
        job["progress"] = 1.0
        log("Готово")
    except BudgetExhausted as e:
        job["status"] = "error"
        log(str(e))
    except Exception as e:  # noqa: BLE001
        job["status"] = "error"
        log(f"Ошибка: {type(e).__name__}: {e}")
    finally:
        job["finished"] = time.time()
        _runs_cache.pop(job["run_id"], None)


# ----------------------------------------------------------------- endpoints


@app.get("/api/health")
def health():
    llm_ok, llm_models = False, []
    try:
        import ollama
        llm_models = [m.get("model") or m.get("name") for m in ollama.list().get("models", [])]
        llm_ok = bool(llm_models)
    except Exception:
        pass
    return {
        "openalex_key": bool(settings.openalex_key),
        "llm_provider": settings.llm_provider,
        "llm_model": settings.ollama_model if settings.llm_provider == "ollama" else settings.anthropic_model,
        "llm_available": llm_ok if settings.llm_provider == "ollama" else True,
        "ollama_models": llm_models,
        "embed_model": settings.embed_model,
        "runs": len(list(RUNS.glob("*/meta.json"))),
    }


@app.get("/api/runs")
def list_runs():
    items = []
    for m in sorted(RUNS.glob("*/meta.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        meta = json.loads(m.read_text(encoding="utf-8"))
        meta["id"] = m.parent.name
        meta["has_semantic"] = (m.parent / "semantic.json").exists()
        meta["updated"] = m.stat().st_mtime
        items.append(meta)
    return items


@app.post("/api/runs", status_code=202)
def create_run(req: RunRequest):
    if not settings.openalex_key:
        raise HTTPException(400, "OPENALEX_API_KEY не задан в .env")
    if req.mode not in ("sample", "recent", "relevance"):
        raise HTTPException(400, "mode: sample | recent | relevance")
    run_id = f"{slug(req.query)}_{req.year_from}_{req.year_to}_{req.mode}"
    job = {"id": uuid.uuid4().hex[:12], "run_id": run_id, "status": "running", "stage": "queue",
           "progress": 0.0, "log": [], "started": time.time(), "request": req.model_dump()}
    JOBS[job["id"]] = job
    threading.Thread(target=_pipeline, args=(job, req), daemon=True).start()
    return {"job_id": job["id"], "run_id": run_id}


@app.get("/api/jobs")
def list_jobs():
    return sorted(JOBS.values(), key=lambda j: j["started"], reverse=True)[:20]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "job not found")
    return JOBS[job_id]


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    run = load_run(run_id)
    yt = years_table(run.stats)
    tops = {k: top_table(run.stats, f, 15).to_dict(orient="records") for k, f in [
        ("countries", "authorships.countries"), ("institutions", "authorships.institutions.id"),
        ("sources", "primary_location.source.id"), ("source_types", "primary_location.source.type"),
        ("languages", "language"), ("types", "type"), ("oa", "open_access.is_oa")]}
    return clean({
        "id": run_id, **run.meta,
        "years": yt.to_dict(orient="records"),
        "top": tops,
        "sample": sample_stats(run.df),
        "semantic": run.semantic or None,
        "files": {f.name: f"/files/{run_id}/{f.name}" for f in run_dir(run_id).glob("*.*")},
    })


@app.delete("/api/runs/{run_id}")
def delete_run(run_id: str):
    import shutil
    shutil.rmtree(run_dir(run_id))
    _runs_cache.pop(run_id, None)
    return {"ok": True}


@app.get("/api/runs/{run_id}/works")
def works(run_id: str, offset: int = 0, limit: int = 50, cluster: int | None = None,
          q: str | None = None, sort: str = "cited_by"):
    run = load_run(run_id)
    df = run.df
    if cluster is not None:
        sd = pd.read_csv(run_dir(run_id) / "semantic_docs.csv")
        df = df[df["id"].isin(sd[sd["cluster"] == cluster]["id"])]
    if q:
        df = df[df["title"].fillna("").str.contains(q, case=False, regex=False)]
    if sort in df.columns:
        df = df.sort_values(sort, ascending=False)
    cols = ["id", "doi", "title", "year", "type", "language", "cited_by", "authors", "countries", "source"]
    return clean({"total": int(len(df)), "items": df[cols].iloc[offset:offset + limit].to_dict(orient="records")})


@app.get("/api/runs/{run_id}/points")
def points(run_id: str):
    p = run_dir(run_id) / "semantic_docs.csv"
    if not p.exists():
        raise HTTPException(404, "семантический слой не выполнялся")
    run = load_run(run_id)
    sd = pd.read_csv(p).merge(run.df[["id", "title", "year", "cited_by", "countries"]], on="id", how="left")
    sd["x"] = sd["x"].round(3); sd["y"] = sd["y"].round(3)
    return clean(sd[["id", "x", "y", "cluster", "title", "year", "cited_by", "method"]].to_dict(orient="records"))


@app.get("/api/runs/{run_id}/network/{kind}")
def network(run_id: str, kind: str, top: int = 150, min_weight: int = 1, resolve: bool = True):
    """Сеть в JSON. Для коцитирования подписи узлов (цитируемых работ вне выборки)
    подтягиваются из OpenAlex пакетами и кешируются (resolve=false — без запросов)."""
    from bibliotool import labels as lab
    run = load_run(run_id)
    own = {r["id"]: {"title": r["title"], "year": r["year"], "cited_by": r["cited_by"], "doi": r["doi"]}
           for r in run.df[["id", "title", "year", "cited_by", "doi"]].to_dict(orient="records")}
    if kind == "coauthorship":
        return clean(graph_json(networks.coauthor_network(run.df), top, {}, min_weight))
    if kind == "cocitation":
        g = graph_json(networks.cocitation_network(run.refs), top, {}, min_weight)
        ids = [n["id"] for n in g["nodes"]]
        info = {**own, **(lab.resolve(ids) if resolve else {})}
        return clean(graph_json(networks.cocitation_network(run.refs), top, info, min_weight))
    if kind == "coupling":
        return clean(graph_json(networks.coupling_network(run.refs), top, own, min_weight))
    raise HTTPException(404, "kind: coauthorship | cocitation | coupling")


@app.get("/api/runs/{run_id}/work/{work_id}")
def work(run_id: str, work_id: str):
    run = load_run(run_id)
    row = run.df[run.df["id"] == work_id]
    if row.empty:
        raise HTTPException(404, "work not in sample")
    rec = row.iloc[0].to_dict()
    p = run_dir(run_id) / "semantic_docs.csv"
    if p.exists():
        sd = pd.read_csv(p)
        m = sd[sd["id"] == work_id]
        if not m.empty:
            rec["cluster"] = int(m.iloc[0]["cluster"]); rec["method"] = m.iloc[0]["method"]
    rec["references"] = run.refs.get(work_id, [])[:50]
    return clean(rec)


@app.post("/api/runs/{run_id}/bias")
def bias_demo(run_id: str, n: int = 500):
    """Демонстрация §5.1: та же тема, выборка по релевантности vs случайная vs весь массив."""
    run = load_run(run_id)
    client = OpenAlexClient()
    flt = client.build_filter(run.query, run.year_from, run.year_to)
    try:
        rel = client.fetch(flt, mode="relevance", limit=n)
    except BudgetExhausted as e:
        raise HTTPException(429, str(e))
    rdf, _ = flatten(rel)
    full = {int(r["year"]): int(r["count"]) for r in years_table(run.stats).to_dict(orient="records")}
    years = sorted(full)

    def share(df):
        vc = df["year"].value_counts()
        tot = max(len(df), 1)
        return [round(float(vc.get(y, 0)) / tot, 4) for y in years]
    tot_full = sum(full.values()) or 1
    return clean({
        "years": years,
        "full": [round(full[y] / tot_full, 4) for y in years],
        "sample": share(run.df), "relevance": share(rdf),
        "sample_stats": {"zero_cited": sample_stats(run.df)["zero_cited_share"],
                         "median_cit": sample_stats(run.df)["citations_median"],
                         "min_cit": int(run.df["cited_by"].min())},
        "relevance_stats": {"zero_cited": float((rdf["cited_by"] == 0).mean()),
                            "median_cit": float(rdf["cited_by"].median()),
                            "min_cit": int(rdf["cited_by"].min())},
        "budget_left": client.remaining_usd,
    })


@app.post("/api/runs/{run_id}/ask")
def ask(run_id: str, req: AskRequest):
    """Вопрос к результатам прогона: LLM отвечает на основе статистики и кластеров."""
    from bibliotool.llm import LLM
    run = load_run(run_id)
    ss = sample_stats(run.df)
    yt = years_table(run.stats)
    ctx = [f"Тема: «{run.query}», {run.year_from}–{run.year_to}. Всего работ в OpenAlex: {run.total:,}.",
           "Публикаций по годам: " + ", ".join(f"{int(r.year)}: {int(r['count'])}" for _, r in yt.iterrows()),
           "Страны: " + ", ".join(f"{n} ({c})" for n, c in run.stats.get("authorships.countries", [])[:10]),
           "Организации: " + ", ".join(f"{n} ({c})" for n, c in run.stats.get("authorships.institutions.id", [])[:8]),
           "Источники: " + ", ".join(f"{n} ({c})" for n, c in run.stats.get("primary_location.source.id", [])[:8]),
           "Языки: " + ", ".join(f"{n} ({c})" for n, c in run.stats.get("language", [])[:6]),
           f"Выборка {len(run.df)}: с аннотацией {ss['with_abstract']:.0%}, медиана цитирований {ss['citations_median']:.0f}, "
           f"нецитируемых {ss['zero_cited_share']:.0%}, международных {ss['international_share']:.0%}.",
           "Сети: " + json.dumps(run.network_summary, ensure_ascii=False)]
    if run.semantic:
        ctx.append("Тематические кластеры выборки (семантика аннотаций). Показатели кластера относятся ТОЛЬКО к выборке "
                   "и не связаны с годовыми счётчиками всего массива выше. growth — относительный прирост числа работ "
                   "кластера в год; recent_share — доля работ последних 3 лет:")
        for c in sorted(run.semantic["clusters"], key=lambda c: -c["size"]):
            ctx.append(f"- [{c['cluster']}] {c['label']}: {c['size']} работ в выборке, средний год {c['mean_year']}, "
                       f"growth {c['growth']:+.2f}/год, recent_share {c['recent_share']:.0%}, ср. цитируемость {c['citations_mean']}. "
                       f"{c['description']} (ключевые слова: {c['keywords']})")
        ctx.append("Слабо представленные (в этой выборке): " +
                   "; ".join(f"{u['label']} ({u['size']})" for u in run.semantic["underexplored"]))
        m = run.semantic["methods"]
        ctx.append(f"Методы: {m['methods']}; базы: {m['data_sources'][:5]}; инструменты: {m['tools'][:5]}")
    system = ("Ты — научный консультант магистранта. Отвечай по-русски, кратко и структурно, опираясь ТОЛЬКО на данные ниже; "
              "если данных нет — так и скажи. Не смешивай годовые счётчики всего массива с размерами кластеров выборки. "
              "Числа приводи точно так, как они даны. Помни ограничения: библиометрия измеряет формальные связи, "
              "не качество; «слабо представленные направления» — это малое число работ в данной базе, "
              "а не пробелы в науке; OpenAlex недопредставляет неанглоязычную науку.\n\nДАННЫЕ:\n" + "\n".join(ctx))
    try:
        llm = LLM()
        answer = llm.complete(req.question, system=system, max_tokens=900)
    except Exception as e:
        raise HTTPException(503, f"LLM недоступен: {e}")
    return {"answer": answer, "provider": f"{llm.provider}/{llm.model}"}
