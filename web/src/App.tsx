import Graph from "graphology";
import { useEffect, useRef, useState } from "react";
import "./App.css";
import { edgesBetween, expand, getNode, runCypher, type Hit } from "./api";
import { cellsToGraph } from "./classify";
import { Canvas, mergeInto } from "./graph/Canvas";
import { Detail } from "./panels/Detail";
import { Search } from "./panels/Search";
import { useTheme, type Pref } from "./theme";

const DEFAULT_VIEW = "MATCH (p:Project)-[r:TAGGED]->(t:Tag) RETURN p AS p, r AS r, t AS t";
const PAGE = 50;

const THEME_OPTIONS: { pref: Pref; label: string }[] = [
  { pref: "system", label: "System" },
  { pref: "light", label: "Light" },
  { pref: "dark", label: "Dark" },
];

export default function App() {
  const { resolved: mode, pref, set: setPref } = useTheme();
  const graph = useRef(new Graph()).current;
  const roots = useRef(new Set<string>()).current;
  const [hovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [, setVersion] = useState(0); // bump to re-render after a merge
  // Remaining count per "<id>-<type>-<dir>" expansion, for the "+N more" chip affordance.
  const [more, setMore] = useState<Record<string, number>>({});

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
    await completeEdges(); // without this, separately-expanded nodes never show edges between them
  }

  async function onPick(hit: Hit) {
    const n = await getNode(hit.id);
    mergeInto(graph, [n], [], mode);
    roots.add(String(hit.id)); // asked for by name, so never auto-removed
    setSelected(hit.id);
    await completeEdges(); // connect it to whatever is already loaded
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
        <Canvas graph={graph} mode={mode} hovered={hovered} />
      </main>
      <aside className="panel panel-detail">
        <Detail
          nodeId={selected}
          more={more}
          onExpand={(type, dir, offset) => {
            if (selected !== null) expandOne(selected, type, dir, offset);
          }}
        />
      </aside>
      <footer className="panel-cypher">{/* Task 13: <Cypher /> */}</footer>
    </div>
  );
}
