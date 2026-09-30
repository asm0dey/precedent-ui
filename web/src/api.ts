import type { Cell, GEdge, GNode } from "./classify";

export type Degree = { type: string; dir: "out" | "in"; count: number };
export type Hit = { id: number; labels: string[]; caption: string; sub: string; degree: number };
export type NodeDetail = GNode & {
  caption: string;
  key: { field: string; value: string } | null;
  degrees: Degree[];
};

/** A non-ok HTTP response, carrying the status so callers can tell the
 * statuses apart. 404 means "this node is gone"; 503 means "the store is
 * missing or busy" and 5xx/network failures mean "ask again later" — treating
 * them alike would let one blip delete a working set the user assembled by
 * hand. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`${status} ${body}`);
    this.name = "ApiError";
    this.status = status;
  }
}

/** True only for the one failure that means the node no longer exists. A
 * rejection that is not an ApiError at all (a dropped connection surfaces as
 * fetch's TypeError) is emphatically not that. */
export const isNotFound = (reason: unknown) =>
  reason instanceof ApiError && reason.status === 404;

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new ApiError(r.status, await r.text());
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new ApiError(r.status, await r.text());
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

/** Node ids arrive in server responses, so they are data, not trusted path
 * segments: anything but a safe integer is refused before it reaches a URL. */
function idSegment(id: number): string {
  if (!Number.isSafeInteger(id)) throw new TypeError(`not a node id: ${String(id)}`);
  return encodeURIComponent(String(id));
}

export const getNode = (id: number) => get<NodeDetail>(`/api/node/${idSegment(id)}`);

export const expand = (
  id: number,
  opts: { type?: string; dir?: string; limit?: number; offset?: number } = {},
) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) p.set(k, String(v));
  return get<{ nodes: GNode[]; edges: GEdge[]; total: number; offset: number; limit: number }>(
    `/api/expand/${idSegment(id)}?${p}`,
  );
};

export const edgesBetween = (ids: number[]) =>
  post<{ edges: GEdge[] }>("/api/edges-between", { ids });

export const runCypher = (query: string, params: Record<string, unknown> = {}) =>
  post<{ columns: string[]; rows: Cell[][]; truncated: boolean }>("/api/cypher", { query, params });
