"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Graph, SERIES, api } from "@/lib/api";
import { Badge, Spinner } from "./ui";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const KINDS = [
  { id: "cocitation", name: "Коцитирование", hint: "две работы связаны, если их цитируют вместе" },
  { id: "coupling", name: "Библиографическое сопряжение", hint: "две работы ссылаются на одни и те же источники" },
  { id: "coauthorship", name: "Соавторство", hint: "авторы — узлы, совместные публикации — рёбра" },
];

export default function NetworkGraph({ runId }: { runId: string }) {
  const [kind, setKind] = useState("cocitation");
  const [data, setData] = useState<Graph | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    api.network(runId, kind, 200)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [runId, kind]);
  const select = (k: string) => { setData(null); setErr(null); setKind(k); };

  const s = data?.summary;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {KINDS.map((k) => (
          <button key={k.id} onClick={() => select(k.id)} title={k.hint}
            className={`text-sm px-3 py-1.5 rounded-full border hairline ${kind === k.id ? "bg-accent text-white border-transparent" : "hover:bg-surface-2"}`}>
            {k.name}
          </button>
        ))}
        {s && (
          <span className="ml-auto flex gap-2 text-xs">
            <Badge>узлов {s.nodes}</Badge><Badge>рёбер {s.edges}</Badge>
            <Badge>компонент {s.components}</Badge><Badge>ядро {s.largest_component}</Badge>
          </span>
        )}
      </div>
      <p className="text-xs text-muted mb-2">{KINDS.find((k) => k.id === kind)?.hint}. Цвет — компонента связности; размер — взвешенная степень. Показаны до 200 самых связанных узлов.</p>
      <div ref={wrap} className="rounded-lg overflow-hidden border hairline" style={{ background: "var(--surface)" }}>
        {err && <div className="p-6 text-sm text-critical">{err}</div>}
        {!data && !err && <Spinner label="Строим сеть…" />}
        {data && data.nodes.length === 0 && <div className="p-6 text-sm text-muted">Сеть пуста при текущих порогах.</div>}
        {data && data.nodes.length > 0 && (
          <ForceGraph2D
            graphData={data} width={w} height={520} backgroundColor="rgba(0,0,0,0)"
            nodeLabel={(n) => `${(n as { label: string }).label}<br/><small>степень ${(n as { degree: number }).degree}</small>`}
            nodeVal={(n) => Math.max(1, Math.sqrt((n as { weight: number }).weight))}
            nodeColor={(n) => SERIES[(n as { component: number }).component % SERIES.length]}
            linkColor={() => "rgba(137,135,129,0.35)"}
            linkWidth={(l) => Math.min(4, 0.6 + (l as { weight: number }).weight * 0.4)}
            cooldownTicks={120} enableNodeDrag
          />
        )}
      </div>
    </div>
  );
}
