import Graph from "graphology";
import { useEffect, useRef, useState } from "react";
import "./App.css";
import { runCypher } from "./api";
import { cellsToGraph } from "./classify";
import { Canvas, mergeInto } from "./graph/Canvas";
import { useTheme, type Pref } from "./theme";

const DEFAULT_VIEW = "MATCH (p:Project)-[r:TAGGED]->(t:Tag) RETURN p AS p, r AS r, t AS t";

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
  const [, setVersion] = useState(0); // bump to re-render after a merge

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
      <aside className="panel panel-search">{/* Task 10: <Search /> */}</aside>
      <main className="panel-canvas">
        <Canvas graph={graph} mode={mode} hovered={hovered} />
      </main>
      <aside className="panel panel-detail">{/* Task 11: <Detail /> */}</aside>
      <footer className="panel-cypher">{/* Task 13: <Cypher /> */}</footer>
    </div>
  );
}
