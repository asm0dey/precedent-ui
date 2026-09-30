// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type Graph from "graphology";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as api from "./api";
import type { NodeDetail } from "./api";
import type { Cell, GEdge, GNode } from "./classify";
import type { Focus } from "./graph/Canvas";

type CanvasProps = {
  graph: Graph;
  mode: "light" | "dark";
  hovered: string | null;
  version: number;
  focus: Focus | null;
  fit: number;
  onSelect: (id: number) => void;
  onDoubleClick: (id: number) => void | Promise<void>;
  onContextMenu: (id: number, x: number, y: number) => void | Promise<void>;
  onHover: (id: string | null) => void;
  onPin: (id: string) => void;
};

const h = vi.hoisted(() => {
  class ApiError extends Error {
    readonly status: number;
    constructor(status: number, body: string) {
      super(`${status} ${body}`);
      this.status = status;
    }
  }
  return { ApiError, canvas: { props: null as unknown } };
});

vi.mock("./api", () => ({
  ApiError: h.ApiError,
  isNotFound: (r: unknown) => r instanceof h.ApiError && r.status === 404,
  getMeta: vi.fn(),
  search: vi.fn(),
  getNode: vi.fn(),
  expand: vi.fn(),
  edgesBetween: vi.fn(),
  runCypher: vi.fn(),
}));

// Sigma needs WebGL, which jsdom lacks: a stand-in that records what App hands it.
vi.mock("./graph/Canvas", () => ({
  Canvas: (props: unknown) => {
    h.canvas.props = props;
    return null;
  },
}));

const canvas = () => h.canvas.props as CanvasProps;
const nodeIds = () => canvas().graph.nodes().sort((a, b) => Number(a) - Number(b));

/** Fake SSE source: `emit` delivers a frame the way the server stream would. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }
  emit(mtime: string) {
    act(() => this.onmessage?.({ data: JSON.stringify({ mtime }) }));
  }
  close() {
    this.closed = true;
  }
}

const n = (id: number, label: string, props: Record<string, unknown> = {}): GNode => ({
  id,
  labels: [label],
  props,
});
const e = (id: string, src: number, dst: number, type: string): GEdge => ({ id, src, dst, type });

// The opening view: project 1 <-IN_PROJECT- decision 2 -CHOSE-> option 3.
const P1 = n(1, "Project", { name: "alpha" });
const D2 = n(2, "Decision", { title: "use bun", status: "active" });
const O3 = n(3, "Option", { name: "bun" });
const VIEW: Cell[][] = [
  [
    { kind: "node", node: D2 },
    { kind: "rel", rel: e("c", 2, 3, "CHOSE") },
    { kind: "node", node: O3 },
    { kind: "rel", rel: e("i", 2, 1, "IN_PROJECT") },
    { kind: "node", node: P1 },
  ],
];

let details: Map<number, NodeDetail>;
const detail = (g: GNode, caption: string, extra: Partial<NodeDetail> = {}): NodeDetail => ({
  ...g,
  caption,
  key: null,
  degrees: [],
  ...extra,
});

const clipboard = { writeText: vi.fn() };

beforeEach(() => {
  details = new Map([
    [1, detail(P1, "alpha", { degrees: [{ type: "IN_PROJECT", dir: "in", count: 1 }] })],
    [
      2,
      detail(D2, "use bun", {
        key: { field: "id", value: "dec-42" },
        degrees: [
          { type: "CHOSE", dir: "out", count: 5 },
          { type: "IN_PROJECT", dir: "out", count: 1 },
        ],
      }),
    ],
    [3, detail(O3, "bun")],
  ]);
  vi.mocked(api.getMeta).mockResolvedValue({ labels: {}, edge_types: {}, mtime: "0:0" });
  vi.mocked(api.runCypher).mockResolvedValue({ columns: [], rows: VIEW, truncated: false });
  vi.mocked(api.edgesBetween).mockResolvedValue({ edges: [] });
  vi.mocked(api.search).mockResolvedValue([]);
  vi.mocked(api.expand).mockResolvedValue({ nodes: [], edges: [], total: 0, offset: 0, limit: 50 });
  vi.mocked(api.getNode).mockImplementation(async (id) => {
    const d = details.get(id);
    if (!d) throw new h.ApiError(404, "gone");
    return d;
  });
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  clipboard.writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Render and wait for the opening view to land on the canvas. */
async function mount() {
  const view = render(<App />);
  await waitFor(() => expect(canvas().graph.order).toBe(3));
  return view;
}

async function openMenu(id: number) {
  await act(async () => {
    await canvas().onContextMenu(id, 10, 20);
  });
  return screen.getByRole("menu");
}

