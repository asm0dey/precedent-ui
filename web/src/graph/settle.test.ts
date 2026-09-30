import Graph from "graphology";
import { describe, expect, it } from "vitest";
import { positions, settled } from "./settle";

const at = (pts: Record<string, [number, number]>) =>
  new Map(Object.entries(pts).map(([k, [x, y]]) => [k, { x, y }]));

describe("settled", () => {
  it("is true when nodes barely move relative to the layout's size", () => {
    const a = at({ a: [0, 0], b: [100, 100] });
    expect(settled(a, at({ a: [0.01, 0], b: [100, 100.01] }))).toBe(true);
  });

  it("is false while nodes are still travelling", () => {
    const a = at({ a: [0, 0], b: [100, 100] });
    expect(settled(a, at({ a: [5, 0], b: [100, 95] }))).toBe(false);
  });

  it("is false when the node set changed between samples", () => {
    expect(settled(at({ a: [0, 0] }), at({ b: [0, 0] }))).toBe(false);
    expect(settled(at({ a: [0, 0] }), at({ a: [0, 0], b: [1, 1] }))).toBe(false);
  });

  it("reads positions from the graph", () => {
    const g = new Graph();
    g.addNode("a", { x: 1, y: 2 });
    expect(positions(g).get("a")).toEqual({ x: 1, y: 2 });
  });
});
