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
