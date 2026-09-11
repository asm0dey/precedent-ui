import { describe, expect, it } from "vitest";
import { cellsToGraph } from "./classify";

describe("cellsToGraph", () => {
  it("collects nodes and edges out of classified cells", () => {
    const rows = [
      [
        { kind: "node", node: { id: 1, labels: ["Tag"], props: { name: "python" } } },
        { kind: "rel", rel: { id: "1-TAGGED-2", src: 1, dst: 2, type: "TAGGED" } },
      ],
      [{ kind: "scalar", value: 7 }],
    ];
    const { nodes, edges } = cellsToGraph(rows as never);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(1);
  });

  it("deduplicates repeated nodes", () => {
    const cell = { kind: "node", node: { id: 1, labels: ["Tag"], props: {} } };
    expect(cellsToGraph([[cell], [cell]] as never).nodes).toHaveLength(1);
  });

  it("is empty when nothing is graph-shaped", () => {
    const { nodes, edges } = cellsToGraph([[{ kind: "scalar", value: "x" }]] as never);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});
