# precedent-ui

A read-only browser for the `precedent` decision graph (the local, journaled
graph a `precedent.py record`/`rebuild` CLI maintains): a themed canvas of
decisions, projects, and tags, with search, a detail panel, capped/paged
expansion, structural collapse, and a Cypher console for ad-hoc queries. It
never writes to your decision graph — see **Read-only** below.

## Requirements

- [`uv`](https://docs.astral.sh/uv/) for the Python server
- [`bun`](https://bun.sh/) for the frontend — never `npm`
- An existing `precedent` store (`~/.local/share/precedent` by default)

## Running it

### Single-process mode (recommended)

Build the frontend once, then run the server — it serves the built assets
itself, so there is exactly one process and one port:

```bash
cd web && bun install && bun run build && cd ..
uv run python -m server.precedent_ui
```

Open `http://127.0.0.1:8899`. Rebuild (`bun run build`) after any frontend
change; the server picks up the new `web/dist` on its next start.

### Dev loop

For frontend iteration with hot reload, run the API server and the Vite dev
server side by side. Vite's dev config proxies `/api/*` to the server, so the
browser only ever talks to one origin in practice:

```bash
uv run python -m server.precedent_ui      # terminal 1 — API on :8899
cd web && bun install && bun run dev       # terminal 2 — Vite on :5173
```

Open `http://localhost:5173`.

### A relocated store

Point either mode at a different `precedent` home with `--home`:

```bash
uv run python -m server.precedent_ui --home /path/to/precedent --port 8899
```

A relocation pointer file (`location`) inside `--home` is followed once, the
same way `precedent.py` itself resolves a moved store.

## Read-only

`precedent-ui` never calls `Database.begin_write()`, and has no code path that
could. The Cypher console can run arbitrary read queries against the graph, but
the engine itself refuses writes outside an explicit write transaction —
`CREATE`, `DETACH DELETE`, and friends fail with a 400, not a mutation. There
is no write path at all in this codebase, and nothing here, present or future,
should gain one.

## Live updates

The server watches `journal.jsonl` — precedent's own append-only source of
truth — and streams a Server-Sent Events frame over `/api/stream` whenever it
changes (i.e. a `precedent.py record` happened, in this process or another).

It deliberately does **not** watch `graph.db`. The underlying engine touches
that file's mtime on every open, including a plain read, and this server
opens a fresh handle per query — so `graph.db`'s own mtime moves constantly
even when nothing was ever recorded, and using it as the change signal would
raise the badge on ordinary browsing rather than on a real change.

The UI never applies a change automatically — the canvas is your working
set, not a live view. Instead, a "graph changed" badge appears in the
header; clicking **refresh** re-fetches every node currently on the canvas,
updates its properties, drops any that no longer exist, and reconnects the
edges among what's left. Nothing is auto-expanded.

One thing this deliberately does **not** cover: `precedent.py rebuild`
replays the existing journal into a fresh `graph.db` without appending to
the journal — it only renumbers each node's internal id — so a bare rebuild
does not raise this badge. That's fine, not an oversight: no decision
changed, and the refresh path above already tolerates a renumbered id via a
404 and a "graph was rebuilt" notice.

## Security boundary

The server binds `127.0.0.1` only and must never gain CORS middleware.
`/api/cypher` executes arbitrary read Cypher by design, so the loopback
socket *is* the trust boundary — permissive CORS would hand any visited web
page read access to your whole decision graph.

## Development

```bash
uv run pytest -q         # Python test suite
cd web && bun run test    # frontend unit tests
cd web && bun run build   # the only real type check — tsc --noEmit alone checks zero files here
```
