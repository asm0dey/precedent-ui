import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  edgesBetween,
  expand,
  getMeta,
  getNode,
  isNotFound,
  runCypher,
  search,
} from "./api";

const fetchMock = vi.fn();

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
const fail = (status: number, text: string) =>
  ({ ok: false, status, json: async () => ({}), text: async () => text }) as Response;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ApiError", () => {
  it("carries the status and puts it in the message", () => {
    const e = new ApiError(503, "busy");
    expect(e.status).toBe(503);
    expect(e.message).toBe("503 busy");
    expect(e.name).toBe("ApiError");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("isNotFound", () => {
  it("is true only for an ApiError with status 404", () => {
    expect(isNotFound(new ApiError(404, "gone"))).toBe(true);
    expect(isNotFound(new ApiError(503, "busy"))).toBe(false);
    expect(isNotFound(new TypeError("Failed to fetch"))).toBe(false);
    expect(isNotFound({ status: 404 })).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
  });
});

describe("get", () => {
  it("returns the parsed body on success", async () => {
    const meta = { labels: { Decision: 1 }, edge_types: {}, mtime: "1:2" };
    fetchMock.mockResolvedValue(ok(meta));
    await expect(getMeta()).resolves.toEqual(meta);
    expect(fetchMock).toHaveBeenCalledWith("/api/meta");
  });

  it("throws an ApiError with the status and body text on failure", async () => {
    fetchMock.mockResolvedValue(fail(404, "no such node"));
    const err = await getNode(7).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("404 no such node");
  });

  it("lets a network failure through as-is", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await getMeta().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(isNotFound(err)).toBe(false);
  });
});

describe("search", () => {
  it("encodes the query and defaults the limit to 50", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await search("a&b c/?");
    expect(fetchMock).toHaveBeenCalledWith("/api/search?q=a%26b%20c%2F%3F&limit=50");
  });

  it("passes an explicit limit", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await search("x", 5);
    expect(fetchMock).toHaveBeenCalledWith("/api/search?q=x&limit=5");
  });
});

describe("node ids", () => {
  it("puts an integer id in the path", async () => {
    fetchMock.mockResolvedValue(ok({}));
    await getNode(42);
    expect(fetchMock).toHaveBeenCalledWith("/api/node/42");
  });

  it.each([1.5, Number.NaN, Infinity, 2 ** 53, "1/../x" as unknown as number])(
    "refuses %s before fetching",
    (id) => {
      expect(() => getNode(id)).toThrow(TypeError);
      expect(() => expand(id)).toThrow(TypeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("expand", () => {
  it("sends only the options that are set", async () => {
    fetchMock.mockResolvedValue(ok({ nodes: [], edges: [], total: 0, offset: 0, limit: 0 }));
    await expand(3, { type: "CHOSE", dir: "out", limit: undefined, offset: 20 });
    expect(fetchMock).toHaveBeenCalledWith("/api/expand/3?type=CHOSE&dir=out&offset=20");
  });

  it("sends an empty query string with no options", async () => {
    fetchMock.mockResolvedValue(ok({ nodes: [], edges: [], total: 0, offset: 0, limit: 0 }));
    await expand(3);
    expect(fetchMock).toHaveBeenCalledWith("/api/expand/3?");
  });
});

describe("post", () => {
  it("edgesBetween posts the ids as JSON", async () => {
    fetchMock.mockResolvedValue(ok({ edges: [] }));
    await expect(edgesBetween([1, 2])).resolves.toEqual({ edges: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/edges-between", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [1, 2] }),
    });
  });

  it("runCypher posts the query with empty params by default", async () => {
    fetchMock.mockResolvedValue(ok({ columns: [], rows: [], truncated: false }));
    await runCypher("MATCH (n) RETURN n");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ query: "MATCH (n) RETURN n", params: {} });
  });

  it("runCypher passes params through", async () => {
    fetchMock.mockResolvedValue(ok({ columns: [], rows: [], truncated: false }));
    await runCypher("RETURN $x", { x: 1 });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ query: "RETURN $x", params: { x: 1 } });
  });

  it("throws an ApiError on a non-ok response", async () => {
    fetchMock.mockResolvedValue(fail(400, '{"detail":{"error":"bad"}}'));
    const err = await runCypher("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });
});
