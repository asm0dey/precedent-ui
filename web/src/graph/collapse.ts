import type { GEdge } from "../classify";

/**
 * The canvas invariant: every node is a root, is pinned, or is connected to one.
 *
 * Collapse is defined structurally rather than by provenance — "what arrived
 * from this node" goes stale the moment the same node is reached a second way.
 */
export function survivors(
  edges: Pick<GEdge, "src" | "dst">[],
  present: string[],
  roots: Set<string>,
  pinned: Set<string>,
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const s = String(e.src);
    const d = String(e.dst);
    (adj.get(s) ?? adj.set(s, []).get(s)!).push(d);
    (adj.get(d) ?? adj.set(d, []).get(d)!).push(s);
  }
  const kept = new Set<string>([...pinned].filter((p) => present.includes(p)));
  const queue = present.filter((n) => roots.has(n));
  queue.forEach((n) => kept.add(n));
  while (queue.length) {
    const n = queue.shift()!;
    for (const m of adj.get(n) ?? []) {
      if (!kept.has(m) && present.includes(m)) {
        kept.add(m);
        queue.push(m);
      }
    }
  }
  return kept;
}
