import { describe, expect, it } from "vitest";
import { survivors } from "./collapse";

const e = (src: string, dst: string) => ({ id: `${src}-X-${dst}`, src, dst, type: "X" });

describe("survivors", () => {
  it("keeps roots and everything reachable from them", () => {
    const kept = survivors([e("a", "b")], ["a", "b"], new Set(["a"]), new Set());
    expect([...kept].sort()).toEqual(["a", "b"]);
  });

  it("drops what is no longer reachable from any root", () => {
    const kept = survivors([e("a", "b")], ["a", "b", "orphan"], new Set(["a"]), new Set());
    expect(kept.has("orphan")).toBe(false);
  });

  it("keeps a node reached by a second route", () => {
    // r1 -> shared <- r2 : collapsing r1 must not take `shared`
    const edges = [e("r1", "shared"), e("r2", "shared")];
    const kept = survivors(edges, ["r1", "r2", "shared"], new Set(["r1", "r2"]), new Set());
    expect(kept.has("shared")).toBe(true);
  });

  it("keeps pinned nodes even when unreachable", () => {
    const kept = survivors([], ["a", "pinned"], new Set(["a"]), new Set(["pinned"]));
    expect(kept.has("pinned")).toBe(true);
  });

  it("treats edges as undirected for reachability", () => {
    const kept = survivors([e("b", "a")], ["a", "b"], new Set(["a"]), new Set());
    expect(kept.has("b")).toBe(true);
  });
});
