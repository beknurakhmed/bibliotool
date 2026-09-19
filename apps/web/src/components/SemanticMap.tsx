"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Cluster, Point, api, clusterColor, fmt } from "@/lib/api";
import { Badge } from "./ui";

type Work = Record<string, string | number | null | string[]>;

/** Семантическая карта: точка = публикация, цвет = кластер. Зум колесом, панорамирование
 *  перетаскиванием, легенда-фильтр, поиск, клик по точке — карточка работы с аннотацией. */
export default function SemanticMap({ runId, points, clusters, selected, onSelect }: {
  runId: string; points: Point[]; clusters: Cluster[]; selected: number | null; onSelect: (c: number | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 540 });
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<{ p: Point; x: number; y: number } | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [minYear, setMinYear] = useState(0);
  const [pick, setPick] = useState<Point | null>(null);
  const [work, setWork] = useState<Work | null>(null);

  const byId = useMemo(() => Object.fromEntries(clusters.map((c) => [c.cluster, c])), [clusters]);
  const bounds = useMemo(() => {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }, [points]);
  const years = useMemo(() => points.map((p) => p.year).filter(Boolean), [points]);
  const yMin = Math.min(...years), yMax = Math.max(...years);

  const pad = 30;
  const base = (p: Point) => [
    pad + ((p.x - bounds.x0) / (bounds.x1 - bounds.x0 || 1)) * (size.w - 2 * pad),
    size.h - pad - ((p.y - bounds.y0) / (bounds.y1 - bounds.y0 || 1)) * (size.h - 2 * pad),
  ];
  const sx = (p: Point) => base(p)[0] * view.k + view.tx;
  const sy = (p: Point) => base(p)[1] * view.k + view.ty;

  const visible = (p: Point) => !hidden.has(p.cluster) && p.year >= minYear;
  const matches = useMemo(() => {
    if (!q.trim()) return null;
    const s = q.toLowerCase();
    return new Set(points.filter((p) => p.title?.toLowerCase().includes(s)).map((p) => p.id));
  }, [q, points]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: Math.max(440, Math.round(el.clientWidth * 0.6)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // wheel-зум: нативный listener, т.к. React вешает onWheel как passive и preventDefault не работает
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((v) => ({ k: Math.min(12, Math.max(0.6, v.k * f)), tx: mx - (mx - v.tx) * f, ty: my - (my - v.ty) * f }));
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!pick) return;
    let alive = true;
    api.work(runId, pick.id).then((w) => alive && setWork(w as Work)).catch(() => alive && setWork(null));
    return () => { alive = false; };
  }, [pick, runId]);
  const choose = (p: Point | null) => { setPick(p); setWork(null); };

  // ---------------------------------------------------------------- отрисовка
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const surface = css.getPropertyValue("--surface").trim(), ink = css.getPropertyValue("--ink").trim();
    ctx.fillStyle = surface; ctx.fillRect(0, 0, size.w, size.h);

    const focusOn = selected != null || matches != null;
    const isLit = (p: Point) => (selected == null || p.cluster === selected) && (matches == null || matches.has(p.id));
    const order = [...points.filter((p) => visible(p) && !isLit(p)), ...points.filter((p) => visible(p) && isLit(p))];
    const r = Math.min(5, 2.4 * Math.sqrt(view.k));
    for (const p of order) {
      const lit = isLit(p);
      ctx.beginPath();
      ctx.arc(sx(p), sy(p), lit ? r + 0.8 : r, 0, Math.PI * 2);
      ctx.fillStyle = clusterColor(p.cluster);
      ctx.globalAlpha = focusOn && !lit ? 0.12 : 0.85;
      ctx.fill(); ctx.globalAlpha = 1;
      if (lit && focusOn) { ctx.lineWidth = 1; ctx.strokeStyle = surface; ctx.stroke(); }
    }
    if (pick) { ctx.beginPath(); ctx.arc(sx(pick), sy(pick), r + 4, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = ink; ctx.stroke(); }

    ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "center";
    for (const c of clusters) {
      if (hidden.has(c.cluster) || (selected != null && c.cluster !== selected)) continue;
      const ps = points.filter((p) => p.cluster === c.cluster && visible(p));
      if (ps.length < 3) continue;
      const mx = ps.map(sx).sort((a, b) => a - b)[ps.length >> 1], my = ps.map(sy).sort((a, b) => a - b)[ps.length >> 1];
      if (mx < 0 || mx > size.w || my < 0 || my > size.h) continue;
      const text = `${c.cluster} · ${c.label}`.slice(0, 44);
      const tw = ctx.measureText(text).width + 10;
      ctx.fillStyle = surface; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.roundRect(mx - tw / 2, my - 9, tw, 18, 5); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = ink; ctx.fillText(text, mx, my + 4);
    }
  }, [points, clusters, selected, size, view, hidden, matches, minYear, pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearest = (mx: number, my: number) => {
    let best: Point | null = null, bd = 100;
    for (const p of points) {
      if (!visible(p)) continue;
      const d = (sx(p) - mx) ** 2 + (sy(p) - my) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const toggle = (c: number) => setHidden((h) => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const reset = () => { setView({ k: 1, tx: 0, ty: 0 }); setHidden(new Set()); setQ(""); setMinYear(0); onSelect(null); choose(null); };

  return (
    <div className="grid xl:grid-cols-[1fr_320px] gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="поиск по заголовку…" className="rounded-lg border hairline bg-surface px-3 py-1.5 text-sm w-56" />
          {matches && <Badge tone="warning">{matches.size} найдено</Badge>}
          <label className="flex items-center gap-2 text-muted ml-2">с года <input type="range" min={yMin} max={yMax} value={minYear || yMin} onChange={(e) => setMinYear(+e.target.value)} /><span className="tabular">{minYear || yMin}</span></label>
          <span className="ml-auto flex gap-1">
            <button onClick={() => setView((v) => ({ ...v, k: v.k * 1.4 }))} className="px-2 py-1 rounded border hairline hover:bg-surface-2">+</button>
            <button onClick={() => setView((v) => ({ ...v, k: v.k / 1.4 }))} className="px-2 py-1 rounded border hairline hover:bg-surface-2">−</button>
            <button onClick={reset} className="px-2 py-1 rounded border hairline hover:bg-surface-2">сброс</button>
            <button onClick={() => { const c = ref.current; if (c) { const a = document.createElement("a"); a.download = "semantic_map.png"; a.href = c.toDataURL("image/png"); a.click(); } }} className="px-2 py-1 rounded border hairline hover:bg-surface-2">PNG</button>
          </span>
        </div>
        <div ref={wrap} className="relative w-full rounded-lg overflow-hidden border hairline">
          <canvas ref={ref} style={{ width: size.w, height: size.h, cursor: dragging ? "grabbing" : "crosshair", display: "block" }}
            onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }; setDragging(true); }}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
              if (drag.current && e.buttons === 1) {
                const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
                if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
                setView((v) => ({ ...v, tx: drag.current!.tx + dx, ty: drag.current!.ty + dy }));
                setHover(null); return;
              }
              const p = nearest(mx, my);
              setHover(p ? { p, x: mx, y: my } : null);
            }}
            onMouseUp={(e) => {
              const moved = drag.current?.moved; drag.current = null; setDragging(false);
              if (moved) return;
              const r = e.currentTarget.getBoundingClientRect();
              const p = nearest(e.clientX - r.left, e.clientY - r.top);
              if (p) { choose(p); onSelect(p.cluster); } else { choose(null); onSelect(null); }
            }}
            onMouseLeave={() => { setHover(null); drag.current = null; setDragging(false); }} />
          {hover && !dragging && (
            <div className="card absolute z-10 px-3 py-2 text-xs max-w-xs pointer-events-none shadow-lg"
              style={{ left: Math.min(hover.x + 12, size.w - 270), top: Math.min(hover.y + 12, size.h - 70) }}>
              <div className="font-medium leading-snug">{hover.p.title}</div>
              <div className="text-muted mt-1">
                <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: clusterColor(hover.p.cluster) }} />
                {byId[hover.p.cluster]?.label ?? "шум"} · {hover.p.year} · цит. {hover.p.cited_by}
              </div>
            </div>
          )}
        </div>
        {/* легенда-фильтр */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[...clusters].sort((a, b) => b.size - a.size).map((c) => {
            const off = hidden.has(c.cluster), act = selected === c.cluster;
            return (
              <button key={c.cluster} onClick={(e) => (e.shiftKey ? toggle(c.cluster) : onSelect(act ? null : c.cluster))} onContextMenu={(e) => { e.preventDefault(); toggle(c.cluster); }}
                title="клик — выделить, shift/правая кнопка — скрыть"
                className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border ${act ? "border-accent bg-surface-2" : "hairline hover:bg-surface-2"} ${off ? "opacity-35 line-through" : ""}`}>
                <span className="w-2 h-2 rounded-sm" style={{ background: clusterColor(c.cluster) }} />{c.label}<span className="text-muted tabular">{c.size}</span>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="card p-3 text-sm overflow-y-auto" style={{ maxHeight: size.h + 40 }}>
        {!pick && (
          <div className="text-xs text-muted space-y-2">
            <p className="font-medium text-ink">Карточка работы</p>
            <p>Кликните по точке — здесь появится аннотация, метаданные и ссылка. Колесо — зум, перетаскивание — панорама. В легенде: клик выделяет кластер, shift-клик скрывает.</p>
            {selected != null && byId[selected] && (
              <div className="pt-2 border-t hairline">
                <p className="font-medium text-ink">{byId[selected].label}</p>
                <p className="mt-1">{byId[selected].description}</p>
                <p className="mt-1 text-[11px]">{byId[selected].keywords}</p>
                <p className="mt-2 font-medium text-ink">Самые цитируемые</p>
                {byId[selected].sample_titles.map((t) => <p key={t} className="leading-snug">· {t}</p>)}
              </div>
            )}
          </div>
        )}
        {pick && (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ background: clusterColor(pick.cluster) }} />
              <div className="font-medium leading-snug">{pick.title}</div>
              <button onClick={() => choose(null)} className="ml-auto text-muted hover:text-ink">×</button>
            </div>
            <div className="text-xs text-muted">{byId[pick.cluster]?.label} · {pick.year} · цитирований {fmt(pick.cited_by)} · {pick.method}</div>
            {work && (
              <>
                <div className="text-xs text-ink-2">{String(work.authors ?? "")}</div>
                <div className="text-xs text-muted">{String(work.source ?? "")} · {String(work.countries ?? "")}</div>
                <div className="flex gap-2 text-xs">
                  {work.doi && <a href={String(work.doi)} target="_blank" className="text-accent hover:underline">DOI ↗</a>}
                  <a href={`https://openalex.org/${pick.id}`} target="_blank" className="text-accent hover:underline">OpenAlex ↗</a>
                </div>
                <p className="text-xs leading-relaxed text-ink-2 border-t hairline pt-2">{String(work.abstract ?? "")}</p>
                {typeof work.topics === "string" && work.topics && <p className="text-[11px] text-muted">{work.topics}</p>}
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
