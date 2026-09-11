# precedent-ui — design

Date: 2026-09-11
Status: approved; implemented on `feat/precedent-ui`. Amendments made during
the final review pass are marked where they occur.

## What this is

A read-only browser for the `precedent` decision graph. It opens the
graphdblite store directly, lets you find a node by text, and grow a picture
outwards from it one hop at a time. A Cypher console sits underneath for
questions the UI does not have a button for.

It exists because `brief`, `check` and `suggest` answer questions you already
knew to ask. Seeing the graph answers the ones you did not.

## Goals

- Explore and browse: start from a search hit, expand, follow, read the rationale.
- Run arbitrary Cypher and render the result as a graph when it is graph-shaped.
- Reflect new data without a restart.
- Stay usable when the store is not 58 decisions but a company's worth of them.
- Know the precedent schema: status, rationale, the three warnings, the saved
  questions.

## Non-goals

- **No writes to the decision record — no writes at all.** Recording a decision
  belongs in the agent conversation, where the rationale is captured in the
  user's own words. A form cannot do that, and a wrong entry is worse than a
  missing one. This tool holds no write path whatsoever: it never calls
  `begin_write()`, so read-only is a property of the code as well as of the
  engine (see *search*, below, for the index-building flag that was cut and
  what it would take to reinstate it).
- No whole-graph render. There is no "show everything" button, at any size.
- No auth, no multi-user, no hosting. Localhost tool.
- Not a generic graphdblite browser. It knows this schema. (A generic one is a
  different project; the API layer here would port, the skin would not.)

## Constraints that shaped it

- **The store is read-only to us by construction.** graphdblite's `query()`
  refuses writes outside an explicit `begin_write()`:

  ```
  GraphDBError: write operations are not permitted inside a read transaction
  ```

  So the Cypher console needs no allowlist, no statement parsing, no
  regex-for-`CREATE`. Read-only is an engine property, not a thing we enforce
  and get wrong.

- **Result values are self-describing.** graphdblite returns nodes as
  `{"__id": 2, "__labels": ["Decision"], ...props}` and relationships as
  `{"__src": 1, "__dst": 13, "__label": "TAGGED"}`. Classification is
  structural, so arbitrary Cypher can be rendered as a graph without a typed
  driver.

  Paths are the exception: `MATCH p=(a)-[]->(b) RETURN p` yields a bare
  `[2, 3]` with no type marker. Indistinguishable from a list of integers, so
  v1 renders paths as scalars rather than guessing.

- **`graph.db`'s mtime is NOT a sound change signal.** It is a single SQLite
  file with no `-wal` sidecar, which is why it looked like one — but graphdblite
  bumps its mtime on every open, including a pure read, and this server opens a
  fresh handle per query. Measured: five plain reads left `journal.jsonl`
  untouched and moved `graph.db` every time. Change detection therefore watches
  `journal.jsonl` — precedent's own append-only source of truth, which this
  process never opens — as `(mtime_ns, size)`.

- **`__id` is engine-assigned and session-scoped.** `precedent rebuild` replays
  the journal into a fresh graph and renumbers everything. Every node also
  carries a stable domain key (`Decision.id`, `Project.id`, `Tag.name`,
  `Topic.name`, `Option.name`, `Principle.id`, `Lesson.id`), which is what the
  client falls back to after a rebuild.

## Security boundary

`/api/cypher` executes arbitrary user-supplied Cypher on purpose, so the trust
boundary is the loopback socket, not any individual endpoint. That is only
acceptable because of what the engine cannot do, which was measured rather than
assumed:

Probed against **graphdblite 0.1.2**:

| Probe | Result |
|---|---|
| `LOAD CSV FROM 'file:///etc/passwd'` | `SyntaxError` — not parsed |
| `apoc.load.json('file://…')` | `SyntaxError` |
| `CALL dbms.procedures()`, `CALL db.labels()` | `ProcedureNotFound` — *these two* do not exist |
| `CALL fts.search('Decision','title','x')` | **resolves.** Failed only with `index not found` — so the engine does have procedures |
| `CREATE`, `DETACH DELETE` | refused: writes need an explicit write transaction |

