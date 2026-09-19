"""Офлайн-тесты: без обращений к OpenAlex и LLM."""
import numpy as np
import pandas as pd

from bibliotool import networks, semantic
from bibliotool.data import flatten, restore_abstract
from bibliotool.stats import sample_stats


def test_restore_abstract():
    inv = {"world": [1], "Hello": [0], "again": [2]}
    assert restore_abstract(inv) == "Hello world again"
    assert restore_abstract(None) is None


def _work(i, authors, refs, year=2020, cited=0, abstract="a b c"):
    return {
        "id": f"https://openalex.org/W{i}", "doi": None, "title": f"Paper {i}",
        "publication_year": year, "publication_date": f"{year}-01-01", "type": "article",
        "language": "en", "cited_by_count": cited, "open_access": {"is_oa": True},
        "authorships": [{"author": {"id": f"https://openalex.org/A{a}", "display_name": a},
                         "institutions": [{"display_name": "Uni"}], "countries": ["UZ"]} for a in authors],
        "primary_location": {"source": {"display_name": "J", "type": "journal"}},
        "topics": [{"display_name": "T"}],
        "abstract_inverted_index": {w: [k] for k, w in enumerate(abstract.split())},
        "referenced_works": [f"https://openalex.org/W{r}" for r in refs],
    }


def test_flatten_and_stats():
    works = [_work(1, ["Ann", "Bob"], [10, 11], cited=5), _work(2, ["Ann", "Bob"], [10, 11, 12], cited=0)]
    df, refs = flatten(works)
    assert list(df["id"]) == ["W1", "W2"]
    assert df.loc[0, "authors"] == "Ann; Bob"
    assert refs["W2"] == ["W10", "W11", "W12"]
    ss = sample_stats(df)
    assert ss["zero_cited_share"] == 0.5 and not ss["bias_warning"]


def test_networks():
    works = [_work(i, ["Ann", "Bob"], [10, 11, 12]) for i in range(5)] + [_work(9, ["Cy"], [99])]
    df, refs = flatten(works)
    G = networks.coauthor_network(df, min_weight=2)
    assert G.has_edge("Ann", "Bob") and G["Ann"]["Bob"]["weight"] == 5
    assert "Cy" not in G  # изолированный автор удаляется
    C = networks.cocitation_network(refs, min_weight=3)
    assert C.has_edge("W10", "W11") and C["W10"]["W11"]["weight"] == 5
    assert networks.summarize(C)["components"] == 1


def test_semantic_pipeline_tfidf(monkeypatch):
    """Семантика на fallback-векторизаторе (без скачивания модели)."""
    monkeypatch.setattr(semantic.settings, "embed_model", "nonexistent/model-xyz")
    rng = np.random.default_rng(0)
    topics = {
        "edu": "students teachers classroom learning curriculum school education pedagogy",
        "med": "patients clinical hospital treatment disease diagnosis therapy medicine",
        "eco": "market economy finance investment inflation banking trade growth",
    }
    rows = []
    for i in range(90):
        t = list(topics)[i % 3]
        words = topics[t].split()
        abstract = " ".join(rng.choice(words, 40)) + " " + " ".join(rng.choice(words, 40))
        rows.append({"id": f"W{i}", "title": f"{t} paper {i}", "abstract": abstract,
                     "year": 2015 + i % 10, "cited_by": int(rng.integers(0, 50))})
    df = pd.DataFrame(rows)
    result, d = semantic.run_semantic(df, 2026, llm=None, log=lambda *_: None)
    assert result["embed_method"] == "tfidf+svd"
    assert result["n_clusters"] >= 2
    assert {"cluster", "x", "y", "method"} <= set(d.columns)
    assert all(c["keywords"] for c in result["clusters"])


def test_detect_methods():
    df = pd.DataFrame({"id": ["a", "b", "c"], "title": ["x", "y", "z"], "abstract": [
        "We surveyed 300 teachers and used regression; data from Scopus analysed in VOSviewer.",
        "Semi-structured interviews and thematic analysis with 12 participants.",
        "This systematic literature review follows PRISMA.",
    ]})
    m = semantic.detect_methods(df)
    assert list(m["method"]) == ["quantitative", "qualitative", "review"]
    assert m.loc[0, "data_sources"] == "Scopus" and m.loc[0, "tools"] == "VOSviewer"
