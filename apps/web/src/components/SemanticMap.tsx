"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Cluster, Point, clusterColor } from "@/lib/api";

/** Семантическая карта на canvas: точка = публикация, цвет = кластер, подписи у центроидов. */
export default function SemanticMap({ points, clusters, selected, onSelect }: {
  points: Point[]; clusters: Cluster[]; selected: number | null; onSelect: (c: number | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [hover, setHover] = useState<{ p: Point; x: number; y: number } | null>(null);
  const labels = useMemo(() => Object.fromEntries(clusters.map((c) => [c.cluster, c.label])), [clusters]);

  const bounds = useMemo(() => {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }, [points]);
  const pad = 36;
  const sx = (x: number) => pad + ((x - bounds.x0) / (bounds.x1 - bounds.x0 || 1)) * (size.w - 2 * pad);
  const sy = (y: number) => size.h - pad - ((y - bounds.y0) / (bounds.y1 - bounds.y0 || 1)) * (size.h - 2 * pad);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: Math.max(420, Math.round(el.clientWidth * 0.62)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue("--surface").trim();
    ctx.fillRect(0, 0, size.w, size.h);
    const ink = css.getPropertyValue("--ink").trim();
    // точки: сначала невыбранные (приглушённые), потом выбранный кластер
    const order = selected == null ? points : [...points.filter((p) => p.cluster !== selected), ...points.filter((p) => p.cluster === selected)];
    for (const p of order) {
      const dim = selected != null && p.cluster !== selected;
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), dim ? 2.2 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = clusterColor(p.cluster);
      ctx.globalAlpha = dim ? 0.18 : 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!dim) { ctx.lineWidth = 1; ctx.strokeStyle = css.getPropertyValue("--surface").trim(); ctx.stroke(); }
    }
    // подписи кластеров у медианы координат
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const c of clusters) {
      if (selected != null && c.cluster !== selected) continue;
      const ps = points.filter((p) => p.cluster === c.cluster);
      if (!ps.length) continue;
      const mx = ps.map((p) => sx(p.x)).sort((a, b) => a - b)[ps.length >> 1];
      const my = ps.map((p) => sy(p.y)).sort((a, b) => a - b)[ps.length >> 1];
      const text = `${c.cluster} · ${c.label}`.slice(0, 40);
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = css.getPropertyValue("--surface").trim();
      ctx.globalAlpha = 0.88;
      ctx.beginPath(); ctx.roundRect(mx - w / 2, my - 9, w, 18, 5); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink;
      ctx.fillText(text, mx, my + 4);
    }
  }, [points, clusters, selected, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearest = (mx: number, my: number) => {
    let best: Point | null = null, bd = 64;
    for (const p of points) {
      const d = (sx(p.x) - mx) ** 2 + (sy(p.y) - my) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  return (
    <div ref={wrap} className="relative w-full">
      <canvas ref={ref} style={{ width: size.w, height: size.h, cursor: "crosshair", borderRadius: 8 }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const p = nearest(e.clientX - r.left, e.clientY - r.top);
          setHover(p ? { p, x: e.clientX - r.left, y: e.clientY - r.top } : null);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const p = nearest(e.clientX - r.left, e.clientY - r.top);
          onSelect(p ? (selected === p.cluster ? null : p.cluster) : null);
        }} />
      {hover && (
        <div className="card absolute z-10 px-3 py-2 text-xs max-w-xs pointer-events-none shadow-lg"
          style={{ left: Math.min(hover.x + 12, size.w - 260), top: hover.y + 12 }}>
          <div className="font-medium leading-snug">{hover.p.title}</div>
          <div className="text-muted mt-1">
            <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: clusterColor(hover.p.cluster) }} />
            {labels[hover.p.cluster] ?? "шум"} · {hover.p.year} · цит. {hover.p.cited_by} · {hover.p.method}
          </div>
        </div>
      )}
    </div>
  );
}