**Read this table as a snapshot of one version, not as a property of the
engine, and re-probe it before relying on it.** An earlier draft of this
document concluded "no procedure support" from the two `ProcedureNotFound`
rows. That was wrong: `fts.search` resolves. The conclusion survived the
correction but the reason did not, and in a security argument a wrong reason is
worse than no reason — it is what someone relaxes a rule on.

The reason the conclusion holds is narrower and does not depend on the
procedure namespace being empty: **`/api/cypher` runs every statement inside
graphdblite's read transaction, which refuses writes outright**, and the one
procedure known to exist (`fts.search`) reads the graph's own fulltext indexes —
no filesystem access, no network, no mutation. A new procedure appearing in a
future version could change that, which is exactly why this is a probe log with
a version on it.

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

## Architecture

```
web/  (vite + react + ts)            server/  (uv script)
┌──────────────────────────┐         ┌────────────────────────────┐
│ sigma + graphology       │  /api   │ FastAPI + uvicorn          │
│ @react-sigma/core        │ ◄─────► │ graphdblite Database       │
│   minimap, forceatlas2   │   SSE   │   (read queries only)      │
└──────────────────────────┘         └────────────┬───────────────┘
                                                  │
                                       ~/.local/share/precedent/graph.db
```

Two processes in development (vite dev server proxying `/api` to uvicorn), one
in use (`server` serves `web/dist` when it exists).

### Why these pieces

- **sigma.js / graphology via `@react-sigma/core`.** Incremental growth is the
  whole interaction, and graphology's `mergeNode`/`mergeEdge` is exactly that —
  add to a live instance, no remount. The ecosystem supplies the furniture
  (`ZoomControl`, `FullScreenControl`, `LayoutForceAtlas2Control`,
  `@react-sigma/minimap`, `nodeReducer`/`edgeReducer` for hover dimming), so
  none of it is hand-written. Rendering sits behind the API contract below; it
  is one file to swap if it disappoints.

  `@react-sigma/graph-search` is deliberately **not** used: it searches the
  loaded graph client-side via minisearch, and the entire point of search here
  is finding nodes that are *not* loaded.

- **FastAPI + uvicorn**, run as `uv run python -m server.precedent_ui` against
  the project's `pyproject.toml` deps. Six endpoints and an SSE stream; this is
  the least code for that.

- **Rejected: Neo4j.** Importing into a real Neo4j buys Bloom/Browser for free
  but costs a server, a driver, an import job that must track the journal, and
  permanent Cypher-dialect drift between two engines. For a store whose engine
  is deliberately embedded, that is the wrong shape.

- **Rejected: AntV G6.** More batteries (toolbar, contextmenu, built-in expand
  behaviours) but a heavier API surface and weaker documentation for
  server-fed, incrementally-grown graphs.

- **Rejected: one self-contained generated HTML file.** Simplest possible
  delivery, but cannot do live updates, server-side search or Cypher
  execution — all of which are requirements.

## API contract

All endpoints read-only. All node references are `__id` integers unless stated.

### `GET /api/meta`

```json
{ "labels": {"Decision": 56, "Project": 6, "Tag": 13, ...},
  "edge_types": {"IN_PROJECT": 56, "ABOUT": 71, ...},
  "mtime": "1789040000123456789:41231" }
```

