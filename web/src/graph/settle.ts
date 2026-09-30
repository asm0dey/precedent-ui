import type Graph from "graphology";

/** Positions keyed by node, as the FA2 worker last wrote them into the graph. */
export type Positions = Map<string, { x: number; y: number }>;

export function positions(graph: Graph): Positions {
  const out: Positions = new Map();
  graph.forEachNode((k, a) => out.set(k, { x: a.x, y: a.y }));
  return out;
}

/** Below this mean step, as a fraction of the layout's diagonal, it has settled. */
export const SETTLED_STEP = 0.002;

/**
 * Whether the layout has stopped moving between two samples: the mean distance a
 * node travelled, relative to the size of the whole layout. Relative, because
 * FA2's coordinates have no fixed scale — a step of 1 is a jolt in a small graph
 * and nothing in a large one. A node that appeared or vanished between samples
 * means the graph changed under us, so it is not settled.
 */
export function settled(before: Positions, after: Positions): boolean {
  if (before.size !== after.size || after.size === 0) return after.size === 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let moved = 0;
  for (const [k, p] of after) {
    const q = before.get(k);
    if (!q) return false;
    moved += Math.hypot(p.x - q.x, p.y - q.y);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY) || 1;
  return moved / after.size / diagonal < SETTLED_STEP;
}
