import Graph from "graphology";
import { useEffect, useRef, useState } from "react";
import "./App.css";
import { edgesBetween, expand, getNode, runCypher, type Degree, type Hit } from "./api";
import { cellsToGraph, type GEdge, type GNode } from "./classify";
import { allocate } from "./graph/budget";
import { Canvas, mergeInto } from "./graph/Canvas";
import { survivors } from "./graph/collapse";
import { ContextMenu, type ContextMenuAction } from "./graph/ContextMenu";
import { Cypher } from "./panels/Cypher";
import { Detail } from "./panels/Detail";
import { Search } from "./panels/Search";
import { useTheme, type Pref } from "./theme";

const DEFAULT_VIEW = "MATCH (p:Project)-[r:TAGGED]->(t:Tag) RETURN p AS p, r AS r, t AS t";
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
  // collapses instead of expanding again.
  const expanded = useRef(new Set<number>()).current;
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [, setVersion] = useState(0); // bump to re-render after a merge
  // Remaining count per "<id>-<type>-<dir>" expansion, for the "+N more" chip affordance.
  const [more, setMore] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<Menu | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  function toast(msg: string) {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 5000);
  }

  async function completeEdges() {
    const ids = graph.nodes().map(Number);
    const { edges } = await edgesBetween(ids);
    mergeInto(graph, [], edges, mode);
    setVersion((v) => v + 1);
  }

  async function expandOne(id: number, type: string, dir: "out" | "in", offset = 0) {
    const r = await expand(id, { type, dir, limit: PAGE, offset });
    mergeInto(graph, r.nodes, r.edges, mode); // NOT roots: expansion is derived
    const shown = offset + r.nodes.length;
    setMore((m) => ({ ...m, [`${id}-${type}-${dir}`]: Math.max(0, r.total - shown) }));
    expanded.add(id);
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
    expanded.add(id);
    if (left > 0) toast(`added ${added} of ${added + left} — use the type chips for the rest`);
  }

  /** `{src, dst}` view of the live graph — the only shape `survivors` needs. */
  function graphEdges() {
    return graph.edges().map((e) => ({ src: graph.source(e), dst: graph.target(e) }));
  }

  /** Structural, not historical: drops whatever loses its path to a root once `id` stops
   * being an expansion point. `id`'s own edges are excluded from the reachability check —
   * otherwise, when `id` is itself a root (e.g. a search hit), `id`'s root status would
   * keep its just-expanded children reachable through it and collapse would remove
   * nothing. `id` itself is always kept — collapse shrinks its neighbourhood, it doesn't
   * remove the node that was double-clicked. */
  function collapse(id: number) {
    const key = String(id);
    const present = graph.nodes();
    const edges = graphEdges().filter((e) => e.src !== key && e.dst !== key);
    const keep = survivors(edges, present, roots, pinned);
    for (const n of present) if (!keep.has(n) && n !== key) graph.dropNode(n);
    expanded.delete(id);
    setVersion((v) => v + 1);
  }

  /** Hide everything except what's reachable from `id` — `survivors` with `id` as the
   * sole root. Pinned nodes still survive. */
  function focus(id: number) {
    const present = graph.nodes();
    const keep = survivors(graphEdges(), present, new Set([String(id)]), pinned);
    for (const n of present) if (!keep.has(n)) graph.dropNode(n);
    setVersion((v) => v + 1);
  }

  function hide(id: number) {
    const key = String(id);
    if (graph.hasNode(key)) graph.dropNode(key);
    roots.delete(key);
    pinned.delete(key);
    expanded.delete(id);
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
    if (expanded.has(id)) collapse(id);
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
        expandOne(id, action.degree.type, action.degree.dir);
        break;
      case "expand-all":
        expandAll(id);
        break;
      case "collapse":
        collapse(id);
        break;
      case "pin":
        togglePin(id);
        break;
      case "focus":
        focus(id);
        break;
      case "hide":
        hide(id);
        break;
      case "copy-key":
        if (menu.key) navigator.clipboard.writeText(menu.key.value);
        break;
    }
    setMenu(null);
  }

  async function onPick(hit: Hit) {
    const n = await getNode(hit.id);
    mergeInto(graph, [n], [], mode);
    roots.add(String(hit.id)); // asked for by name, so never auto-removed
    setSelected(hit.id);
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
      // Everything in the default view was asked for, so all of it is a root.
      nodes.forEach((n) => roots.add(String(n.id)));
      setVersion((v) => v + 1);
    });
    // Load once on mount. Theme changes re-tint via the Canvas reducers, not a re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>precedent</h1>
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
      </aside>
      <main className="panel-canvas">
        <Canvas
          graph={graph}
          mode={mode}
          hovered={hovered}
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
          more={more}
          onExpand={(type, dir, offset) => {
            if (selected !== null) expandOne(selected, type, dir, offset);
          }}
          onOpenMenu={(x, y) => {
            if (selected !== null) onContextMenu(selected, x, y);
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
