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
    """One graphdblite handle, reopened when the file underneath is replaced."""

    def __init__(self, home: pathlib.Path) -> None:
        self.home = resolve_home(home)
        self.path = self.home / "graph.db"
        self._db: Database | None = None
        self._opened_at: float = -1.0

    def mtime(self) -> float:
        try:
            return self.path.stat().st_mtime
        except FileNotFoundError:
            return -1.0

    def _handle(self) -> Database:
        now = self.mtime()
        if now < 0:
            raise FileNotFoundError(f"no graph at {self.path}")
        if self._db is None or now != self._opened_at:
            self.close()
            self._db = Database(str(self.path))
            self._opened_at = now
        return self._db

    def query(self, cypher: str, params: dict | None = None) -> list[dict]:
        return self._handle().query(cypher, params or {})

    def close(self) -> None:
        if self._db is not None:
            self._db.close()
            self._db = None
