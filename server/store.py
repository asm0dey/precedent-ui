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

    def change_stamp(self) -> tuple[int, int]:
        """Signal for "the store changed", read from the journal.

        NOT graph.db's mtime: graphdblite bumps graph.db's mtime on every
        open, including a pure read, so with a fresh Database handle per
        query() (below) graph.db's own mtime moves constantly even though
        nothing was ever recorded — using it as a change signal fires a
        false "graph changed" badge on ordinary browsing (measured: five
        plain reads left journal.jsonl untouched but changed graph.db every
        time).

        journal.jsonl is precedent's own append-only source of truth, and
        this class never opens it, so its mtime/size only move on a real
        write from elsewhere (`precedent.py record`).

        Note: `precedent.py rebuild` replays the existing journal into a
        fresh graph.db WITHOUT appending to the journal — it only renumbers
        each node's engine-assigned `__id`. A bare rebuild therefore does
        NOT move this stamp. That's deliberate, not a gap: no decision
        changed, and the client's refresh path already tolerates a
        renumbered id via a 404 and a "graph was rebuilt" notice.
        """
        try:
            s = (self.home / "journal.jsonl").stat()
        except FileNotFoundError:
            return (-1, -1)
        return (s.st_mtime_ns, s.st_size)

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
            # Drop the frame's reference too: on the error path the raised
            # exception's traceback keeps this frame alive, and a lingering
            # (even closed) handle is finalised on whatever thread GC runs on,
            # where pyo3 raises because Database is unsendable.
            del db

    def create_indexes(self) -> None:
        """The one write this tool performs. Never called implicitly."""
        from server.queries import SEARCH_FIELDS

        if self.mtime() < 0:
            raise FileNotFoundError(f"no graph at {self.path}")
        db = Database(str(self.path))
        try:
            with db.begin_write() as tx:
                for label, fields in SEARCH_FIELDS.items():
                    tx.create_fulltext_index_word_multi(label, fields)
                tx.commit()
        finally:
            db.close()
            del db

    def close(self) -> None:
        # No longer a cached handle to close. This method is retained for
        # test fixture compatibility (tests/conftest.py calls it).
        pass
