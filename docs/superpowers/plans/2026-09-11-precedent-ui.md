# precedent-ui Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only local browser for the `precedent` decision graph: search a node by text, grow the picture outwards one capped hop at a time, read the rationale, and run Cypher when the buttons run out.

**Architecture:** A FastAPI server opens the graphdblite store read-only and exposes seven JSON endpoints plus an SSE change stream. A Vite/React frontend renders a *working set* with sigma.js over graphology — never the whole graph — growing it by merging expansion results into a live graph instance.

**Tech Stack:** Python 3.12+, FastAPI, uvicorn, graphdblite, pytest. TypeScript, Vite, React, sigma.js, graphology, `@react-sigma/core` + `-minimap` + `-layout-forceatlas2`, vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-precedent-ui-design.md`

## Global Constraints

- **Read-only.** No code path may call `Database.begin_write()`. graphdblite's `query()` refuses writes itself; do not add a second enforcement layer (allowlists, statement parsing, `CREATE` regexes).
- **Python >= 3.12.**
- **Node identity is `__id`,** an engine-assigned int, session-scoped. Every node also has a stable domain key: `Decision.id`, `Project.id`, `Principle.id`, `Lesson.id`, `Tag.name`, `Topic.name`, `Option.name`.
- **graphdblite value shapes:** node = `{"__id": int, "__labels": [str], ...props}`; relationship = `{"__src": int, "__dst": int, "__label": str}`. A path is a bare list of ints with no type marker and is treated as a scalar.
- **Dialect rules** (from `references/schema.md` in the precedent repo): alias every returned expression (`RETURN count(d) AS n`); `NOT (n)-[:R]->()` does not parse — use `NOT EXISTS { MATCH (n)-[:R]->() }`; params are a dict positional argument, never a `parameters=` keyword.
- **Expansion is always capped.** Default 50 per edge type; expand-all budget is 100 nodes.
- **Cypher row cap is 1000**, and the response says when it truncated.
- **Every query that asks what is true now filters `status = 'active'`.** Superseded decisions are retained deliberately and otherwise pollute results.
- **Store location** resolves like `precedent.py` does: default `~/.local/share/precedent`, and a `location` file inside it holding one absolute path relocates it — followed exactly **one** hop.

## Security boundary

`/api/cypher` executes arbitrary user-supplied Cypher on purpose, so the trust
boundary is the loopback socket, not any individual endpoint. That is only
acceptable because of what the engine cannot do, which was measured rather than
assumed:

| Probe | Result |
|---|---|
| `LOAD CSV FROM 'file:///etc/passwd'` | `SyntaxError` — not parsed |
| `apoc.load.json('file://…')` | `SyntaxError` |
| `CALL dbms.procedures()`, `CALL db.labels()` | `ProcedureNotFound` — no procedure support |
| `CREATE`, `DETACH DELETE` | refused: writes need an explicit write transaction |

Arbitrary Cypher therefore reads the decision graph and nothing else — the same
data the UI renders. Three rules follow, and they are requirements, not advice:

- **Bind loopback only.** `host="127.0.0.1"`. Never `0.0.0.0`.
- **Never add permissive CORS.** No `CORSMiddleware` with `allow_origins=["*"]`.
  Today a cross-origin page cannot reach `/api/cypher`, because a JSON POST
  forces a preflight that goes unanswered. Opening CORS would hand a visited
  web page read access to the user's whole decision graph.
- **Validate interpolated Cypher fragments anyway.** `expand`'s `type` is the
  only user value ever interpolated rather than parameterised; it is validated
  against `^[A-Za-z_][A-Za-z0-9_]*$`. This buys clear 400s instead of opaque
  500s rather than privilege containment — `/api/cypher` already grants more —
  but an endpoint that builds Cypher from a request value should never be the
  loose one.

Known and accepted: a pathological query (a large cartesian product) can pin CPU
before the 1000-row cap applies, and the engine exposes no statement timeout.
For a single-user local tool the mitigation is Ctrl-C.

### Dependency declaration — amendment to the spec

The spec says the server is a `uv run` script with inline deps. This plan uses a
`pyproject.toml` instead, because a test suite needs pytest and httpx declared
somewhere, and two dependency declarations in one project drift. The server is
still started with `uv run`; only the declaration moves.

---

## File Structure

| File | Responsibility |
|---|---|
| `pyproject.toml` | deps + dev group; `package = false` |
| `server/store.py` | home resolution, the `Database` handle, reopen-on-rebuild, mtime |
| `server/queries.py` | every Cypher string and the row-shaping helpers. Pure, unit-tested |
| `server/precedent_ui.py` | FastAPI routes, CLI entry, static serving |
| `tests/conftest.py` | builds a real temp store from a fixture journal |
| `tests/fixtures/journal.jsonl` | a slice of a real journal |
| `tests/test_store.py` | resolution, reopen-on-rebuild |
| `tests/test_queries.py` | shaping + classification, no HTTP |
| `tests/test_api.py` | every endpoint through `TestClient` |
| `web/src/api.ts` | typed client for the HTTP contract |
| `web/src/skin.ts` | semantic colour tokens (light/dark), captions, status styling |
| `web/src/theme.ts` | tri-state theme toggle + persistence |
| `web/src/graph/budget.ts` | expand-all allocation. Pure, unit-tested |
| `web/src/graph/collapse.ts` | root-reachability BFS. Pure, unit-tested |
| `web/src/graph/Canvas.tsx` | sigma container, merge, reducers, gestures |
| `web/src/graph/ContextMenu.tsx` | right-click menu |
| `web/src/panels/Search.tsx` | search box + results |
| `web/src/panels/Detail.tsx` | node detail, rationale, degree chips |
| `web/src/panels/Cypher.tsx` | console, table/graph result, add-to-canvas |
| `web/src/classify.ts` | node/rel/scalar cell classification. Pure, unit-tested |

---

### Task 1: Project skeleton, store resolution, and the test fixture

**Files:**
- Create: `pyproject.toml`, `server/__init__.py`, `server/store.py`
- Create: `tests/conftest.py`, `tests/fixtures/journal.jsonl`, `tests/test_store.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolve_home(home: pathlib.Path) -> pathlib.Path`; `Store(home: pathlib.Path)` with `.path -> pathlib.Path`, `.mtime() -> float`, `.query(cypher: str, params: dict | None = None) -> list[dict]`. pytest fixture `store_home` (a `pathlib.Path`) and `store` (a `Store`).

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "precedent-ui"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["fastapi", "uvicorn", "graphdblite"]

[dependency-groups]
dev = ["pytest", "httpx"]

[tool.uv]
package = false
```

- [ ] **Step 2: Create the fixture journal**

The journal is the source of truth for a precedent store, and `rebuild` replays
it into a fresh graph. Copy the first 12 entries of the real store so the
fixture is real data rather than invented shapes:

```bash
mkdir -p tests/fixtures
head -12 ~/.local/share/precedent/journal.jsonl > tests/fixtures/journal.jsonl
wc -l tests/fixtures/journal.jsonl   # expect 12
```

- [ ] **Step 3: Write `tests/conftest.py`**

```python
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
```

- [ ] **Step 4: Write the failing tests**

```python
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
```

The last test is the one that matters: `precedent rebuild` replaces `graph.db`,
so a long-lived handle ends up pointing at an unlinked inode and quietly serves
stale data forever.

- [ ] **Step 5: Run the tests to verify they fail**

Run: `uv run pytest tests/test_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.store'`

- [ ] **Step 6: Implement `server/store.py`**

```python
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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `uv run pytest tests/test_store.py -v`
Expected: 5 passed

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml server/ tests/
git commit -m "feat: read-only store handle with pointer resolution and reopen-on-rebuild"
```

---

### Task 2: Row shaping and cell classification

**Files:**
- Create: `server/queries.py`
- Create: `tests/test_queries.py`

**Interfaces:**
- Consumes: `Store` from Task 1.
- Produces: `node_out(raw: dict) -> dict` → `{"id": int, "labels": list[str], "props": dict}`; `rel_out(raw: dict) -> dict` → `{"id": str, "src": int, "dst": int, "type": str}`; `classify(value) -> dict` → `{"kind": "node"|"rel"|"scalar", ...}`; `CAPTION_FIELD: dict[str, str]`; `SEARCH_FIELDS: dict[str, list[str]]`; `caption(node_out_dict) -> str`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_queries.py
from server.queries import caption, classify, node_out, rel_out

NODE = {"__id": 2, "__labels": ["Decision"], "title": "Postgres", "status": "active"}
REL = {"__src": 1, "__dst": 13, "__label": "TAGGED"}


def test_node_out_splits_metadata_from_properties():
    assert node_out(NODE) == {
        "id": 2,
        "labels": ["Decision"],
        "props": {"title": "Postgres", "status": "active"},
    }