Feeds change detection. The legend and the label filter list this was also
meant to feed are **cut from v1** (see the cut list below): the endpoint and its
typed client (`api.ts`'s `getMeta`) stay, ready for them, but nothing calls it
today and no legend or filter UI exists.

`mtime` is not a numeric timestamp but a journal-derived change stamp string,
`"<mtime_ns>:<size>"` over `journal.jsonl` — see the `/api/stream` section.

### `GET /api/search?q=<text>&limit=50`

Server-side, case-insensitive substring over the text properties that matter per
label: `Decision.title|statement|rationale`, `Project.name|id`, `Tag.name`,
`Topic.name`, `Option.name`, `Principle.statement`, `Lesson.statement`.

```json
[{ "id": 103, "labels": ["Decision"], "caption": "PostgreSQL is the only supported database",
   "sub": "architecture · active", "degree": 11 }]
```

Ranking: exact match on the caption field first, then prefix, then substring,
then by degree descending. Ties broken by `__id` so paging is stable.

Scale note: this is a scan, and it stays one. An earlier `--index` flag that
called `create_fulltext_index_word_multi` was removed as a pure no-op: creating
the index changed nothing, because graphdblite's fulltext indexes are reachable
*only* through `CALL fts.search(label, property, query)`, and `search_cypher`
unconditionally emits `toLower(toString(n.<field>)) CONTAINS $q`. The index was
built and never read.

If a store ever grows large enough for the scan to hurt, building it back means
more than restoring the flag:

- keep the index-creation call (`create_fulltext_index_word_multi` per label +
  field set), and
- rewrite search to issue `CALL fts.search(<label>, <field>, $q)`, and
- probe index presence per label/field before doing so — the engine reports a
  missing index only by raising (`index not found`), and `CALL db.labels()` is
  `ProcedureNotFound`, so there is no catalogue to ask — and
- keep the current `CONTAINS` scan as the fallback for every label/field whose
  index is absent, since the two paths must return the same shape.

Note what removing the flag also removed: it was the only `begin_write()` in
the tool, so the codebase now has **no** write path at all.

### `GET /api/node/{id}`

Full properties plus the degree breakdown that drives expansion:

```json
{ "id": 2, "labels": ["Decision"], "props": {...},
  "degrees": [ {"type": "REJECTED", "dir": "out", "count": 5},
               {"type": "CHOSE",    "dir": "out", "count": 3} ] }
```

404 when the id is gone (see stale-id handling below).

### `GET /api/expand/{id}?type=CHOSE&dir=out&limit=50&offset=0`

Neighbours along one edge type and direction, capped.

```json
{ "nodes": [...], "edges": [...], "total": 362, "offset": 0, "limit": 50 }
```

`type` and `dir` omitted means all types, still capped. `total` is what the
`+N more` affordance reports.

Expand-all (double-click) does not use the omitted-type form: the client already
holds the degree breakdown from `/api/node/{id}`, so it allocates its budget
across types itself and issues one call per type. That is what lets it spend
smallest-type-first and report precisely what it left behind.

### `POST /api/edges-between`

```json
{ "ids": [2, 13, 103] }  ->  { "edges": [...] }
```

Called after every merge. Without it the picture is falsely sparse: expand A,
expand C separately, and the A→C edge is never learned.

### `POST /api/cypher`

```json
{ "query": "MATCH (d:Decision) RETURN d AS d LIMIT 10", "params": {} }
```

Returns `{"columns": [...], "rows": [...], "truncated": false}`. Each cell is
tagged `node` / `rel` / `scalar` by the structural rule above. Rows capped at
1000, `truncated` says so, and the UI states it rather than silently lying.

Engine errors are returned verbatim with their class name (`ParseError`,
`StorageError`). A Cypher console that hides the parser's message is useless.

### `GET /api/stream`

SSE. Polls `journal.jsonl`'s `(mtime_ns, size)` server-side (not `graph.db`'s
mtime — see the constraints above) and emits `{"mtime": "<mtime_ns>:<size>"}`
when it moves, including once immediately on connect so a client learns the
current value. The client shows a *graph changed* badge. Refresh re-fetches
props and degrees for loaded nodes and runs `edges-between` over them. It never
auto-expands — the working set belongs to the user.

Refresh drops a node **only** on a 404. Any other failure — a 503 while the
store is missing or busy, a 5xx, a dropped connection — leaves the node, its
root status and its pin alone and says the refresh was incomplete, because none
of those say anything about whether the node still exists.

