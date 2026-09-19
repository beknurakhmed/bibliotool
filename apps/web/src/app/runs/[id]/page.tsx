"use client";
import { use, useEffect, useMemo, useState } from "react";
import Assistant from "@/components/Assistant";
import BiasDemo from "@/components/BiasDemo";
import NetworkGraph from "@/components/NetworkGraph";
import SemanticMap from "@/components/SemanticMap";
import { Badge, Callout, Card, HBars, Spinner, Stat, VBars } from "@/components/ui";
import { Cluster, Point, RunDetail, api, clusterColor, fmt, pct } from "@/lib/api";

const TABS = [
  ["overview", "Обзор"], ["networks", "Сети"], ["semantic", "Семантика"], ["directions", "Направления и методы"],
  ["bias", "Эксперимент"], ["assistant", "Ассистент"], ["works", "Работы"], ["files", "Файлы"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [points, setPoints] = useState<Point[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "overview";
    const h = window.location.hash.slice(1) as Tab;
    return TABS.some(([k]) => k === h) ? h : "overview";
  });
  const go = (t: Tab) => { setTab(t); history.replaceState(null, "", `#${t}`); window.scrollTo({ top: 0 }); };
  useEffect(() => {
    const onHash = () => { const h = window.location.hash.slice(1) as Tab; if (TABS.some(([k]) => k === h)) setTab(h); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let alive = true;
    api.run(id).then((r) => {
      if (!alive) return;
      setRun(r);
      if (r.semantic) api.points(id).then((p) => alive && setPoints(p)).catch(() => alive && setPoints([]));
    }).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [id]);

  if (err) return <Callout tone="critical">{err}</Callout>;
  if (!run) return <Spinner label="Загружаем прогон…" />;

  const s = run.sample, sem = run.semantic;
  const first = run.years[0], last = run.years[run.years.length - 1];
  const growth = first && last && first.count ? last.count / first.count : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold leading-tight">«{run.query}»</h1>
          <div className="flex flex-wrap gap-1.5 mt-1.5 text-xs">
            <Badge>{run.year_from}–{run.year_to}</Badge>
            <Badge tone={run.mode === "relevance" ? "warning" : "neutral"}>выборка: {run.mode}</Badge>
            <Badge>{fmt(run.n_sample)} записей из {fmt(run.total)}</Badge>
            {sem && <Badge tone="accent">{sem.n_clusters} кластеров</Badge>}
            {s.bias_warning && <Badge tone="critical">⚠ выборка смещена</Badge>}
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b hairline overflow-x-auto -mx-1 px-1">
        {TABS.map(([k, n]) => (
          <button key={k} onClick={() => go(k)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === k ? "border-accent text-ink font-medium" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {n}{k === "works" && sel != null ? ` · кластер ${sel}` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat label="Работ в OpenAlex" value={fmt(run.total)} hint="точный счётчик по фильтру" />
            <Stat label="Рост за период" value={growth ? `×${growth.toFixed(1)}` : "—"} hint={first && last ? `${first.year} → ${last.year}` : ""} />
            <Stat label="С аннотацией" value={pct(s.with_abstract)} hint="доступны для семантики" />
            <Stat label="Со списком литературы" value={pct(s.with_references)} hint="доступны для коцитирования" />
            <Stat label="Медиана цитирований" value={fmt(s.citations_median)} hint={`среднее ${fmt(s.citations_mean, 1)}`} />
            <Stat label="Нецитируемых" value={pct(s.zero_cited_share)} hint={s.bias_warning ? "⚠ выборка смещена" : "выборка репрезентативна"} tone={s.bias_warning ? "critical" : "good"} />
          </div>
          {s.bias_warning && <Callout tone="critical">В выборке нет работ с нулевой цитируемостью — она смещена в сторону старых цитируемых работ (§5.1).</Callout>}
          <Card title="Динамика публикаций" subtitle={`Точные счётчики по всему массиву (group_by).${run.year_to >= 2026 ? " Последний год неполный — показан бледнее." : ""}`}>
            <VBars data={run.years as unknown as Record<string, number>[]} partialLast={run.year_to >= 2026} height={220} />
          </Card>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Страны" subtitle="по аффилиациям авторов, весь массив"><HBars data={run.top.countries} /></Card>
            <Card title="Организации" subtitle="весь массив"><HBars data={run.top.institutions} /></Card>
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <Card title="Источники" subtitle="журналы и репозитории в одном поле API"><HBars data={run.top.sources.slice(0, 12)} /></Card>
            <Card title="Языки" subtitle="автоопределение OpenAlex; возможны ошибки"><HBars data={run.top.languages.slice(0, 10)} /></Card>
            <div className="space-y-4">
              <Card title="Тип источника"><HBars data={run.top.source_types.slice(0, 6)} height={160} /></Card>
              <Card title="Открытый доступ"><HBars data={run.top.oa.map((r) => ({ ...r, name: r.name === "true" ? "открытый" : r.name === "false" ? "закрытый" : r.name }))} height={80} /></Card>
            </div>
          </div>
          <Card title="Выборка" subtitle="показатели, доступные только по выгруженным записям">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-muted">международных коллабораций</div><div className="text-lg font-medium">{pct(s.international_share)}</div></div>
              <div><div className="text-xs text-muted">авторов на работу (медиана)</div><div className="text-lg font-medium">{fmt(s.authors_median)}</div></div>
              <div><div className="text-xs text-muted">ссылок на работу (медиана)</div><div className="text-lg font-medium">{fmt(s.references_median)}</div></div>
              <div><div className="text-xs text-muted">на английском</div><div className="text-lg font-medium">{pct(s.english_share)}</div></div>
            </div>
            <div className="mt-3"><div className="text-xs text-muted mb-1">Темы OpenAlex (topics) в выборке</div>
              <HBars data={s.top_topics.slice(0, 10).map(([name, count]) => ({ name, count }))} height={250} /></div>
          </Card>
        </div>
      )}

      {tab === "networks" && (
        <Card title="Сетевой анализ" subtitle="networkx · экспорт в Gephi (GEXF) и VOSviewer (map + network)"
          right={<div className="flex gap-1">{["cocitation", "coupling", "coauthors"].map((f) => <a key={f} href={`/files/${id}/networks/${f}.gexf`} className="text-xs px-2 py-1 rounded border hairline hover:bg-surface-2">{f}.gexf</a>)}</div>}>
          <NetworkGraph runId={id} />
          {run.network_summary?.coauthorship && run.network_summary.coauthorship.largest_component <= 5 && (
            <div className="mt-3"><Callout tone="info">Сеть соавторства распалась на фрагменты (крупнейшая компонента — {run.network_summary.coauthorship.largest_component}):
              при случайной выборке из {fmt(run.total)} работ вероятность попадания двух работ одного коллектива мала. Для сетевого анализа нужна сплошная
              выгрузка по узкой теме — единая процедура сбора не годится для всех видов анализа (§5.4).</Callout></div>
          )}
        </Card>
      )}

      {tab === "semantic" && (sem ? (
        <Card title="Семантическая карта"
          subtitle={`${sem.embed_method} → ${sem.projection.toUpperCase()} → ${sem.cluster_method} · ${sem.n_docs} аннотаций · кластеры подписаны LLM`}>
          {!points && <Spinner label="Загружаем точки…" />}
          {points && <SemanticMap runId={id} points={points} clusters={sem.clusters} selected={sel} onSelect={setSel} />}
          <ClusterList clusters={sem.clusters} selected={sel} onSelect={setSel} onWorks={() => go("works")} />
        </Card>
      ) : <Card title="Семантический слой"><p className="text-sm text-muted">Для этого прогона семантика не выполнялась: <code>python -m bibliotool semantic data/runs/{id} --llm</code></p></Card>)}

      {tab === "directions" && (sem ? (
        <div className="space-y-4">
          <Card title="Слабо представленные направления"
            subtitle="Мало работ в выборке при высокой цитируемости или свежести: score = 0.5·(1 − ранг размера) + 0.25·ранг цитируемости + 0.25·ранг свежести">
            <Callout tone="warning">Это области с малым числом публикаций <b>в данной выборке из OpenAlex</b>, а не пробелы в науке как таковой (§6.2). Кандидаты для проверки, а не выводы.</Callout>
            <div className="grid md:grid-cols-5 gap-3 mt-3">
              {sem.underexplored.map((u) => (
                <button key={u.cluster} onClick={() => { setSel(u.cluster); go("semantic"); }} className="card p-3 text-left hover:border-accent">
                  <div className="flex items-center gap-2 text-xs text-muted"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: clusterColor(u.cluster) }} />кластер {u.cluster}</div>
                  <div className="font-medium text-sm mt-1 leading-snug">{u.label}</div>
                  <div className="text-xs text-muted mt-2 tabular">{u.size} работ · цит. {fmt(u.citations_mean, 1)} · свежих {pct(u.recent_share)}</div>
                  <div className="mt-2 h-1 rounded bg-surface-2"><div className="h-full rounded" style={{ width: `${u.underexplored_score * 100}%`, background: "var(--s2)" }} /></div>
                </button>
              ))}
            </div>
          </Card>
          <Card title="Рост направлений" subtitle="относительный прирост числа работ кластера в год (наклон тренда / среднее); доля работ последних 3 лет">
            <GrowthTable clusters={sem.clusters} onPick={(c) => { setSel(c); go("semantic"); }} />
          </Card>
          <div className="grid lg:grid-cols-3 gap-4">
            <Card title="Тип исследования" subtitle="эвристика по аннотации — работает нестабильно">
              <HBars data={Object.entries(sem.methods.methods).map(([name, count]) => ({ name, count }))} height={170} /></Card>
            <Card title="Базы данных в аннотациях" subtitle="какие источники используют сами работы"><HBars data={sem.methods.data_sources.map(([name, count]) => ({ name, count }))} height={220} /></Card>
            <Card title="Инструменты анализа" subtitle="упоминания в аннотациях"><HBars data={sem.methods.tools.map(([name, count]) => ({ name, count }))} height={220} /></Card>
          </div>
        </div>
      ) : <Card title="Направления"><p className="text-sm text-muted">Требуется семантический слой.</p></Card>)}

      {tab === "bias" && (
        <Card title="Эксперимент: как процедура выборки меняет вывод" subtitle="Воспроизводимая иллюстрация методологической ошибки (§5.1)">
          <BiasDemo runId={id} />
        </Card>
      )}

      {tab === "assistant" && (
        <Card title="Ассистент по результатам" subtitle="LLM отвечает только на основе статистики и кластеров этого прогона; локальная модель">
          <Assistant runId={id} />
        </Card>
      )}

      {tab === "works" && (
        <Card title="Работы в выборке" right={<a href={`/files/${id}/works.csv`} className="text-xs px-2 py-1 rounded border hairline hover:bg-surface-2">works.csv</a>}>
          <WorksTable runId={id} cluster={sel} clusters={sem?.clusters ?? []} onClear={() => setSel(null)} />
        </Card>
      )}

      {tab === "files" && (
        <Card title="Отчёт и файлы" subtitle="report.md — готовый раздел для проектной работы; stats.json — полная статистика; semantic.json — кластеры и описания; networks/ — Gephi и VOSviewer">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(run.files).map(([n, u]) => (
              <a key={n} href={u} target="_blank" className="card px-3 py-2 text-sm hover:border-accent flex items-center gap-2">
                <span className="text-muted text-xs w-8">{n.split(".").pop()}</span>{n}
              </a>
            ))}
          </div>
          <ReportPreview url={run.files["report.md"]} runId={id} />
        </Card>
      )}
    </div>
  );
}

function ClusterList({ clusters, selected, onSelect, onWorks }: { clusters: Cluster[]; selected: number | null; onSelect: (c: number | null) => void; onWorks: () => void }) {
  const sorted = useMemo(() => [...clusters].sort((a, b) => b.size - a.size), [clusters]);
  const max = sorted[0]?.size ?? 1;
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium">Тематические кластеры ({clusters.length})</h4>
        {selected != null && <div className="flex gap-3 text-xs"><button onClick={onWorks} className="text-accent hover:underline">работы кластера →</button><button onClick={() => onSelect(null)} className="text-muted hover:text-ink">сбросить ×</button></div>}
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
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GrowthTable({ clusters, onPick }: { clusters: Cluster[]; onPick: (c: number) => void }) {
  const rows = [...clusters].sort((a, b) => b.growth - a.growth);
  const maxG = Math.max(...rows.map((r) => Math.abs(r.growth)), 0.01);
  return (
    <div className="space-y-1">
      {rows.map((c) => (
        <button key={c.cluster} onClick={() => onPick(c.cluster)} className="w-full grid grid-cols-[minmax(0,1fr)_120px_70px_70px] items-center gap-3 text-sm hover:bg-surface-2 rounded px-2 py-1 text-left">
          <span className="truncate"><span className="inline-block w-2 h-2 rounded-sm mr-2" style={{ background: clusterColor(c.cluster) }} />{c.label}</span>
          <span className="h-2 rounded bg-surface-2 relative"><span className="absolute inset-y-0 rounded" style={{ left: 0, width: `${(Math.max(0, c.growth) / maxG) * 100}%`, background: "var(--s3)" }} /></span>
          <span className="tabular text-xs text-right" style={{ color: c.growth > 0.15 ? "var(--good)" : "var(--ink-2)" }}>{c.growth > 0 ? "+" : ""}{(c.growth * 100).toFixed(0)}%/год</span>
          <span className="tabular text-xs text-right text-muted">{pct(c.recent_share)} свежих</span>
        </button>
      ))}
    </div>
  );
}

function ReportPreview({ url, runId }: { url?: string; runId: string }) {
  const [md, setMd] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url).then((r) => r.text()).then((t) => alive && setMd(t)).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  if (!md) return null;
  // очень простой рендер markdown: заголовки, таблицы, картинки, списки
  const html = md
    .replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, `<img alt="$1" src="/files/${runId}/$2" />`)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>").replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/^\|(.+)\|$/gm, (line) => `<tr>${line.split("|").slice(1, -1).map((c) => `<td>${c.trim()}</td>`).join("")}</tr>`)
    .replace(/<tr><td>-+<\/td>.*?<\/tr>\n?/g, "").replace(/(<tr>.*<\/tr>\n?)+/g, (t) => `<table>${t}</table>`)
    .replace(/\n{2,}/g, "<br/>");
  return (
    <details className="mt-4">
      <summary className="text-sm cursor-pointer text-ink-2 hover:text-ink">Предпросмотр report.md</summary>
      <div className="prose-md mt-2 text-sm" dangerouslySetInnerHTML={{ __html: html }} />
    </details>
  );
}

function WorksTable({ runId, cluster, clusters, onClear }: { runId: string; cluster: number | null; clusters: Cluster[]; onClear: () => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("cited_by");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; items: Record<string, string | number | null>[] } | null>(null);
  const size = 25;
  const key = `${cluster}|${q}|${sort}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) { setPrevKey(key); setPage(0); }
  useEffect(() => {
    let alive = true;
    api.works(runId, { offset: page * size, limit: size, cluster: cluster ?? undefined, q, sort })
      .then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [runId, cluster, q, page, sort]);
  const label = cluster != null ? clusters.find((c) => c.cluster === cluster)?.label : null;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по заголовку…" className="rounded-lg border hairline bg-surface px-3 py-1.5 text-sm w-64" />
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border hairline bg-surface px-2 py-1.5 text-sm">
          <option value="cited_by">по цитируемости</option><option value="year">по году</option><option value="n_references">по числу ссылок</option>
        </select>
        {label && <Badge tone="accent">кластер {cluster}: {label} <button onClick={onClear} className="ml-1 hover:text-critical">×</button></Badge>}
        <span className="ml-auto text-xs text-muted tabular">{data ? `${fmt(data.total)} работ` : ""}</span>
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