def test_rel_out_synthesises_a_stable_edge_id():
    assert rel_out(REL) == {"id": "1-TAGGED-13", "src": 1, "dst": 13, "type": "TAGGED"}


def test_classify_recognises_a_node():
    assert classify(NODE)["kind"] == "node"


def test_classify_recognises_a_relationship():
    assert classify(REL)["kind"] == "rel"


def test_classify_treats_a_path_as_a_scalar():
    # graphdblite returns paths as bare id lists with no type marker,
    # indistinguishable from a list of integers.
    assert classify([2, 3]) == {"kind": "scalar", "value": [2, 3]}


def test_classify_treats_plain_values_as_scalars():
    assert classify("postgres") == {"kind": "scalar", "value": "postgres"}
    assert classify(7) == {"kind": "scalar", "value": 7}
    assert classify(None) == {"kind": "scalar", "value": None}


def test_caption_uses_the_per_label_field():
    assert caption(node_out(NODE)) == "Postgres"
    tag = {"__id": 13, "__labels": ["Tag"], "name": "python"}
    assert caption(node_out(tag)) == "python"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_queries.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.queries'`

- [ ] **Step 3: Implement `server/queries.py`**

```python
"""Cypher strings and row shaping. Pure — no I/O, no FastAPI."""

from __future__ import annotations

from typing import Any

# Which property carries a node's human-readable caption, per label.
CAPTION_FIELD: dict[str, str] = {
    "Decision": "title",
    "Project": "name",
    "Tag": "name",
    "Topic": "name",
    "Option": "name",
    "Principle": "statement",
    "Lesson": "statement",
}

# Which properties search scans, per label.
SEARCH_FIELDS: dict[str, list[str]] = {
    "Decision": ["title", "statement", "rationale"],
    "Project": ["name", "id"],
    "Tag": ["name"],
    "Topic": ["name"],
    "Option": ["name"],
    "Principle": ["statement"],
    "Lesson": ["statement"],
}

# The stable, rebuild-surviving key, per label.
DOMAIN_KEY: dict[str, str] = {
    "Decision": "id",
    "Project": "id",
    "Principle": "id",
    "Lesson": "id",
    "Tag": "name",
    "Topic": "name",
    "Option": "name",
}


def node_out(raw: dict) -> dict:
    return {
        "id": raw["__id"],
        "labels": raw["__labels"],
        "props": {k: v for k, v in raw.items() if not k.startswith("__")},
    }


def rel_out(raw: dict) -> dict:
    """Synthesise an edge id: graphdblite exposes none, and graphology needs one.

    The schema has no parallel edges of the same type between the same pair,
    so src-type-dst is unique in practice.
    """
    src, dst, typ = raw["__src"], raw["__dst"], raw["__label"]
    return {"id": f"{src}-{typ}-{dst}", "src": src, "dst": dst, "type": typ}


def classify(value: Any) -> dict:
    if isinstance(value, dict) and "__labels" in value:
        return {"kind": "node", "node": node_out(value)}
    if isinstance(value, dict) and "__label" in value and "__src" in value:
        return {"kind": "rel", "rel": rel_out(value)}
    return {"kind": "scalar", "value": value}


def caption(node: dict) -> str:
    label = node["labels"][0] if node["labels"] else ""
    field = CAPTION_FIELD.get(label)
    value = node["props"].get(field) if field else None
    return str(value) if value is not None else f"{label} #{node['id']}"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_queries.py -v`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add server/queries.py tests/test_queries.py
git commit -m "feat: row shaping and structural cell classification"
```

---

### Task 3: `/api/meta` and the FastAPI app

**Files:**
- Create: `server/precedent_ui.py`
- Create: `tests/test_api.py`

**Interfaces:**
- Consumes: `Store`, `node_out`, `caption`.
- Produces: `create_app(home: pathlib.Path) -> FastAPI`; `GET /api/meta` → `{"labels": dict[str, int], "edge_types": dict[str, int], "mtime": float}`. pytest fixture `client` (a `TestClient`).

- [ ] **Step 1: Add the `client` fixture to `tests/conftest.py`**

```python
@pytest.fixture
def client(store_home: pathlib.Path):
    from fastapi.testclient import TestClient

    from server.precedent_ui import create_app

    with TestClient(create_app(store_home)) as c:
        yield c
```

- [ ] **Step 2: Write the failing test**

```python
# tests/test_api.py
def test_meta_reports_label_and_edge_counts(client):
    body = client.get("/api/meta").json()
    assert body["labels"]["Decision"] > 0
    assert body["labels"]["Project"] > 0
    assert body["edge_types"]["IN_PROJECT"] > 0
    assert body["mtime"] > 0


def test_a_missing_store_names_the_resolved_path(tmp_path):
    from fastapi.testclient import TestClient

    from server.precedent_ui import create_app

    with TestClient(create_app(tmp_path / "nowhere"), raise_server_exceptions=False) as c:
        r = c.get("/api/meta")
    assert r.status_code == 503
    assert "nowhere" in r.json()["detail"]
```

A store that is not there is the normal first-run experience, not an internal
error: it must say which path it looked at, because the answer is usually that
the user has relocated the store.

- [ ] **Step 3: Run the test to verify it fails**

Run: `uv run pytest tests/test_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server.precedent_ui'`

- [ ] **Step 4: Implement `server/precedent_ui.py`**

```python
"""precedent-ui: a read-only browser for the precedent decision graph."""

from __future__ import annotations

import argparse
import pathlib

from fastapi import FastAPI

from server import queries
from server.store import DEFAULT_HOME, Store

LABEL_COUNTS = "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n ORDER BY n DESC"
EDGE_COUNTS = "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS n ORDER BY n DESC"


def create_app(home: pathlib.Path) -> FastAPI:
    app = FastAPI(title="precedent-ui")
    store = Store(home)
    app.state.store = store

    @app.exception_handler(FileNotFoundError)
    def _no_store(_request, exc: FileNotFoundError):
        from fastapi.responses import JSONResponse

        return JSONResponse({"detail": str(exc)}, status_code=503)

    @app.get("/api/meta")
    def meta() -> dict:
        return {
            "labels": {r["label"]: r["n"] for r in store.query(LABEL_COUNTS)},
            "edge_types": {r["type"]: r["n"] for r in store.query(EDGE_COUNTS)},
            "mtime": store.mtime(),
        }

    return app


def main() -> None:
    import uvicorn

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--home", type=pathlib.Path, default=DEFAULT_HOME)
    ap.add_argument("--port", type=int, default=8899)
    a = ap.parse_args()
    uvicorn.run(create_app(a.home), host="127.0.0.1", port=a.port)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `uv run pytest tests/test_api.py -v`
Expected: 2 passed

- [ ] **Step 6: Verify the server actually starts against the real store**

```bash
uv run python -m server.precedent_ui --port 8899 &
sleep 2
curl -s localhost:8899/api/meta | head -c 300
kill %1
```
Expected: JSON with `Decision`, `Project`, `Option` counts.

- [ ] **Step 7: Commit**

```bash
git add server/precedent_ui.py tests/
git commit -m "feat: FastAPI app with /api/meta"
```

---

### Task 4: `/api/search`

**Files:**
- Modify: `server/queries.py` (add `search_rows`)
- Modify: `server/precedent_ui.py` (add the route)
- Modify: `tests/test_api.py`

**Interfaces:**
- Consumes: `SEARCH_FIELDS`, `CAPTION_FIELD`, `node_out`, `caption`.
- Produces: `GET /api/search?q=&limit=50` → `[{"id": int, "labels": [str], "caption": str, "sub": str, "degree": int}]`, best match first.

Ranking: exact caption match (0), caption prefix (1), caption substring (2), other-field substring (3); then degree descending; then `id` ascending so paging is stable.

- [ ] **Step 1: Write the failing tests**

```python
def test_search_finds_a_decision_by_title(client):
    hits = client.get("/api/search", params={"q": "postgres"}).json()
    assert any("Postgres" in h["caption"] for h in hits)
    assert all({"id", "labels", "caption", "sub", "degree"} <= h.keys() for h in hits)


def test_search_finds_a_tag_by_name(client):
    hits = client.get("/api/search", params={"q": "python"}).json()
    assert any(h["labels"] == ["Tag"] and h["caption"] == "python" for h in hits)


def test_search_ranks_an_exact_caption_match_first(client):
    hits = client.get("/api/search", params={"q": "python"}).json()
    assert hits[0]["caption"] == "python"


def test_search_is_case_insensitive(client):
    assert client.get("/api/search", params={"q": "PYTHON"}).json()


def test_search_respects_limit(client):
    hits = client.get("/api/search", params={"q": "e", "limit": 3}).json()
    assert len(hits) <= 3


