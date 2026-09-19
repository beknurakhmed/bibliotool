"use client";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import Assistant from "@/components/Assistant";
import BiasDemo from "@/components/BiasDemo";
import NetworkGraph from "@/components/NetworkGraph";
import SemanticMap from "@/components/SemanticMap";
import { Badge, Callout, Card, HBars, Spinner, Stat, VBars } from "@/components/ui";
import { Cluster, Point, RunDetail, api, clusterColor, fmt, pct } from "@/lib/api";

const SECTIONS = [
  ["overview", "Обзор"], ["dynamics", "Динамика"], ["geo", "География"], ["sources", "Источники"],
  ["networks", "Сети"], ["semantic", "Семантика"], ["gaps", "Направления"], ["methods", "Методы"],
  ["bias", "Смещение выборки"], ["assistant", "Ассистент"], ["works", "Работы"], ["report", "Отчёт"],
];

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [points, setPoints] = useState<Point[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    api.run(id).then((r) => {
      setRun(r);
      if (r.semantic) api.points(id).then(setPoints).catch(() => setPoints([]));
    }).catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <Callout tone="critical">{err}</Callout>;
  if (!run) return <Spinner label="Загружаем прогон…" />;

  const s = run.sample, sem = run.semantic;
  const first = run.years[0], last = run.years[run.years.length - 1];
  const growth = first && last && first.count ? last.count / first.count : null;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-xs text-muted hover:text-ink">← все прогоны</Link>
        <h1 className="text-2xl font-semibold mt-1">«{run.query}»</h1>
        <div className="flex flex-wrap gap-2 mt-2 text-xs">
          <Badge>{run.year_from}–{run.year_to}</Badge>
          <Badge tone={run.mode === "relevance" ? "warning" : "neutral"}>выборка: {run.mode}</Badge>
          <Badge>{fmt(run.n_sample)} записей</Badge>
          {sem && <Badge tone="accent">{sem.n_clusters} кластеров</Badge>}
        </div>
      </div>

      <nav className="sticky top-14 z-20 -mx-5 px-5 py-2 border-b hairline bg-page/90 backdrop-blur flex gap-1 overflow-x-auto text-sm">
        {SECTIONS.map(([k, n]) => <a key={k} href={`#${k}`} className="px-3 py-1 rounded-full whitespace-nowrap hover:bg-surface-2 text-ink-2">{n}</a>)}
      </nav>

      {/* ------------------------------------------------ overview */}
      <section id="overview" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 scroll-mt-28">
        <Stat label="Работ в OpenAlex" value={fmt(run.total)} hint="точный счётчик по фильтру" />
        <Stat label="Рост за период" value={growth ? `×${growth.toFixed(1)}` : "—"} hint={first && last ? `${first.year} → ${last.year}` : ""} />
        <Stat label="С аннотацией" value={pct(s.with_abstract)} hint="доступны для семантики" />
        <Stat label="Со списком литературы" value={pct(s.with_references)} hint="доступны для коцитирования" />
        <Stat label="Медиана цитирований" value={fmt(s.citations_median)} hint={`среднее ${fmt(s.citations_mean, 1)}`} />
        <Stat label="Нецитируемых" value={pct(s.zero_cited_share)} hint={s.bias_warning ? "⚠ выборка смещена" : "выборка репрезентативна"} tone={s.bias_warning ? "critical" : "good"} />
      </section>
      {s.bias_warning && <Callout tone="critical">В выборке нет работ с нулевой цитируемостью — она смещена в сторону старых цитируемых работ (§5.1).</Callout>}

      {/* ------------------------------------------------ dynamics */}
      <Card title="Динамика публикаций" subtitle={`Точные счётчики по всему массиву (group_by). ${run.year_to >= 2026 ? "Последний год неполный — показан бледнее." : ""}`} className="scroll-mt-28">
        <div id="dynamics" />
        <VBars data={run.years as unknown as Record<string, number>[]} partialLast={run.year_to >= 2026} />
      </Card>

      {/* ------------------------------------------------ geo */}
      <div id="geo" className="grid lg:grid-cols-2 gap-4 scroll-mt-28">
        <Card title="Страны" subtitle="по аффилиациям авторов, весь массив"><HBars data={run.top.countries} /></Card>
        <Card title="Организации" subtitle="весь массив"><HBars data={run.top.institutions} color="var(--s1)" /></Card>
      </div>

      {/* ------------------------------------------------ sources */}
      <div id="sources" className="grid lg:grid-cols-3 gap-4 scroll-mt-28">
        <Card title="Источники" subtitle="журналы и репозитории в одном поле API" className="lg:col-span-1"><HBars data={run.top.sources.slice(0, 12)} /></Card>
        <Card title="Языки" subtitle="автоопределение OpenAlex; возможны ошибки"><HBars data={run.top.languages.slice(0, 10)} /></Card>
        <div className="space-y-4">
          <Card title="Тип источника"><HBars data={run.top.source_types.slice(0, 6)} height={160} /></Card>
          <Card title="Открытый доступ"><HBars data={run.top.oa.map((r) => ({ ...r, name: r.name === "true" ? "открытый" : r.name === "false" ? "закрытый" : r.name }))} height={80} /></Card>
        </div>
      </div>

      {/* ------------------------------------------------ networks */}
      <Card title="Сетевой анализ" subtitle="networkx · экспорт в Gephi (GEXF) и VOSviewer (map + network)" className="scroll-mt-28"
        right={<div className="flex gap-1">{["cocitation.gexf", "coauthors.gexf", "coupling.gexf"].map((f) => <a key={f} href={`/files/${id}/networks/${f}`} className="text-xs px-2 py-1 rounded border hairline hover:bg-surface-2">{f}</a>)}</div>}>
        <div id="networks" />
        <NetworkGraph runId={id} />
        {run.network_summary?.coauthorship && run.network_summary.coauthorship.largest_component <= 5 && (
          <Callout tone="info">Сеть соавторства распалась на фрагменты (крупнейшая компонента — {run.network_summary.coauthorship.largest_component}):
            при случайной выборке из {fmt(run.total)} работ вероятность попадания двух работ одного коллектива мала. Для сетевого анализа
            нужна сплошная выгрузка по узкой теме или отбор по цитируемости — единая процедура сбора не годится для всех видов анализа (§5.4).</Callout>
        )}
      </Card>

      {/* ------------------------------------------------ semantic */}
      {sem ? (
        <>
          <Card title="Семантическая карта" className="scroll-mt-28"
            subtitle={`${sem.embed_method} → ${sem.projection.toUpperCase()} → ${sem.cluster_method} · ${sem.n_docs} аннотаций · кластеры подписаны LLM. Клик по точке выделяет кластер.`}>
            <div id="semantic" />
            {!points && <Spinner label="Загружаем точки…" />}
            {points && <SemanticMap points={points} clusters={sem.clusters} selected={sel} onSelect={setSel} />}
            <ClusterList clusters={sem.clusters} selected={sel} onSelect={setSel} runId={id} />
          </Card>

          {/* ---------------------------------------------- gaps */}
          <Card title="Слабо представленные направления" className="scroll-mt-28"
            subtitle="Мало работ в выборке при высокой цитируемости или свежести: score = 0.5·(1 − ранг размера) + 0.25·ранг цитируемости + 0.25·ранг свежести">
            <div id="gaps" />
            <Callout tone="warning">Это области с малым числом публикаций <b>в данной выборке из OpenAlex</b>, а не пробелы в науке как таковой (§6.2). Кандидаты для проверки, а не выводы.</Callout>
            <div className="grid md:grid-cols-5 gap-3 mt-3">
              {sem.underexplored.map((u) => (
                <button key={u.cluster} onClick={() => setSel(u.cluster)} className="card p-3 text-left hover:border-accent">
                  <div className="flex items-center gap-2 text-xs text-muted"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: clusterColor(u.cluster) }} />кластер {u.cluster}</div>
                  <div className="font-medium text-sm mt-1 leading-snug">{u.label}</div>
                  <div className="text-xs text-muted mt-2 tabular">{u.size} работ · цит. {fmt(u.citations_mean, 1)} · свежих {pct(u.recent_share)}</div>
                  <div className="mt-2 h-1 rounded bg-surface-2"><div className="h-full rounded" style={{ width: `${u.underexplored_score * 100}%`, background: "var(--s2)" }} /></div>
                </button>
              ))}
            </div>
          </Card>

          {/* ---------------------------------------------- methods */}
          <div id="methods" className="grid lg:grid-cols-3 gap-4 scroll-mt-28">
            <Card title="Тип исследования" subtitle="эвристика по аннотации — работает нестабильно">
              <HBars data={Object.entries(sem.methods.methods).map(([name, count]) => ({ name, count }))} color="var(--s1)" height={170} />
            </Card>
            <Card title="Базы данных в аннотациях" subtitle="какие источники используют сами работы"><HBars data={sem.methods.data_sources.map(([name, count]) => ({ name, count }))} height={220} /></Card>
            <Card title="Инструменты анализа" subtitle="упоминания в аннотациях"><HBars data={sem.methods.tools.map(([name, count]) => ({ name, count }))} height={220} /></Card>
          </div>
        </>
      ) : (
        <Card title="Семантический слой" className="scroll-mt-28"><div id="semantic" /><p className="text-sm text-muted">Для этого прогона семантика не выполнялась. Запустите: <code>python -m bibliotool semantic data/runs/{id} --llm</code></p></Card>
      )}

      {/* ------------------------------------------------ bias */}
      <Card title="Эксперимент: как процедура выборки меняет вывод" subtitle="Воспроизводимая иллюстрация методологической ошибки (§5.1)" className="scroll-mt-28">
        <div id="bias" />
        <BiasDemo runId={id} />
      </Card>

      {/* ------------------------------------------------ assistant */}
      <Card title="Ассистент по результатам" subtitle="LLM отвечает только на основе статистики и кластеров этого прогона; локальная модель" className="scroll-mt-28">
        <div id="assistant" />
        <Assistant runId={id} />
      </Card>

      {/* ------------------------------------------------ works */}
      <Card title="Работы в выборке" className="scroll-mt-28" right={<a href={`/files/${id}/works.csv`} className="text-xs px-2 py-1 rounded border hairline hover:bg-surface-2">works.csv</a>}>
        <div id="works" />
        <WorksTable runId={id} cluster={sel} clusters={sem?.clusters ?? []} />
      </Card>

      {/* ------------------------------------------------ report */}
      <Card title="Отчёт и файлы" className="scroll-mt-28">
        <div id="report" />
        <div className="flex flex-wrap gap-2">
          {Object.entries(run.files).map(([n, u]) => <a key={n} href={u} target="_blank" className="text-xs px-2.5 py-1.5 rounded-lg border hairline hover:bg-surface-2">{n}</a>)}
        </div>
        <p className="text-xs text-muted mt-3">report.md — готовый раздел для проектной работы; stats.json — полная статистика group_by; semantic.json — кластеры и описания.</p>
      </Card>
    </div>
  );
}

