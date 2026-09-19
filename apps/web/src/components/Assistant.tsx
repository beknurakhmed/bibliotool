"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Callout, Spinner } from "./ui";

const PRESETS = [
  "Сформулируй обоснование актуальности темы на основе динамики публикаций",
  "Какие направления растут быстрее всего и почему это важно?",
  "Какие ограничения этих данных нужно указать в диссертации?",
  "Какие журналы и организации стоит включить в обзор литературы?",
];

/** Вопрос к результатам: LLM отвечает только по данным прогона (статистика + кластеры). */
export default function Assistant({ runId }: { runId: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ q: string; a: string; provider?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true); setErr(null); setQ("");
    try {
      const r = await api.ask(runId, question);
      setItems((x) => [{ q: question, a: r.answer, provider: r.provider }, ...x]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p} onClick={() => ask(p)} disabled={busy}
            className="text-xs px-2.5 py-1.5 rounded-full border hairline hover:bg-surface-2 disabled:opacity-50 text-left">{p}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Свой вопрос по результатам…"
          className="flex-1 rounded-lg border hairline bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        <button disabled={busy || !q.trim()} className="px-4 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-50">Спросить</button>
      </form>
      {busy && <Spinner label="LLM формулирует ответ (локально, может занять 20–60 с)…" />}
      {err && <Callout tone="critical">{err}</Callout>}
      {items.map((it, i) => (
        <div key={i} className="card p-4">
          <div className="text-sm font-medium">{it.q}</div>
          <div className="text-sm text-ink-2 whitespace-pre-wrap mt-2 leading-relaxed">{it.a}</div>
          <div className="text-xs text-muted mt-2">{it.provider} · ответ строится только на данных прогона</div>
        </div>
      ))}
    </div>
  );
}
