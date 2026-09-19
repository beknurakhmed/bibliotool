"""UI: приложение открывает сохранённый прогон без исключений (streamlit AppTest)."""
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

ROOT = Path(__file__).resolve().parent.parent
RUNS = [p for p in (ROOT / "runs").glob("*") if (p / "meta.json").exists()] if (ROOT / "runs").exists() else []


@pytest.mark.skipif(not RUNS, reason="нет сохранённых прогонов в runs/")
def test_app_opens_saved_run():
    at = AppTest.from_file(str(ROOT / "app" / "streamlit_app.py"), default_timeout=120)
    at.run()
    assert not at.exception
    at.selectbox[0].select(RUNS[0].name).run()
    assert not at.exception, at.exception
    assert at.tabs  # вкладки отрисованы
