"""precedent-ui: a read-only browser for the precedent decision graph."""

from __future__ import annotations

import argparse
import pathlib

from fastapi import FastAPI, HTTPException

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
