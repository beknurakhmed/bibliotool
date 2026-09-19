"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Health, Job, RunRequest, api } from "@/lib/api";
import { Badge, Callout } from "./ui";

const STAGES: Record<string, string> = {
  queue: "В очереди", stats: "Статистика по массиву", fetch: "Выгрузка записей", networks: "Сети",
  semantic: "Семантический слой", report: "Отчёт", done: "Готово",
};

export default function RunLauncher({ health, onDone }: { health: Health | null; onDone: () => void }) {
  const [req, setReq] = useState<RunRequest>({ query: "artificial intelligence in education", year_from: 2015, year_to: 2026, mode: "sample", limit: 1000, semantic: true, llm: true });
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(async () => {
      try {
        const j = await api.job(job.id);
        setJob(j);
        if (j.status !== "running") { clearInterval(t); onDone(); }
      } catch { /* сервер перезапускается */ }
    }, 1500);
    return () => clearInterval(t);
  }, [job, onDone]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try {
      const r = await api.createRun(req);
      setJob({ id: r.job_id, run_id: r.run_id, status: "running", stage: "queue", progress: 0, log: [], started: Date.now() / 1000, request: req });
    } catch (e) { setErr((e as Error).message); }
  };

  const set = <K extends keyof RunRequest>(k: K, v: RunRequest[K]) => setReq((r) => ({ ...r, [k]: v }));
  const running = job?.status === "running";

  return (
    <div className="grid lg:grid-cols-[1fr_1.1fr] gap-4">
      <form onSubmit={submit} className="card p-4 space-y-3">
        <h3 className="font-semibold">Новый прогон</h3>
        <label className="block text-sm">
          <span className="text-muted text-xs">Тематический запрос (title + abstract)</span>
          <input value={req.query} onChange={(e) => set("query", e.target.value)} required
            className="mt-1 w-full rounded-lg border hairline bg-surface px-3 py-2 outline-none focus:border-accent" />
        </label>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <label><span className="text-muted text-xs">С года</span>
            <input type="number" value={req.year_from} onChange={(e) => set("year_from", +e.target.value)} className="mt-1 w-full rounded-lg border hairline bg-surface px-3 py-2" /></label>
          <label><span className="text-muted text-xs">По год</span>
            <input type="number" value={req.year_to} onChange={(e) => set("year_to", +e.target.value)} className="mt-1 w-full rounded-lg border hairline bg-surface px-3 py-2" /></label>
          <label><span className="text-muted text-xs">Записей</span>
            <input type="number" min={100} max={10000} step={100} value={req.limit} onChange={(e) => set("limit", +e.target.value)} className="mt-1 w-full rounded-lg border hairline bg-surface px-3 py-2" /></label>
        </div>
        <div className="text-sm">
          <span className="text-muted text-xs">Режим выборки</span>
          <div className="flex gap-2 mt-1">
            {[["sample", "случайная"], ["recent", "свежие"], ["relevance", "релевантность ⚠"]].map(([m, n]) => (
              <button type="button" key={m} onClick={() => set("mode", m)}
                className={`px-3 py-1.5 rounded-full border hairline text-sm ${req.mode === m ? "bg-accent text-white border-transparent" : "hover:bg-surface-2"}`}>{n}</button>
            ))}
          </div>
          {req.mode === "relevance" && <p className="text-xs text-warning mt-1">Смещённая выборка — только для демонстрации эффекта (§5.1).</p>}
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={req.semantic} onChange={(e) => set("semantic", e.target.checked)} /> Семантический слой</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={req.llm} onChange={(e) => set("llm", e.target.checked)} disabled={!req.semantic} /> Описание кластеров LLM</label>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button disabled={running || !health?.openalex_key} className="px-4 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-50">
            {running ? "Выполняется…" : "Запустить"}
          </button>
          <span className="text-xs text-muted">≈ ${(0.001 * 10 + req.limit / 100 * 0.001).toFixed(3)} бюджета OpenAlex · семантика ~1–3 мин на 1000 записей</span>
        </div>
        {err && <Callout tone="critical">{err}</Callout>}
        {!health?.openalex_key && <Callout tone="critical">Нет OPENALEX_API_KEY в .env — прогон невозможен.</Callout>}
      </form>

      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Ход выполнения</h3>
          {job && <Badge tone={job.status === "done" ? "good" : job.status === "error" ? "critical" : "accent"}>{STAGES[job.stage] ?? job.stage}</Badge>}
        </div>
        {!job && <p className="text-sm text-muted mt-3">Запустите прогон — здесь появится лог этапов.</p>}
        {job && (
          <>
            <div className="h-1.5 rounded-full bg-surface-2 mt-3 overflow-hidden">
              <div className="h-full transition-all" style={{ width: `${Math.round(job.progress * 100)}%`, background: job.status === "error" ? "var(--critical)" : "var(--accent)" }} />
            </div>
            <pre className="mt-3 text-xs leading-relaxed text-ink-2 whitespace-pre-wrap max-h-64 overflow-auto font-mono">{job.log.join("\n") || "…"}</pre>
            {job.status === "done" && (
              <Link href={`/runs/${job.run_id}`} className="inline-block mt-3 px-4 py-2 rounded-lg bg-accent text-white text-sm">Открыть результаты →</Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
