"""CLI: bibliotool run "запрос" --from 2015 --to 2026 [--mode sample|recent] [--limit 2000] [--semantic] [--llm]

Этапы (каждый можно запустить отдельно):
  run       — полный прогон: статистика + выгрузка + сети + (опц.) семантика + отчёт
  semantic  — семантический слой для уже сохранённого прогона
  report    — пересобрать отчёт для сохранённого прогона
"""
from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

from . import networks, report, semantic
from .config import settings
from .data import Run, flatten
from .openalex import BudgetExhausted, OpenAlexClient
from .stats import full_stats, sample_stats


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:40]


def log(msg: str):
    print(msg, flush=True)


def _utf8_console():
    """Windows-консоль по умолчанию cp1252/cp866 — переключаем вывод на UTF-8."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


# ---------------------------------------------------------------- этапы


def stage_fetch(args) -> tuple[Run, Path]:
    client = OpenAlexClient(use_cache=not args.no_cache)
    if not client.api_key:
        sys.exit("Нет ключа OpenAlex: задайте OPENALEX_API_KEY в .env (https://openalex.org/settings/api)")
    flt = client.build_filter(args.query, args.year_from, args.year_to)
    run = Run(query=args.query, year_from=args.year_from, year_to=args.year_to,
              mode=args.mode, limit=args.limit)
    out = Path(args.out) if args.out else settings.runs_dir / f"{slug(args.query)}_{args.year_from}_{args.year_to}_{args.mode}"

    log(f"Запрос: «{args.query}»  период {args.year_from}–{args.year_to}  режим {args.mode}  лимит {args.limit}")
    log("1/4 Статистика по всему массиву (group_by)…")
    run.stats, run.total = full_stats(client, flt, log=log)
    log(f"    всего работ: {run.total:,}")

    log("2/4 Выгрузка записей…")
    t0 = time.time()
    works = client.fetch(flt, mode=args.mode, limit=args.limit,
                         progress=lambda n: print(f"\r    {n} записей", end="", flush=True))
    print()
    run.df, run.refs = flatten(works)
    log(f"    {len(run.df)} записей за {time.time() - t0:.0f} с; остаток бюджета: ${client.remaining_usd}")

    ss = sample_stats(run.df)
    if ss.get("bias_warning"):
        log("    ⚠ В выборке нет работ с 0 цитирований — признак смещённой выборки")

    log("3/4 Сети…")
    net_dir = out / "networks"
    titles = dict(zip(run.df["id"], run.df["title"].fillna("").str.slice(0, 80)))
    run.network_summary = {
        "coauthorship": networks.export(networks.coauthor_network(run.df), net_dir, "coauthors"),
        "cocitation": networks.export(networks.cocitation_network(run.refs), net_dir, "cocitation"),
        "coupling": networks.export(networks.coupling_network(run.refs), net_dir, "coupling", titles),
    }
    for k, v in run.network_summary.items():
        log(f"    {k}: узлов {v['nodes']}, рёбер {v['edges']}, компонент {v['components']}, "
            f"крупнейшая {v['largest_component']}")
    run.save(out)
    return run, out


def stage_semantic(run: Run, out: Path, use_llm: bool) -> None:
    llm = None
    if use_llm:
        from .llm import LLM
        try:
            llm = LLM()
            log(f"    LLM: {llm.provider}/{llm.model}")
        except Exception as e:
            log(f"    LLM недоступен ({e}); кластеры будут подписаны ключевыми словами")
    result, sem_df = semantic.run_semantic(run.df, run.year_to, llm=llm, query=run.query,
                                           log=lambda m: log("    " + m))
    run.semantic = result
    sem_df[["id", "cluster", "x", "y", "method", "data_sources", "tools"]].to_csv(
        out / "semantic_docs.csv", index=False)
    run.save(out)


def stage_report(run: Run, out: Path) -> Path:
    import pandas as pd
    sem_df = None
    p = out / "semantic_docs.csv"
    if p.exists():
        sem_df = pd.read_csv(p)
    charts = report.make_charts(run, out, sem_df)
    md = report.make_markdown(run, out, charts)
    log(f"Отчёт: {md}")
    return md


# ---------------------------------------------------------------- main


def main(argv=None):
    ap = argparse.ArgumentParser(prog="bibliotool", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="полный прогон")
    r.add_argument("query")
    r.add_argument("--from", dest="year_from", type=int, default=2015)
    r.add_argument("--to", dest="year_to", type=int, default=2026)
    r.add_argument("--mode", choices=["sample", "recent", "relevance"], default="sample",
                   help="relevance — смещённая выборка, только для демонстрации эффекта")
    r.add_argument("--limit", type=int, default=2000)
    r.add_argument("--out", help="папка результатов (по умолчанию runs/<query>_<годы>_<режим>)")
    r.add_argument("--semantic", action="store_true", help="выполнить семантический слой")
    r.add_argument("--llm", action="store_true", help="описывать кластеры через LLM (Ollama/Anthropic)")
    r.add_argument("--no-cache", action="store_true", help="не использовать кеш ответов API")

    s = sub.add_parser("semantic", help="семантический слой для сохранённого прогона")
    s.add_argument("run_dir")
    s.add_argument("--llm", action="store_true")

    p = sub.add_parser("report", help="пересобрать отчёт")
    p.add_argument("run_dir")

    args = ap.parse_args(argv)
    _utf8_console()
    try:
        if args.cmd == "run":
            run, out = stage_fetch(args)
            if args.semantic:
                log("4/4 Семантический слой…")
                stage_semantic(run, out, args.llm)
            else:
                log("4/4 Семантический слой пропущен (--semantic чтобы включить)")
            stage_report(run, out)
            log(f"Готово: {out}")
        elif args.cmd == "semantic":
            out = Path(args.run_dir)
            run = Run.load(out)
            stage_semantic(run, out, args.llm)
            stage_report(run, out)
        elif args.cmd == "report":
            out = Path(args.run_dir)
            stage_report(Run.load(out), out)
    except BudgetExhausted as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
