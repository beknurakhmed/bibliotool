"""Конфигурация из переменных окружения / .env.

Корень монорепозитория определяется по файлу .env (или BIBLIOTOOL_ROOT);
данные прогонов и кеш по умолчанию лежат в <root>/data/.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


def find_root() -> Path:
    if os.getenv("BIBLIOTOOL_ROOT"):
        return Path(os.environ["BIBLIOTOOL_ROOT"]).resolve()
    for start in (Path.cwd(), Path(__file__).resolve()):
        for p in (start, *start.parents):
            if (p / ".env").exists() or (p / "ecosystem.config.js").exists():
                return p
    return Path.cwd()


ROOT = find_root()
if (ROOT / ".env").exists():
    load_dotenv(ROOT / ".env", override=False)


@dataclass
class Settings:
    root: Path = ROOT
    openalex_key: str = field(default_factory=lambda: os.getenv("OPENALEX_API_KEY", ""))
    mailto: str = field(default_factory=lambda: os.getenv("OPENALEX_MAILTO", ""))
    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "ollama"))
    ollama_model: str = field(default_factory=lambda: os.getenv("OLLAMA_MODEL", "qwen2.5:7b"))
    anthropic_model: str = field(default_factory=lambda: os.getenv("ANTHROPIC_MODEL", "claude-opus-5"))
    embed_model: str = field(
        default_factory=lambda: os.getenv("EMBED_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")
    )
    cache_dir: Path = field(default_factory=lambda: Path(os.getenv("BIBLIOTOOL_CACHE", ROOT / "data" / "cache")))
    runs_dir: Path = field(default_factory=lambda: Path(os.getenv("BIBLIOTOOL_RUNS", ROOT / "data" / "runs")))


settings = Settings()
