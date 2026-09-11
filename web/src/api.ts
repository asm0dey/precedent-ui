import type { Cell, GEdge, GNode } from "./classify";

export type Degree = { type: string; dir: "out" | "in"; count: number };
export type Hit = { id: number; labels: string[]; caption: string; sub: string; degree: number };
export type NodeDetail = GNode & {
  caption: string;
  key: { field: string; value: string } | null;
  degrees: Degree[];
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const getMeta = () =>
  // "mtime" is a journal-derived change stamp ("<mtime_ns>:<size>"), not a
  // numeric timestamp — see server/store.py's Store.change_stamp().
  get<{ labels: Record<string, number>; edge_types: Record<string, number>; mtime: string }>(
    "/api/meta",
  );

export const search = (q: string, limit = 50) =>
  get<Hit[]>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);

export const getNode = (id: number) => get<NodeDetail>(`/api/node/${id}`);

export const expand = (
  id: number,
  opts: { type?: string; dir?: string; limit?: number; offset?: number } = {},
) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) p.set(k, String(v));
  return get<{ nodes: GNode[]; edges: GEdge[]; total: number; offset: number; limit: number }>(
    `/api/expand/${id}?${p}`,
  );
};

export const edgesBetween = (ids: number[]) =>
  post<{ edges: GEdge[] }>("/api/edges-between", { ids });

export const runCypher = (query: string, params: Record<string, unknown> = {}) =>
  post<{ columns: string[]; rows: Cell[][]; truncated: boolean }>("/api/cypher", { query, params });
