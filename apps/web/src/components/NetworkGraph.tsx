"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods, NodeObject, LinkObject } from "react-force-graph-2d";
import { Graph, SERIES, api, fmt } from "@/lib/api";
import { Badge, Spinner } from "./ui";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type GNode = Graph["nodes"][number] & { x?: number; y?: number };
type GLink = LinkObject & { weight: number; source: GNode | string; target: GNode | string };

const KINDS = [
  { id: "cocitation", name: "Коцитирование", hint: "две работы связаны, если их цитируют вместе; узлы — цитируемые работы (интеллектуальная база области)" },
  { id: "coupling", name: "Сопряжение", hint: "две работы выборки связаны, если ссылаются на одни и те же источники (текущий фронт исследований)" },
  { id: "coauthorship", name: "Соавторство", hint: "авторы — узлы, совместные публикации — рёбра (исследовательские коллективы)" },
];

export default function NetworkGraph({ runId }: { runId: string }) {
  const fg = useRef<ForceGraphMethods<NodeObject, LinkObject> | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [kind, setKind] = useState("cocitation");
  const [top, setTop] = useState(150);
  const [minW, setMinW] = useState(1);
  const [showLabels, setShowLabels] = useState(true);
  const [data, setData] = useState<Graph | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<GNode | null>(null);
  const [hover, setHover] = useState<GNode | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.network(runId, kind, top).then((d) => alive && setData(d)).catch((e) => alive && setErr(e.message));
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [runId, kind, top]);

  const select = (k: string) => { setData(null); setErr(null); setSel(null); setKind(k); };

  // соседи выбранного/наведённого узла
  const focus = hover ?? sel;
  const neighbors = useMemo(() => {
    const s = new Set<string>();
    if (!data || !focus) return s;
    for (const l of data.links) {
      const a = typeof l.source === "object" ? (l.source as GNode).id : l.source;
      const b = typeof l.target === "object" ? (l.target as GNode).id : l.target;
      if (a === focus.id) s.add(b as string);
      if (b === focus.id) s.add(a as string);
    }
    return s;
  }, [data, focus]);

  const filtered = useMemo((): { nodes: GNode[]; links: Graph["links"]; summary: Graph["summary"]; max_weight: number } | null => {
    if (!data) return null;
    if (minW <= 1) return data as typeof data & { nodes: GNode[] };
    const links = data.links.filter((l) => l.weight >= minW);
    const keep = new Set(links.flatMap((l) => [typeof l.source === "object" ? (l.source as GNode).id : l.source, typeof l.target === "object" ? (l.target as GNode).id : l.target]));
    return { ...data, links, nodes: data.nodes.filter((n) => keep.has(n.id)) };
  }, [data, minW]);

  const matches = useMemo(() => {
    if (!q.trim() || !filtered) return new Set<string>();
    const s = q.toLowerCase();
    return new Set(filtered.nodes.filter((n) => n.label.toLowerCase().includes(s)).map((n) => n.id));
  }, [q, filtered]);

  // подписи соседей — только у 20 самых связанных, иначе при 100+ соседях холст нечитаем
  const labelNb = useMemo(() => {
    if (!filtered || !focus) return new Set<string>();
    return new Set(filtered.nodes.filter((n) => neighbors.has(n.id)).sort((a, b) => b.weight - a.weight).slice(0, 20).map((n) => n.id));
  }, [filtered, focus, neighbors]);
  const maxDeg = useMemo(() => Math.max(1, ...(filtered?.nodes.map((n) => n.weight) ?? [1])), [filtered]);
  const labelThreshold = useMemo(() => {
    if (!filtered) return 0;
    const ws = [...filtered.nodes.map((n) => n.weight)].sort((a, b) => b - a);
    return ws[Math.min(ws.length - 1, 24)] ?? 0; // подписи для ~25 самых связанных
  }, [filtered]);

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force("charge")?.strength(-70);
    g.d3Force("link")?.distance((l: LinkObject) => 40 - Math.min(25, ((l as GLink).weight ?? 1) * 3));
    setTimeout(() => g.zoomToFit(400, 40), 600);
  }, [filtered]);

  const paintNode = useCallback((obj: NodeObject, ctx: CanvasRenderingContext2D, scale: number) => {
    const node = obj as GNode;
    const isFocus = focus?.id === node.id;
    const isNb = neighbors.has(node.id);
    const dim = focus != null && !isFocus && !isNb;
    const hit = matches.has(node.id);
    const r = 2 + 7 * Math.sqrt(node.weight / maxDeg);
    ctx.beginPath();
    ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
    ctx.fillStyle = SERIES[node.component % SERIES.length];
    ctx.globalAlpha = dim ? 0.15 : 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (isFocus || hit) {
      ctx.lineWidth = 2 / scale; ctx.strokeStyle = isFocus ? "#0b0b0b" : "#eda100"; ctx.stroke();
    }
    const showLabel = (showLabels && node.weight >= labelThreshold && scale > 0.9) || isFocus || labelNb.has(node.id) || hit;
    if (showLabel && !dim) {
      const fs = Math.max(10 / scale, 2.5);
      ctx.font = `${isFocus ? 600 : 400} ${fs}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      const text = node.label.length > 42 ? node.label.slice(0, 40) + "…" : node.label;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(252,252,251,0.85)";
      ctx.fillRect(node.x! - tw / 2 - 2, node.y! + r + 1, tw + 4, fs + 2);
      ctx.fillStyle = "#0b0b0b";
      ctx.fillText(text, node.x!, node.y! + r + 2);
    }
  }, [focus, neighbors, labelNb, matches, maxDeg, showLabels, labelThreshold]);

  const s = filtered?.summary;
  const kindInfo = KINDS.find((k) => k.id === kind)!;
  const nbList = useMemo(() => {
    if (!filtered || !sel) return [];
    return filtered.nodes.filter((n) => neighbors.has(n.id)).sort((a, b) => b.weight - a.weight).slice(0, 15);
  }, [filtered, sel, neighbors]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {KINDS.map((k) => (
          <button key={k.id} onClick={() => select(k.id)} title={k.hint}
            className={`text-sm px-3 py-1.5 rounded-full border ${kind === k.id ? "bg-accent text-white border-transparent" : "hairline hover:bg-surface-2"}`}>{k.name}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="найти узел…"
          className="ml-auto rounded-lg border hairline bg-surface px-3 py-1.5 text-sm w-48" />
        {matches.size > 0 && <Badge tone="warning">{matches.size}</Badge>}
      </div>
      <p className="text-xs text-muted mb-2">{kindInfo.hint}. Цвет — компонента связности, размер — взвешенная степень. Колесо — зум, перетаскивание — узлы/холст, клик — карточка узла.</p>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted mb-2">
        <label className="flex items-center gap-2">узлов <input type="range" min={30} max={400} step={10} value={top} onChange={(e) => setTop(+e.target.value)} /> <span className="tabular w-8">{top}</span></label>
        <label className="flex items-center gap-2">мин. вес ребра <input type="range" min={1} max={Math.max(2, Math.min(30, data?.max_weight ?? 2))} value={minW} onChange={(e) => setMinW(+e.target.value)} /> <span className="tabular w-6">{minW}</span></label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> подписи</label>
        <button onClick={() => fg.current?.zoomToFit(400, 40)} className="px-2 py-1 rounded border hairline hover:bg-surface-2">вписать</button>
        <button onClick={() => { const c = wrap.current?.querySelector("canvas"); if (c) { const a = document.createElement("a"); a.download = `${kind}.png`; a.href = c.toDataURL("image/png"); a.click(); } }}
          className="px-2 py-1 rounded border hairline hover:bg-surface-2">PNG</button>
        {s && <span className="ml-auto flex gap-1.5"><Badge>узлов {s.nodes}</Badge><Badge>рёбер {s.edges}</Badge><Badge>компонент {s.components}</Badge><Badge>ядро {s.largest_component}</Badge></span>}
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-3">
        <div ref={wrap} className="rounded-lg overflow-hidden border hairline relative" style={{ background: "var(--surface)", height: 560 }}>
          {err && <div className="p-6 text-sm text-critical">{err}</div>}
          {!filtered && !err && <Spinner label="Строим сеть…" />}
          {filtered && filtered.nodes.length === 0 && <div className="p-6 text-sm text-muted">Сеть пуста при текущих порогах — уменьшите «мин. вес ребра».</div>}
          {filtered && filtered.nodes.length > 0 && (
            <ForceGraph2D ref={fg} graphData={filtered as unknown as { nodes: NodeObject[]; links: LinkObject[] }} width={w} height={560}
              backgroundColor="rgba(0,0,0,0)"
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={(node, color, ctx) => { const n = node as GNode; ctx.beginPath(); ctx.arc(n.x!, n.y!, 4 + 7 * Math.sqrt(n.weight / maxDeg), 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); }}
              nodeLabel={() => ""}
              linkColor={(l) => { const L = l as GLink; const a = typeof L.source === "object" ? L.source.id : L.source, b = typeof L.target === "object" ? L.target.id : L.target;
                if (!focus) return "rgba(137,135,129,0.3)"; return a === focus.id || b === focus.id ? "rgba(42,120,214,0.7)" : "rgba(137,135,129,0.06)"; }}
              linkWidth={(l) => Math.min(5, 0.5 + (l as GLink).weight * 0.35)}
              onNodeHover={(n) => setHover((n as GNode) ?? null)}
              onNodeClick={(n) => { const node = n as GNode; setSel(node); fg.current?.centerAt(node.x, node.y, 400); fg.current?.zoom(2.5, 400); }}
              onBackgroundClick={() => setSel(null)}
              cooldownTicks={150} enableNodeDrag />
          )}
        </div>

        <aside className="card p-3 text-sm overflow-y-auto" style={{ maxHeight: 560 }}>
          {!sel && (
            <div className="text-muted text-xs space-y-2">
              <p className="font-medium text-ink">Карточка узла</p>
              <p>Нажмите на узел, чтобы увидеть работу/автора, показатели и соседей. Наведение подсвечивает связи.</p>
              {filtered && (
                <>
                  <p className="font-medium text-ink pt-2">Самые связанные</p>
                  {[...filtered.nodes].sort((a, b) => b.weight - a.weight).slice(0, 10).map((n) => (
                    <button key={n.id} onClick={() => { setSel(n); fg.current?.centerAt(n.x, n.y, 400); fg.current?.zoom(2.5, 400); }}
                      className="block w-full text-left hover:text-accent leading-snug truncate">
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: SERIES[n.component % SERIES.length] }} />{n.label}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          {sel && (
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ background: SERIES[sel.component % SERIES.length] }} />
                <div className="font-medium leading-snug">{sel.label}</div>
                <button onClick={() => setSel(null)} className="ml-auto text-muted hover:text-ink">×</button>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs tabular">
                <span className="text-muted">степень</span><span>{sel.degree}</span>
                <span className="text-muted">взвеш. степень</span><span>{sel.weight}</span>
                {sel.year != null && <><span className="text-muted">год</span><span>{sel.year}</span></>}
                {sel.cited_by != null && <><span className="text-muted">цитирований</span><span>{fmt(sel.cited_by)}</span></>}
                {sel.publications != null && <><span className="text-muted">публикаций в выборке</span><span>{sel.publications}</span></>}
                <span className="text-muted">компонента</span><span>#{sel.component + 1}</span>
              </div>
              <div className="flex gap-2 text-xs">
                {sel.doi && <a href={sel.doi} target="_blank" className="text-accent hover:underline">DOI ↗</a>}
                {sel.id.startsWith("W") && <a href={`https://openalex.org/${sel.id}`} target="_blank" className="text-accent hover:underline">OpenAlex ↗</a>}
              </div>
              <div className="pt-1">
                <div className="text-xs text-muted mb-1">Соседи ({neighbors.size})</div>
                {nbList.map((n) => (
                  <button key={n.id} onClick={() => { setSel(n); fg.current?.centerAt(n.x, n.y, 400); }}
                    className="block w-full text-left text-xs hover:text-accent leading-snug py-0.5 truncate">{n.label}</button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