One thing this deliberately does not catch: `precedent rebuild` replays the
existing journal into a fresh `graph.db` without appending to the journal, so a
bare rebuild does not move the stamp. No decision changed, and the refresh path
already tolerates a renumbered `__id` via the 404 above.

## Interaction model

```
┌───────────────┬──────────────────────────────────┬─────────────────┐
│ search  [___] │                                  │ Decision        │
│ ───────────── │                                  │ ─────────────── │
│ ▸ Postgres…   │          sigma canvas            │ title           │
│ ▸ Tests run…  │                                  │ RATIONALE       │
│ ▸ backend     │        (working set only)        │ status: active  │
│               │                                  │ ─────────────── │
│ labels  (cut) │                          ┌─────┐ │ expand:         │
│ ☑ Decision    │                          │ mini│ │ [CHOSE 3]       │
│ ☑ Project …   │                          └─────┘ │ [REJECTED 5]    │
├───────────────┴──────────────────────────────────┤ [ABOUT 2]       │
│ cypher ▾  MATCH (d:Decision)…          [run]     │ [IN_PROJECT 1]  │
└──────────────────────────────────────────────────┴─────────────────┘
```

The loop: **search → click a hit → the node lands on the canvas → pick an
edge-type chip → its neighbours merge in.**

### Canvas gestures

| Gesture | Effect |
|---|---|
| click | select → detail panel |
| double-click | expand every edge type, both directions, within a budget |
| double-click again | collapse (below) |
| right-click | context menu (below) |
| drag | pin; pinned nodes are exempt from layout until unpinned |
| hover | dim everything that is not a neighbour, via `nodeReducer`/`edgeReducer` |

Direction is legible before you commit to loading anything: edges render with
arrows, and the detail chips read `CHOSE ▸ 3` / `◂ REGRETS 1`.

**The expand-all budget is 100 nodes, spent smallest edge type first.** A
Decision (`CHOSE 3 · REJECTED 5 · ABOUT 2 · IN_PROJECT 1`) therefore expands
completely and double-click means what it looks like it means. A `Tag` with 4362
projects expands to 100 and says *"added 100 of 4362 — use the type chips for
the rest"*. Smallest-first because it more often yields a whole neighbourhood
than an arbitrary slice of the single biggest type.

### Collapse, and the canvas invariant

> **Every node on the canvas is a root, is pinned, or is connected to a root.**

A **root** is a node asked for by name: a search hit, a Cypher *add to canvas*,
or the default Projects view. Roots and pinned nodes are both sticky — neither
is ever removed automatically — but they are sticky in different ways, and the
difference is the whole of the invariant:

- A **root** anchors a neighbourhood. The BFS starts from the roots, so
  anything still connected to one survives.
- A **pin** anchors exactly one node. Pinning means *hold this still and keep
  it*, not *protect everything attached to it*. A pinned node is added to the
  survivor set directly and is **not** a BFS source, so its neighbours can
  vanish out from under it and leave it sitting alone. That is deliberate: a
  pin is a layout gesture (drag a node where you want it), and letting a drag
  silently make a whole subgraph uncollapsible would be a surprising amount of
  meaning to attach to moving something.

`collapse(n)` drops every non-root, non-pinned node that loses its path to a
root once `n` stops being an expansion point — one BFS from the roots, with the
pinned nodes seeded into the survivor set.

Defining it this way rather than as "remove what arrived from this node" avoids
tracking provenance, which goes stale the moment the same node is reached a
second way. The consequences are the ones you want:

- expand then collapse returns exactly to the prior state;
- a node reached by two routes survives collapsing either one;
- no orphan islands are left drifting, which removing only immediate
  neighbours would do;
- *hide others* is the same operation with one node as the only root, so it
  costs no extra machinery. It differs from collapse in one respect the code
  must honour: because its root set is a single node, it drops nodes that *are*
  roots, so it prunes `roots`/`pinned` for everything it removes. A dropped id
  left in `roots` would come back as asked-for-by-name the next time expansion
  reached it, and would then never collapse.