def test_search_with_empty_query_returns_nothing(client):
    assert client.get("/api/search", params={"q": "  "}).json() == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_api.py -v`
Expected: FAIL — 404 on `/api/search`

- [ ] **Step 3: Add `search_rows` to `server/queries.py`**

```python
def search_cypher(label: str, field: str) -> str:
    """One query per label/field. No UNION: ranking happens in Python anyway,
    and per-label queries keep the dialect surface small."""
    return (
        f"MATCH (n:{label}) WHERE toLower(toString(n.{field})) CONTAINS $q "
        f"RETURN n AS n LIMIT $cap"
    )


DEGREE_FOR_IDS = (
    "MATCH (n)-[r]-() WHERE id(n) IN $ids RETURN id(n) AS id, count(r) AS degree"
)


def rank(node: dict, needle: str) -> int:
    cap = caption(node).lower()
    if cap == needle:
        return 0
    if cap.startswith(needle):
        return 1
    if needle in cap:
        return 2
    return 3


def subtitle(node: dict) -> str:
    label = node["labels"][0] if node["labels"] else "?"
    props = node["props"]
    if label == "Decision":
        return f"{props.get('scope', '?')} · {props.get('status', '?')}"
    return label
```

- [ ] **Step 4: Add the route to `server/precedent_ui.py`**

```python
    @app.get("/api/search")
    def search(q: str, limit: int = 50) -> list[dict]:
        needle = q.strip().lower()
        if not needle:
            return []
        # Scan each label's searchable fields; a node found by several fields
        # is kept once, at its best rank.
        best: dict[int, tuple[int, dict]] = {}
        for label, fields in queries.SEARCH_FIELDS.items():
            for field in fields:
                cypher = queries.search_cypher(label, field)
                for row in store.query(cypher, {"q": needle, "cap": limit * 4}):
                    node = queries.node_out(row["n"])
                    r = queries.rank(node, needle) if field == queries.CAPTION_FIELD.get(label) else 3
                    prior = best.get(node["id"])
                    if prior is None or r < prior[0]:
                        best[node["id"]] = (r, node)

        degrees = {
            row["id"]: row["degree"]
            for row in store.query(queries.DEGREE_FOR_IDS, {"ids": list(best)})
        } if best else {}

        ordered = sorted(
            best.values(), key=lambda rn: (rn[0], -degrees.get(rn[1]["id"], 0), rn[1]["id"])
        )
        return [
            {
                "id": node["id"],
                "labels": node["labels"],
                "caption": queries.caption(node),
                "sub": queries.subtitle(node),
                "degree": degrees.get(node["id"], 0),
            }
            for _, node in ordered[:limit]
        ]
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_api.py -v`
Expected: 8 passed

- [ ] **Step 6: Commit**

```bash
git add server/ tests/
git commit -m "feat: server-side search with deterministic ranking"
```

---

### Task 5: `/api/node/{id}` with the degree breakdown

**Files:**
- Modify: `server/queries.py`, `server/precedent_ui.py`, `tests/test_api.py`

**Interfaces:**
- Produces: `GET /api/node/{id}` → `{"id", "labels", "props", "caption", "key": {"field", "value"} | None, "degrees": [{"type": str, "dir": "out"|"in", "count": int}]}`. 404 when absent.

The degree breakdown is what makes expansion sane: the client learns
`CHOSE ▸3 · REJECTED ▸5` before loading anything, and Task 8's budget allocator
needs those counts.

- [ ] **Step 1: Write the failing tests**

```python
def _first_decision_id(client):
    hits = client.get("/api/search", params={"q": "postgres"}).json()
    return next(h["id"] for h in hits if h["labels"] == ["Decision"])


def test_node_returns_props_and_caption(client):
    nid = _first_decision_id(client)
    body = client.get(f"/api/node/{nid}").json()
    assert body["labels"] == ["Decision"]
    assert body["props"]["rationale"]
    assert body["caption"]


def test_node_reports_the_stable_domain_key(client):
    nid = _first_decision_id(client)
    body = client.get(f"/api/node/{nid}").json()
    assert body["key"]["field"] == "id"
    assert body["key"]["value"]


def test_node_degrees_are_split_by_type_and_direction(client):
    nid = _first_decision_id(client)
    degrees = client.get(f"/api/node/{nid}").json()["degrees"]
    out = {(d["type"], d["dir"]): d["count"] for d in degrees}
    assert out[("IN_PROJECT", "out")] == 1
    assert out[("CHOSE", "out")] >= 1


def test_node_404_for_a_missing_id(client):
    assert client.get("/api/node/99999999").status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_api.py -v`
Expected: FAIL — 404 on every `/api/node/...`

- [ ] **Step 3: Add the queries**

```python
# server/queries.py
NODE_BY_ID = "MATCH (n) WHERE id(n) = $id RETURN n AS n"
DEGREE_OUT = "MATCH (n)-[r]->() WHERE id(n) = $id RETURN type(r) AS type, count(*) AS n"
DEGREE_IN = "MATCH (n)<-[r]-() WHERE id(n) = $id RETURN type(r) AS type, count(*) AS n"


def domain_key(node: dict) -> dict | None:
    label = node["labels"][0] if node["labels"] else ""
    field = DOMAIN_KEY.get(label)
    if field is None or field not in node["props"]:
        return None
    return {"field": field, "value": node["props"][field]}
```

- [ ] **Step 4: Add the route**

```python
from fastapi import HTTPException

    @app.get("/api/node/{node_id}")
    def node(node_id: int) -> dict:
        rows = store.query(queries.NODE_BY_ID, {"id": node_id})
        if not rows:
            raise HTTPException(404, f"no node {node_id} — the graph may have been rebuilt")
        n = queries.node_out(rows[0]["n"])
        degrees = [
            {"type": r["type"], "dir": "out", "count": r["n"]}
            for r in store.query(queries.DEGREE_OUT, {"id": node_id})
        ] + [
            {"type": r["type"], "dir": "in", "count": r["n"]}
            for r in store.query(queries.DEGREE_IN, {"id": node_id})
        ]
        return {
            **n,
            "caption": queries.caption(n),
            "key": queries.domain_key(n),
            "degrees": sorted(degrees, key=lambda d: (d["count"], d["type"])),
        }
```

`degrees` is sorted smallest-first because that is the order the expand-all
budget spends in — sorting it here means the client does not re-derive it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_api.py -v`
Expected: 12 passed

- [ ] **Step 6: Commit**

```bash
git add server/ tests/
git commit -m "feat: node detail with direction-split degree breakdown"
```

---

### Task 6: `/api/expand/{id}` and `/api/edges-between`

**Files:**
- Modify: `server/queries.py`, `server/precedent_ui.py`, `tests/test_api.py`

**Interfaces:**
- Produces: `GET /api/expand/{id}?type=&dir=&limit=50&offset=0` → `{"nodes": [node_out], "edges": [rel_out], "total": int, "offset": int, "limit": int}`; `POST /api/edges-between` with `{"ids": [int]}` → `{"edges": [rel_out]}`.

- [ ] **Step 1: Write the failing tests**

```python
def test_expand_returns_neighbours_and_connecting_edges(client):
    nid = _first_decision_id(client)
    body = client.get(f"/api/expand/{nid}", params={"type": "CHOSE", "dir": "out"}).json()
    assert body["nodes"] and body["edges"]
    assert all(e["type"] == "CHOSE" for e in body["edges"])
    assert all(e["src"] == nid for e in body["edges"])


def test_expand_reports_the_untruncated_total(client):
    nid = _first_decision_id(client)
    body = client.get(f"/api/expand/{nid}", params={"type": "CHOSE", "dir": "out", "limit": 1}).json()
    assert len(body["nodes"]) == 1
    assert body["total"] >= 1


def test_expand_pages_by_offset(client):
    nid = _first_decision_id(client)
    args = {"type": "CHOSE", "dir": "out", "limit": 1}
    first = client.get(f"/api/expand/{nid}", params=args).json()
    second = client.get(f"/api/expand/{nid}", params={**args, "offset": 1}).json()
    if second["nodes"]:
        assert first["nodes"][0]["id"] != second["nodes"][0]["id"]


def test_expand_without_a_type_returns_every_type(client):
    nid = _first_decision_id(client)
    types = {e["type"] for e in client.get(f"/api/expand/{nid}").json()["edges"]}
    assert len(types) > 1


def test_edges_between_finds_edges_among_loaded_nodes(client):
    nid = _first_decision_id(client)
    expanded = client.get(f"/api/expand/{nid}").json()
    ids = [nid] + [n["id"] for n in expanded["nodes"]]
    edges = client.post("/api/edges-between", json={"ids": ids}).json()["edges"]
    assert len(edges) >= len(expanded["edges"])


def test_edges_between_with_no_ids_returns_nothing(client):
    assert client.post("/api/edges-between", json={"ids": []}).json()["edges"] == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_api.py -v`
