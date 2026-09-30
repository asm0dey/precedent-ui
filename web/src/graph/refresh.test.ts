import { describe, expect, it } from "vitest";
import { ApiError, type NodeDetail } from "../api";
import { planRefresh } from "./refresh";

const detail = (id: number): NodeDetail => ({
  id,
  labels: ["Decision"],
  props: {},
  caption: `d${id}`,
  key: null,
  degrees: [],
});

const ok = (id: number): PromiseSettledResult<NodeDetail> => ({
  status: "fulfilled",
  value: detail(id),
});
const fails = (reason: unknown): PromiseSettledResult<NodeDetail> => ({
  status: "rejected",
  reason,
});

describe("planRefresh", () => {
  it("drops a node only when the server says 404", () => {
    const plan = planRefresh([1], [fails(new ApiError(404, "no node 1"))]);
    expect(plan.gone).toEqual([1]);
    expect(plan.unreachable).toEqual([]);
  });

  it("keeps a node when the store is unavailable (503)", () => {
    const plan = planRefresh([1], [fails(new ApiError(503, "no graph at /x/graph.db"))]);
    expect(plan.gone).toEqual([]);
    expect(plan.unreachable).toEqual([1]);
  });

  it("keeps a node on a 500 and on a dropped connection", () => {
    const plan = planRefresh(
      [1, 2],
      [fails(new ApiError(500, "boom")), fails(new TypeError("Failed to fetch"))],
    );
    expect(plan.gone).toEqual([]);
    expect(plan.unreachable).toEqual([1, 2]);
  });

  it("returns the fresh detail for everything that answered", () => {
    const plan = planRefresh([1, 2, 3], [ok(1), fails(new ApiError(404, "")), ok(3)]);
    expect(plan.fresh.map((n) => n.id)).toEqual([1, 3]);
    expect(plan.gone).toEqual([2]);
    expect(plan.unreachable).toEqual([]);
  });
});
