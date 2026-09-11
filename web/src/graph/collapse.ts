/**
 * The canvas invariant: every node is a root, is pinned, or is connected to one.
 *
 * Collapse is defined structurally rather than by provenance — "what arrived
 * from this node" goes stale the moment the same node is reached a second way.
 *
 * `edges` takes `src`/`dst` as `string | number` because graphology's node
 * keys are strings while the server's node ids are numbers — this function
 * genuinely accepts both, normalising with `String(...)` below.
 */
export function survivors(
  edges: { src: string | number; dst: string | number }[],
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
  const inPresent = new Set(present);
  const kept = new Set<string>([...pinned].filter((p) => inPresent.has(p)));
  const queue = present.filter((n) => roots.has(n));
  queue.forEach((n) => kept.add(n));
  while (queue.length) {
    const n = queue.shift()!;
    for (const m of adj.get(n) ?? []) {
      if (!kept.has(m) && inPresent.has(m)) {
        kept.add(m);
        queue.push(m);
      }
    }
  }
  return kept;
}
