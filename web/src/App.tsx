import Graph from "graphology";
import { useEffect, useRef, useState } from "react";
import "./App.css";
import { edgesBetween, expand, getNode, runCypher, type Degree, type Hit } from "./api";
import { cellsToGraph, type GEdge, type GNode } from "./classify";
import { allocate } from "./graph/budget";
import { Canvas, type Focus } from "./graph/Canvas";
import { withinHops } from "./graph/neighbourhood";
import { ContextMenu, type ContextMenuAction } from "./graph/ContextMenu";
import { mergeInto } from "./graph/merge";
import { planRefresh } from "./graph/refresh";
import { Cypher } from "./panels/Cypher";
import { Detail } from "./panels/Detail";
import { Legend } from "./panels/Legend";
import { Search } from "./panels/Search";
import { useTheme, type Pref } from "./theme";

/**
 * What the canvas shows on open: every decision, what it chose, and where.
 *
 * An earlier version opened on Projects joined to their Tags. That is the
 * filing system rather than the contents — you could not see a single decision
 * or a single technology until you searched for one, in a tool whose whole
 * point is the decisions. This shows the names you would recognise (`grafeo`,
 * `graphdblite`, `bun`) straight away.
 *
 * Superseded decisions are deliberately NOT filtered out: the skin fades them,
 * so a replaced choice and its replacement are both visible, which is the
 * history worth seeing. "The projects map" is a saved query if you want the
 * old view.
 */
const DEFAULT_VIEW = `MATCH (d:Decision)-[c:CHOSE]->(o:Option)
MATCH (d)-[i:IN_PROJECT]->(p:Project)
OPTIONAL MATCH (p)-[g:TAGGED]->(t:Tag)
RETURN d AS d, c AS c, o AS o, i AS i, p AS p, g AS g, t AS t`;
const PAGE = 50;
const EXPAND_ALL_BUDGET = 100;

const THEME_OPTIONS: { pref: Pref; label: string }[] = [
  { pref: "system", label: "System" },
  { pref: "light", label: "Light" },
  { pref: "dark", label: "Dark" },
];

type Menu = {
  at: { x: number; y: number };
  nodeId: number;
  degrees: Degree[];
  key: { field: string; value: string } | null;
  caption: string;
};

