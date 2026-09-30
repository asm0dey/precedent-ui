import type Graph from "graphology";
import type { GEdge, GNode } from "../classify";
import { captionOf, tokens, type Mode } from "../skin";

/** Merge into the live instance — never rebuild it. Growth is the interaction.
 *
 * Lives apart from `Canvas.tsx` because it is pure graphology: no sigma, no
 * React, no DOM — so it is unit-testable without a browser.
 */
export function mergeInto(graph: Graph, nodes: GNode[], edges: GEdge[], mode: Mode) {
  const t = tokens(mode);
  for (const n of nodes) {
    const key = String(n.id);
    const attrs = {
      label: captionOf(n),
      size: 8,
      color: t.labelColor[n.labels[0]] ?? t.edge,
      nodeLabel: n.labels[0],
      status: (n.props.status as string) ?? "active",
    };
    // A starting position is supplied ONLY for a node that is not here yet.
    // graphology's mergeNode assigns the given attributes onto an existing
    // node, so passing x/y unconditionally would teleport every node already
    // on the canvas — scrambling the whole layout on refresh, and jolting a
    // pinned node whenever an expansion returns it as a neighbour again.
    graph.mergeNode(
      key,
      // Layout jitter, not a secret: FA2 only needs nodes not to start coincident.
      graph.hasNode(key) ? attrs : { ...attrs, x: Math.random(), y: Math.random() }, // NOSONAR
    );
  }
  for (const e of edges) {
    if (graph.hasNode(String(e.src)) && graph.hasNode(String(e.dst))) {
      graph.mergeEdgeWithKey(e.id, String(e.src), String(e.dst), { edgeType: e.type });
    }
  }
}
