// Типы и клиент REST API (проксируется через next.config rewrites на :8000)

export type RunMeta = {
  id: string; query: string; year_from: number; year_to: number; mode: string;
  limit: number; total: number; n_sample: number; has_semantic: boolean; updated: number;
  network_summary: Record<string, NetSummary>;
};
export type NetSummary = { nodes: number; edges: number; components: number; largest_component: number; density: number };
export type Cluster = {
  cluster: number; size: number; share: number; keywords: string; mean_year: number | null;
  recent_share: number | null; citations_median: number; citations_mean: number; growth: number;
  sample_titles: string[]; underexplored_score: number; label: string; description: string;
};
export type Semantic = {
  embed_method: string; cluster_method: string; projection: string; n_docs: number; n_clusters: number;
  noise_share: number; clusters: Cluster[];
  underexplored: { cluster: number; label: string; size: number; citations_mean: number; recent_share: number; underexplored_score: number }[];
  methods: { methods: Record<string, number>; data_sources: [string, number][]; tools: [string, number][] };
};
export type SampleStats = {
  n: number; with_abstract: number; with_references: number; english_share: number;
  citations_median: number; citations_mean: number; citations_max: number; zero_cited_share: number;
  international_share: number; authors_median: number; references_median: number;
  top_topics: [string, number][]; bias_warning: boolean;
};
export type RunDetail = RunMeta & {
  years: { year: number; count: number }[];
  top: Record<string, { name: string; count: number }[]>;
  sample: SampleStats;
  semantic: Semantic | null;
  files: Record<string, string>;
};
export type Point = { id: string; x: number; y: number; cluster: number; title: string; year: number; cited_by: number; method: string };
export type Graph = {
  nodes: { id: string; label: string; degree: number; weight: number; component: number }[];
  links: { source: string; target: string; weight: number }[];
  summary: NetSummary;
};
export type Job = {
  id: string; run_id: string; status: "running" | "done" | "error"; stage: string; progress: number;
  log: string[]; started: number; request: RunRequest;
};
export type RunRequest = { query: string; year_from: number; year_to: number; mode: string; limit: number; semantic: boolean; llm: boolean };
export type Health = {
  openalex_key: boolean; llm_provider: string; llm_model: string; llm_available: boolean;
  ollama_models: string[]; embed_model: string; runs: number;
};
export type Bias = {
  years: number[]; full: number[]; sample: number[]; relevance: number[];
  sample_stats: { zero_cited: number; median_cit: number; min_cit: number };
  relevance_stats: { zero_cited: number; median_cit: number; min_cit: number };
  budget_left: string | null;
};

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json();
}

export const api = {
  health: () => j<Health>("/api/health"),
  runs: () => j<RunMeta[]>("/api/runs"),
  run: (id: string) => j<RunDetail>(`/api/runs/${id}`),
  points: (id: string) => j<Point[]>(`/api/runs/${id}/points`),
  network: (id: string, kind: string, top = 150) => j<Graph>(`/api/runs/${id}/network/${kind}?top=${top}`),
  works: (id: string, p: { offset?: number; limit?: number; cluster?: number; q?: string; sort?: string }) => {
    const qs = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => v !== undefined && v !== "" && qs.set(k, String(v)));
    return j<{ total: number; items: Record<string, string | number | null>[] }>(`/api/runs/${id}/works?${qs}`);
  },
  createRun: (req: RunRequest) => j<{ job_id: string; run_id: string }>("/api/runs", { method: "POST", body: JSON.stringify(req) }),
  job: (id: string) => j<Job>(`/api/jobs/${id}`),
  jobs: () => j<Job[]>("/api/jobs"),
  bias: (id: string, n = 500) => j<Bias>(`/api/runs/${id}/bias?n=${n}`, { method: "POST" }),
  ask: (id: string, question: string) => j<{ answer: string; provider: string }>(`/api/runs/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) }),
  deleteRun: (id: string) => j<{ ok: boolean }>(`/api/runs/${id}`, { method: "DELETE" }),
};

// Категориальная палитра (8 слотов, фиксированный порядок). Кластеры > 8 получают
// светлые/тёмные ступени тех же оттенков; идентичность всегда дублируется подписью.
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
export const SERIES_ALT = ["#86b6ef", "#f4a884", "#7dd6b3", "#f7ce6a", "#f3bdd1", "#7fc27f", "#9d92dc", "#f09a9a"];
export const clusterColor = (c: number) => (c < 0 ? "#c3c2b7" : c < 8 ? SERIES[c] : SERIES_ALT[c % 8]);

export const fmt = (n: number | null | undefined, d = 0) =>
  n == null || Number.isNaN(n) ? "—" : n.toLocaleString("ru-RU", { maximumFractionDigits: d });
export const pct = (x: number | null | undefined, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
