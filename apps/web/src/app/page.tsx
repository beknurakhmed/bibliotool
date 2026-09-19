"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import RunLauncher from "@/components/RunLauncher";
import { Badge, Callout, Spinner } from "@/components/ui";
import { Health, RunMeta, api, fmt } from "@/lib/api";

const MODE: Record<string, string> = { sample: "случайная", recent: "свежие", relevance: "релевантность ⚠" };

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [runs, setRuns] = useState<RunMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.runs().then(setRuns).catch((e) => setErr(e.message));
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);
  useEffect(refresh, [refresh]);

  const del = async (id: string) => {
    if (!confirm(`Удалить прогон «${id}»?`)) return;
    await api.deleteRun(id); refresh();
  };

  return (
    <div className="space-y-8">
      <section className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight leading-tight">
            Библиометрический анализ<br /><span className="text-accent">с семантическим слоем</span>
          </h1>
          <p className="text-ink-2 mt-3 max-w-xl leading-relaxed">
            Открытая база OpenAlex (250+ млн работ, без подписки) → точная статистика по всему массиву →
            сети соавторства и коцитирования → группировка публикаций <b>по смыслу аннотаций</b>, а не по совпадению
            терминов → описание направлений языковой моделью → слабо представленные области.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {["OpenAlex API", "group_by по 100k+ работ", "Gephi / VOSviewer export", "sentence-transformers", "UMAP + HDBSCAN", "c-TF-IDF", "Ollama / Claude", "детектор смещения выборки"].map((t) => <Badge key={t}>{t}</Badge>)}
          </div>
        </div>
        <div className="card p-4 text-sm space-y-2">
          <h3 className="font-semibold">Состояние системы</h3>
          {!health && <Spinner label="API…" />}
          {health && (
            <ul className="space-y-1.5">
              <li className="flex justify-between"><span className="text-muted">OpenAlex ключ</span><Badge tone={health.openalex_key ? "good" : "critical"}>{health.openalex_key ? "задан" : "нет"}</Badge></li>
              <li className="flex justify-between"><span className="text-muted">LLM</span><Badge tone={health.llm_available ? "good" : "warning"}>{health.llm_provider} / {health.llm_model}</Badge></li>
              <li className="flex justify-between"><span className="text-muted">Эмбеддинги</span><span className="text-xs">{health.embed_model}</span></li>
              <li className="flex justify-between"><span className="text-muted">Сохранённых прогонов</span><span className="tabular">{health.runs}</span></li>
            </ul>
          )}
          {err && <Callout tone="critical">API недоступен: {err}. Запустите <code>pm2 start ecosystem.config.js</code>.</Callout>}
        </div>
      </section>

      <RunLauncher health={health} onDone={refresh} />

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">Сохранённые прогоны</h2>
          <span className="text-xs text-muted">{runs?.length ?? 0} шт.</span>
        </div>
        {!runs && !err && <Spinner />}
        {runs && runs.length === 0 && <p className="text-sm text-muted">Пока пусто — запустите первый прогон выше.</p>}
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {runs?.map((r) => (
            <div key={r.id} className="card p-4 flex flex-col gap-2 hover:border-accent transition-colors">
              <Link href={`/runs/${r.id}`} className="font-medium leading-snug hover:text-accent">«{r.query}»</Link>
              <div className="text-xs text-muted">{r.year_from}–{r.year_to} · {MODE[r.mode] ?? r.mode} · {new Date(r.updated * 1000).toLocaleDateString("ru-RU")}</div>
              <div className="flex gap-4 text-sm tabular mt-1">
                <span><span className="text-muted text-xs">в базе </span>{fmt(r.total)}</span>
                <span><span className="text-muted text-xs">выборка </span>{fmt(r.n_sample)}</span>
                <span><span className="text-muted text-xs">коцит. ядро </span>{r.network_summary?.cocitation?.largest_component ?? "—"}</span>
              </div>
              <div className="flex items-center gap-2 mt-auto pt-1">
                {r.has_semantic ? <Badge tone="accent">семантика</Badge> : <Badge>без семантики</Badge>}
                <button onClick={() => del(r.id)} className="ml-auto text-xs text-muted hover:text-critical">удалить</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
