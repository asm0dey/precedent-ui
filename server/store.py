"""Read-only access to a precedent store."""

from __future__ import annotations

import pathlib

from graphdblite import Database

POINTER = "location"
DEFAULT_HOME = pathlib.Path.home() / ".local/share/precedent"


def resolve_home(home: pathlib.Path) -> pathlib.Path:
    """Follow a relocation pointer, exactly once.

    A pointer found inside the target is a stale file, not a second hop —
    this mirrors precedent.py's own rule.
    """
    pointer = home / POINTER
    if not pointer.is_file():
        return home
    content = pointer.read_text().strip()
    target = pathlib.Path(content)
    if not content or not target.is_absolute():
        raise ValueError(
            f"{pointer} does not hold one absolute path (contents: {content!r})"
        )
    return target


class Store:
    """Read-only graphdblite access to a precedent graph.

    Opens a fresh handle per query (not cached) because graphdblite's Database
    is unsendable (pyo3): it panics if touched from a thread other than the one
    that created it. FastAPI runs sync routes in a threadpool, so a shared
    cached handle breaks under any concurrency.
    """

    def __init__(self, home: pathlib.Path) -> None:
        self.home = resolve_home(home)
        self.path = self.home / "graph.db"

    def mtime(self) -> float:
        try:
            return self.path.stat().st_mtime
        except FileNotFoundError:
            return -1.0

    def query(self, cypher: str, params: dict | None = None) -> list[dict]:
        # A fresh handle per query, on purpose. graphdblite's Database is
        # unsendable (pyo3): it panics if touched from a thread other than the
        # one that created it, and FastAPI runs sync routes in a threadpool.
        # Measured cost is 0.93 ms per open+query+close against 0.57 ms warm.
        if self.mtime() < 0:
            raise FileNotFoundError(f"no graph at {self.path}")
        db = Database(str(self.path))
        try:
            return db.query(cypher, params or {})
        finally:
            db.close()

    def close(self) -> None:
        # No longer a cached handle to close. This method is retained for
        # test fixture compatibility (tests/conftest.py calls it).
        pass
