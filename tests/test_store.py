# tests/test_store.py
import pathlib

import pytest

from server.store import Store, resolve_home
from tests.conftest import build_store


def test_resolve_home_without_pointer_returns_input(tmp_path):
    assert resolve_home(tmp_path) == tmp_path


def test_resolve_home_follows_pointer_one_hop(tmp_path):
    home, elsewhere = tmp_path / "home", tmp_path / "elsewhere"
    home.mkdir()
    elsewhere.mkdir()
    (home / "location").write_text(str(elsewhere))
    assert resolve_home(home) == elsewhere


def test_resolve_home_refuses_relative_pointer(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    (home / "location").write_text("../elsewhere")
    with pytest.raises(ValueError):
        resolve_home(home)


def test_store_queries_the_real_graph(store):
    rows = store.query("MATCH (n:Decision) RETURN count(n) AS n")
    assert rows[0]["n"] > 0


def test_store_reopens_after_rebuild_replaces_the_file(store, store_home):
    before = store.query("MATCH (n) RETURN count(n) AS n")[0]["n"]
    build_store(store_home)  # rebuild writes a fresh graph.db
    after = store.query("MATCH (n) RETURN count(n) AS n")[0]["n"]
    assert after == before
