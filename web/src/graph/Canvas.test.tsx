// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import Graph from "graphology";
import noverlap from "graphology-layout-noverlap";
import { drawDiscNodeHover } from "sigma/rendering";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOVER_LABEL_INK, clip, edgePaint, nodePaint, tokens } from "../skin";
import { Canvas, type CanvasHandlers, type Focus } from "./Canvas";

/**
 * jsdom has no WebGL, so sigma itself cannot run. The react-sigma hooks are
 * replaced with fakes over a real graphology graph, which is what the reducers,
 * gesture wiring and settle loop actually read and write.
 */
const h = vi.hoisted(() => ({
  sigma: null as unknown as FakeSigma,
  events: {} as Record<string, (e: any) => void>,
  fa2: null as any,
  start: vi.fn(),
  stop: vi.fn(),
  goto: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@react-sigma/core", () => {
  const camera = { goto: h.goto, reset: h.reset };
  const register = (handlers: Record<string, (e: any) => void>) => {
    h.events = handlers;
  };
  const passThrough = ({ children }: { children?: unknown }) => children ?? null;
  return {
    SigmaContainer: passThrough,
    ControlsContainer: passThrough,
    ZoomControl: () => null,
    FullScreenControl: () => null,
    useSigma: () => h.sigma,
    useCamera: () => camera,
    useRegisterEvents: () => register,
  };
});

vi.mock("@react-sigma/layout-forceatlas2", () => {
  const layout = { start: h.start, stop: h.stop };
  return {
    LayoutForceAtlas2Control: () => null,
    useWorkerLayoutForceAtlas2: (opts: unknown) => {
      h.fa2 = opts;
      return layout;
    },
  };
});

vi.mock("@react-sigma/minimap", () => ({ MiniMap: () => null }));
vi.mock("graphology-layout-noverlap", () => ({ default: { assign: vi.fn() } }));
vi.mock("sigma/rendering", () => ({ drawDiscNodeHover: vi.fn() }));

type FakeSigma = ReturnType<typeof fakeSigma>;

/** Viewport space is graph space doubled, so a conversion that was skipped shows. */
function fakeSigma(graph: Graph) {
  const settings: Record<string, any> = {};
  const container = document.createElement("div");
  container.getBoundingClientRect = () => ({ left: 100, top: 50 }) as DOMRect;
  return {
    settings,
    getGraph: () => graph,
    setSetting: (k: string, v: unknown) => {
      settings[k] = v;
    },
    refresh: vi.fn(),
    getContainer: () => container,
    getNodeDisplayData: (k: string) =>
      graph.hasNode(k)
        ? { x: graph.getNodeAttribute(k, "x"), y: graph.getNodeAttribute(k, "y"), size: 12 }
        : undefined,
    graphToViewport: (p: { x: number; y: number }) => ({ x: p.x * 2, y: p.y * 2 }),
    viewportToGraph: (p: { x: number; y: number }) => ({ x: p.x / 2, y: p.y / 2 }),
  };
}

const LONG = "Adopt a very long decision title that will not fit";

function sampleGraph() {
  const g = new Graph();
  g.addNode("1", { x: 0, y: 0, size: 8, label: LONG, nodeLabel: "Decision", status: "active" });
  g.addNode("2", { x: 10, y: 0, size: 8, label: "precedent", nodeLabel: "Project" });
  g.addNode("3", { x: 0, y: 10, size: 8, label: "bun", nodeLabel: "Option", status: "superseded" });
  g.addNode("4", { x: 10, y: 10, size: 8, label: "old", nodeLabel: "Decision", status: "regretted" });
  g.addEdgeWithKey("e12", "1", "2", { edgeType: "IN_PROJECT" });
  g.addEdgeWithKey("e34", "4", "3", { edgeType: "CHOSE" });
  g.addEdgeWithKey("e14", "1", "4", { edgeType: "REGRETS" });
  return g;
}

function handlers(): { [K in keyof CanvasHandlers]: ReturnType<typeof vi.fn> } {
  return {
    onSelect: vi.fn(),
    onDoubleClick: vi.fn(),
    onContextMenu: vi.fn(),
    onHover: vi.fn(),
    onPin: vi.fn(),
  };
}

type Props = Parameters<typeof Canvas>[0];

function mount(graph: Graph, overrides: Partial<Props> = {}) {
  h.sigma = fakeSigma(graph);
  const hs = handlers();
  const props: Props = {
    graph,
    mode: "light",
    hovered: null,
    version: 0,
    focus: null,
    fit: 0,
    ...(hs as unknown as CanvasHandlers),
    ...overrides,
  };
  const view = render(<Canvas {...props} />);
  return {
    ...view,
    hs,
    props,
    update: (next: Partial<Props>) => {
      Object.assign(props, next);
      view.rerender(<Canvas {...props} />);
    },
  };
}

const nodeReducer = () => h.sigma.settings.nodeReducer as (n: string, d: any) => any;
const edgeReducer = () => h.sigma.settings.edgeReducer as (e: string, d: any) => any;
const reduceNode = (g: Graph, n: string) => nodeReducer()(n, g.getNodeAttributes(n));
const reduceEdge = (g: Graph, e: string) => edgeReducer()(e, g.getEdgeAttributes(e));

beforeEach(() => {
  vi.clearAllMocks();
  h.events = {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Canvas reducers", () => {
  it("colours nodes by label and status from the theme", () => {
    const g = sampleGraph();
    mount(g, { mode: "dark" });
    const t = tokens("dark");
    expect(reduceNode(g, "2").color).toBe(nodePaint(t, "Project", undefined));
    expect(reduceNode(g, "2").color).toBe(t.labelColor.Project);
    // superseded fades and sinks beneath the rest
    const faded = reduceNode(g, "3");
    expect(faded.color).toBe(nodePaint(t, "Option", "superseded"));
    expect(faded.color).toMatch(/^rgba\(/);
    expect(faded.zIndex).toBe(0);
    expect(reduceNode(g, "2").zIndex).toBe(1);
    // regretted takes the regret warning colour, not the Decision blue
    expect(reduceNode(g, "4").color).toBe(nodePaint(t, "Decision", "regretted"));
    expect(reduceNode(g, "4").color).not.toContain(t.labelColor.Decision);
  });

  it("re-tints on a theme flip without touching the graph", () => {
    const g = sampleGraph();
    const { update } = mount(g, { mode: "light" });
    expect(reduceNode(g, "2").color).toBe(tokens("light").labelColor.Project);
    expect(h.sigma.settings.labelColor).toEqual({ color: tokens("light").text });
    update({ mode: "dark" });
    expect(reduceNode(g, "2").color).toBe(tokens("dark").labelColor.Project);
    expect(h.sigma.settings.labelColor).toEqual({ color: tokens("dark").text });
    expect(h.sigma.settings.edgeLabelColor).toEqual({ color: tokens("dark").text });
    expect(g.getNodeAttribute("2", "color")).toBeUndefined();
    expect(h.sigma.refresh).toHaveBeenCalledTimes(2);
  });

  it("clips long labels, but not on the hovered node", () => {
    const g = sampleGraph();
    const { update } = mount(g);
    expect(reduceNode(g, "1").label).toBe(clip(LONG));
    expect(reduceNode(g, "1").label).not.toBe(LONG);
    expect(reduceNode(g, "2").label).toBe("precedent");
    update({ hovered: "1" });
    expect(reduceNode(g, "1").label).toBe(LONG);
  });

  it("leaves a node without a label unlabelled", () => {
    const g = new Graph();
    g.addNode("x", { x: 0, y: 0 });
    mount(g);
    expect(reduceNode(g, "x").label).toBeUndefined();
  });

  it("highlights the hovered node and its neighbours and greys out the rest", () => {
    const g = sampleGraph();
    mount(g, { hovered: "1" });
    const t = tokens("light");
    expect(reduceNode(g, "1").highlighted).toBe(true);
    expect(reduceNode(g, "2").highlighted).toBe(true);
    expect(reduceNode(g, "4").highlighted).toBe(true);
    const far = reduceNode(g, "3");
    expect(far.highlighted).toBeUndefined();
    expect(far.color).toBe(t.edge);
    expect(far.label).toBe("");
  });

  it("colours edges by type and hides those not touching the hovered node", () => {
    const g = sampleGraph();
    const { update } = mount(g);
    const t = tokens("light");
    expect(reduceEdge(g, "e12").color).toBe(edgePaint(t, "IN_PROJECT"));
    expect(reduceEdge(g, "e34").color).toBe(t.verdict.CHOSE);
    expect(reduceEdge(g, "e14").color).toBe(t.warn.regret);
    expect(reduceEdge(g, "e34").hidden).toBeUndefined();

    update({ hovered: "1" });
    expect(reduceEdge(g, "e12").hidden).toBeUndefined();
    expect(reduceEdge(g, "e14").hidden).toBeUndefined();
    expect(reduceEdge(g, "e34").hidden).toBe(true);
    expect(reduceEdge(g, "e34").color).toBe(t.verdict.CHOSE);
  });

  it("ignores a hovered node that has since been removed", () => {
    const g = sampleGraph();
    mount(g, { hovered: "1" });
    g.dropNode("1");
    expect(() => reduceNode(g, "2")).not.toThrow();
    expect(reduceNode(g, "2").highlighted).toBeUndefined();
    expect(reduceNode(g, "2").label).toBe("precedent");
    expect(reduceEdge(g, "e34").hidden).toBeUndefined();
  });

  it("draws the hover label in fixed dark ink whatever the theme", () => {
    mount(sampleGraph(), { mode: "dark" });
    const ctx = {} as CanvasRenderingContext2D;
    const settings = { labelColor: { color: "#fff" }, labelSize: 14 };
    h.sigma.settings.defaultDrawNodeHover(ctx, { x: 1 }, settings);
    expect(drawDiscNodeHover).toHaveBeenCalledWith(
      ctx,
      { x: 1 },
      { labelColor: { color: HOVER_LABEL_INK }, labelSize: 14 },
    );
  });
});

describe("Canvas events", () => {
  function sigmaEvent(node: string, extra: Record<string, unknown> = {}) {
    return {
      node,
      preventSigmaDefault: vi.fn(),
      event: { x: 5, y: 7, original: { preventDefault: vi.fn(), button: 0 } },
      ...extra,
    };
  }

  it("passes clicks and hovers through with numeric ids", () => {
    const { hs } = mount(sampleGraph());
    h.events.clickNode(sigmaEvent("2"));
    h.events.doubleClickNode(sigmaEvent("3"));
    h.events.enterNode(sigmaEvent("4"));
    h.events.leaveNode(sigmaEvent("4"));
    expect(hs.onSelect).toHaveBeenCalledWith(2);
    expect(hs.onDoubleClick).toHaveBeenCalledWith(3);
    expect(hs.onHover.mock.calls).toEqual([["4"], [null]]);
  });

  it("opens the context menu at viewport coordinates and blocks the native menu", () => {
    const { hs } = mount(sampleGraph());
    const e = sigmaEvent("1");
    h.events.rightClickNode(e);
    expect(e.preventSigmaDefault).toHaveBeenCalled();
    expect(e.event.original.preventDefault).toHaveBeenCalled();
    // container sits at (100, 50); the event is container-relative (5, 7)
    expect(hs.onContextMenu).toHaveBeenCalledWith(1, 105, 57);
  });

  it("drags a node, pins it in place and reports the pin on release", () => {
    const g = sampleGraph();
    const { hs } = mount(g);
    h.events.downNode(sigmaEvent("2"));
    const move = { x: 40, y: 60, preventSigmaDefault: vi.fn() };
    h.events.mousemovebody(move);
    expect(g.getNodeAttributes("2")).toMatchObject({ x: 20, y: 30, fixed: true });
    expect(move.preventSigmaDefault).toHaveBeenCalled();
    h.events.mouseup({});
    expect(hs.onPin).toHaveBeenCalledWith("2");

    // released: further moves drag nothing
    h.events.mousemovebody({ x: 0, y: 0, preventSigmaDefault: vi.fn() });
    expect(g.getNodeAttribute("2", "x")).toBe(20);
  });

  it("does not pin on a plain click without movement", () => {
    const g = sampleGraph();
    const { hs } = mount(g);
    h.events.downNode(sigmaEvent("2"));
    h.events.mouseup({});
    expect(hs.onPin).not.toHaveBeenCalled();
    expect(g.getNodeAttribute("2", "fixed")).toBeUndefined();
  });

  it("does not arm a drag from a right-button press", () => {
    const g = sampleGraph();
    const { hs } = mount(g);
    h.events.downNode(
      sigmaEvent("2", { event: { x: 0, y: 0, original: { preventDefault: vi.fn(), button: 2 } } }),
    );
    h.events.mousemovebody({ x: 40, y: 60, preventSigmaDefault: vi.fn() });
    h.events.mouseup({});
    expect(g.getNodeAttribute("2", "x")).toBe(10);
    expect(hs.onPin).not.toHaveBeenCalled();
  });

  it("treats a touch (no button) as a primary press", () => {
    const g = sampleGraph();
    const { hs } = mount(g);
    h.events.downNode(sigmaEvent("2", { event: { x: 0, y: 0, original: { preventDefault: vi.fn() } } }));
    h.events.mousemovebody({ x: 2, y: 2, preventSigmaDefault: vi.fn() });
    h.events.mouseup({});
    expect(hs.onPin).toHaveBeenCalledWith("2");
  });

  it("disarms a drag when the context menu opens", () => {
    const g = sampleGraph();
    const { hs } = mount(g);
    h.events.downNode(sigmaEvent("2"));
    h.events.rightClickNode(sigmaEvent("2"));
    h.events.mousemovebody({ x: 40, y: 60, preventSigmaDefault: vi.fn() });
    h.events.mouseup({});
    expect(g.getNodeAttribute("2", "x")).toBe(10);
    expect(hs.onPin).not.toHaveBeenCalled();
  });
});

describe("Canvas auto layout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** Moves every node a large step, so the next sample reads as unsettled. */
  const jolt = (g: Graph) => g.forEachNode((n, a) => g.mergeNodeAttributes(n, { x: a.x + 5 }));
  const tick = () => vi.advanceTimersByTime(250);

  it("weights edges by relationship for ForceAtlas2", () => {
    mount(sampleGraph());
    const w = h.fa2.getEdgeWeight;
    expect(w("e", { edgeType: "IN_PROJECT" })).toBe(5);
    expect(w("e", { edgeType: "TAGGED" })).toBe(3);
    expect(w("e", { edgeType: "ABOUT" })).toBe(0.5);
    expect(w("e", { edgeType: "SUPERSEDES" })).toBe(1);
    expect(h.fa2.settings).toMatchObject({ linLogMode: true, barnesHutOptimize: true });
  });

  it("starts on mount and stops after two calm samples in a row", () => {
    const g = sampleGraph();
    mount(g);
    expect(h.start).toHaveBeenCalledTimes(1);
    jolt(g);
    tick(); // moving
    tick(); // calm 1
    expect(h.stop).not.toHaveBeenCalled();
    jolt(g);
    tick(); // moving again: calm resets
    tick(); // calm 1
    expect(h.stop).not.toHaveBeenCalled();
    tick(); // calm 2
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(noverlap.assign).toHaveBeenCalledTimes(1);
    // done: no more sampling
    tick();
    tick();
    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it("gives up waiting after fifteen seconds of movement", () => {
    const g = sampleGraph();
    mount(g);
    for (let i = 0; i < 59; i++) {
      jolt(g);
      tick();
    }
    expect(h.stop).not.toHaveBeenCalled();
    jolt(g);
    tick();
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(noverlap.assign).toHaveBeenCalledTimes(1);
  });

  it("restarts the layout when the version changes, and stops on unmount", () => {
    const g = sampleGraph();
    const { update, unmount } = mount(g);
    update({ version: 1 });
    expect(h.start).toHaveBeenCalledTimes(2);
    expect(h.stop).toHaveBeenCalledTimes(1); // cleanup of the previous run
    update({ hovered: "1" });
    expect(h.start).toHaveBeenCalledTimes(2);
    unmount();
    expect(h.stop).toHaveBeenCalledTimes(2);
    tick();
    tick();
    expect(noverlap.assign).not.toHaveBeenCalled();
  });

  it("separates discs in viewport space and leaves pinned nodes where they are", () => {
    const g = sampleGraph();
    g.setNodeAttribute("2", "fixed", true);
    mount(g);
    tick();
    tick();
    expect(noverlap.assign).toHaveBeenCalledTimes(1);
    const [graph, opts] = vi.mocked(noverlap.assign).mock.calls[0] as [Graph, any];
    expect(graph).toBe(g);
    expect(opts.settings.margin).toBe(4);
    expect(opts.inputReducer("4", g.getNodeAttributes("4"))).toEqual({ x: 20, y: 20, size: 12 });
    // a node sigma has no display data for falls back to its own size
    expect(opts.inputReducer("ghost", { x: 1, y: 1, size: 3 })).toEqual({ x: 2, y: 2, size: 3 });
    expect(opts.outputReducer("4", { x: 30, y: 50 })).toEqual({ x: 15, y: 25 });
    expect(opts.outputReducer("2", { x: 30, y: 50 })).toEqual({ x: 10, y: 0 });
  });

  it("centres on a new focus once settled, and only once", () => {
    const g = sampleGraph();
    const { update } = mount(g);
    tick();
    tick();
    expect(h.goto).not.toHaveBeenCalled();

    const focus: Focus = { id: 4, nonce: 1 };
    update({ focus, version: 1 });
    tick();
    expect(h.goto).not.toHaveBeenCalled(); // not before the layout has settled
    tick();
    expect(h.goto).toHaveBeenCalledTimes(1);
    expect(h.goto).toHaveBeenCalledWith({ x: 10, y: 10, ratio: 0.25 }, { duration: 600 });

    // a later merge must not yank the camera back to the old target
    update({ version: 2 });
    tick();
    tick();
    expect(h.goto).toHaveBeenCalledTimes(1);

    // searching the same node again (new nonce) moves the camera again
    update({ focus: { id: 4, nonce: 2 }, version: 3 });
    tick();
    tick();
    expect(h.goto).toHaveBeenCalledTimes(2);
  });

  it("does not restart the layout for a focus change alone", () => {
    const g = sampleGraph();
    const { update } = mount(g);
    tick();
    tick();
    update({ focus: { id: 4, nonce: 1 } });
    tick();
    tick();
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.goto).not.toHaveBeenCalled();
  });

  it("skips centring on a focused node that is no longer in the graph", () => {
    const g = sampleGraph();
    const { update } = mount(g);
    update({ focus: { id: 99, nonce: 1 }, version: 1 });
    tick();
    tick();
    expect(h.goto).not.toHaveBeenCalled();
  });

  it("refits the camera after a pruning action, in place of any focus move", () => {
    const g = sampleGraph();
    const { update } = mount(g);
    update({ fit: 1, focus: { id: 4, nonce: 1 } });
    expect(h.start).toHaveBeenCalledTimes(2);
    tick();
    tick();
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.reset).toHaveBeenCalledWith({ duration: 600 });
    expect(h.goto).not.toHaveBeenCalled();

    // the fit nonce is consumed: the next settle centres on the pending focus
    update({ version: 1 });
    tick();
    tick();
    expect(h.reset).toHaveBeenCalledTimes(1);
    expect(h.goto).toHaveBeenCalledTimes(1);
  });
});
