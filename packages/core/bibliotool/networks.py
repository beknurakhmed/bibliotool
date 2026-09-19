"""Сетевой анализ: соавторство, коцитирование, библиографическое сопряжение.

Экспорт: GEXF (Gephi), CSV рёбер, а также map/network файлы для VOSviewer.
"""
from __future__ import annotations

import itertools
from collections import Counter
from pathlib import Path

import networkx as nx
import pandas as pd


def coauthor_network(df: pd.DataFrame, min_weight: int = 2) -> nx.Graph:
    """Авторы — узлы, совместная публикация — ребро, вес = число совместных работ."""
    G = nx.Graph()
    pubs: Counter = Counter()
    for a in df["authors"].dropna():
        names = sorted({x.strip() for x in str(a).split(";") if x.strip()})
        for n in names:
            pubs[n] += 1
        for u, v in itertools.combinations(names, 2):
            w = G.get_edge_data(u, v, {}).get("weight", 0) + 1
            G.add_edge(u, v, weight=w)
    G.remove_edges_from([(u, v) for u, v, d in G.edges(data=True) if d["weight"] < min_weight])
    G.remove_nodes_from(list(nx.isolates(G)))
    nx.set_node_attributes(G, {n: pubs[n] for n in G.nodes}, "publications")
    return G


def cocitation_network(refs: dict[str, list[str]], min_weight: int = 3,
                       top_n: int = 300, max_refs: int = 200) -> nx.Graph:
    """Две работы связаны, если их цитируют вместе в третьей публикации."""
    pair: Counter = Counter()
    for cited in refs.values():
        cited = [c for c in cited if c]
        if not cited or len(cited) > max_refs:  # обзоры с сотнями ссылок отсекаем
            continue
        for u, v in itertools.combinations(sorted(set(cited)), 2):
            pair[(u, v)] += 1
    G = nx.Graph()
    for (u, v), w in pair.items():
        if w >= min_weight:
            G.add_edge(u, v, weight=w)
    return _core(G, top_n)


def coupling_network(refs: dict[str, list[str]], min_shared: int = 3, top_n: int = 300) -> nx.Graph:
    """Библиографическое сопряжение: две работы связаны, если ссылаются на одни и те же источники."""
    sets = {k: set(v) for k, v in refs.items() if v}
    G = nx.Graph()
    for (a, ra), (b, rb) in itertools.combinations(sets.items(), 2):
        shared = len(ra & rb)
        if shared >= min_shared:
            G.add_edge(a, b, weight=shared)
    return _core(G, top_n)


def _core(G: nx.Graph, top_n: int) -> nx.Graph:
    if G.number_of_nodes() > top_n:
        keep = sorted(G.degree(weight="weight"), key=lambda x: x[1], reverse=True)[:top_n]
        G = G.subgraph([n for n, _ in keep]).copy()
    return G


def summarize(G: nx.Graph) -> dict:
    if G.number_of_nodes() == 0:
        return {"nodes": 0, "edges": 0, "components": 0, "largest_component": 0, "density": 0.0}
    comps = sorted(nx.connected_components(G), key=len, reverse=True)
    return {
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "components": len(comps),
        "largest_component": len(comps[0]),
        "density": round(nx.density(G), 4),
    }


def top_nodes(G: nx.Graph, n: int = 15) -> pd.DataFrame:
    if G.number_of_nodes() == 0:
        return pd.DataFrame(columns=["node", "degree", "weighted_degree"])
    rows = [{"node": v, "degree": G.degree(v), "weighted_degree": G.degree(v, weight="weight")}
            for v in G.nodes]
    return pd.DataFrame(rows).sort_values("weighted_degree", ascending=False).head(n).reset_index(drop=True)


def export(G: nx.Graph, out_dir: Path, name: str, labels: dict[str, str] | None = None) -> dict:
    """GEXF для Gephi, CSV рёбер, map+network для VOSviewer."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if G.number_of_nodes() == 0:
        return summarize(G)
    nx.write_gexf(G, out_dir / f"{name}.gexf")
    pd.DataFrame([{"source": u, "target": v, "weight": d["weight"]}
                  for u, v, d in G.edges(data=True)]).to_csv(out_dir / f"{name}_edges.csv", index=False)

    # VOSviewer: map file (id, label) + network file (id1, id2, weight), tab-separated
    ids = {n: i + 1 for i, n in enumerate(G.nodes)}
    labels = labels or {}
    pd.DataFrame([{"id": ids[n], "label": labels.get(n, n)} for n in G.nodes]).to_csv(
        out_dir / f"{name}_vos_map.txt", sep="\t", index=False)
    pd.DataFrame([{"id1": ids[u], "id2": ids[v], "weight": d["weight"]}
                  for u, v, d in G.edges(data=True)]).to_csv(
        out_dir / f"{name}_vos_network.txt", sep="\t", index=False, header=False)
    return summarize(G)
