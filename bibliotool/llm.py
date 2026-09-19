"""Единый интерфейс к LLM: Ollama (локально) или Anthropic (Claude)."""
from __future__ import annotations

import json
import re

from .config import settings


class LLM:
    def __init__(self, provider: str | None = None, model: str | None = None):
        self.provider = (provider or settings.llm_provider).lower()
        if self.provider == "anthropic":
            import anthropic
            self.client = anthropic.Anthropic()
            self.model = model or settings.anthropic_model
        elif self.provider == "ollama":
            import ollama
            self.client = ollama
            self.model = model or settings.ollama_model
        else:
            raise ValueError(f"Неизвестный провайдер LLM: {self.provider}")

    def complete(self, prompt: str, system: str = "", max_tokens: int = 1500) -> str:
        if self.provider == "anthropic":
            r = self.client.messages.create(
                model=self.model, max_tokens=max_tokens,
                system=system or anthropic_default_system(),
                messages=[{"role": "user", "content": prompt}],
            )
            return "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
        msgs = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.append({"role": "user", "content": prompt})
        r = self.client.chat(model=self.model, messages=msgs, options={"num_predict": max_tokens,
                                                                        "temperature": 0.2})
        return r["message"]["content"]

    def complete_json(self, prompt: str, system: str = "", max_tokens: int = 1500) -> dict:
        text = self.complete(prompt + "\n\nОтветь строго одним JSON-объектом без пояснений.",
                             system, max_tokens)
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise ValueError(f"LLM не вернул JSON: {text[:200]}")
        return json.loads(m.group(0))


def anthropic_default_system() -> str:
    return "Ты — аналитик научной литературы. Отвечай кратко, по существу, на русском языке."


def available() -> bool:
    """Доступен ли LLM без ошибки (для UI/CLI: пропускать описание кластеров, если нет)."""
    try:
        llm = LLM()
        if llm.provider == "ollama":
            llm.client.list()
        return True
    except Exception:
        return False
