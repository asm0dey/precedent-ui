import pathlib
import shutil
import subprocess

import pytest

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "journal.jsonl"
PRECEDENT_CLI = pathlib.Path.home() / "work_self/my-decisions/precedent/scripts/precedent.py"


def build_store(home: pathlib.Path, journal: pathlib.Path = FIXTURE) -> pathlib.Path:
    """Replay a journal into a real graph.db, the way precedent itself does."""
    home.mkdir(parents=True, exist_ok=True)
    shutil.copy(journal, home / "journal.jsonl")
    subprocess.run(
        ["uv", "run", str(PRECEDENT_CLI), "--home", str(home), "rebuild"],
        check=True,
        capture_output=True,
    )
    return home / "graph.db"


@pytest.fixture
def store_home(tmp_path: pathlib.Path) -> pathlib.Path:
    home = tmp_path / "precedent"
    build_store(home)
    return home


@pytest.fixture
def store(store_home: pathlib.Path):
    from server.store import Store

    s = Store(store_home)
    yield s
    s.close()


@pytest.fixture
def client(store_home: pathlib.Path):
    from fastapi.testclient import TestClient

    from server.precedent_ui import create_app

    with TestClient(create_app(store_home)) as c:
        yield c
