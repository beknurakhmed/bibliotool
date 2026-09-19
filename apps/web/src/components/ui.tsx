"use client";
import { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { fmt } from "@/lib/api";

export function Card({ title, subtitle, children, className = "", right }: {
  title?: string; subtitle?: string; children: ReactNode; className?: string; right?: ReactNode;
}) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            {title && <h3 className="font-semibold leading-tight">{title}</h3>}
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "warning" | "critical" }) {
  const color = tone === "good" ? "var(--good)" : tone === "warning" ? "var(--warning)" : tone === "critical" ? "var(--critical)" : "var(--ink)";
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold mt-0.5" style={{ color }}>{value}</div>
      {hint && <div className="text-xs text-muted mt-0.5">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "critical" | "accent" }) {
  const bg = { neutral: "var(--surface-2)", good: "color-mix(in oklab, var(--good) 15%, transparent)",
    warning: "color-mix(in oklab, var(--warning) 20%, transparent)", critical: "color-mix(in oklab, var(--critical) 15%, transparent)",
    accent: "color-mix(in oklab, var(--accent) 15%, transparent)" }[tone];
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs" style={{ background: bg }}>{children}</span>;
}

export function Callout({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "info" | "critical" }) {
  const c = tone === "warning" ? "var(--warning)" : tone === "critical" ? "var(--critical)" : "var(--accent)";
  return (
    <div className="rounded-lg px-3 py-2 text-sm text-ink-2 border" style={{ borderColor: c, background: `color-mix(in oklab, ${c} 8%, transparent)` }}>
      {children}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function Tip({ active, payload, label, unit = "" }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-xs shadow-md">
      <div className="text-muted">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="tabular font-medium">{fmt(p.value)}{unit}</div>
      ))}
    </div>
  );
}

/** Горизонтальные столбцы для рейтингов (страны, организации...). Один ряд — без легенды. */
export function HBars({ data, color = "var(--s1)", height, unit = "" }: {
  data: { name: string; count: number }[]; color?: string; height?: number; unit?: string;
}) {
  const h = height ?? Math.max(160, data.length * 24 + 20);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 40, top: 4, bottom: 4 }} barCategoryGap={2}>
        <CartesianGrid horizontal={false} strokeDasharray="0" />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={170} tickLine={false} axisLine={false}
          tick={{ fontSize: 11 }} interval={0} tickFormatter={(v: string) => (v.length > 28 ? v.slice(0, 27) + "…" : v)} />
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} maxBarSize={18}
          label={{ position: "right", fontSize: 11, fill: "var(--ink-2)", formatter: (v) => fmt(Number(v)) }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Вертикальные столбцы по годам; последний год можно выделить как неполный. */
export function VBars({ data, xKey = "year", yKey = "count", color = "var(--s1)", height = 240, partialLast = false }: {
  data: Record<string, number>[]; xKey?: string; yKey?: string; color?: string; height?: number; partialLast?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} barCategoryGap={3}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tick={{ fontSize: 11 }} />
        <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmt(v)} />
        <Tooltip content={<Tip />} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey={yKey} radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((_, i) => (
            <Cell key={i} fill={color} fillOpacity={partialLast && i === data.length - 1 ? 0.45 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted py-6 justify-center">
      <span className="pulse inline-block w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} />
      {label ?? "Загрузка…"}
    </div>
  );
}
