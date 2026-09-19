"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Health, RunMeta, api } from "@/lib/api";

type Ctx = { runs: RunMeta[]; health: Health | null; refresh: () => void; apiDown: boolean };
const ShellCtx = createContext<Ctx>({ runs: [], health: null, refresh: () => {}, apiDown: false });
export const useShell = () => useContext(ShellCtx);

const MODE: Record<string, string> = { sample: "случайная", recent: "свежие", relevance: "релевантность ⚠" };

export default function Shell({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [open, setOpen] = useState(false);
  const path = usePathname();

  const refresh = useCallback(() => {
    api.runs().then((r) => { setRuns(r); setApiDown(false); }).catch(() => setApiDown(true));
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [refresh]);

  const nav = (
    <>
      <div className="px-3 pt-3 pb-2">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "var(--accent)" }} />bibliotool
        </Link>
        <p className="text-[11px] text-muted mt-1 leading-snug">библиометрия + семантика · OpenAlex</p>
      </div>
      <Link href="/" onClick={() => setOpen(false)}
        className={`mx-3 my-2 px-3 py-2 rounded-lg text-sm text-center ${path === "/" ? "bg-accent text-white" : "bg-surface-2 hover:bg-accent hover:text-white"}`}>
        + Новый прогон
      </Link>
      <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted">Прогоны · {runs.length}</div>
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {runs.map((r) => {
          const active = path === `/runs/${r.id}`;
          return (
            <Link key={r.id} href={`/runs/${r.id}`} onClick={() => setOpen(false)}
              className={`block rounded-lg px-2.5 py-2 text-sm leading-snug border ${active ? "border-accent bg-surface" : "border-transparent hover:bg-surface-2"}`}>
              <div className="font-medium truncate">{r.query}</div>
              <div className="text-[11px] text-muted flex gap-1.5 mt-0.5">
                <span>{r.year_from}–{r.year_to}</span><span>·</span><span>{MODE[r.mode] ?? r.mode}</span>
                {r.has_semantic && <span className="ml-auto" style={{ color: "var(--accent)" }}>●</span>}
              </div>
            </Link>
          );
        })}
        {!runs.length && !apiDown && <p className="text-xs text-muted px-2.5 py-2">пока нет</p>}
        {apiDown && <p className="text-xs text-critical px-2.5 py-2">API недоступен — <code>pm2 start ecosystem.config.js</code></p>}
      </div>
      <div className="border-t hairline px-3 py-2 text-[11px] text-muted space-y-1">
        <Link href="/about" className={`block hover:text-ink ${path === "/about" ? "text-ink" : ""}`}>О методе</Link>
        <a href="http://localhost:8000/docs" target="_blank" className="block hover:text-ink">API /docs</a>
        <a href="http://localhost:8501" target="_blank" className="block hover:text-ink">Streamlit-версия</a>
        {health && (
          <div className="pt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: health.openalex_key && health.llm_available ? "var(--good)" : "var(--warning)" }} />
            OpenAlex {health.openalex_key ? "ok" : "нет ключа"} · {health.llm_model}
          </div>
        )}
      </div>
    </>
  );

  return (
    <ShellCtx.Provider value={{ runs, health, refresh, apiDown }}>
      <div className="flex min-h-screen">
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r hairline bg-page sticky top-0 h-screen">{nav}</aside>
        {open && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <aside className="w-72 flex flex-col bg-page border-r hairline h-full">{nav}</aside>
            <div className="flex-1 bg-black/30" onClick={() => setOpen(false)} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <header className="lg:hidden sticky top-0 z-30 h-12 flex items-center gap-3 px-4 border-b hairline bg-page/90 backdrop-blur">
            <button onClick={() => setOpen(true)} className="text-xl leading-none">☰</button>
            <span className="font-semibold">bibliotool</span>
          </header>
          <main className="px-5 py-5 max-w-[1500px]">{children}</main>
        </div>
      </div>
    </ShellCtx.Provider>
  );
}
