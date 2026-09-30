import { describe, expect, it } from "vitest";
import { withinHops } from "./neighbourhood";

// a — b — c — d,  plus e hanging off b
const CHAIN = [
  { src: "a", dst: "b" },
  { src: "b", dst: "c" },
  { src: "c", dst: "d" },
  { src: "b", dst: "e" },
];

describe("withinHops", () => {
  it("keeps only the node itself at depth 0", () => {
    expect([...withinHops(CHAIN, "a", 0)]).toEqual(["a"]);
  });

  it("keeps immediate neighbours at depth 1", () => {
    expect([...withinHops(CHAIN, "b", 1)].sort()).toEqual(["a", "b", "c", "e"]);
  });

  it("reaches further with each hop", () => {
    expect([...withinHops(CHAIN, "a", 2)].sort()).toEqual(["a", "b", "c", "e"]);
    expect([...withinHops(CHAIN, "a", 3)].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("stops growing once the component is exhausted", () => {
    expect([...withinHops(CHAIN, "a", 99)].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("follows edges in both directions", () => {
    // d is only ever a destination; starting there must still reach c
    expect([...withinHops(CHAIN, "d", 1)].sort()).toEqual(["c", "d"]);
  });

  it("excludes a disconnected node at any depth", () => {
    const withIsland = [...CHAIN, { src: "x", dst: "y" }];
    const kept = withinHops(withIsland, "a", 99);
    expect(kept.has("x")).toBe(false);
    expect(kept.has("y")).toBe(false);
  });

  it("handles numeric ids, which is what the server sends", () => {
    const numeric = [{ src: 1, dst: 2 }];
    expect([...withinHops(numeric, "1", 1)].sort()).toEqual(["1", "2"]);
  });

  it("terminates on a cycle", () => {
    const cyclic = [
      { src: "a", dst: "b" },
      { src: "b", dst: "c" },
      { src: "c", dst: "a" },
    ];
    expect([...withinHops(cyclic, "a", 99)].sort()).toEqual(["a", "b", "c"]);
  });
});
