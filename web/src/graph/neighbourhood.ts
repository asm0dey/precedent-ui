/**
 * Nodes within `depth` hops of a starting node.
 *
 * This is the honest primitive for pruning a canvas. The reachability-based
 * alternative — "keep whatever still connects to a root" — is vacuous once the
 * graph is densely connected: everything connects to everything, so nothing is
 * ever removed. Depth answers the question people actually ask, which is "show
 * me this and its surroundings, and get rid of the rest".
 *
 * Edges are undirected here: a decision's rationale is no less relevant because
 * the arrow points the other way.
 */
export type Link = { src: string | number; dst: string | number };

export function withinHops(edges: Link[], start: string, depth: number): Set<string> {
  const keep = new Set<string>([start]);
  if (depth <= 0) return keep;

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const a = String(e.src);
    const b = String(e.dst);
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }

  let frontier = [start];
  for (let hop = 0; hop < depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbour of adj.get(node) ?? []) {
        if (!keep.has(neighbour)) {
          keep.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }
  return keep;
}