Expected: FAIL — 404 on the new paths

- [ ] **Step 3: Add the queries**

```python
# server/queries.py
def expand_cypher(edge_type: str | None, direction: str) -> str:
    """Neighbours along one direction, optionally one type.

    Ordered by neighbour id so that offset paging is stable.
    """
    rel = f"[r:{edge_type}]" if edge_type else "[r]"
    pattern = f"(n)-{rel}->(m)" if direction == "out" else f"(n)<-{rel}-(m)"
    return (
        f"MATCH {pattern} WHERE id(n) = $id "
        f"RETURN m AS m, r AS r ORDER BY id(m) SKIP $offset LIMIT $limit"
    )


def expand_count_cypher(edge_type: str | None, direction: str) -> str:
    rel = f"[r:{edge_type}]" if edge_type else "[r]"
    pattern = f"(n)-{rel}->(m)" if direction == "out" else f"(n)<-{rel}-(m)"
    return f"MATCH {pattern} WHERE id(n) = $id RETURN count(r) AS n"


EDGES_BETWEEN = (
    "MATCH (a)-[r]->(b) WHERE id(a) IN $ids AND id(b) IN $ids RETURN r AS r"
)
```

- [ ] **Step 4: Add the routes**

```python
from pydantic import BaseModel


class IdsIn(BaseModel):
    ids: list[int]


    @app.get("/api/expand/{node_id}")
    def expand(
        node_id: int,
        type: str | None = None,
        dir: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        directions = [dir] if dir in ("out", "in") else ["out", "in"]
        nodes: dict[int, dict] = {}
        edges: dict[str, dict] = {}
        total = 0
        for d in directions:
            total += store.query(
                queries.expand_count_cypher(type, d), {"id": node_id}
            )[0]["n"]
            rows = store.query(
                queries.expand_cypher(type, d),
                {"id": node_id, "limit": limit, "offset": offset},
            )
            for row in rows:
                n = queries.node_out(row["m"])
                nodes[n["id"]] = n
                e = queries.rel_out(row["r"])
                edges[e["id"]] = e
        return {
            "nodes": list(nodes.values()),
            "edges": list(edges.values()),
            "total": total,
            "offset": offset,
            "limit": limit,
        }

    @app.post("/api/edges-between")
    def edges_between(body: IdsIn) -> dict:
        if not body.ids:
            return {"edges": []}
        rows = store.query(queries.EDGES_BETWEEN, {"ids": body.ids})
        seen = {queries.rel_out(r["r"])["id"]: queries.rel_out(r["r"]) for r in rows}
        return {"edges": list(seen.values())}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_api.py -v`
Expected: 18 passed

- [ ] **Step 6: Commit**

```bash
git add server/ tests/
git commit -m "feat: capped paged expansion and edge completion"
```

---

### Task 7: `/api/cypher` and `/api/stream`

**Files:**
- Modify: `server/precedent_ui.py`, `tests/test_api.py`

**Interfaces:**
- Produces: `POST /api/cypher` with `{"query": str, "params": dict}` → `{"columns": [str], "rows": [[cell]], "truncated": bool}` where each cell is `classify()`'s output; errors → 400 `{"detail": {"error": str, "type": str}}`. `GET /api/stream` → `text/event-stream` emitting `{"mtime": float}`.

- [ ] **Step 1: Write the failing tests**

```python
def test_cypher_returns_classified_cells(client):
    body = client.post(
        "/api/cypher", json={"query": "MATCH (d:Decision) RETURN d AS d LIMIT 2"}
    ).json()
    assert body["columns"] == ["d"]
    assert body["rows"][0][0]["kind"] == "node"


def test_cypher_classifies_relationships(client):
    body = client.post(
        "/api/cypher", json={"query": "MATCH ()-[r]->() RETURN r AS r LIMIT 1"}
    ).json()
    assert body["rows"][0][0]["kind"] == "rel"


def test_cypher_takes_parameters(client):
    body = client.post(
        "/api/cypher",
        json={
            "query": "MATCH (t:Tag) WHERE t.name = $n RETURN t.name AS name",
            "params": {"n": "python"},
        },
    ).json()
    assert body["rows"][0][0]["value"] == "python"


def test_cypher_rejects_writes_via_the_engine(client):
    r = client.post("/api/cypher", json={"query": "CREATE (x:Zzz) RETURN x AS x"})
    assert r.status_code == 400
    assert "read transaction" in r.json()["detail"]["error"]


def test_cypher_surfaces_parse_errors_verbatim(client):
    r = client.post("/api/cypher", json={"query": "MATCH ("})
    assert r.status_code == 400
    assert r.json()["detail"]["type"]


def test_cypher_caps_rows_and_says_so(client):
    body = client.post(
        "/api/cypher", json={"query": "MATCH (n) RETURN n AS n", "max_rows": 3}
    ).json()
    assert len(body["rows"]) == 3
    assert body["truncated"] is True


def test_stream_emits_the_current_mtime(client):
    with client.stream("GET", "/api/stream") as r:
        for line in r.iter_lines():
            if line.startswith("data:"):
                assert "mtime" in line
                break
```

The write-rejection test is load-bearing: it proves the read-only property comes
from the engine, so nobody later "hardens" it with a regex.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_api.py -v`
Expected: FAIL — 404 on `/api/cypher`

- [ ] **Step 3: Implement the routes**

```python
import asyncio
import json

from fastapi.responses import StreamingResponse
from graphdblite import GraphDBError

MAX_ROWS = 1000


class CypherIn(BaseModel):
    query: str
    params: dict = {}
    max_rows: int = MAX_ROWS


    @app.post("/api/cypher")
    def cypher(body: CypherIn) -> dict:
        # No sanitising: graphdblite's query() refuses writes outside an
        # explicit write transaction, so the engine is the enforcement point.
        try:
            rows = store.query(body.query, body.params)
        except GraphDBError as e:
            raise HTTPException(400, {"error": str(e), "type": type(e).__name__})
        cap = min(body.max_rows, MAX_ROWS)
        columns = list(rows[0].keys()) if rows else []
        return {
            "columns": columns,
            "rows": [[queries.classify(r[c]) for c in columns] for r in rows[:cap]],
            "truncated": len(rows) > cap,
        }

    @app.get("/api/stream")
    async def stream() -> StreamingResponse:
        async def events():
            last = None
            while True:
                now = store.mtime()
                if now != last:
                    last = now
                    yield f"data: {json.dumps({'mtime': now})}\n\n"
                await asyncio.sleep(1.0)

        return StreamingResponse(events(), media_type="text/event-stream")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_api.py -v`
Expected: 25 passed

- [ ] **Step 5: Verify live change detection by hand**

```bash
uv run python -m server.precedent_ui --port 8899 &
sleep 2
curl -sN localhost:8899/api/stream | head -2 &
uv run ~/work_self/my-decisions/precedent/scripts/precedent.py maintain >/dev/null
sleep 3
kill %1 %2 2>/dev/null
```
Expected: at least one `data: {"mtime": ...}` line.

- [ ] **Step 6: Commit**

```bash
git add server/ tests/
git commit -m "feat: cypher console endpoint and SSE change stream"
```

---

### Task 8: Frontend scaffold, API client, and the pure logic

**Files:**
- Create: `web/` (Vite scaffold), `web/vite.config.ts`, `web/src/api.ts`, `web/src/classify.ts`, `web/src/graph/budget.ts`, `web/src/graph/collapse.ts`
- Create: `web/src/classify.test.ts`, `web/src/graph/budget.test.ts`, `web/src/graph/collapse.test.ts`

**Interfaces:**
- Consumes: the HTTP contract from Tasks 3–7.
- Produces: types `GNode {id, labels, props}`, `GEdge {id, src, dst, type}`, `Degree {type, dir, count}`, `Hit {id, labels, caption, sub, degree}`; functions `getMeta`, `search`, `getNode`, `expand`, `edgesBetween`, `runCypher`; `allocate(degrees: Degree[], budget: number): Alloc[]`; `survivors(edges: GEdge[], present: string[], roots: Set<string>, pinned: Set<string>): Set<string>`; `cellsToGraph(rows: Cell[][]): {nodes, edges}`.

- [ ] **Step 1: Scaffold and install**

```bash
bun create vite web --template react-ts
cd web
bun install
bun add sigma graphology @react-sigma/core @react-sigma/minimap @react-sigma/layout-forceatlas2
bun add -d vitest
```

Add to `web/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Configure the dev proxy in `web/vite.config.ts`**

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8899", changeOrigin: true },
    },
  },
});
```

- [ ] **Step 3: Write the failing tests for the pure logic**

```ts
// web/src/graph/budget.test.ts
import { describe, expect, it } from "vitest";
import { allocate } from "./budget";

