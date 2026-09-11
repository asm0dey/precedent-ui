export type GNode = { id: number; labels: string[]; props: Record<string, unknown> };
export type GEdge = { id: string; src: number; dst: number; type: string };
export type Cell =
  | { kind: "node"; node: GNode }
  | { kind: "rel"; rel: GEdge }
  | { kind: "scalar"; value: unknown };

export function cellsToGraph(rows: Cell[][]): { nodes: GNode[]; edges: GEdge[] } {
  const nodes = new Map<number, GNode>();
  const edges = new Map<string, GEdge>();
  for (const row of rows) {
    for (const cell of row) {
      if (cell.kind === "node") nodes.set(cell.node.id, cell.node);
      if (cell.kind === "rel") edges.set(cell.rel.id, cell.rel);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
