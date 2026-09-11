# precedent-ui — design

Date: 2026-09-11
Status: approved, not yet implemented

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

- **No writes to the decision record.** Recording a decision belongs in the
  agent conversation, where the rationale is captured in the user's own words.
  A form cannot do that, and a wrong entry is worse than a missing one. The one
  write this tool can ever perform is the opt-in `--index` flag, which creates
  fulltext indexes and touches no decision data (see *search*, below).
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

- **`graph.db` is a single SQLite file with no `-wal` sidecar,** so its mtime is
  a sound change signal.

- **`__id` is engine-assigned and session-scoped.** `precedent rebuild` replays
  the journal into a fresh graph and renumbers everything. Every node also
  carries a stable domain key (`Decision.id`, `Project.id`, `Tag.name`,
  `Topic.name`, `Option.name`, `Principle.id`, `Lesson.id`), which is what the
  client falls back to after a rebuild.

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

- **FastAPI + uvicorn**, single file, `uv run` inline deps. Seven endpoints and
  an SSE stream; this is the least code for that.

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
  "mtime": 1789040000.0 }
```

Feeds the legend, the label filter list, and change detection.

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

Scale note: this is a scan. On a store large enough for it to hurt, an opt-in
`--index` flag creates graphdblite fulltext indexes
(`create_fulltext_index_word_multi`) once, and search uses them when present.
That flag is the **one** write this tool can perform, it is never implicit, and
it is off by default.

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

SSE. Polls `graph.db` mtime server-side; emits `{"mtime": ..., "labels": {...}}`
when it moves. The client shows a *graph changed* badge. Refresh re-fetches
props and degrees for loaded nodes and runs `edges-between` over them. It never
auto-expands — the working set belongs to the user.

## Interaction model

```
┌───────────────┬──────────────────────────────────┬─────────────────┐
│ search  [___] │                                  │ Decision        │
│ ───────────── │                                  │ ─────────────── │
│ ▸ Postgres…   │          sigma canvas            │ title           │
│ ▸ Tests run…  │                                  │ RATIONALE       │
│ ▸ backend     │        (working set only)        │ status: active  │
│               │                                  │ ─────────────── │
│ labels        │                          ┌─────┐ │ expand:         │
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

> **Every node on the canvas is a root, is pinned, or is connected to one.**

A **root** is a node asked for by name: a search hit, a Cypher *add to canvas*,
or the default Projects view. Roots and pinned nodes are sticky and are never
removed automatically.

`collapse(n)` drops every non-root, non-pinned node that loses its path to a
root once `n` stops being an expansion point — one BFS from the roots.

Defining it this way rather than as "remove what arrived from this node" avoids
tracking provenance, which goes stale the moment the same node is reached a
second way. The consequences are the ones you want:

- expand then collapse returns exactly to the prior state;
- a node reached by two routes survives collapsing either one;
- no orphan islands are left drifting, which removing only immediate
  neighbours would do;
- *hide others* is the same operation with one node as the only root, so it
  costs no extra machinery.

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
filtering beyond type chips, path rendering, expand-to-depth-N.

## The precedent skin

- **Status is visual.** `active` solid · `superseded` faded · `regretted` struck
  through in red. Superseded decisions are retained on purpose; seeing one
  greyed next to its replacement is the point of retaining it.
- **Captions**: Decision→`title`, Project→`name`, Tag/Topic/Option→`name`,
  Principle/Lesson→truncated `statement`.
- **The detail panel leads with rationale** for a Decision. The *what* is
  recoverable from the code; the *why* is not, and it is why the graph exists.
  `despite` renders as a callout when set.
- **The three warnings are drawn, not read**: CONFLICT (a live Decision CHOSE an
  option another live Decision REJECTED), DIVERGENCE (`DIVERGES_FROM`), REGRET
  (`REGRETS`).
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

Instead `skin.ts` holds **semantic tokens** — `label.Decision`,
`status.superseded`, `status.regretted`, `edge.default`, `warn.conflict`,
`warn.divergence` — each with a light and a dark value, and sigma resolves them
through `nodeReducer`/`edgeReducer` at render time. Switching theme swaps the
token table and calls `refresh()`; graph data is never touched. Those reducers
already exist for hover dimming, so this is the same mechanism, not a new one.

Both token sets are checked for contrast against their own ground — label
colours must stay distinguishable from each other *and* readable on both, and
the faded treatment for `superseded` needs a different alpha per theme to read
as faded rather than as invisible.

## Layout

```
precedent-ui/
  server/precedent_ui.py   # uv script; inline deps: fastapi, uvicorn, graphdblite
  server/queries.py        # every cypher string, in one place, unit-testable
  web/
    src/api.ts             # typed client for the contract above
    src/graph/             # sigma container, merge, expand, layout
    src/panels/            # search, detail, cypher console
    src/skin.ts            # semantic colour tokens (light/dark), captions, status styling
    src/theme.ts           # tri-state toggle, prefers-color-scheme, persistence
  tests/test_api.py
  docs/superpowers/specs/
```

Running:

```bash
uv run server/precedent_ui.py              # defaults to ~/.local/share/precedent
uv run server/precedent_ui.py --home DIR    # honours the `init` pointer file
cd web && npm run dev                       # proxies /api to the server
```

## Failure handling

| Condition | Behaviour |
|---|---|
| store missing or busy | message naming the resolved path; SSE keeps retrying |
| Cypher syntax/storage error | engine message and class returned verbatim |
| stale `__id` after `rebuild` | 404 → *graph was rebuilt, re-run your search* |
| result over 1000 rows | truncated, and the UI says so |
| node with enormous degree | capped expansion with an explicit remaining count |

## Testing

Server tests build a **real** temp `graph.db` by replaying a fixture journal
through `precedent.py rebuild`, then drive the real endpoints through FastAPI's
TestClient. No mocked graph — consistent with this project's recorded norm that
tests run against the real engine rather than an in-memory stand-in.

Covered: search ranking and stability, degree breakdown correctness, expansion
caps and paging, budget allocation across edge types, `edges-between` completeness, cell classification for node /
rel / scalar / path, the 1000-row cap, error passthrough, stale-id 404, and that
a `CREATE` through `/api/cypher` is refused by the engine.

The frontend's second non-trivial pure function is the collapse BFS — roots,
pins, reachability — and it gets vitest coverage alongside the classifier:
expand-then-collapse round trip, a node reached by two routes surviving, and no
orphans left behind.

Rendering itself is not unit-tested.
