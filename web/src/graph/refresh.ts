import { isNotFound, type NodeDetail } from "../api";

export type RefreshPlan = {
  /** Freshly-fetched detail for every node that answered. */
  fresh: NodeDetail[];
  /** Ids the server says are gone (404) — safe to drop from the canvas. */
  gone: number[];
  /** Ids whose re-fetch failed for any other reason. These are left alone:
   * the node is still on the canvas and still in roots/pinned. */
  unreachable: number[];
};

/**
 * Decide what a refresh may act on. Pure, so the rule can be tested without a
 * browser.
 *
 * The rule: only a 404 drops a node. `/api/node/{id}` returns 404 exactly when
 * the id is gone (a `rebuild` reassigns every `__id`), and that is the only
 * case that justifies deleting a node the user put on the canvas. Every other
 * rejection — a 503 while the store is missing or busy, a 5xx, a dropped
 * connection — says nothing about whether the node exists, so the node stays
 * and the UI says so without claiming a rebuild happened.
 */
export function planRefresh(
  ids: number[],
  results: PromiseSettledResult<NodeDetail>[],
): RefreshPlan {
  const plan: RefreshPlan = { fresh: [], gone: [], unreachable: [] };
  results.forEach((res, i) => {
    if (res.status === "fulfilled") plan.fresh.push(res.value);
    else if (isNotFound(res.reason)) plan.gone.push(ids[i]);
    else plan.unreachable.push(ids[i]);
  });
  return plan;
}