function ClusterList({ clusters, selected, onSelect, runId }: { clusters: Cluster[]; selected: number | null; onSelect: (c: number | null) => void; runId: string }) {
  const sorted = useMemo(() => [...clusters].sort((a, b) => b.size - a.size), [clusters]);
  const max = sorted[0]?.size ?? 1;
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium">Тематические кластеры ({clusters.length})</h4>
        {selected != null && <button onClick={() => onSelect(null)} className="text-xs text-muted hover:text-ink">сбросить выделение ×</button>}
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
        {sorted.map((c) => {
          const active = selected === c.cluster;
          return (
            <button key={c.cluster} onClick={() => onSelect(active ? null : c.cluster)}
              className={`text-left rounded-lg border p-3 transition-colors ${active ? "border-accent bg-surface-2" : "hairline hover:bg-surface-2"} ${selected != null && !active ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: clusterColor(c.cluster) }} />
                <span className="font-medium text-sm leading-tight">{c.label}</span>
                <span className="ml-auto text-xs text-muted tabular">{c.size}</span>
              </div>
              <div className="h-1 rounded bg-surface-2 mt-2"><div className="h-full rounded" style={{ width: `${(c.size / max) * 100}%`, background: clusterColor(c.cluster) }} /></div>
              {c.description && <p className="text-xs text-ink-2 mt-2 leading-snug">{c.description}</p>}
              <p className="text-[11px] text-muted mt-1.5 leading-snug">{c.keywords}</p>
              <div className="flex gap-3 text-[11px] text-muted mt-1.5 tabular">
                <span>ср. год {c.mean_year ?? "—"}</span><span>цит. {fmt(c.citations_mean, 1)}</span><span>свежих {pct(c.recent_share)}</span>
                <span style={{ color: c.growth > 0.15 ? "var(--good)" : undefined }}>рост {c.growth > 0 ? "+" : ""}{(c.growth * 100).toFixed(0)}%/год</span>
              </div>
              {active && <a href={`#works`} className="text-xs text-accent mt-1 inline-block" onClick={(e) => e.stopPropagation()}>работы кластера ↓ · {runId}</a>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorksTable({ runId, cluster, clusters }: { runId: string; cluster: number | null; clusters: Cluster[] }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; items: Record<string, string | number | null>[] } | null>(null);
  const size = 25;
  const key = `${cluster}|${q}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) { setPrevKey(key); setPage(0); }  // сброс страницы при смене фильтра (без эффекта)
  useEffect(() => {
    let alive = true;
    api.works(runId, { offset: page * size, limit: size, cluster: cluster ?? undefined, q })
      .then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [runId, cluster, q, page]);
  const label = cluster != null ? clusters.find((c) => c.cluster === cluster)?.label : null;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по заголовку…" className="rounded-lg border hairline bg-surface px-3 py-1.5 text-sm w-64" />
        {label && <Badge tone="accent">кластер {cluster}: {label}</Badge>}
        <span className="ml-auto text-xs text-muted tabular">{data ? `${fmt(data.total)} работ · сортировка по цитируемости` : ""}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted text-left"><tr><th className="py-1 pr-3">Заголовок</th><th className="pr-3">Год</th><th className="pr-3">Цит.</th><th className="pr-3">Страны</th><th>Источник</th></tr></thead>
          <tbody>
            {data?.items.map((w) => (
              <tr key={String(w.id)} className="border-t hairline align-top">
                <td className="py-1.5 pr-3 max-w-xl">
                  <a href={w.doi ? String(w.doi) : `https://openalex.org/${w.id}`} target="_blank" className="hover:text-accent leading-snug">{w.title}</a>
                  <div className="text-[11px] text-muted truncate max-w-xl">{String(w.authors ?? "")}</div>
                </td>
                <td className="pr-3 tabular">{w.year}</td><td className="pr-3 tabular">{w.cited_by}</td>
                <td className="pr-3 text-xs text-muted">{String(w.countries ?? "").split(";").slice(0, 3).join(",")}</td>
                <td className="text-xs text-muted max-w-[180px] truncate">{w.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.total > size && (
        <div className="flex items-center gap-3 mt-3 text-sm">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded border hairline disabled:opacity-40">←</button>
          <span className="text-muted text-xs tabular">{page + 1} / {Math.ceil(data.total / size)}</span>
          <button disabled={(page + 1) * size >= data.total} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded border hairline disabled:opacity-40">→</button>
        </div>
      )}
    </div>
  );
}