describe("allocate", () => {
  it("takes every neighbour when the whole neighbourhood fits", () => {
    const d = [
      { type: "IN_PROJECT", dir: "out" as const, count: 1 },
      { type: "ABOUT", dir: "out" as const, count: 2 },
      { type: "CHOSE", dir: "out" as const, count: 3 },
      { type: "REJECTED", dir: "out" as const, count: 5 },
    ];
    const got = allocate(d, 100);
    expect(got.map((a) => a.take)).toEqual([1, 2, 3, 5]);
    expect(got.every((a) => a.take === a.count)).toBe(true);
  });

  it("spends the budget smallest type first", () => {
    const d = [
      { type: "TAGGED", dir: "in" as const, count: 4000 },
      { type: "ABOUT", dir: "out" as const, count: 2 },
    ];
    const got = allocate(d, 100);
    expect(got[0]).toMatchObject({ type: "ABOUT", take: 2 });
    expect(got[1]).toMatchObject({ type: "TAGGED", take: 98 });
  });

  it("reports what it left behind", () => {
    const got = allocate([{ type: "TAGGED", dir: "in", count: 4362 }], 100);
    expect(got[0].remaining).toBe(4262);
  });

  it("never returns a negative or over-budget take", () => {
    const got = allocate(
      [
        { type: "A", dir: "out", count: 60 },
        { type: "B", dir: "out", count: 60 },
        { type: "C", dir: "out", count: 60 },
      ],
      100,
    );
    expect(got.reduce((n, a) => n + a.take, 0)).toBe(100);
    expect(got.every((a) => a.take >= 0)).toBe(true);
  });
});
```

```ts
// web/src/graph/collapse.test.ts
import { describe, expect, it } from "vitest";
import { survivors } from "./collapse";

const e = (src: string, dst: string) => ({ id: `${src}-X-${dst}`, src, dst, type: "X" });

describe("survivors", () => {
  it("keeps roots and everything reachable from them", () => {
    const kept = survivors([e("a", "b")], ["a", "b"], new Set(["a"]), new Set());
    expect([...kept].sort()).toEqual(["a", "b"]);
  });

  it("drops what is no longer reachable from any root", () => {
    const kept = survivors([e("a", "b")], ["a", "b", "orphan"], new Set(["a"]), new Set());
    expect(kept.has("orphan")).toBe(false);
  });

  it("keeps a node reached by a second route", () => {
    // r1 -> shared <- r2 : collapsing r1 must not take `shared`
    const edges = [e("r1", "shared"), e("r2", "shared")];
    const kept = survivors(edges, ["r1", "r2", "shared"], new Set(["r1", "r2"]), new Set());
    expect(kept.has("shared")).toBe(true);
  });

  it("keeps pinned nodes even when unreachable", () => {
    const kept = survivors([], ["a", "pinned"], new Set(["a"]), new Set(["pinned"]));
    expect(kept.has("pinned")).toBe(true);
  });

  it("treats edges as undirected for reachability", () => {
    const kept = survivors([e("b", "a")], ["a", "b"], new Set(["a"]), new Set());
    expect(kept.has("b")).toBe(true);
  });
});
```

```ts
// web/src/classify.test.ts
import { describe, expect, it } from "vitest";
import { cellsToGraph } from "./classify";

