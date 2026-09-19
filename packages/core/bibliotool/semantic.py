"""Семантический слой: эмбеддинги аннотаций -> кластеры по смыслу -> описание LLM.

Отличие от карт ключевых слов: две работы об одном и том же, написанные разными
словами, попадают в один кластер, потому что сравниваются векторы смысла, а не
совпадение терминов.

Важная оговорка (см. описание проекта, §6.2): «слабо представленные направления»
— это области с малым числом публикаций в данной выборке из данной базы,
а не пробелы в науке как таковой.
"""
from __future__ import annotations

import re
from collections import Counter

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA, TruncatedSVD
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.preprocessing import normalize

from .config import settings

# ----------------------------------------------------------------- эмбеддинги


def embed(texts: list[str], model_name: str | None = None, log=print) -> tuple[np.ndarray, str]:
    """Возвращает (матрица векторов, название метода)."""
    model_name = model_name or settings.embed_model
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(model_name)
        vec = model.encode(texts, batch_size=64, show_progress_bar=False, normalize_embeddings=True)
        return np.asarray(vec, dtype=np.float32), f"sentence-transformers/{model_name}"
    except Exception as e:  # нет библиотеки / модели / сети
        log(f"sentence-transformers недоступен ({type(e).__name__}), fallback: TF-IDF + SVD")
        tfidf = TfidfVectorizer(max_features=20000, ngram_range=(1, 2), stop_words="english",
                                min_df=2, sublinear_tf=True)
        X = tfidf.fit_transform(texts)
        k = min(200, X.shape[1] - 1, len(texts) - 1)
        vec = TruncatedSVD(n_components=max(2, k), random_state=42).fit_transform(X)
        return normalize(vec).astype(np.float32), "tfidf+svd"


def reduce_2d(vec: np.ndarray) -> tuple[np.ndarray, str]:
    try:
        import umap
        return umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.1,
                         random_state=42).fit_transform(vec), "umap"
    except Exception:
        return PCA(n_components=2, random_state=42).fit_transform(vec), "pca"


# ----------------------------------------------------------------- кластеризация


def _assign_outliers(vec: np.ndarray, labels: np.ndarray) -> np.ndarray:
    """Точки-выбросы HDBSCAN (-1) относим к ближайшему центроиду (косинусная близость).
    Как reduce_outliers в BERTopic: структура — от плотностной кластеризации, но ни один
    документ не теряется."""
    labels = labels.copy()
    ids = sorted(set(labels) - {-1})
    if not ids or not (labels == -1).any():
        return labels
    cents = normalize(np.vstack([vec[labels == c].mean(axis=0) for c in ids]))
    noise = np.where(labels == -1)[0]
    sims = normalize(vec[noise]) @ cents.T
    labels[noise] = np.asarray(ids)[sims.argmax(axis=1)]
    return labels


def cluster(vec: np.ndarray, min_cluster_size: int | None = None, log=print) -> tuple[np.ndarray, str]:
    """UMAP → HDBSCAN; выбросы относятся к ближайшему кластеру. Если структура не найдена — KMeans."""
    n = len(vec)
    min_cluster_size = min_cluster_size or int(np.clip(n / 100, 8, 30))
    # снижаем размерность перед плотностной кластеризацией
    dim = min(20, vec.shape[1], n - 1)
    try:
        import umap
        low = umap.UMAP(n_components=min(10, dim), n_neighbors=15, min_dist=0.0,
                        random_state=42).fit_transform(vec)
    except Exception:
        low = PCA(n_components=dim, random_state=42).fit_transform(vec)

    try:
        from sklearn.cluster import HDBSCAN
        for method in ("eom", "leaf"):
            raw = HDBSCAN(min_cluster_size=min_cluster_size, cluster_selection_method=method).fit_predict(low)
            n_clusters = len(set(raw)) - (1 if -1 in raw else 0)
            noise = float((raw == -1).mean())
            if n_clusters >= 4 and noise < 0.7:
                log(f"HDBSCAN/{method}: кластеров {n_clusters}, выбросов {noise:.0%} → отнесены к ближайшему кластеру")
                return _assign_outliers(vec, raw), f"hdbscan-{method}(min_cluster_size={min_cluster_size}, outliers={noise:.0%})"
            log(f"HDBSCAN/{method}: кластеров {n_clusters}, выбросов {noise:.0%} — недостаточно структуры")
    except Exception as e:
        log(f"HDBSCAN недоступен ({type(e).__name__})")

    from sklearn.cluster import KMeans
    k = int(np.clip(np.sqrt(n / 2), 4, 25))
    labels = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(vec)
    return labels, f"kmeans(k={k})"


