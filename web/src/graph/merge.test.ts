import Graph from "graphology";
import { describe, expect, it } from "vitest";
import type { GNode } from "../classify";
import { mergeInto } from "./merge";

const node = (id: number, props: Record<string, unknown> = {}): GNode => ({
  id,
  labels: ["Decision"],
  props: { title: `d${id}`, ...props },
});

describe("mergeInto", () => {
  it("keeps a node's position when it is merged again", () => {
    const g = new Graph();
    mergeInto(g, [node(1)], [], "light");
    // The user (or the layout) moved it.
    g.setNodeAttribute("1", "x", 42);
    g.setNodeAttribute("1", "y", -7);

    mergeInto(g, [node(1)], [], "light");

    expect(g.getNodeAttribute("1", "x")).toBe(42);
    expect(g.getNodeAttribute("1", "y")).toBe(-7);
  });

  it("leaves a pinned node pinned and in place across a merge", () => {
    const g = new Graph();
    mergeInto(g, [node(1)], [], "light");
    g.setNodeAttribute("1", "x", 3);
    g.setNodeAttribute("1", "y", 4);
    g.setNodeAttribute("1", "fixed", true);

    mergeInto(g, [node(1)], [], "light");

    expect(g.getNodeAttribute("1", "fixed")).toBe(true);
    expect([g.getNodeAttribute("1", "x"), g.getNodeAttribute("1", "y")]).toEqual([3, 4]);
  });

  it("still refreshes the mergeable attributes of an existing node", () => {
    const g = new Graph();
    mergeInto(g, [node(1, { status: "active" })], [], "light");
    g.setNodeAttribute("1", "x", 1);

    mergeInto(g, [{ id: 1, labels: ["Decision"], props: { title: "renamed", status: "superseded" } }], [], "light");

    expect(g.getNodeAttribute("1", "label")).toBe("renamed");
    expect(g.getNodeAttribute("1", "status")).toBe("superseded");
    expect(g.getNodeAttribute("1", "x")).toBe(1);
  });

  it("gives a brand-new node a starting position", () => {
    const g = new Graph();
    mergeInto(g, [node(9)], [], "light");
    expect(typeof g.getNodeAttribute("9", "x")).toBe("number");
    expect(typeof g.getNodeAttribute("9", "y")).toBe("number");
  });

  it("only adds an edge when both endpoints are present", () => {
    const g = new Graph();
    mergeInto(
      g,
      [node(1), node(2)],
      [
        { id: "1-ABOUT-2", src: 1, dst: 2, type: "ABOUT" },
        { id: "1-ABOUT-3", src: 1, dst: 3, type: "ABOUT" },
      ],
      "light",
    );
    expect(g.edges()).toEqual(["1-ABOUT-2"]);
  });
});