Collapsing a node you searched for does nothing to it, because it is a root.
That is correct — you asked for it.

### Context menu

```
expand ▸  CHOSE ▸3   REJECTED ▸5   ABOUT ▸2   IN_PROJECT ▸1   [all]
collapse
─────────
pin / unpin
focus (hide others)
hide
─────────
copy domain key
```

The expand submenu carries live counts from `/api/node/{id}`, making it the
precise form of double-click's budgeted guess.

Rules that keep it honest at any store size:

- **Merge, never replace.** Expansion adds to the working set. ForceAtlas2
  re-runs for ~1s after each merge rather than relaying from scratch.
- **Cap every expansion.** 50 per edge type; the chip reads `+312 more` and
  pages by offset. A tag with 5000 projects cannot flood the canvas.
- **Complete the edges after every merge** via `edges-between`.
- **Change is announced, not applied.** SSE badge, explicit refresh.
- **Cypher results that are graph-shaped get an `add to canvas` button**, which
  merges them into the working set. Otherwise they render as a table.
- Drag pins a node; pinned nodes are exempt from layout.

Default view on open: the Projects and their Tags. That is the map, and an empty
canvas is a worse start than a small one.

Explicitly cut from v1: multi-select, persisted layouts, undo history, edge
filtering beyond type chips, path rendering, expand-to-depth-N, **the label
legend, and the label filter checkboxes** drawn in the sketch above. The last
two were specified and never built; `/api/meta` already returns the label and
edge-type counts they need, so they are a UI-only addition whenever they are
wanted.

## The precedent skin

