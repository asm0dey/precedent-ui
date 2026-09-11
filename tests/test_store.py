# tests/test_store.py
import pathlib

import pytest

from server.store import Store, resolve_home
from tests.conftest import FIXTURE, build_store


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


def test_store_reflects_an_external_rebuild(store, store_home, tmp_path):
    before = store.query("MATCH (n) RETURN count(n) AS n")[0]["n"]
    shorter = tmp_path / "shorter.jsonl"
    shorter.write_text("".join(FIXTURE.read_text().splitlines(keepends=True)[:6]))
    build_store(store_home, shorter)
    after = store.query("MATCH (n) RETURN count(n) AS n")[0]["n"]
    assert after < before, "a long-lived handle must see an external rebuild"


def test_change_stamp_ignores_pure_reads(store):
    """graphdblite touches graph.db's mtime on open even for a pure read
    (measured: every open+query+close bumps it, with no write issued) — see
    Store.change_stamp's docstring. change_stamp() reads journal.jsonl
    instead, which this class never opens, so repeated reads must not move
    it.
    """
    before = store.change_stamp()
    for _ in range(3):
        store.query("MATCH (n) RETURN count(n) AS n")
    assert store.change_stamp() == before


def test_change_stamp_moves_when_the_journal_is_rewritten(store, store_home, tmp_path):
    """The one thing change_stamp() must actually detect: a real journal
    write (here simulated the same way test_store_reflects_an_external_
    rebuild does, via build_store's copy-then-rebuild)."""
    before = store.change_stamp()
    shorter = tmp_path / "shorter.jsonl"
    shorter.write_text("".join(FIXTURE.read_text().splitlines(keepends=True)[:6]))
    build_store(store_home, shorter)
    assert store.change_stamp() != before


def test_store_queries_from_many_threads(store):
    """graphdblite's Database is unsendable; a shared handle panics across threads."""
    import concurrent.futures

    def one() -> int:
        return store.query("MATCH (n) RETURN count(n) AS n")[0]["n"]

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        counts = [f.result() for f in [pool.submit(one) for _ in range(32)]]

    assert len(set(counts)) == 1 and counts[0] > 0
