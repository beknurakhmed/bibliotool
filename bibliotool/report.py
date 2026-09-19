"""Отчёт по прогону: графики (PNG) и Markdown-документ."""
from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

from .data import Run  # noqa: E402
from .stats import sample_stats, top_table, years_table  # noqa: E402


def _bar(df: pd.DataFrame, x: str, y: str, title: str, path: Path, horizontal: bool = False):
    fig, ax = plt.subplots(figsize=(9, 4.5) if not horizontal else (9, 6))
    if horizontal:
        d = df.iloc[::-1]
        ax.barh(d[x].astype(str), d[y], color="#4C72B0")
    else:
        ax.bar(df[x].astype(str), df[y], color="#4C72B0")
        plt.xticks(rotation=45, ha="right")
    ax.set_title(title)
    ax.grid(axis="x" if horizontal else "y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def make_charts(run: Run, out: Path, sem_df: pd.DataFrame | None = None) -> list[Path]:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    files = []
    yt = years_table(run.stats)
    if len(yt):
        p = out / "years.png"
        _bar(yt, "year", "count", f"Публикации по годам: «{run.query}» (всего {run.total:,})", p)
        files.append(p)
    for fld, name, title in [("authorships.countries", "countries", "Страны (топ-15)"),
                             ("authorships.institutions.id", "institutions", "Организации (топ-15)"),
                             ("primary_location.source.id", "sources", "Источники (топ-15)"),
                             ("language", "languages", "Языки (топ-10)")]:
        t = top_table(run.stats, fld, 15 if name != "languages" else 10)
        if len(t):
            p = out / f"{name}.png"
            _bar(t, "name", "count", title, p, horizontal=True)
            files.append(p)

    if sem_df is not None and "x" in sem_df:
        fig, ax = plt.subplots(figsize=(9, 7))
        d = sem_df[sem_df["cluster"] != -1]
        noise = sem_df[sem_df["cluster"] == -1]
        if len(noise):
            ax.scatter(noise["x"], noise["y"], s=6, c="#cccccc", label="шум")
        sc = ax.scatter(d["x"], d["y"], s=10, c=d["cluster"], cmap="tab20")
        labels = {c["cluster"]: c.get("label", "") for c in run.semantic.get("clusters", [])}
        for cid, g in d.groupby("cluster"):
            ax.annotate(f"{cid}: {labels.get(cid, '')[:30]}", (g["x"].median(), g["y"].median()),
                        fontsize=7, ha="center",
                        bbox=dict(boxstyle="round,pad=0.2", fc="white", alpha=0.7, lw=0))
        ax.set_title(f"Семантическая карта ({run.semantic.get('projection')}, "
                     f"{run.semantic.get('n_clusters')} кластеров)")
        ax.set_xticks([]); ax.set_yticks([])
        fig.tight_layout()
        p = out / "semantic_map.png"
        fig.savefig(p, dpi=150)
        plt.close(fig)
        files.append(p)
    return files


def _md_table(df: pd.DataFrame, cols: list[str] | None = None) -> str:
    if df.empty:
        return "_нет данных_"
    cols = cols or list(df.columns)
    head = "| " + " | ".join(cols) + " |\n|" + "---|" * len(cols) + "\n"
    body = "\n".join("| " + " | ".join(str(r[c]) for c in cols) + " |" for _, r in df[cols].iterrows())
    return head + body


def make_markdown(run: Run, out: Path, charts: list[Path]) -> Path:
    out = Path(out)
    ss = sample_stats(run.df)
    yt = years_table(run.stats)
    L = [f"# Библиометрический отчёт: «{run.query}» ({run.year_from}–{run.year_to})", ""]
    L += [f"**Всего работ в OpenAlex по запросу:** {run.total:,}  ",
          f"**Выгружено записей:** {len(run.df)} (режим: `{run.mode}`)  ",
          "", "> Статистика по годам/странам/источникам считается по **всему** массиву "
          "(group_by), показатели цитируемости и семантика — по выборке.", ""]

    L += ["## 1. Динамика публикаций", ""]
    if len(yt):
        first, last = yt.iloc[0], yt.iloc[-1]
        L += [f"{int(first['year'])}: {int(first['count']):,} → {int(last['year'])}: {int(last['count']):,} работ.", ""]
        L += [_md_table(yt, ["year", "count"]), ""]
    if (out / "years.png").exists():
        L += ["![годы](years.png)", ""]

    L += ["## 2. География и организации", ""]
    L += ["**Страны (топ-10):**", "", _md_table(top_table(run.stats, "authorships.countries", 10)), ""]
    L += ["**Организации (топ-10):**", "", _md_table(top_table(run.stats, "authorships.institutions.id", 10)), ""]
    L += ["**Источники (топ-10):**", "",
          _md_table(top_table(run.stats, "primary_location.source.id", 10)), "",
          "> Журналы и репозитории (Zenodo, SSRN, Figshare) идут в одном поле API — "
          "см. `primary_location.source.type` в stats.json.", ""]
    L += ["**Языки (топ-10):**", "", _md_table(top_table(run.stats, "language", 10)), ""]

    L += ["## 3. Показатели выборки", ""]
    if ss:
        L += [f"- работ с аннотацией: {ss['with_abstract']:.0%}",
              f"- работ со списком литературы: {ss['with_references']:.0%}",
              f"- на английском: {ss['english_share']:.0%}",
              f"- цитируемость: медиана {ss['citations_median']:.0f}, среднее {ss['citations_mean']:.1f}, "
              f"макс {ss['citations_max']:,}",
              f"- работ с нулевой цитируемостью: {ss['zero_cited_share']:.0%}"
              + ("  **⚠ 0% — выборка смещена (см. §5.1 описания проекта)**" if ss["bias_warning"] else ""),
              f"- международных коллабораций: {ss['international_share']:.0%}",
              f"- авторов на работу (медиана): {ss['authors_median']:.0f}",
              f"- ссылок на работу (медиана): {ss['references_median']:.0f}", ""]
        L += ["**Темы OpenAlex (topics) в выборке:**", "",
              _md_table(pd.DataFrame(ss["top_topics"], columns=["topic", "count"])), ""]

    L += ["## 4. Сети", ""]
    ns = run.network_summary
    if ns:
        rows = [{"сеть": k, **v} for k, v in ns.items()]
        L += [_md_table(pd.DataFrame(rows)), "",
              "> Сеть соавторства при случайной выборке распадается на фрагменты: вероятность "
              "попадания двух работ одного коллектива мала. Для сетевого анализа нужна сплошная "
              "выгрузка по узкой теме (см. §5.4).", ""]
        L += ["Файлы: `networks/*.gexf` (Gephi), `*_edges.csv`, `*_vos_map.txt` + `*_vos_network.txt` (VOSviewer).", ""]

    if run.semantic:
        s = run.semantic
        L += ["## 5. Семантический слой", ""]
        L += [f"Метод эмбеддингов: `{s['embed_method']}`; кластеризация: `{s['cluster_method']}`; "
              f"документов: {s['n_docs']}; кластеров: {s['n_clusters']}; шум: {s['noise_share']:.0%}.", ""]
        cl = pd.DataFrame(s["clusters"])
        if len(cl):
            cl_show = cl[["cluster", "label", "size", "share", "mean_year", "citations_mean", "growth"]].copy()
            cl_show["share"] = (cl_show["share"] * 100).round(1).astype(str) + "%"
            L += [_md_table(cl_show), ""]
            for _, c in cl.iterrows():
                L += [f"**Кластер {c['cluster']} — {c['label']}** ({c['size']} работ)  ",
                      f"_Ключевые слова:_ {c['keywords']}  "]
                if c.get("description"):
                    L += [f"{c['description']}  "]
                L += [""]
        if (out / "semantic_map.png").exists():
            L += ["![карта](semantic_map.png)", ""]
        L += ["### Слабо представленные направления", "",
              "> Это области с **малым числом публикаций в данной выборке из OpenAlex** при высокой "
              "цитируемости/свежести — не пробелы в науке как таковой (§6.2).", ""]
        L += [_md_table(pd.DataFrame(s["underexplored"])), ""]
        m = s["methods"]
        L += ["### Методы, базы данных, инструменты (эвристика по аннотациям)", "",
              "> Определение по ключевым фразам работает нестабильно — ограничение исследования.", "",
              "Типы исследований: " + ", ".join(f"{k}: {v}" for k, v in m["methods"].items()), "",
              "Базы данных: " + (", ".join(f"{k} ({v})" for k, v in m["data_sources"]) or "—"), "",
              "Инструменты: " + (", ".join(f"{k} ({v})" for k, v in m["tools"]) or "—"), ""]

    L += ["## Ограничения", "",
          "- **Данные:** неполные метаданные (аннотации, списки литературы), ошибки автоопределения языка, "
          "смешение журналов и репозиториев, смещение в пользу англоязычных публикаций.",
          "- **Метод:** библиометрия измеряет формальные связи, а не качество; цитируемость зависит от "
          "дисциплины, языка и возраста; результат зависит от процедуры выборки.", ""]
    p = out / "report.md"
    p.write_text("\n".join(L), encoding="utf-8")
    return p
