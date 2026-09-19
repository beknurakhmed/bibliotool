"use client";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bias, api, pct } from "@/lib/api";
import { Callout, Spinner, Stat } from "./ui";

/** §5.1: тот же запрос — три процедуры выборки — противоположные выводы о динамике. */
export default function BiasDemo({ runId }: { runId: string }) {
  const [data, setData] = useState<Bias | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try { setData(await api.bias(runId, 500)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          Инструмент выгрузит 500 работ по той же теме с сортировкой по <b>релевантности</b> (значение API по умолчанию)
          и сравнит распределение по годам с случайной выборкой и с точной статистикой по всему массиву.
          Стоимость ≈ $0.005 из дневного бюджета.
        </p>
        <button onClick={run} disabled={busy} className="px-4 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-50">
          {busy ? "Выгружаем…" : "Показать эффект выборки"}
        </button>
        {busy && <Spinner label="Запрос к OpenAlex…" />}
        {err && <Callout tone="critical">{err}</Callout>}
      </div>
    );
  }

  const rows = data.years.map((y, i) => ({ year: y, "весь массив": +(data.full[i] * 100).toFixed(1),
    "случайная": +(data.sample[i] * 100).toFixed(1), "по релевантности": +(data.relevance[i] * 100).toFixed(1) }));
  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }} barCategoryGap={4} barGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: "var(--axis)" }} tick={{ fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 11 }} unit="%" />
          <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="весь массив" fill="var(--s1)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="случайная" fill="var(--s3)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="по релевантности" fill="var(--s2)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Нецитируемых · случайная" value={pct(data.sample_stats.zero_cited)} hint={`медиана цит. ${data.sample_stats.median_cit}`} tone="good" />
        <Stat label="Нецитируемых · релевантность" value={pct(data.relevance_stats.zero_cited)} hint={`медиана цит. ${data.relevance_stats.median_cit}`} tone="critical" />
        <Stat label="Мин. цитирований · случайная" value={String(data.sample_stats.min_cit)} />
        <Stat label="Мин. цитирований · релевантность" value={String(data.relevance_stats.min_cit)} />
      </div>
      <Callout tone="info">
        Релевантность коррелирует с цитируемостью, а цитируемость накапливается со временем: сортировка по релевантности
        систематически отбирает старые работы и показывает ложный «спад». Один и тот же запрос к одной базе даёт
        противоположные выводы в зависимости от параметров выборки — процедура сбора данных определяет результат исследования.
      </Callout>
    </div>
  );
}
