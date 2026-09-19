"""Пользовательский интерфейс bibliotool.

Запуск:  streamlit run app/streamlit_app.py
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

ROOT = Path(__file__).resolve().parents[2]  # корень монорепозитория

from bibliotool import networks, report, semantic  # noqa: E402
from bibliotool.cli import slug  # noqa: E402
from bibliotool.config import settings  # noqa: E402
from bibliotool.data import Run, flatten  # noqa: E402
from bibliotool.openalex import BudgetExhausted, OpenAlexClient  # noqa: E402
from bibliotool.stats import full_stats, sample_stats, top_table, years_table  # noqa: E402

st.set_page_config(page_title="bibliotool — библиометрический анализ", page_icon="📚", layout="wide")
st.title("📚 Библиометрический анализ с семантическим слоем")
st.caption("Данные: OpenAlex (CC0). Статистика — по всему массиву, семантика — по выборке.")

# ------------------------------------------------------------------ sidebar
with st.sidebar:
    st.header("Новый прогон")
    query = st.text_input("Тематический запрос", "bibliometric analysis")
    c1, c2 = st.columns(2)
    year_from = c1.number_input("С года", 1990, 2030, 2015)
    year_to = c2.number_input("По год", 1990, 2030, 2026)
    mode = st.radio("Режим выборки", ["sample", "recent"], horizontal=True,
                    help="sample — случайная (репрезентативна); recent — свежие работы. "
                         "Выборка по релевантности намеренно исключена: она смещена к старым цитируемым работам.")
    limit = st.slider("Записей в выборке", 100, 5000, 1000, 100)
    do_semantic = st.checkbox("Семантический слой", True)
    use_llm = st.checkbox("Описывать кластеры LLM", True,
                          help=f"Провайдер: {settings.llm_provider} "
                               f"({settings.ollama_model if settings.llm_provider == 'ollama' else settings.anthropic_model})")
    run_btn = st.button("▶ Запустить", type="primary", use_container_width=True)

    st.divider()
    st.header("Сохранённые прогоны")
    runs_dir = Path(settings.runs_dir)
    saved = sorted([p.name for p in runs_dir.glob("*") if (p / "meta.json").exists()]) if runs_dir.exists() else []
    chosen = st.selectbox("Открыть", ["—"] + saved)
    if not settings.openalex_key:
        st.error("Нет OPENALEX_API_KEY в .env")


# ------------------------------------------------------------------ pipeline


def execute(query, year_from, year_to, mode, limit, do_semantic, use_llm) -> Path:
    out = runs_dir / f"{slug(query)}_{year_from}_{year_to}_{mode}"
    client = OpenAlexClient()
    flt = client.build_filter(query, year_from, year_to)
    run = Run(query=query, year_from=year_from, year_to=year_to, mode=mode, limit=limit)
    status = st.status("Выполняется…", expanded=True)
    with status:
        st.write("1/4 Статистика по всему массиву…")
        run.stats, run.total = full_stats(client, flt, log=st.write)
        st.write(f"Всего работ: **{run.total:,}**")
        st.write("2/4 Выгрузка записей…")
        bar = st.progress(0.0)
        works = client.fetch(flt, mode=mode, limit=limit,
                             progress=lambda n: bar.progress(min(1.0, n / limit)))
        run.df, run.refs = flatten(works)
        st.write(f"Выгружено {len(run.df)}; остаток бюджета OpenAlex: ${client.remaining_usd}")
        st.write("3/4 Сети…")
        net_dir = out / "networks"
        titles = dict(zip(run.df["id"], run.df["title"].fillna("").str.slice(0, 80)))
        run.network_summary = {
            "coauthorship": networks.export(networks.coauthor_network(run.df), net_dir, "coauthors"),
            "cocitation": networks.export(networks.cocitation_network(run.refs), net_dir, "cocitation"),
            "coupling": networks.export(networks.coupling_network(run.refs), net_dir, "coupling", titles),
        }
        run.save(out)
        if do_semantic:
            st.write("4/4 Семантический слой (эмбеддинги → кластеры → описание)…")
            llm = None
            if use_llm:
                try:
                    from bibliotool.llm import LLM
                    llm = LLM()
                except Exception as e:
                    st.warning(f"LLM недоступен: {e}")
            result, sem_df = semantic.run_semantic(run.df, year_to, llm=llm, query=query, log=st.write)
            run.semantic = result
            sem_df[["id", "cluster", "x", "y", "method", "data_sources", "tools"]].to_csv(
                out / "semantic_docs.csv", index=False)
            run.save(out)
        sem_df = pd.read_csv(out / "semantic_docs.csv") if (out / "semantic_docs.csv").exists() else None
        charts = report.make_charts(run, out, sem_df)
        report.make_markdown(run, out, charts)
        status.update(label="Готово", state="complete", expanded=False)
    return out


run_path: Path | None = None
if run_btn:
    try:
        run_path = execute(query, int(year_from), int(year_to), mode, int(limit), do_semantic, use_llm)
        st.session_state["run_path"] = str(run_path)
    except BudgetExhausted as e:
        st.error(str(e))
    except Exception as e:
        st.exception(e)
elif chosen != "—":
    run_path = runs_dir / chosen
    st.session_state["run_path"] = str(run_path)
elif "run_path" in st.session_state:
    run_path = Path(st.session_state["run_path"])

if run_path is None or not (run_path / "meta.json").exists():
    st.info("Задайте запрос слева и нажмите «Запустить», либо откройте сохранённый прогон.")
    st.stop()

# ------------------------------------------------------------------ display
run = Run.load(run_path)
ss = sample_stats(run.df)

st.subheader(f"«{run.query}» · {run.year_from}–{run.year_to} · режим `{run.mode}`")
m1, m2, m3, m4, m5 = st.columns(5)
m1.metric("Работ в OpenAlex", f"{run.total:,}")
m2.metric("В выборке", len(run.df))
m3.metric("С аннотацией", f"{ss.get('with_abstract', 0):.0%}")
m4.metric("Медиана цитирований", f"{ss.get('citations_median', 0):.0f}")
m5.metric("0 цитирований", f"{ss.get('zero_cited_share', 0):.0%}",
          help="Если 0% — выборка смещена к цитируемым работам (см. §5.1)")
if ss.get("bias_warning"):
    st.warning("В выборке нет работ с нулевой цитируемостью — признак смещённой выборки.")

tabs = st.tabs(["📈 Статистика", "🕸 Сети", "🧠 Семантика", "🔬 Методы и инструменты", "📄 Отчёт", "📋 Данные"])

with tabs[0]:
    yt = years_table(run.stats)
    if len(yt):
        st.plotly_chart(px.bar(yt, x="year", y="count", title="Публикации по годам (весь массив)"),
                        use_container_width=True)
    c1, c2 = st.columns(2)
    for col, fld, title in [(c1, "authorships.countries", "Страны"),
                            (c2, "authorships.institutions.id", "Организации"),
                            (c1, "primary_location.source.id", "Источники"),
                            (c2, "language", "Языки")]:
        t = top_table(run.stats, fld, 15)
        if len(t):
            col.plotly_chart(px.bar(t.iloc[::-1], x="count", y="name", orientation="h", title=title),
                             use_container_width=True)
    c1, c2, c3 = st.columns(3)
    for col, fld, title in [(c1, "type", "Типы публикаций"), (c2, "open_access.is_oa", "Открытый доступ"),
                            (c3, "primary_location.source.type", "Тип источника")]:
        t = top_table(run.stats, fld, 8)
        if len(t):
            col.plotly_chart(px.pie(t, names="name", values="count", title=title), use_container_width=True)

with tabs[1]:
    st.markdown("Сети экспортированы в `networks/` — GEXF для **Gephi**, `*_vos_map.txt` + `*_vos_network.txt` для **VOSviewer**.")
    st.dataframe(pd.DataFrame([{"сеть": k, **v} for k, v in run.network_summary.items()]),
                 use_container_width=True, hide_index=True)
    st.info("Сеть соавторства при случайной выборке распадается на фрагменты: вероятность попадания "
            "двух работ одного коллектива мала. Для сетевого анализа нужна сплошная выгрузка по узкой теме.")
    c1, c2 = st.columns(2)
    G = networks.coauthor_network(run.df)
    c1.markdown("**Соавторство — топ узлов**")
    c1.dataframe(networks.top_nodes(G), use_container_width=True, hide_index=True)
    Gc = networks.cocitation_network(run.refs)
    c2.markdown("**Коцитирование — самые связанные работы (OpenAlex ID)**")
    c2.dataframe(networks.top_nodes(Gc), use_container_width=True, hide_index=True)

with tabs[2]:
    if not run.semantic:
        st.info("Семантический слой не выполнялся для этого прогона.")
    else:
        s = run.semantic
        st.caption(f"эмбеддинги: `{s['embed_method']}` · кластеризация: `{s['cluster_method']}` · "
                   f"проекция: `{s['projection']}` · документов: {s['n_docs']} · шум: {s['noise_share']:.0%}")
        cl = pd.DataFrame(s["clusters"])
        sem_df = pd.read_csv(run_path / "semantic_docs.csv").merge(
            run.df[["id", "title", "year", "cited_by"]], on="id", how="left")
        lab = {int(r["cluster"]): f"{int(r['cluster'])}: {r['label']}" for _, r in cl.iterrows()}
        sem_df["Кластер"] = sem_df["cluster"].map(lambda c: lab.get(int(c), "шум"))
        fig = px.scatter(sem_df, x="x", y="y", color="Кластер", hover_data=["title", "year", "cited_by"],
                         title="Семантическая карта (каждая точка — публикация)", height=650)
        fig.update_traces(marker=dict(size=6))
        fig.update_xaxes(visible=False); fig.update_yaxes(visible=False)
        st.plotly_chart(fig, use_container_width=True)

        st.markdown("### Тематические кластеры")
        show = cl[["cluster", "label", "size", "share", "mean_year", "recent_share",
                   "citations_mean", "growth", "keywords"]].copy()
        st.dataframe(show, use_container_width=True, hide_index=True,
                     column_config={"share": st.column_config.NumberColumn(format="%.1%"),
                                    "recent_share": st.column_config.NumberColumn("доля свежих", format="%.0%")})
        for _, c in cl.iterrows():
            with st.expander(f"Кластер {c['cluster']} — {c['label']} ({c['size']} работ)"):
                if c.get("description"):
                    st.write(c["description"])
                st.markdown(f"_Ключевые слова:_ {c['keywords']}")
                st.markdown("\n".join(f"- {t}" for t in c["sample_titles"]))

        st.markdown("### Слабо представленные направления")
        st.warning("Это области с малым числом публикаций **в данной выборке из OpenAlex** при высокой "
                   "цитируемости/свежести — не пробелы в науке как таковой (§6.2 описания проекта).")
        st.dataframe(pd.DataFrame(s["underexplored"]), use_container_width=True, hide_index=True)

with tabs[3]:
    if not run.semantic:
        st.info("Требуется семантический слой.")
    else:
        m = run.semantic["methods"]
        st.warning("Определение по ключевым фразам в аннотации работает нестабильно — оформлено как ограничение исследования.")
        c1, c2, c3 = st.columns(3)
        c1.plotly_chart(px.pie(names=list(m["methods"].keys()), values=list(m["methods"].values()),
                               title="Тип исследования"), use_container_width=True)
        if m["data_sources"]:
            c2.plotly_chart(px.bar(pd.DataFrame(m["data_sources"], columns=["база", "n"]), x="n", y="база",
                                   orientation="h", title="Базы данных"), use_container_width=True)
        if m["tools"]:
            c3.plotly_chart(px.bar(pd.DataFrame(m["tools"], columns=["инструмент", "n"]), x="n", y="инструмент",
                                   orientation="h", title="Инструменты анализа"), use_container_width=True)

with tabs[4]:
    md = run_path / "report.md"
    if md.exists():
        st.download_button("⬇ Скачать report.md", md.read_bytes(), "report.md", "text/markdown")
        st.markdown(md.read_text(encoding="utf-8").replace("](", f"]({run_path.as_posix()}/"))

with tabs[5]:
    st.download_button("⬇ works.csv", (run_path / "works.csv").read_bytes(), "works.csv", "text/csv")
    st.dataframe(run.df.drop(columns=["abstract"]), use_container_width=True, hide_index=True)
