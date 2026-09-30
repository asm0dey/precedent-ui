import { useEffect, useState } from "react";
import { getMeta } from "../api";
import { EDGE_LEGEND, tokens, type Mode } from "../skin";

/**
 * What the colours mean, with how much of each the store actually holds.
 *
 * The counts come from `/api/meta`, which until now had no consumer — the
 * legend is what it was always for. They also answer a question the canvas
 * cannot: the working set shows a slice, these are the totals behind it.
 */
export function Legend({ mode }: Readonly<{ mode: Mode }>) {
  const t = tokens(mode);
  const [labels, setLabels] = useState<Record<string, number> | null>(null);
  const [edgeTypes, setEdgeTypes] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let live = true;
    getMeta()
      .then((m) => {
        if (!live) return;
        setLabels(m.labels);
        setEdgeTypes(m.edge_types);
      })
      .catch(() => {
        /* the legend is an aid, not a feature — a failed count is not worth a banner */
      });
    return () => {
      live = false;
    };
  }, []);

  const nodeKinds = Object.keys(t.labelColor).filter((k) => (labels?.[k] ?? 0) > 0);

  /** "structure" stands for four relationship types, so it shows their total. */
  const countFor = (legendType: string) => {
    if (!edgeTypes) return "";
    const total = legendType
      .split("·")
      .map((t) => edgeTypes[t.trim()] ?? 0)
      .reduce((a, b) => a + b, 0);
    return total;
  };

  return (
    <section className="legend" aria-label="What the colours mean">
      <h3>nodes</h3>
      <ul>
        {nodeKinds.map((kind) => (
          <li key={kind}>
            <span className="swatch" style={{ background: t.labelColor[kind] }} aria-hidden />
            <span className="legend-name">{kind}</span>
            <span className="legend-count">{labels?.[kind]}</span>
          </li>
        ))}
        <li>
          <span
            className="swatch"
            style={{ background: t.labelColor.Decision, opacity: t.statusAlpha.superseded }}
            aria-hidden
          />
          <span className="legend-name">superseded</span>
          <span className="legend-count">faded</span>
        </li>
        <li>
          <span className="swatch" style={{ background: t.warn.regret }} aria-hidden />
          <span className="legend-name">regretted</span>
          <span className="legend-count">{labels?.Lesson ?? 0}</span>
        </li>
      </ul>

      <h3>edges</h3>
      <ul>
        {EDGE_LEGEND(t).map((e) => (
          <li key={e.type}>
            <span className="swatch line" style={{ background: e.color }} aria-hidden />
            <span className="legend-name" title={e.hint}>
              {e.type.includes("·") ? "structure" : e.type.toLowerCase()}
            </span>
            <span className="legend-count">{countFor(e.type)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