# ----------------------------------------------------------------- ключевые слова (c-TF-IDF)


TOKEN_RE = r"(?u)\b[a-zA-Z][a-zA-Z-]{2,}\b"

GENERIC_WORDS = {
    "research", "study", "studies", "analysis", "paper", "papers", "article", "articles", "results",
    "result", "data", "using", "based", "review", "literature", "publications", "publication",
    "journal", "journals", "authors", "author", "findings", "field", "published", "approach",
    "aim", "aims", "method", "methods", "used", "use", "new", "years", "year", "number", "total",
    "trends", "trend", "current", "future", "growth", "topics", "topic", "countries", "country",
    "documents", "document", "database", "science", "scientific", "web", "scopus", "bibliometric",
    "bibliometrics", "vosviewer", "citespace", "citation", "citations", "cited", "keywords",
    "keyword", "mapping", "map", "network", "analyzed", "analysed", "identify", "identified",
    "provide", "provides", "shows", "show", "significant", "most", "also", "la", "de", "en", "el",
}


def cluster_keywords(texts: list[str], labels: np.ndarray, top_k: int = 10,
                     extra_stop: set[str] | None = None) -> dict[int, list[str]]:
    """Class-based TF-IDF: слова, характерные для кластера относительно всех остальных.
    Слова запроса и общенаучная лексика исключаются — иначе они забивают все кластеры."""
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
    stop = set(ENGLISH_STOP_WORDS) | GENERIC_WORDS | (extra_stop or set())
    docs_by_cluster: dict[int, list[str]] = {}
    for t, l in zip(texts, labels):
        docs_by_cluster.setdefault(int(l), []).append(t)
    ids = sorted(docs_by_cluster)
    joined = [" ".join(docs_by_cluster[i]) for i in ids]
    cv = CountVectorizer(ngram_range=(1, 2), stop_words=list(stop), min_df=1, max_features=50000,
                         token_pattern=TOKEN_RE)
    X = cv.fit_transform(joined).toarray().astype(float)
    tf = X / (X.sum(axis=1, keepdims=True) + 1e-9)
    df = (X > 0).sum(axis=0)
    idf = np.log(1 + len(ids) / (df + 1e-9))
    ctfidf = tf * idf
    terms = cv.get_feature_names_out()
    out = {}
    for row, cid in zip(ctfidf, ids):
        top = np.argsort(row)[::-1][:top_k]
        out[cid] = [terms[i] for i in top if row[i] > 0]
    return out


# ----------------------------------------------------------------- профиль кластеров


