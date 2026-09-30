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

function adjacency(edges: Link[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  };
  for (const e of edges) {
    link(String(e.src), String(e.dst));
    link(String(e.dst), String(e.src));
  }
  return adj;
}

export function withinHops(edges: Link[], start: string, depth: number): Set<string> {
  const keep = new Set<string>([start]);
  if (depth <= 0) return keep;

  const adj = adjacency(edges);

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
