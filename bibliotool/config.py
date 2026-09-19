"""Конфигурация из переменных окружения / .env."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# .env ищем в текущей папке и в корне проекта
for candidate in (Path.cwd() / ".env", Path(__file__).resolve().parent.parent / ".env"):
    if candidate.exists():
        load_dotenv(candidate, override=False)
        break


@dataclass
class Settings:
    openalex_key: str = field(default_factory=lambda: os.getenv("OPENALEX_API_KEY", ""))
    mailto: str = field(default_factory=lambda: os.getenv("OPENALEX_MAILTO", ""))
    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "ollama"))
    ollama_model: str = field(default_factory=lambda: os.getenv("OLLAMA_MODEL", "qwen2.5:7b"))
    anthropic_model: str = field(default_factory=lambda: os.getenv("ANTHROPIC_MODEL", "claude-opus-5"))
    embed_model: str = field(
        default_factory=lambda: os.getenv("EMBED_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")
    )
    cache_dir: Path = field(default_factory=lambda: Path(os.getenv("BIBLIOTOOL_CACHE", ".cache")))
    runs_dir: Path = field(default_factory=lambda: Path(os.getenv("BIBLIOTOOL_RUNS", "runs")))


settings = Settings()