- **Status is visual.** `active` solid · `superseded` faded · `regretted` in the
  regret warning colour. Superseded decisions are retained on purpose; seeing
  one greyed next to its replacement is the point of retaining it. On the canvas
  this is resolved in `nodeReducer` from the node's own `status` attribute
  (`skin.ts`'s `nodePaint`), never written onto the graph; the detail panel does
  the same in CSS. Strike-through was the original wording for `regretted`, but
  sigma draws no text decoration on a node, so the colour carries it there.
- **Captions**: Decision→`title`, Project→`name`, Tag/Topic/Option→`name`,
  Principle/Lesson→truncated `statement`.
- **The detail panel leads with rationale** for a Decision. The *what* is
  recoverable from the code; the *why* is not, and it is why the graph exists.
  `despite` renders as a callout when set.
- **Two of the three warnings are drawn**: DIVERGENCE (`DIVERGES_FROM`) and
  REGRET (`REGRETS`) are edge types the canvas holds, so `edgeReducer` paints
  them `warn.divergence` / `warn.regret` and a regretted Decision's node takes
  `warn.regret` too.

  **CONFLICT is not drawn, and cannot be.** "A live Decision CHOSE an option
  another live Decision REJECTED" is not a property of any node or edge the
  canvas has loaded — detecting it needs a cross-referencing query over the
  whole store, and the canvas is a partial working set by design. It is surfaced
  by `precedent check` and by the *contradictions* saved query in the Cypher
  console instead. `skin.ts` keeps a `warn.conflict` token, unused and commented
  as such, only so the light/dark palettes stay symmetric if that ever changes.
- **Saved queries** in the sidebar — the questions the tool exists for:
  - kin of a project by tag overlap, with the shared tags named
  - coverage gaps: topics settled in ≥2 kin projects, open here
  - contradictions: one project, one topic, two `active` answers
  - norms: an option chosen in ≥2 projects
  - supersession chains
  - regretted clusters, with the Lesson attached

Every saved query filters `status = 'active'` where it asks what is true now.
Superseded decisions are kept deliberately and will otherwise pollute results.

## Theming

Light and dark, defaulting to `prefers-color-scheme`, with an explicit
system/light/dark toggle persisted in `localStorage`.

Panels are ordinary CSS custom properties. The canvas is the part with a trap:
sigma reads colours from graph attributes, so a naive theme switch would rewrite
every node's stored attributes and entangle presentation with graph state.

Instead `skin.ts` holds **semantic tokens** — `labelColor.Decision`,
`statusAlpha.superseded`, `statusAlpha.regretted`, `edge`, `warn.divergence`,
`warn.regret` (and an unused `warn.conflict`, see above) — each with a light and
a dark value, and sigma resolves them through `nodeReducer`/`edgeReducer` at
render time. Switching theme swaps the
token table and calls `refresh()`; graph data is never touched. Those reducers
already exist for hover dimming, so this is the same mechanism, not a new one.

Both token sets are checked for contrast against their own ground — label
colours must stay distinguishable from each other *and* readable on both, and
the faded treatment for `superseded` needs a different alpha per theme to read
as faded rather than as invisible.

## Layout

```
precedent-ui/
  server/precedent_ui.py   # FastAPI app + CLI; deps in pyproject.toml
  server/queries.py        # every cypher string, in one place, unit-testable
  server/store.py          # read-only graphdblite access, change stamp
  web/
    src/api.ts             # typed client for the contract above
    src/graph/             # sigma container, merge, expand, layout
    src/panels/            # search, detail, cypher console
    src/skin.ts            # semantic colour tokens (light/dark), captions, status styling
    src/theme.ts           # tri-state toggle, prefers-color-scheme, persistence
  tests/test_api.py, tests/test_queries.py, tests/test_store.py
  docs/superpowers/specs/
```

Running:

```bash
uv run python -m server.precedent_ui             # defaults to ~/.local/share/precedent
uv run python -m server.precedent_ui --home DIR  # honours the `init` pointer file
cd web && bun run dev                            # proxies /api to the server
```

## Failure handling

| Condition | Behaviour |
|---|---|
| store missing or busy | message naming the resolved path; SSE keeps retrying |
| Cypher syntax/storage error | engine message and class returned verbatim |
| stale `__id` after `rebuild` | 404 → node dropped, *graph was rebuilt* notice |
| any other refresh failure (503, 5xx, dropped connection) | nothing removed; *refresh incomplete* notice |
| result over 1000 rows | truncated, and the UI says so |
| node with enormous degree | capped expansion with an explicit remaining count |

## Testing

Server tests build a **real** temp `graph.db` by replaying a fixture journal
through `precedent.py rebuild`, then drive the real endpoints through FastAPI's
TestClient. No mocked graph — consistent with this project's recorded norm that
tests run against the real engine rather than an in-memory stand-in.

That makes precedent's own CLI a test dependency. Its path is `$PRECEDENT_CLI`,
defaulting to `~/work_self/my-decisions/precedent/scripts/precedent.py`; when it
is absent those tests skip with a message naming the variable, so a fresh
checkout reports "skipped", never a stack of errors. `tests/test_queries.py` is
pure and runs regardless.

Covered: search ranking and stability, degree breakdown correctness, expansion
caps and paging, budget allocation across edge types, `edges-between` completeness, cell classification for node /
rel / scalar / path, the 1000-row cap, error passthrough, stale-id 404, and that
a `CREATE` through `/api/cypher` is refused by the engine.

On the frontend, vitest covers every non-trivial pure function — the line is
"does this need a browser", not "is this in the UI half":

- the cell **classifier** (node / rel / scalar);
- the collapse **BFS** — roots, pins, reachability: expand-then-collapse round
  trip, a node reached by two routes surviving, no orphans left behind;
- the expand-all **budget** allocation across edge types;
- **`mergeInto`** — pure graphology, no sigma: that a re-merged node keeps its
  position (and its pin), that a new one gets a starting position, and that an
  edge needs both endpoints present;
- **`planRefresh`** — that only a 404 drops a node;
- **`skin.ts`'s `nodePaint`/`edgePaint`** — status fading, the regret colour,
  the two warning edge types.

Rendering itself is not unit-tested: the sigma container, the reducers' wiring
and the event handlers need a real canvas, and the reviewed judgement is that a
headless-browser harness costs more than it would catch here.