export default function App() {
  const { resolved: mode, pref, set: setPref } = useTheme();
  const graph = useRef(new Graph()).current;
  const roots = useRef(new Set<string>()).current;
  const pinned = useRef(new Set<string>()).current;
  // Nodes expand-all has already spent a budget on, so a second double-click
  // collapses instead of expanding again. Written ONLY by expandAll: a
  // single-type expansion from a detail chip or the context menu must not turn
  // the next double-click into a collapse that removes what was just added.
  const expandedAll = useRef(new Set<number>()).current;
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Bumped after every merge: re-renders the panels AND drives the canvas's
  // settle-after-change layout run, so a new node never lands at a random
  // position and sits there until someone presses play.
  const [version, setVersion] = useState(0);
  // Remaining count per "<id>-<type>-<dir>" expansion, for the "+N more" chip affordance.
  const [more, setMore] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<Menu | null>(null);
  // Camera target. The nonce makes re-picking the same hit move the camera again.
  const [cameraFocus, setCameraFocus] = useState<Focus | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // A journal-derived change stamp string ("<mtime_ns>:<size>"), not a
  // numeric timestamp — see server/store.py's Store.change_stamp().
  const mtimeRef = useRef<string | null>(null);
  const [changed, setChanged] = useState(false);
  // Bumped after a refresh so Detail re-fetches degrees for the still-selected node.
  const [refreshedAt, setRefreshedAt] = useState(0);

  function toast(msg: string) {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 5000);
  }

  /** A request fired from a click has no caller to await it; say so when it fails. */
  const report = (what: string) => (e: unknown) =>
    toast(`${what} failed: ${e instanceof Error ? e.message : String(e)}`);

  async function completeEdges() {
    const ids = graph.nodes().map(Number);
    const { edges } = await edgesBetween(ids);
    mergeInto(graph, [], edges, mode);
    setVersion((v) => v + 1);
  }

  /** User-initiated: re-fetches every loaded node, drops any that now 404 (a
   * rebuild reassigns `__id`s), and re-derives edges among the survivors.
   * Never auto-expands — the working set stays exactly what the user had,
   * minus whatever no longer exists.
   *
   * A node is dropped ONLY on a 404. Any other failure (a 503 while the store
   * is missing or busy, a 5xx, a dropped connection) leaves the node, its root
   * status and its pin exactly as they were — see graph/refresh.ts. */
  async function refreshGraph() {
    const ids = graph.nodes().map(Number);
    const { fresh, gone, unreachable } = planRefresh(
      ids,
      await Promise.allSettled(ids.map((id) => getNode(id))),
    );
    mergeInto(graph, fresh, [], mode);
    for (const id of gone) {
      const key = String(id);
      if (graph.hasNode(key)) graph.dropNode(key);
      roots.delete(key);
      pinned.delete(key);
      expandedAll.delete(id);
      if (selected === id) setSelected(null);
    }
    let edgesFailed = false;
    try {
      await completeEdges();
    } catch {
      edgesFailed = true;
      setVersion((v) => v + 1);
    }
    setChanged(false);
    setRefreshedAt((v) => v + 1);
    if (gone.length) toast("graph was rebuilt — some nodes no longer exist");
    else if (unreachable.length || edgesFailed)
      toast("refresh incomplete — the server did not answer; nothing was removed");
  }

  async function expandOne(id: number, type: string, dir: "out" | "in", offset = 0) {
    const r = await expand(id, { type, dir, limit: PAGE, offset });
    mergeInto(graph, r.nodes, r.edges, mode); // NOT roots: expansion is derived
    const shown = offset + r.nodes.length;
    setMore((m) => ({ ...m, [`${id}-${type}-${dir}`]: Math.max(0, r.total - shown) }));
    await completeEdges(); // without this, separately-expanded nodes never show edges between them
  }

  /** Budgeted whole-neighbourhood expansion — smallest edge type first (see budget.ts). */
  async function expandAll(id: number) {
    const { degrees } = await getNode(id);
    const plan = allocate(degrees, EXPAND_ALL_BUDGET);
    let added = 0;
    let left = 0;
    for (const a of plan) {
      if (a.take > 0) {
        const r = await expand(id, { type: a.type, dir: a.dir, limit: a.take });
        mergeInto(graph, r.nodes, r.edges, mode); // NOT roots: expansion is derived
        added += r.nodes.length;
      }
      left += a.remaining;
    }
    await completeEdges();
    expandedAll.add(id);
    if (left > 0) toast(`added ${added} of ${added + left} — use the type chips for the rest`);
  }

  /** `{src, dst}` view of the live graph — the only shape `withinHops` needs. */
  function graphEdges() {
    return graph.edges().map((e) => ({ src: graph.source(e), dst: graph.target(e) }));
  }

  /** Keep this node and everything within `depth` hops; drop the rest.
   *
   * Replaces two reachability-based actions that were vacuous on a connected
   * graph: "collapse" kept whatever still reached a root, and "focus (hide
   * others)" kept whatever reached the focused node — on a graph where
   * everything connects to everything, both kept everything. Depth is the
   * question people actually ask: show me this and its surroundings.
   *
   * Pinned nodes survive regardless. Pinning is an explicit "keep this", and
   * silently dropping something the user pinned would be the more surprising
   * behaviour. */
  function collapseTo(id: number, depth: number) {
    const keep = withinHops(graphEdges(), String(id), depth);
    const dropped = graph
      .nodes()
      .filter((n) => !keep.has(n) && !pinned.has(n))
      .map((n) => {
        graph.dropNode(n);
        return n;
      });
    for (const n of dropped) {
      roots.delete(n);
      expandedAll.delete(Number(n));
      if (selected === Number(n)) setSelected(null);
    }
    // The node you acted on is always kept, so it stays a sensible anchor for
    // the next expansion — and it becomes a root, because you asked for it.
    roots.add(String(id));
    if (dropped.length === 0) toast("nothing further away than that was loaded");
    setFitNonce((n) => n + 1); // show what is left, wherever the camera was
    setVersion((v) => v + 1);
  }

  function hide(id: number) {
    const key = String(id);
    if (graph.hasNode(key)) graph.dropNode(key);
    roots.delete(key);
    pinned.delete(key);
    expandedAll.delete(id);
    if (selected === id) setSelected(null);
    setVersion((v) => v + 1);
  }

  function togglePin(id: number) {
    const key = String(id);
    const next = !pinned.has(key);
    if (next) pinned.add(key);
    else pinned.delete(key);
    if (graph.hasNode(key)) graph.setNodeAttribute(key, "fixed", next);
    setVersion((v) => v + 1);
  }

  async function onDoubleClick(id: number) {
    // The inverse of expand-all: keep the node and one hop. Predictable, and
    // it no longer depends on a reachability rule that a connected graph makes
    // vacuous.
    if (expandedAll.has(id)) collapseTo(id, 1);
    else await expandAll(id);
  }

  async function onContextMenu(id: number, x: number, y: number) {
    const n = await getNode(id);
    setMenu({ at: { x, y }, nodeId: id, degrees: n.degrees, key: n.key, caption: n.caption });
  }

  function onMenuAction(action: ContextMenuAction) {
    if (!menu) return;
    const id = menu.nodeId;
    switch (action.kind) {
      case "expand":
        expandOne(id, action.degree.type, action.degree.dir).catch(report("expand"));
        break;
      case "expand-all":
        expandAll(id).catch(report("expand all"));
        break;
      case "collapse":
        collapseTo(id, action.depth);
        break;
      case "pin":
        togglePin(id);
        break;
      case "hide":
        hide(id);
        break;
      case "copy-key":
        if (menu.key) navigator.clipboard.writeText(menu.key.value).catch(report("copy"));
        break;
    }
    setMenu(null);
  }

  async function onPick(hit: Hit) {
    const n = await getNode(hit.id);
    mergeInto(graph, [n], [], mode);
    roots.add(String(hit.id)); // asked for by name, so never auto-removed
    setSelected(hit.id);
    // Centre on it once the layout settles. Without this the hit is merged into
    // a canvas of a couple of hundred nodes and you have to go and find it.
    setCameraFocus((f) => ({ id: hit.id, nonce: (f?.nonce ?? 0) + 1 }));
    await completeEdges(); // connect it to whatever is already loaded
  }

  /** Cypher console results are asked-for-by-name, exactly like a search hit —
   * they become roots so Task 12's collapse never removes them. */
  async function onCypherAdd(nodes: GNode[], edges: GEdge[]) {
    mergeInto(graph, nodes, edges, mode);
    nodes.forEach((n) => roots.add(String(n.id)));
    setVersion((v) => v + 1);
    await completeEdges(); // connect them to whatever is already loaded
  }

  useEffect(() => {
    runCypher(DEFAULT_VIEW).then(({ rows }) => {
      const { nodes, edges } = cellsToGraph(rows);
      mergeInto(graph, nodes, edges, mode);
      // Only the Projects anchor the opening view. Marking everything a root —
      // which is what "asked for by name" meant when this view was a 20-node
      // project map — makes collapse a no-op across the entire graph, because
      // collapse only ever removes non-roots. Projects are what you navigate
      // from; decisions, options and tags hang off them and stay removable.
      nodes
        .filter((n) => n.labels[0] === "Project")
        .forEach((n) => roots.add(String(n.id)));
      setVersion((v) => v + 1);
    }, report("loading the projects map"));
    // Load once on mount. Theme changes re-tint via the Canvas reducers, not a re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    let first = true;
    es.onmessage = (e) => {
      const { mtime } = JSON.parse(e.data);
      // The stream emits once immediately on connect so a client learns the
      // current value — that first frame is not a change.
      if (first) {
        first = false;
        mtimeRef.current = mtime;
        return;
      }
      if (mtime !== mtimeRef.current) {
        mtimeRef.current = mtime;
        setChanged(true); // badge only — refresh is user-initiated
      }
    };
    return () => es.close();
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>precedent</h1>
        <div className="stream-badge" role="status" aria-live="polite">
          {changed && (
            <>
              <span>graph changed</span>
              <button type="button" onClick={refreshGraph}>
                refresh
              </button>
            </>
          )}
        </div>
        <div className="theme-toggle" role="group" aria-label="Theme">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.pref}
              type="button"
              className={pref === opt.pref ? "active" : ""}
              onClick={() => setPref(opt.pref)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>
      <aside className="panel panel-search">
        <Search onPick={onPick} />
        <Legend mode={mode} />
      </aside>
      <main className="panel-canvas">
        <Canvas
          graph={graph}
          mode={mode}
          hovered={hovered}
          version={version}
          focus={cameraFocus}
          fit={fitNonce}
          onSelect={setSelected}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onHover={setHovered}
          onPin={(id) => pinned.add(id)}
        />
        {toastMsg && <div className="canvas-toast">{toastMsg}</div>}
      </main>
      <aside className="panel panel-detail">
        <Detail
          nodeId={selected}
          refreshedAt={refreshedAt}
          more={more}
          onExpand={(type, dir, offset) => {
            if (selected !== null) expandOne(selected, type, dir, offset).catch(report("expand"));
          }}
          onOpenMenu={(x, y) => {
            if (selected !== null) onContextMenu(selected, x, y).catch(report("opening the menu"));
          }}
          menuOpen={menu !== null && menu.nodeId === selected}
        />
      </aside>
      <footer className="panel-cypher">
        <Cypher onAdd={onCypherAdd} />
      </footer>
      {/* position: fixed — opened from either a canvas right-click or the Detail
          panel's keyboard-reachable actions button, so it isn't scoped to one panel. */}
      <ContextMenu
        at={menu?.at ?? null}
        nodeId={menu?.nodeId ?? -1}
        degrees={menu?.degrees ?? []}
        caption={menu?.caption ?? ""}
        onAction={onMenuAction}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}
