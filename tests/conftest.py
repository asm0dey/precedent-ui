import os
import pathlib
import shutil
import subprocess

import pytest

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "journal.jsonl"

# These tests build a REAL graph.db by replaying the fixture journal through
# precedent's own CLI (this project's recorded norm: test against the real
# engine, never a stand-in), so they need that CLI on disk. The default is
# where it lives on the author's machine; point $PRECEDENT_CLI at your own
# checkout to run them anywhere else. Absent, they skip rather than error —
# tests/test_queries.py is pure and runs regardless.
DEFAULT_PRECEDENT_CLI = pathlib.Path.home() / "work_self/my-decisions/precedent/scripts/precedent.py"
PRECEDENT_CLI = pathlib.Path(os.environ.get("PRECEDENT_CLI") or DEFAULT_PRECEDENT_CLI)


def build_store(home: pathlib.Path, journal: pathlib.Path = FIXTURE) -> pathlib.Path:
    """Replay a journal into a real graph.db, the way precedent itself does."""
    if not PRECEDENT_CLI.is_file():
        pytest.skip(
            f"precedent CLI not found at {PRECEDENT_CLI}. These tests replay a "
            f"fixture journal through the real `precedent.py rebuild`; set "
            f"PRECEDENT_CLI=/path/to/precedent.py to run them."
        )
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
