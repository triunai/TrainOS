import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(scope="session")
def template_15() -> bytes:
    return (FIXTURES / "sample-template-15.pdf").read_bytes()


@pytest.fixture(scope="session")
def template_20() -> bytes:
    return (FIXTURES / "sample-template-20.pdf").read_bytes()


@pytest.fixture()
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setenv("TPMS_OCR_DEV", "1")
    return TestClient(app)