def cluster_profiles(df: pd.DataFrame, labels: np.ndarray, keywords: dict[int, list[str]],
                     year_to: int) -> pd.DataFrame:
    d = df.copy()
    d["cluster"] = labels
    recent_from = year_to - 2
    rows = []
    total = len(d)
    for cid, g in d.groupby("cluster"):
        yrs = g["year"].dropna()
        # тренд: наклон числа публикаций по годам (нормированный на среднее)
        slope = 0.0
        if yrs.nunique() >= 3:
            counts = yrs.value_counts().sort_index()
            x = counts.index.values.astype(float)
            slope = float(np.polyfit(x, counts.values.astype(float), 1)[0] / max(counts.mean(), 1))
        rows.append({
            "cluster": int(cid),
            "size": int(len(g)),
            "share": round(len(g) / total, 4),
            "keywords": ", ".join(keywords.get(int(cid), [])[:8]),
            "mean_year": round(float(yrs.mean()), 1) if len(yrs) else None,
            "recent_share": round(float((yrs >= recent_from).mean()), 3) if len(yrs) else None,
            "citations_median": float(g["cited_by"].median()),
            "citations_mean": round(float(g["cited_by"].mean()), 1),
            "growth": round(slope, 3),
            "sample_titles": g.sort_values("cited_by", ascending=False)["title"].head(5).tolist(),
        })
    prof = pd.DataFrame(rows)
    if (prof["cluster"] == -1).any():
        prof = prof[prof["cluster"] != -1].copy()
    # «слабо представленные»: мало работ, но высокий интерес (цитируемость) или свежесть
    if len(prof):
        size_rank = prof["size"].rank(pct=True)
        cit_rank = prof["citations_mean"].rank(pct=True)
        rec_rank = prof["recent_share"].fillna(0).rank(pct=True)
        prof["underexplored_score"] = ((1 - size_rank) * 0.5 + cit_rank * 0.25 + rec_rank * 0.25).round(3)
    return prof.sort_values("size", ascending=False).reset_index(drop=True)


# ----------------------------------------------------------------- описание кластеров LLM

SYSTEM_DESCRIBE = ("Ты — аналитик научной литературы. По ключевым словам и заголовкам работ "
                   "определи тематическое направление. Отвечай ТОЛЬКО на русском языке, "
                   "кириллицей; латиницей допустимы лишь аббревиатуры (AI, HRM, ESG).")


def describe_clusters(profiles: pd.DataFrame, llm, log=print) -> pd.DataFrame:
    labels, descs = [], []
    for _, r in profiles.iterrows():
        titles = "\n".join(f"- {t}" for t in r["sample_titles"])
        prompt = (f"Ключевые слова кластера: {r['keywords']}\n"
                  f"Примеры заголовков:\n{titles}\n\n"
                  'Верни JSON: {"label": короткое название направления (3-6 слов), '
                  '"description": 1-2 предложения о том, что изучают эти работы}')
        try:
            j = llm.complete_json(prompt, SYSTEM_DESCRIBE, max_tokens=300)
            labels.append(str(j.get("label", "")).strip(" .:;\"'«»"))
            descs.append(str(j.get("description", "")).strip())
        except Exception as e:
            log(f"кластер {r['cluster']}: LLM ошибка {type(e).__name__}: {e}")
            labels.append(r["keywords"].split(",")[0])
            descs.append("")
    profiles = profiles.copy()
    profiles["label"] = labels
    profiles["description"] = descs
    return profiles


# ----------------------------------------------------------------- методы / данные / инструменты

METHOD_PATTERNS = {
    "quantitative": r"\b(survey|questionnaire|regression|statistic\w*|experiment\w*|quasi-experiment\w*|"
                    r"randomi[sz]ed|sample of \d+|n\s*=\s*\d+|structural equation|anova|t-test|"
                    r"correlation|bibliometric|scientometric|meta-analysis|quantitative)\b",
    "qualitative": r"\b(interview\w*|focus group\w*|case stud\w+|thematic analysis|grounded theory|"
                   r"ethnograph\w*|content analysis|phenomenolog\w*|qualitative|narrative)\b",
    "mixed": r"\b(mixed[- ]method\w*|sequential explanatory|convergent design)\b",
    "review": r"\b(systematic review|literature review|scoping review|prisma|state of the art|overview)\b",
    "design": r"\b(design[- ]based research|prototype|framework is proposed|we propose|implementation)\b",
}
DATA_SOURCES = ["Scopus", "Web of Science", "WoS", "OpenAlex", "Dimensions", "Google Scholar",
                "PubMed", "Lens", "Crossref", "Semantic Scholar", "IEEE Xplore", "ERIC"]
TOOLS = ["VOSviewer", "CiteSpace", "Bibliometrix", "Biblioshiny", "Gephi", "SciMAT", "HistCite",
         "Pajek", "BibExcel", "CitNetExplorer", "R package", "Python"]


