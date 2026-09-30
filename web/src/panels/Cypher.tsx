import { useState } from "react";
import { runCypher } from "../api";
import { cellsToGraph, type Cell, type GEdge, type GNode } from "../classify";
import { captionOf } from "../skin";
import { SAVED } from "../savedQueries";

type EngineError = { type: string; error: string };
type Result = { columns: string[]; rows: Cell[][]; truncated: boolean };

/** The server's 400 body is `{"detail": {"error": ..., "type": ...}}` inside the
 * fetch layer's `"<status> <text>"` Error message — pull it back out so the
 * engine's own message (parser text, read-transaction refusal, …) reaches the
 * user verbatim instead of being swallowed. */
function parseEngineError(e: unknown): EngineError {
  const s = String(e);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const body = JSON.parse(s.slice(start, end + 1));
      if (body?.detail?.error) return body.detail as EngineError;
    } catch {
      // fall through to the generic message below
    }
  }
  return { type: "Error", error: String(e) };
}

export function Cypher({ onAdd }: { onAdd: (n: GNode[], e: GEdge[]) => void }) {
  const [query, setQuery] = useState(SAVED[0].cypher);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<EngineError | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setResult(await runCypher(query));
    } catch (e) {
      setError(parseEngineError(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  const graphed = result ? cellsToGraph(result.rows) : { nodes: [], edges: [] };

  return (
    <div className="cypher">
      <div className="cypher-controls">
        <label htmlFor="cypher-saved">saved query</label>
        <select
          id="cypher-saved"
          onChange={(e) => setQuery(SAVED[Number(e.target.value)].cypher)}
        >
          {SAVED.map((q, i) => (
            <option key={q.name} value={i}>
              {q.name}
            </option>
          ))}
        </select>
        <label htmlFor="cypher-query">cypher query</label>
        <textarea
          id="cypher-query"
          className="cypher-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={4}
          spellCheck={false}
        />
        <button type="button" onClick={run} disabled={running}>
          {running ? "running…" : "run"}
        </button>
      </div>
      {error && (
        <pre className="error cypher-error" role="alert">
          {error.type}: {error.error}
        </pre>
      )}
      {result?.truncated && (
        <div className="warn" role="status">
          showing 1000 rows; more were dropped
        </div>
      )}
      {graphed.nodes.length > 0 && (
        <button
          type="button"
          className="cypher-add"
          onClick={() => onAdd(graphed.nodes, graphed.edges)}
        >
          add {graphed.nodes.length} node{graphed.nodes.length === 1 ? "" : "s"} to canvas
        </button>
      )}
      {result && (
        <div className="cypher-table-wrap">
          <table className="cypher-table">
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      {cell.kind === "node" ? (
                        <>
                          <span className={`chip ${cell.node.labels[0]}`}>
                            {cell.node.labels[0]}
                          </span>{" "}
                          {captionOf(cell.node)}
                        </>
                      ) : cell.kind === "rel" ? (
                        `-[${cell.rel.type}]->`
                      ) : (
                        String(cell.value)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