describe("App", () => {
  describe("opening view", () => {
    it("loads decisions, options and projects on mount and bumps the canvas version", async () => {
      await mount();
      expect(vi.mocked(api.runCypher).mock.calls[0][0]).toContain("MATCH (d:Decision)");
      expect(nodeIds()).toEqual(["1", "2", "3"]);
      expect(canvas().graph.size).toBe(2);
      expect(canvas().version).toBeGreaterThan(0);
    });

    it("toasts when the projects map cannot load, and clears the toast after five seconds", async () => {
      vi.useFakeTimers();
      vi.mocked(api.runCypher).mockRejectedValue(new Error("503 busy"));
      render(<App />);
      await act(async () => {});
      expect(screen.getByText("loading the projects map failed: 503 busy")).toBeTruthy();
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.queryByText(/loading the projects map failed/)).toBeNull();
    });
  });

  describe("search", () => {
    it("adds a picked hit, selects it, focuses the camera on it and connects it", async () => {
      details.set(7, detail(n(7, "Tag", { name: "db" }), "db"));
      vi.mocked(api.search).mockResolvedValue([
        { id: 7, labels: ["Tag"], caption: "db", sub: "tag", degree: 4 },
      ]);
      await mount();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Search the decision graph"), "db");
      await user.click(await screen.findByRole("button", { name: /db/ }));

      await waitFor(() => expect(canvas().graph.hasNode("7")).toBe(true));
      expect(canvas().focus).toEqual({ id: 7, nonce: 1 });
      await waitFor(() =>
        expect(vi.mocked(api.edgesBetween)).toHaveBeenCalledWith(expect.arrayContaining([7])),
      );
      // Detail shows the selection.
      expect(await screen.findByRole("heading", { name: "db" })).toBeTruthy();
    });
  });

  describe("double-click", () => {
    it("expands within the budget, says how much was left, then collapses to one hop", async () => {
      details.set(1, detail(P1, "alpha", { degrees: [{ type: "IN_PROJECT", dir: "in", count: 152 }] }));
      vi.mocked(api.expand).mockResolvedValue({
        nodes: [n(10, "Decision"), n(11, "Decision")],
        edges: [e("x", 10, 1, "IN_PROJECT"), e("y", 11, 1, "IN_PROJECT")],
        total: 152,
        offset: 0,
        limit: 100,
      });
      await mount();

      await act(async () => {
        await canvas().onDoubleClick(1);
      });
      expect(vi.mocked(api.expand)).toHaveBeenCalledWith(1, {
        type: "IN_PROJECT",
        dir: "in",
        limit: 100,
      });
      expect(nodeIds()).toEqual(["1", "2", "3", "10", "11"]);
      expect(screen.getByText("added 2 of 54 — use the type chips for the rest")).toBeTruthy();

      // Second double-click is the inverse: keep 1 and its direct neighbours.
      const fit = canvas().fit;
      await act(async () => {
        await canvas().onDoubleClick(1);
      });
      expect(nodeIds()).toEqual(["1", "2", "10", "11"]);
      expect(canvas().fit).toBe(fit + 1);
    });

    it("toasts when the expansion behind a double-click fails", async () => {
      vi.mocked(api.getNode).mockRejectedValue(new Error("503 busy"));
      await mount();
      await act(async () => {
        await canvas().onDoubleClick(2);
      });
      expect(await screen.findByText("expand all failed: 503 busy")).toBeTruthy();
    });

    it("stays quiet when the whole neighbourhood fits the budget", async () => {
      await mount();
      await act(async () => {
        await canvas().onDoubleClick(2);
      });
      expect(vi.mocked(api.expand)).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(/added/)).toBeNull();
    });
  });

  describe("context menu", () => {
    it("opens with the node's caption and closes on an action", async () => {
      await mount();
      const menu = await openMenu(2);
      expect(menu.getAttribute("aria-label")).toBe("Actions for use bun");
      await userEvent.click(within(menu).getByText("pin / unpin"));
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("expands one edge type a page at a time and offers the rest in Detail", async () => {
      vi.mocked(api.expand).mockResolvedValue({
        nodes: [n(3, "Option"), n(4, "Option", { name: "npm" })],
        edges: [e("c2", 2, 4, "CHOSE")],
        total: 5,
        offset: 0,
        limit: 50,
      });
      await mount();
      act(() => canvas().onSelect(2));
      await screen.findByRole("heading", { name: "use bun" });

      const menu = await openMenu(2);
      await userEvent.click(within(menu).getByText("CHOSE ▸ 5"));
      await waitFor(() => expect(canvas().graph.hasEdge("c2")).toBe(true));
      expect(vi.mocked(api.expand)).toHaveBeenCalledWith(2, {
        type: "CHOSE",
        dir: "out",
        limit: 50,
        offset: 0,
      });

      // 5 total, 2 shown: the Detail chip offers the other 3, starting at 2.
      await userEvent.click(await screen.findByRole("button", { name: "+3 more" }));
      expect(vi.mocked(api.expand)).toHaveBeenLastCalledWith(2, {
        type: "CHOSE",
        dir: "out",
        limit: 50,
        offset: 2,
      });
    });

    it("toasts when an expansion fails", async () => {
      vi.mocked(api.expand).mockRejectedValue(new Error("503 busy"));
      await mount();
      await userEvent.click(within(await openMenu(2)).getByText("CHOSE ▸ 5"));
      expect(await screen.findByText("expand failed: 503 busy")).toBeTruthy();
    });

    it("toasts when expand-all fails, including for a non-Error rejection", async () => {
      vi.mocked(api.expand).mockRejectedValue("socket closed");
      await mount();
      await userEvent.click(within(await openMenu(2)).getByText("all"));
      expect(await screen.findByText("expand all failed: socket closed")).toBeTruthy();
    });

    it("keeps only nodes within the chosen depth, sparing pinned ones", async () => {
      await mount();
      act(() => canvas().onPin("3")); // a drag pins
      await userEvent.click(within(await openMenu(1)).getByText("this node + 1 hop"));
      expect(nodeIds()).toEqual(["1", "2", "3"]);

      // Unpinned now: the next collapse may drop it.
      await userEvent.click(within(await openMenu(3)).getByText("pin / unpin"));
      await userEvent.click(within(await openMenu(1)).getByText("this node + 1 hop"));
      expect(nodeIds()).toEqual(["1", "2"]);
    });

    it("says so when a collapse had nothing to drop", async () => {
      await mount();
      await userEvent.click(within(await openMenu(2)).getByText("this node + 2 hops"));
      expect(nodeIds()).toEqual(["1", "2", "3"]);
      expect(screen.getByText("nothing further away than that was loaded")).toBeTruthy();
    });

    it("pins and unpins by marking the node fixed", async () => {
      await mount();
      await userEvent.click(within(await openMenu(2)).getByText("pin / unpin"));
      expect(canvas().graph.getNodeAttribute("2", "fixed")).toBe(true);
      await userEvent.click(within(await openMenu(2)).getByText("pin / unpin"));
      expect(canvas().graph.getNodeAttribute("2", "fixed")).toBe(false);
    });

    it("hides a node and clears the selection when it was selected", async () => {
      await mount();
      act(() => canvas().onSelect(3));
      await screen.findByRole("heading", { name: "bun" });
      await userEvent.click(within(await openMenu(3)).getByText("hide"));
      expect(canvas().graph.hasNode("3")).toBe(false);
      expect(screen.getByText("nothing selected")).toBeTruthy();
    });

    it("copies the domain key to the clipboard", async () => {
      await mount();
      await userEvent.click(within(await openMenu(2)).getByText("copy domain key"));
      expect(clipboard.writeText).toHaveBeenCalledWith("dec-42");
    });

    it("does nothing on copy when the node has no domain key", async () => {
      await mount();
      await userEvent.click(within(await openMenu(3)).getByText("copy domain key"));
      expect(clipboard.writeText).not.toHaveBeenCalled();
    });

    it("toasts instead of throwing where the browser offers no clipboard", async () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      await mount();
      await userEvent.click(within(await openMenu(2)).getByText("copy domain key"));
      expect(await screen.findByText(/copy needs HTTPS or localhost/)).toBeTruthy();
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("toasts when opening it from a right-click fails", async () => {
      vi.mocked(api.getNode).mockRejectedValue(new Error("503 busy"));
      await mount();
      await act(async () => {
        await canvas().onContextMenu(2, 10, 20);
      });
      expect(await screen.findByText("opening the menu failed: 503 busy")).toBeTruthy();
    });

    it("toasts when the clipboard refuses", async () => {
      clipboard.writeText.mockRejectedValue(new Error("denied"));
      await mount();
      await userEvent.click(within(await openMenu(2)).getByText("copy domain key"));
      expect(await screen.findByText("copy failed: denied")).toBeTruthy();
    });

    it("opens from the Detail panel's actions button, and toasts if that fails", async () => {
      await mount();
      act(() => canvas().onSelect(2));
      await userEvent.click(await screen.findByRole("button", { name: "actions ▾" }));
      expect(await screen.findByRole("menu", { name: "Actions for use bun" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "actions ▾" }).getAttribute("aria-expanded")).toBe(
        "true",
      );

      await userEvent.keyboard("{Escape}");
      vi.mocked(api.getNode).mockRejectedValueOnce(new Error("503 busy"));
      await userEvent.click(screen.getByRole("button", { name: "actions ▾" }));
      expect(await screen.findByText("opening the menu failed: 503 busy")).toBeTruthy();
    });

    it("toasts when a Detail chip expansion fails", async () => {
      vi.mocked(api.expand).mockRejectedValue(new Error("boom"));
      await mount();
      act(() => canvas().onSelect(2));
      await userEvent.click(await screen.findByRole("button", { name: /CHOSE ▸\s*5/ }));
      expect(await screen.findByText("expand failed: boom")).toBeTruthy();
    });
  });

  describe("change stream", () => {
    it("ignores the connect frame and an unchanged stamp, flags a new one", async () => {
      await mount();
      const es = FakeEventSource.last!;
      expect(es.url).toBe("/api/stream");
      es.emit("1:1");
      es.emit("1:1");
      expect(screen.queryByText("graph changed")).toBeNull();
      es.emit("2:9");
      expect(screen.getByText("graph changed")).toBeTruthy();
    });

    it("closes the stream on unmount", async () => {
      const { unmount } = await mount();
      unmount();
      expect(FakeEventSource.last!.closed).toBe(true);
    });

    async function changed() {
      await mount();
      FakeEventSource.last!.emit("1:1");
      FakeEventSource.last!.emit("2:2");
      return screen.getByRole("button", { name: "refresh" });
    }

    it("refresh drops nodes that now 404, clears their selection, and clears the badge", async () => {
      const button = await changed();
      act(() => canvas().onSelect(3));
      await screen.findByRole("heading", { name: "bun" });
      details.delete(3);
      details.set(2, detail({ ...D2, props: { ...D2.props, status: "superseded" } }, "use bun"));

      await userEvent.click(button);
      await screen.findByText("graph was rebuilt — some nodes no longer exist");
      expect(nodeIds()).toEqual(["1", "2"]);
      expect(canvas().graph.getNodeAttribute("2", "status")).toBe("superseded");
      expect(screen.queryByText("graph changed")).toBeNull();
      expect(screen.getByText("nothing selected")).toBeTruthy();
    });

    it("refresh keeps a node the server could not answer for", async () => {
      const button = await changed();
      vi.mocked(api.getNode).mockImplementation(async (id) => {
        if (id === 3) throw new h.ApiError(503, "busy");
        return details.get(id)!;
      });
      await userEvent.click(button);
      await screen.findByText("refresh incomplete — the server did not answer; nothing was removed");
      expect(nodeIds()).toEqual(["1", "2", "3"]);
    });

    it("refresh reports an incomplete result when edges cannot be re-derived", async () => {
      const button = await changed();
      vi.mocked(api.edgesBetween).mockRejectedValue(new Error("down"));
      await userEvent.click(button);
      await screen.findByText("refresh incomplete — the server did not answer; nothing was removed");
      expect(nodeIds()).toEqual(["1", "2", "3"]);
      expect(screen.queryByText("graph changed")).toBeNull();
    });
  });

  describe("panels and chrome", () => {
    it("adds Cypher console results to the canvas and connects them", async () => {
      await mount();
      vi.mocked(api.runCypher).mockResolvedValue({
        columns: ["t"],
        rows: [[{ kind: "node", node: n(20, "Tag", { name: "infra" }) }]],
        truncated: false,
      });
      await userEvent.click(screen.getByRole("button", { name: "run" }));
      await userEvent.click(await screen.findByRole("button", { name: "add 1 node to canvas" }));
      await waitFor(() => expect(canvas().graph.hasNode("20")).toBe(true));
      await waitFor(() =>
        expect(vi.mocked(api.edgesBetween)).toHaveBeenLastCalledWith(
          expect.arrayContaining([1, 2, 3, 20]),
        ),
      );
    });

    it("passes the hovered node through to the canvas", async () => {
      await mount();
      act(() => canvas().onHover("2"));
      expect(canvas().hovered).toBe("2");
      act(() => canvas().onHover(null));
      expect(canvas().hovered).toBeNull();
    });

    it("switches theme and hands the resolved mode to the canvas", async () => {
      await mount();
      expect(canvas().mode).toBe("light");
      const dark = screen.getByRole("button", { name: "Dark" });
      await userEvent.click(dark);
      expect(dark.className).toBe("active");
      expect(canvas().mode).toBe("dark");
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
  });
});
