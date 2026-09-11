"""precedent-ui: a read-only browser for the precedent decision graph."""

from __future__ import annotations

import argparse
import asyncio
import json
import pathlib
import re
from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from graphdblite import GraphDBError
from pydantic import BaseModel

from server import queries
from server.store import DEFAULT_HOME, Store

VALID_TYPE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

LABEL_COUNTS = "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n ORDER BY n DESC"
EDGE_COUNTS = "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS n ORDER BY n DESC"

MAX_ROWS = 1000


class IdsIn(BaseModel):
    ids: list[int]


class CypherIn(BaseModel):
    query: str
    params: dict = {}
    max_rows: int = MAX_ROWS


def _stamp_str(stamp: tuple[int, int]) -> str:
    """Wire form of a Store.change_stamp() tuple: `"<mtime_ns>:<size>"`.

    A plain string keeps both components significant to an equality check —
    projecting to mtime_ns alone would miss a change that lands within the
    same nanosecond tick but a different size (coarse-clock filesystems).
    Used identically by /api/meta and /api/stream so the two endpoints agree
    on what "changed" means.
    """
    return f"{stamp[0]}:{stamp[1]}"


async def mtime_events(store: Store, interval: float = 1.0) -> AsyncIterator[str]:
    """Yield an SSE frame whenever the store's journal-derived change stamp moves.

    Polls Store.change_stamp() — journal.jsonl's mtime_ns + size — NOT
    graph.db's mtime. graphdblite bumps graph.db's mtime on every open, even
    for a pure read, so with a fresh Database handle per query (Store.query)
    graph.db's own mtime moves constantly while nothing was ever recorded;
    that would fire this stream on ordinary browsing rather than on a real
    change. The journal is append-only and this process never opens it, so
    it only moves on a real `precedent.py record` from elsewhere. A bare
    `precedent.py rebuild` does not move it either — see
    Store.change_stamp's docstring for why that's deliberate.

    Module level and interval-injectable so it can be tested directly:
    an infinite generator can never be read through TestClient, which
    waits for the response to complete.
    """
    last = None
    while True:
        now = store.change_stamp()
        if now != last:
            last = now
            yield f"data: {json.dumps({'mtime': _stamp_str(now)})}\n\n"
        await asyncio.sleep(interval)


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
            # Same journal-derived source /api/stream watches — see
            # Store.change_stamp's docstring for why this isn't graph.db's mtime.
            "mtime": _stamp_str(store.change_stamp()),
        }

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

    @app.get("/api/expand/{node_id}")
    def expand(
        node_id: int,
        type: str | None = None,
        dir: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        # Validate parameters
        if dir is not None and dir not in ("out", "in"):
            raise HTTPException(400, f"invalid direction {dir!r} — expected 'out' or 'in'")
        if type is not None and not VALID_TYPE.fullmatch(type):
            raise HTTPException(400, f"invalid edge type {type!r}")

        # Resolve direction: use provided dir or None for undirected
        resolved_dir = dir  # This is either "out", "in", or None

        nodes: dict[int, dict] = {}
        edges: dict[str, dict] = {}
        total = store.query(
            queries.expand_count_cypher(type, resolved_dir), {"id": node_id}
        )[0]["n"]
        rows = store.query(
            queries.expand_cypher(type, resolved_dir),
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
        return StreamingResponse(mtime_events(store), media_type="text/event-stream")

    # Mounted LAST, after every /api route: StaticFiles(html=True) serves a
    # catch-all for unmatched paths, which would shadow the routes above if
    # mounted earlier.
    dist = pathlib.Path(__file__).parent.parent / "web" / "dist"
    if dist.is_dir():
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=dist, html=True), name="web")

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