describe("cellsToGraph", () => {
  it("collects nodes and edges out of classified cells", () => {
    const rows = [
      [
        { kind: "node", node: { id: 1, labels: ["Tag"], props: { name: "python" } } },
        { kind: "rel", rel: { id: "1-TAGGED-2", src: 1, dst: 2, type: "TAGGED" } },
      ],
      [{ kind: "scalar", value: 7 }],
    ];
    const { nodes, edges } = cellsToGraph(rows as never);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(1);
  });

  it("deduplicates repeated nodes", () => {
    const cell = { kind: "node", node: { id: 1, labels: ["Tag"], props: {} } };
    expect(cellsToGraph([[cell], [cell]] as never).nodes).toHaveLength(1);
  });

  it("is empty when nothing is graph-shaped", () => {
    const { nodes, edges } = cellsToGraph([[{ kind: "scalar", value: "x" }]] as never);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd web && bun run test`
Expected: FAIL — cannot resolve `./budget`, `./collapse`, `./classify`

- [ ] **Step 5: Implement the pure modules**

```ts
// web/src/graph/budget.ts
export type Degree = { type: string; dir: "out" | "in"; count: number };
export type Alloc = Degree & { take: number; remaining: number };

/**
 * Spend an expand-all budget across edge types, smallest type first.
 *
 * Smallest-first because it more often yields a whole neighbourhood than an
 * arbitrary slice of the single biggest type: a Decision expands completely,
 * so double-click means what it looks like it means.
 */
export function allocate(degrees: Degree[], budget = 100): Alloc[] {
  let left = budget;
  return [...degrees]
    .sort((a, b) => a.count - b.count || a.type.localeCompare(b.type))
    .map((d) => {
      const take = Math.max(0, Math.min(left, d.count));
      left -= take;
      return { ...d, take, remaining: d.count - take };
    });
}
```

```ts
// web/src/graph/collapse.ts
import type { GEdge } from "../classify";

/**
 * The canvas invariant: every node is a root, is pinned, or is connected to one.
 *
 * Collapse is defined structurally rather than by provenance — "what arrived
 * from this node" goes stale the moment the same node is reached a second way.
 */
export function survivors(
  edges: Pick<GEdge, "src" | "dst">[],
  present: string[],
  roots: Set<string>,
  pinned: Set<string>,
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const s = String(e.src);
    const d = String(e.dst);
    (adj.get(s) ?? adj.set(s, []).get(s)!).push(d);
    (adj.get(d) ?? adj.set(d, []).get(d)!).push(s);
  }
  const kept = new Set<string>([...pinned].filter((p) => present.includes(p)));
  const queue = present.filter((n) => roots.has(n));
  queue.forEach((n) => kept.add(n));
  while (queue.length) {
    const n = queue.shift()!;
    for (const m of adj.get(n) ?? []) {
      if (!kept.has(m) && present.includes(m)) {
        kept.add(m);
        queue.push(m);
      }
    }
  }
  return kept;
}
```

```ts
// web/src/classify.ts
export type GNode = { id: number; labels: string[]; props: Record<string, unknown> };
export type GEdge = { id: string; src: number; dst: number; type: string };
export type Cell =
  | { kind: "node"; node: GNode }
  | { kind: "rel"; rel: GEdge }
  | { kind: "scalar"; value: unknown };

export function cellsToGraph(rows: Cell[][]): { nodes: GNode[]; edges: GEdge[] } {
  const nodes = new Map<number, GNode>();
  const edges = new Map<string, GEdge>();
  for (const row of rows) {
    for (const cell of row) {
      if (cell.kind === "node") nodes.set(cell.node.id, cell.node);
      if (cell.kind === "rel") edges.set(cell.rel.id, cell.rel);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
```

```ts
// web/src/api.ts
import type { Cell, GEdge, GNode } from "./classify";

export type Degree = { type: string; dir: "out" | "in"; count: number };
export type Hit = { id: number; labels: string[]; caption: string; sub: string; degree: number };
export type NodeDetail = GNode & {
  caption: string;
  key: { field: string; value: string } | null;
  degrees: Degree[];
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const getMeta = () =>
  get<{ labels: Record<string, number>; edge_types: Record<string, number>; mtime: number }>(
    "/api/meta",
  );

export const search = (q: string, limit = 50) =>
  get<Hit[]>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);

export const getNode = (id: number) => get<NodeDetail>(`/api/node/${id}`);

export const expand = (
  id: number,
  opts: { type?: string; dir?: string; limit?: number; offset?: number } = {},
) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) p.set(k, String(v));
  return get<{ nodes: GNode[]; edges: GEdge[]; total: number; offset: number; limit: number }>(
    `/api/expand/${id}?${p}`,
  );
};

export const edgesBetween = (ids: number[]) =>
  post<{ edges: GEdge[] }>("/api/edges-between", { ids });

export const runCypher = (query: string, params: Record<string, unknown> = {}) =>
  post<{ columns: string[]; rows: Cell[][]; truncated: boolean }>("/api/cypher", { query, params });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && bun run test`
Expected: 12 passed

- [ ] **Step 7: Commit**

```bash
git add web/ && git commit -m "feat: frontend scaffold, typed api client, budget and collapse logic"
```

---

### Task 9: Theme tokens and the sigma canvas

**Files:**
- Create: `web/src/skin.ts`, `web/src/theme.ts`, `web/src/graph/Canvas.tsx`
- Modify: `web/src/App.tsx`, `web/src/index.css`

**Interfaces:**
- Consumes: `GNode`, `GEdge`, `api.getMeta`, `api.expand`.
- Produces: `tokens(mode: "light" | "dark")` → `{ labelColor: Record<string,string>, statusAlpha: Record<string,number>, edge: string, bg: string, text: string, warn: Record<string,string> }`; `<Canvas/>` rendering a graphology instance held in a ref; `useTheme()` → `{ mode, resolved, set }`.

- [ ] **Step 1: Implement `web/src/skin.ts`**

```ts
export type Mode = "light" | "dark";

const LIGHT = {
  bg: "#ffffff",
  text: "#14161a",
  edge: "#9aa3ad",
  labelColor: {
    Decision: "#2f6fd0",
    Project: "#1f9d63",
    Tag: "#b8860b",
    Topic: "#7a4fbf",
    Option: "#6b7280",
    Principle: "#c2410c",
    Lesson: "#b91c1c",
  } as Record<string, string>,
  statusAlpha: { active: 1, superseded: 0.35, regretted: 0.8 },
  warn: { conflict: "#dc2626", divergence: "#d97706", regret: "#b91c1c" },
};

const DARK: typeof LIGHT = {
  bg: "#14161a",
  text: "#e8eaed",
  edge: "#5b636d",
  labelColor: {
    Decision: "#7aa9f0",
    Project: "#5bd39a",
    Tag: "#e0b45a",
    Topic: "#b28df0",
    Option: "#a1a8b3",
    Principle: "#f08a4b",
    Lesson: "#f06a6a",
  } as Record<string, string>,
  // superseded needs a *higher* alpha on a dark ground to read as faded
  // rather than as invisible.
  statusAlpha: { active: 1, superseded: 0.5, regretted: 0.85 },
  warn: { conflict: "#f87171", divergence: "#fbbf24", regret: "#f06a6a" },
};

export const tokens = (mode: Mode) => (mode === "dark" ? DARK : LIGHT);

export const CAPTION_FIELD: Record<string, string> = {
  Decision: "title",
  Project: "name",
  Tag: "name",
  Topic: "name",
  Option: "name",
  Principle: "statement",
  Lesson: "statement",
};

export const captionOf = (n: { labels: string[]; props: Record<string, unknown> }) => {
  const field = CAPTION_FIELD[n.labels[0]];
  const v = field ? n.props[field] : undefined;
  return v === undefined ? n.labels[0] : String(v);
};
```

- [ ] **Step 2: Implement `web/src/theme.ts`**

```ts
import { useEffect, useState } from "react";
import type { Mode } from "./skin";

export type Pref = "system" | Mode;
const KEY = "precedent-ui-theme";

export function useTheme() {
  const [pref, setPref] = useState<Pref>(() => (localStorage.getItem(KEY) as Pref) ?? "system");
  const [system, setSystem] = useState<Mode>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setSystem(e.matches ? "dark" : "light");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const resolved: Mode = pref === "system" ? system : pref;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem(KEY, pref);
  }, [pref, resolved]);

  return { pref, resolved, set: setPref };
}
```

- [ ] **Step 3: Implement `web/src/graph/Canvas.tsx`**

```tsx
import { SigmaContainer, ControlsContainer, FullScreenControl, ZoomControl, useSigma }
  from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import { LayoutForceAtlas2Control } from "@react-sigma/layout-forceatlas2";
import { MiniMap } from "@react-sigma/minimap";
import Graph from "graphology";
import { useEffect, useRef } from "react";
import type { GEdge, GNode } from "../classify";
import { captionOf, tokens, type Mode } from "../skin";

/** Merge into the live instance — never rebuild it. Growth is the interaction. */
export function mergeInto(graph: Graph, nodes: GNode[], edges: GEdge[], mode: Mode) {
  const t = tokens(mode);
  for (const n of nodes) {
    graph.mergeNode(String(n.id), {
      label: captionOf(n),
      size: 8,
      color: t.labelColor[n.labels[0]] ?? t.edge,
      nodeLabel: n.labels[0],
      status: (n.props.status as string) ?? "active",
      x: Math.random(),
      y: Math.random(),
    });
  }
  for (const e of edges) {
    if (graph.hasNode(String(e.src)) && graph.hasNode(String(e.dst))) {
      graph.mergeEdgeWithKey(e.id, String(e.src), String(e.dst), { edgeType: e.type });
    }
  }
}

/** Theme and hover live in the reducers, so a theme flip never rewrites attributes. */
function Reducers({ mode, hovered }: { mode: Mode; hovered: string | null }) {
  const sigma = useSigma();
  useEffect(() => {
    const t = tokens(mode);
    sigma.setSetting("nodeReducer", (node, data) => {
      const base = {
        ...data,
        color: t.labelColor[data.nodeLabel as string] ?? t.edge,
        zIndex: data.status === "superseded" ? 0 : 1,
      };
      if (!hovered) return base;
      const neighbours = sigma.getGraph().neighbors(hovered);
      if (node === hovered || neighbours.includes(node)) return { ...base, highlighted: true };
      return { ...base, color: t.edge, label: "" };
    });
    sigma.setSetting("edgeReducer", (edge, data) => {
      const base = { ...data, color: t.edge };
      if (!hovered) return base;
      return sigma.getGraph().extremities(edge).includes(hovered)
        ? base
        : { ...base, hidden: true };
    });
    sigma.refresh();
  }, [sigma, mode, hovered]);
  return null;
}

export function Canvas({ graph, mode, hovered }: { graph: Graph; mode: Mode; hovered: string | null }) {
  const t = tokens(mode);
  return (
    <SigmaContainer
      graph={graph}
      style={{ height: "100%", width: "100%", background: t.bg }}
      settings={{ allowInvalidContainer: true, defaultEdgeType: "arrow", labelDensity: 0.2 }}
    >
      <Reducers mode={mode} hovered={hovered} />
      <ControlsContainer position="bottom-right">
        <ZoomControl />
        <FullScreenControl />
        <LayoutForceAtlas2Control autoRunFor={1000} />
      </ControlsContainer>
      <ControlsContainer position="bottom-left">
        <MiniMap width="120px" height="120px" />
      </ControlsContainer>
    </SigmaContainer>
  );
}
```

- [ ] **Step 4: Wire the default Projects view into `web/src/App.tsx`**

```tsx
const DEFAULT_VIEW = "MATCH (p:Project)-[r:TAGGED]->(t:Tag) RETURN p AS p, r AS r, t AS t";

export default function App() {
  const { resolved: mode, pref, set: setPref } = useTheme();
  const graph = useRef(new Graph()).current;
  const roots = useRef(new Set<string>()).current;
  const pinned = useRef(new Set<string>()).current;
  const expanded = useRef(new Set<number>()).current;
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to re-render after a merge

  useEffect(() => {
    runCypher(DEFAULT_VIEW).then(({ rows }) => {
      const { nodes, edges } = cellsToGraph(rows);
      mergeInto(graph, nodes, edges, mode);
      // Everything in the default view was asked for, so all of it is a root.
      nodes.forEach((n) => roots.add(String(n.id)));
      setVersion((v) => v + 1);
    });
  }, []);

  return (
    <div className="app">
      <aside><Search onPick={onPick} /></aside>
      <main><Canvas graph={graph} mode={mode} hovered={hovered} /></main>
      <aside><Detail nodeId={selected} onExpand={(t, d) => expandOne(selected!, t, d)} /></aside>
      <footer><Cypher onAdd={addToCanvas} /></footer>
      <ThemeToggle pref={pref} onChange={setPref} />
    </div>
  );
}
```

An empty canvas is a worse start than a small one: the Projects and their Tags
are the map you navigate from.

- [ ] **Step 5: Verify by hand**

```bash
uv run python -m server.precedent_ui --port 8899 &
cd web && bun run dev
```
Open the printed URL. Expected: 6 Projects joined to their Tags, arrows drawn,
hovering a node dims the rest, the theme toggle flips both panels and canvas,
and the browser console is free of errors.

- [ ] **Step 6: Commit**

```bash
git add web/ && git commit -m "feat: themed sigma canvas with reducer-driven styling"
```

---

### Task 10: Search panel

**Files:**
- Create: `web/src/panels/Search.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `api.search`, `api.expand`, `mergeInto`.
- Produces: `<Search onPick={(hit: Hit) => void}/>`. Picking a hit adds the node as a **root**.

- [ ] **Step 1: Implement the panel**

```tsx
import { useEffect, useState } from "react";
import { search, type Hit } from "../api";

export function Search({ onPick }: { onPick: (h: Hit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) return setHits([]);
    const timer = setTimeout(() => {
      search(q).then(setHits).catch((e) => setError(String(e)));
    }, 200); // debounce: search is a scan on the server
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="panel">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" />
      {error && <div className="error">{error}</div>}
      <ul>
        {hits.map((h) => (
          <li key={h.id} onClick={() => onPick(h)}>
            <span className={`chip ${h.labels[0]}`}>{h.labels[0]}</span>
            <strong>{h.caption}</strong>
            <small>{h.sub} · {h.degree} edges</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Wire it in `App.tsx`**

```ts
async function completeEdges() {
  const ids = graph.nodes().map(Number);
  const { edges } = await edgesBetween(ids);
  mergeInto(graph, [], edges, mode);
  setVersion((v) => v + 1);
}

async function onPick(hit: Hit) {
  const n = await getNode(hit.id);
  mergeInto(graph, [n], [], mode);
  roots.add(String(hit.id));   // asked for by name, so never auto-removed
  setSelected(hit.id);
  await completeEdges();       // connect it to whatever is already loaded
}
```

- [ ] **Step 3: Verify by hand**

Type `postgres`. Expected: Decisions ranked with an exact caption match first;
clicking one puts it on the canvas connected to anything already there.

- [ ] **Step 4: Commit**

```bash
git add web/ && git commit -m "feat: server-backed search panel"
```

---

### Task 11: Detail panel and expand-by-type

**Files:**
- Create: `web/src/panels/Detail.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `api.getNode`, `api.expand`, `api.edgesBetween`, `mergeInto`.
- Produces: `<Detail nodeId={number|null} onExpand={(type: string, dir: string) => void}/>`; `App.expandOne(id, type, dir, offset?)` which merges the result and re-runs edge completion.

- [ ] **Step 1: Implement the panel**

```tsx
import { useEffect, useState } from "react";
import { getNode, type NodeDetail } from "../api";

export function Detail({
  nodeId,
  onExpand,
}: {
  nodeId: number | null;
  onExpand: (type: string, dir: "out" | "in") => void;
}) {
  const [n, setN] = useState<NodeDetail | null>(null);
  useEffect(() => {
    if (nodeId === null) return setN(null);
    getNode(nodeId).then(setN).catch(() => setN(null));
  }, [nodeId]);

  if (!n) return <div className="panel">nothing selected</div>;
  const label = n.labels[0];
  const p = n.props as Record<string, string>;

  return (
    <div className="panel detail">
      <span className={`chip ${label}`}>{label}</span>
      <h2>{n.caption}</h2>
      {label === "Decision" && (
        <>
          {p.statement && <p className="statement">{p.statement}</p>}
          {/* The rationale leads: the what is recoverable from the code, the why is not. */}
          <section className="rationale">
            <h3>rationale</h3>
            <p>{p.rationale}</p>
          </section>
          {p.despite && (
            <section className="despite">
              <h3>despite precedent</h3>
              <p>{p.despite}</p>
            </section>
          )}
          <dl>
            <dt>scope</dt><dd>{p.scope}</dd>
            <dt>status</dt><dd className={`status-${p.status}`}>{p.status}</dd>
            <dt>created</dt><dd>{p.created}</dd>
          </dl>
        </>
      )}
      <section className="expand">
        <h3>expand</h3>
        {n.degrees.map((d) => (
          <button key={`${d.type}-${d.dir}`} onClick={() => onExpand(d.type, d.dir)}>
            {d.dir === "out" ? `${d.type} ▸` : `◂ ${d.type}`} {d.count}
          </button>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Implement `expandOne` in `App.tsx`**

```ts
const PAGE = 50;

async function expandOne(id: number, type: string, dir: "out" | "in", offset = 0) {
  const r = await expand(id, { type, dir, limit: PAGE, offset });
  mergeInto(graph, r.nodes, r.edges, mode);  // NOT roots: expansion is derived
  expanded.add(id);
  const shown = offset + r.nodes.length;
  setMore((m) => ({ ...m, [`${id}-${type}-${dir}`]: Math.max(0, r.total - shown) }));
  await completeEdges();  // without this, A and C expanded separately never show A->C
}
```

The `more` map drives the `+N more` affordance on each chip; clicking it calls
`expandOne` again with `offset + PAGE`.

- [ ] **Step 3: Verify by hand**

Click a Decision. Expected: rationale is the visually dominant block; chips read
`CHOSE ▸ 3`, `REJECTED ▸ 5`; clicking one adds exactly those neighbours; a
superseded Decision renders faded.

- [ ] **Step 4: Commit**

```bash
git add web/ && git commit -m "feat: detail panel with rationale-first layout and typed expansion"
```

---

### Task 12: Canvas gestures — expand-all, collapse, context menu

**Files:**
- Create: `web/src/graph/ContextMenu.tsx`
- Modify: `web/src/graph/Canvas.tsx`, `web/src/App.tsx`

**Interfaces:**
- Consumes: `allocate`, `survivors`, `api.expand`, `api.getNode`.
- Produces: `App.expandAll(id)`, `App.collapse(id)`, `App.hide(id)`, `App.focus(id)`, `App.togglePin(id)`; `<ContextMenu at={{x,y}} nodeId degrees onAction/>`.

- [ ] **Step 1: Register the gestures in `Canvas.tsx`**

```tsx
  useEffect(() => {
    registerEvents({
      clickNode: (e) => onSelect(Number(e.node)),
      doubleClickNode: (e) => onDoubleClick(Number(e.node)),
      rightClickNode: (e) => {
        e.preventSigmaDefault();
        onContextMenu(Number(e.node), e.event.x, e.event.y);
      },
      enterNode: (e) => setHovered(e.node),
      leaveNode: () => setHovered(null),
    });
  }, [registerEvents]);
```

Dragging pins: on `downNode` record the node, on `mousemovebody` write
`graph.setNodeAttribute(node, "fixed", true)` plus the new x/y and call
`event.preventSigmaDefault()`, on `mouseup` clear the drag. ForceAtlas2 skips
nodes with `fixed: true`.

- [ ] **Step 2: Implement `expandAll` in `App.tsx`**

```ts
async function expandAll(id: number) {
  const { degrees } = await getNode(id);
  const plan = allocate(degrees, 100);            // smallest edge type first
  let added = 0;
  let left = 0;
  for (const a of plan) {
    if (a.take > 0) {
      const r = await expand(id, { type: a.type, dir: a.dir, limit: a.take });
      mergeInto(graph, r.nodes, r.edges, mode);
      added += r.nodes.length;
    }
    left += a.remaining;
  }
  await completeEdges();
  if (left > 0) toast(`added ${added} of ${added + left} — use the type chips for the rest`);
}
```

- [ ] **Step 3: Implement `collapse` in `App.tsx`**

```ts
function collapse(id: number) {
  const present = graph.nodes();
  const edges = graph.edges().map((e) => ({
    id: e,
    src: graph.source(e),
    dst: graph.target(e),
    type: graph.getEdgeAttribute(e, "edgeType") as string,
  }));
  // `id` stops being an expansion point: anything that only hung off it goes.
  const keep = survivors(edges, present, roots, pinned);
  for (const n of present) if (!keep.has(n) && n !== String(id)) graph.dropNode(n);
}
```

Second double-click on an already-expanded node calls this; the first call
expands. Track which node ids have been expanded in a `Set`.

- [ ] **Step 4: Implement `ContextMenu.tsx`**

```tsx
export function ContextMenu({ at, node, degrees, onAction, onClose }) {
  if (!at) return null;
  return (
    <ul className="context-menu" style={{ left: at.x, top: at.y }} onMouseLeave={onClose}>
      <li className="submenu">
        expand ▸
        <ul>
          {degrees.map((d) => (
            <li key={`${d.type}-${d.dir}`} onClick={() => onAction("expand", d)}>
              {d.dir === "out" ? `${d.type} ▸` : `◂ ${d.type}`} {d.count}
            </li>
          ))}
          <li onClick={() => onAction("expand-all")}>all</li>
        </ul>
      </li>
      <li onClick={() => onAction("collapse")}>collapse</li>
      <li className="sep" />
      <li onClick={() => onAction("pin")}>pin / unpin</li>
      <li onClick={() => onAction("focus")}>focus (hide others)</li>
      <li onClick={() => onAction("hide")}>hide</li>
      <li className="sep" />
      <li onClick={() => onAction("copy-key")}>copy domain key</li>
    </ul>
  );
}
```

`focus` is `survivors` with this node as the only root — the same operation, no
extra machinery. `copy-key` copies the `key` from `/api/node/{id}`, the value
that survives a rebuild.

- [ ] **Step 5: Verify by hand**

Expected: double-click a Decision expands its whole neighbourhood (the counts
are small enough to fit the budget); double-click again returns the canvas to
exactly its prior state; double-click a Tag reports *added 100 of N*; a node
reached two ways survives collapsing either; dragging a node holds it still
while ForceAtlas2 runs.

- [ ] **Step 6: Commit**

```bash
git add web/ && git commit -m "feat: canvas gestures, budgeted expand-all, structural collapse"
```

---

### Task 13: Cypher console and saved queries

**Files:**
- Create: `web/src/panels/Cypher.tsx`, `web/src/savedQueries.ts`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `api.runCypher`, `cellsToGraph`, `mergeInto`.
- Produces: `<Cypher onAdd={(nodes, edges) => void}/>`; `SAVED: {name: string, cypher: string}[]`.

- [ ] **Step 1: Write the saved queries**

```ts
// web/src/savedQueries.ts
// Every query that asks what is true now filters status = 'active'.
export const SAVED = [
  {
    name: "kin by tag overlap",
    cypher: `MATCH (p:Project)-[:TAGGED]->(t:Tag)<-[:TAGGED]-(o:Project)
WHERE p.id <> o.id
RETURN p AS project, t AS tag, o AS kin`,
  },
  {
    name: "contradictions (one project, one topic, two live answers)",
    cypher: `MATCH (a:Decision)-[:IN_PROJECT]->(p:Project)<-[:IN_PROJECT]-(b:Decision)
MATCH (a)-[:ABOUT]->(t:Topic)<-[:ABOUT]-(b)
WHERE a.status = 'active' AND b.status = 'active' AND a.id < b.id
RETURN p AS project, t AS topic, a AS one, b AS other`,
  },
  {
    name: "norms (an option chosen in 2+ projects)",
    cypher: `MATCH (d:Decision)-[:CHOSE]->(o:Option)
MATCH (d)-[:IN_PROJECT]->(p:Project)
WHERE d.status = 'active'
WITH o, count(DISTINCT p) AS projects
WHERE projects > 1
RETURN o AS option, projects
ORDER BY projects DESC`,
  },
  {
    name: "supersession chains",
    cypher: `MATCH (new:Decision)-[r:SUPERSEDES]->(old:Decision)
RETURN new AS replacement, r AS r, old AS superseded`,
  },
  {
    name: "regretted clusters",
    cypher: `MATCH (l:Lesson)-[r:REGRETS]->(d:Decision)
RETURN l AS lesson, r AS r, d AS decision`,
  },
  {
    name: "acknowledged divergences",
    cypher: `MATCH (d:Decision)-[r:DIVERGES_FROM]->(from:Decision)
RETURN d AS diverged, r AS r, from AS precedent`,
  },
];
```

- [ ] **Step 2: Implement the console**

```tsx
import { useState } from "react";
import { runCypher } from "../api";
import { cellsToGraph, type Cell, type GEdge, type GNode } from "../classify";
import { SAVED } from "../savedQueries";

export function Cypher({ onAdd }: { onAdd: (n: GNode[], e: GEdge[]) => void }) {
  const [query, setQuery] = useState(SAVED[0].cypher);
  const [result, setResult] = useState<{ columns: string[]; rows: Cell[][]; truncated: boolean } | null>(null);
  const [error, setError] = useState<{ type: string; error: string } | null>(null);

  async function run() {
    setError(null);
    try {
      setResult(await runCypher(query));
    } catch (e) {
      // The engine's own message, verbatim — a console that hides the
      // parser's output is useless.
      const m = String(e).match(/\{.*\}/);
      setError(m ? JSON.parse(m[0]).detail : { type: "Error", error: String(e) });
      setResult(null);
    }
  }

  const graphed = result ? cellsToGraph(result.rows) : { nodes: [], edges: [] };

  return (
    <div className="panel cypher">
      <select onChange={(e) => setQuery(SAVED[Number(e.target.value)].cypher)}>
        {SAVED.map((q, i) => <option key={q.name} value={i}>{q.name}</option>)}
      </select>
      <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={4} />
      <button onClick={run}>run</button>
      {error && <pre className="error">{error.type}: {error.error}</pre>}
      {result?.truncated && <div className="warn">showing 1000 rows; more were dropped</div>}
      {graphed.nodes.length > 0 && (
        <button onClick={() => onAdd(graphed.nodes, graphed.edges)}>
          add {graphed.nodes.length} nodes to canvas
        </button>
      )}
      {result && (
        <table>
          <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    {cell.kind === "node" ? `(${cell.node.labels[0]})`
                      : cell.kind === "rel" ? `-[${cell.rel.type}]->`
                      : String(cell.value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

Nodes added from the console are **roots** — they were asked for by name.

- [ ] **Step 3: Verify by hand**

Run each saved query. Expected: all six execute without a dialect error; the
graph-shaped ones offer *add to canvas*; `MATCH (` reports a `ParseError` with
the engine's text; `CREATE (x:Zzz)` reports the read-transaction refusal.

If any saved query fails to parse, fix it against
`references/schema.md`'s dialect notes — alias every returned expression, and
use `NOT EXISTS { MATCH ... }` rather than `NOT (n)-[:R]->()`.

- [ ] **Step 4: Commit**

```bash
git add web/ && git commit -m "feat: cypher console with saved precedent queries"
```

---

### Task 14: Live updates, static serving, README

**Files:**
- Modify: `web/src/App.tsx`, `server/precedent_ui.py`
- Create: `README.md`

**Interfaces:**
- Produces: an SSE subscription that raises a *graph changed* badge; `create_app` mounting `web/dist` when it exists.

- [ ] **Step 1: Subscribe to the stream in `App.tsx`**

```ts
useEffect(() => {
  const es = new EventSource("/api/stream");
  let first = true;
  es.onmessage = (e) => {
    const { mtime } = JSON.parse(e.data);
    if (first) { first = false; setMtime(mtime); return; }
    if (mtime !== mtimeRef.current) setChanged(true);  // badge only
  };
  return () => es.close();
}, []);
```

Refresh (user-initiated) re-fetches `getNode` for every loaded id, updates
props and degrees, drops any that now 404 with a *graph was rebuilt* notice, and
re-runs `edgesBetween`. It never auto-expands — the working set belongs to the
user.

- [ ] **Step 2: Serve the built frontend**

```python
    dist = pathlib.Path(__file__).parent.parent / "web" / "dist"
    if dist.is_dir():
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=dist, html=True), name="web")
```

Mount last, after every `/api` route, so the catch-all cannot shadow them.

- [ ] **Step 3: Write `README.md`**

Cover: what it is, that it is read-only, `uv run python -m server.precedent_ui`,
the dev loop (`bun run dev` + the proxy), `bun run build` for the single-process
mode, `--home` for a relocated store, and the note that `--index` (Task 15) is
the one write it can ever perform.

- [ ] **Step 4: Verify the full loop by hand**

```bash
cd web && bun run build && cd ..
uv run python -m server.precedent_ui --port 8899
```
Open `http://127.0.0.1:8899`. In another terminal record a decision with
`precedent.py`. Expected: the badge appears within ~2s; clicking refresh shows
the new state; nothing expands on its own.

- [ ] **Step 5: Commit**

```bash
git add web/ server/ README.md
git commit -m "feat: live change badge, static serving, README"
```

---

### Task 15: Optional fulltext indexes

**Files:**
- Modify: `server/precedent_ui.py`, `server/store.py`, `tests/test_store.py`

**Interfaces:**
- Produces: `Store.create_indexes()` and a `--index` CLI flag; `Store.has_fulltext` used by search to pick its path.

This is the **one** write this tool can ever perform. It creates fulltext
indexes and touches no decision data. It is never implicit and is off by
default.

- [ ] **Step 1: Write the failing test**

```python
def test_create_indexes_is_opt_in_and_leaves_decisions_untouched(store):
    before = store.query("MATCH (n) RETURN count(n) AS n")[0]["n"]
    store.create_indexes()
    after = store.query("MATCH (n) RETURN count(n) AS n")[0]["n"]
    assert after == before
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/test_store.py -v`
Expected: FAIL — `Store` has no attribute `create_indexes`

- [ ] **Step 3: Implement**

```python
    def create_indexes(self) -> None:
        """The one write this tool performs. Never called implicitly."""
        from server.queries import SEARCH_FIELDS

        with self._handle().begin_write() as tx:
            for label, fields in SEARCH_FIELDS.items():
                tx.create_fulltext_index_word_multi(label, fields)
            tx.commit()
```

Add `--index` to `main()`: when passed, build the indexes, print what was
created, and exit without starting the server.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add server/ tests/
git commit -m "feat: opt-in fulltext indexes for large stores"
```

---

## Verification

Run the whole suite and both hand-checks before calling this done:

```bash
uv run pytest -v
cd web && bun run test && bun run build
```

Then, against the real store: search finds a Decision; double-click expands its
whole neighbourhood; double-click again restores the prior canvas exactly; a
Tag reports what it left behind; the theme toggle changes nothing about the
graph data; recording a decision in another terminal raises the badge; `CREATE`
in the console is refused by the engine.