def detect_methods(df: pd.DataFrame) -> pd.DataFrame:
    """Эвристика по аннотации: тип исследования, базы данных, инструменты.
    Работает нестабильно (см. §3.4 описания) — оформлено как ограничение."""
    texts = (df["title"].fillna("") + ". " + df["abstract"].fillna("")).str.lower()
    out = pd.DataFrame({"id": df["id"].values})
    for name, pat in METHOD_PATTERNS.items():
        rx = re.compile(pat)
        out[f"m_{name}"] = [bool(rx.search(t)) for t in texts]

    def classify(row):
        if row["m_mixed"]:
            return "mixed"
        q, ql = row["m_quantitative"], row["m_qualitative"]
        if q and ql:
            return "mixed"
        if q:
            return "quantitative"
        if ql:
            return "qualitative"
        if row["m_review"]:
            return "review"
        if row["m_design"]:
            return "design/development"
        return "unclear"

    out["method"] = out.apply(classify, axis=1)
    raw = (df["title"].fillna("") + ". " + df["abstract"].fillna("")).values
    out["data_sources"] = ["; ".join(s for s in DATA_SOURCES
                                     if re.search(rf"\b{re.escape(s)}\b", t, re.I)) for t in raw]
    out["tools"] = ["; ".join(s for s in TOOLS
                              if re.search(rf"\b{re.escape(s)}\b", t, re.I)) for t in raw]
    return out


def methods_summary(m: pd.DataFrame) -> dict:
    srcs, tools = Counter(), Counter()
    for v in m["data_sources"]:
        srcs.update(x for x in v.split("; ") if x)
    for v in m["tools"]:
        tools.update(x for x in v.split("; ") if x)
    return {
        "methods": {k: int(v) for k, v in m["method"].value_counts().items()},
        "data_sources": srcs.most_common(10),
        "tools": tools.most_common(10),
    }


# ----------------------------------------------------------------- pipeline


def run_semantic(df: pd.DataFrame, year_to: int, llm=None, log=print,
                 min_cluster_size: int | None = None, query: str = "") -> tuple[dict, pd.DataFrame]:
    """Полный семантический слой. Возвращает (json-совместимый словарь, df с колонками cluster/x/y)."""
    d = df[df["abstract"].notna() & (df["abstract"].str.len() > 100)].copy()
    log(f"Аннотаций, пригодных для анализа: {len(d)} из {len(df)}")
    if len(d) < 30:
        raise ValueError("Слишком мало аннотаций для семантического анализа (< 30)")
    texts = (d["title"].fillna("") + ". " + d["abstract"]).tolist()

    log("Эмбеддинги…")
    vec, embed_method = embed(texts, log=log)
    log(f"  метод: {embed_method}, размерность {vec.shape[1]}")

    log("Кластеризация…")
    labels, cluster_method = cluster(vec, min_cluster_size, log=log)
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    log(f"  метод: {cluster_method}, кластеров {n_clusters}, шум {(labels == -1).mean():.0%}")

    xy, proj = reduce_2d(vec)
    d["cluster"] = labels
    d["x"], d["y"] = xy[:, 0], xy[:, 1]

    kw = cluster_keywords(texts, labels, extra_stop=set(re.findall(r"[a-z]+", query.lower())))
    profiles = cluster_profiles(d, labels, kw, year_to)
    if llm is not None:
        log("Описание кластеров LLM…")
        profiles = describe_clusters(profiles, llm, log=log)
    else:
        profiles["label"] = profiles["keywords"].str.split(",").str[0]
        profiles["description"] = ""

    methods = detect_methods(d)
    d = d.merge(methods[["id", "method", "data_sources", "tools"]], on="id", how="left")

    result = {
        "embed_method": embed_method,
        "cluster_method": cluster_method,
        "projection": proj,
        "n_docs": int(len(d)),
        "n_clusters": int(n_clusters),
        "noise_share": float((labels == -1).mean()),
        "clusters": profiles.to_dict(orient="records"),
        "underexplored": profiles.sort_values("underexplored_score", ascending=False)
                                 .head(5)[["cluster", "label", "size", "citations_mean",
                                           "recent_share", "underexplored_score"]]
                                 .to_dict(orient="records"),
        "methods": methods_summary(methods),
    }
    return result, d
