import {
  SigmaContainer,
  ControlsContainer,
  FullScreenControl,
  ZoomControl,
  useCamera,
  useSigma,
  useRegisterEvents,
} from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import {
  LayoutForceAtlas2Control,
  useWorkerLayoutForceAtlas2,
} from "@react-sigma/layout-forceatlas2";
import { MiniMap } from "@react-sigma/minimap";
import Graph from "graphology";
import { useEffect, useRef } from "react";
import { drawDiscNodeHover } from "sigma/rendering";
import { HOVER_LABEL_INK, edgePaint, nodePaint, tokens, type Mode } from "../skin";

/** Theme, status and hover all live in the reducers, so neither a theme flip nor
 * the precedent skin ever rewrites graph attributes — they only read them. */
function Reducers({ mode, hovered }: { mode: Mode; hovered: string | null }) {
  const sigma = useSigma();
  useEffect(() => {
    const t = tokens(mode);

    // Label rendering is sigma's, not the reducers': it paints node and edge
    // labels with its own default of #000, which is unreadable on the dark
    // canvas. Set it here so it flips with the theme like everything else.
    sigma.setSetting("labelColor", { color: t.text });
    sigma.setSetting("edgeLabelColor", { color: t.text });
    sigma.setSetting("defaultDrawNodeHover", (context, data, settings) =>
      drawDiscNodeHover(context, data, {
        ...settings,
        labelColor: { color: HOVER_LABEL_INK },
      }),
    );

    sigma.setSetting("nodeReducer", (node, data) => {
      const base = {
        ...data,
        // Status is visual: `superseded` fades, `regretted` turns the regret
        // warning colour. Both come from the node's own `status` attribute.
        color: nodePaint(t, data.nodeLabel as string, data.status as string),
        zIndex: data.status === "superseded" ? 0 : 1,
      };
      // `hovered` can outlive the node it names: sigma emits no `leaveNode`
      // when a node is removed, and hiding a hovered node (the context menu
      // swallows the mousemove) would otherwise raise NotFoundGraphError here
      // once per remaining node.
      const graph = sigma.getGraph();
      if (!hovered || !graph.hasNode(hovered)) return base;
      const neighbours = graph.neighbors(hovered);
      if (node === hovered || neighbours.includes(node)) return { ...base, highlighted: true };
      return { ...base, color: t.edge, label: "" };
    });
    sigma.setSetting("edgeReducer", (edge, data) => {
      // DIVERGES_FROM and REGRETS are drawn as warnings, not read from a panel.
      const base = { ...data, color: edgePaint(t, data.edgeType as string) };
      const graph = sigma.getGraph();
      if (!hovered || !graph.hasNode(hovered)) return base;
      return graph.extremities(edge).includes(hovered) ? base : { ...base, hidden: true };
    });
    sigma.refresh();
  }, [sigma, mode, hovered]);
  return null;
}

/**
 * Runs ForceAtlas2 for a moment whenever the working set changes.
 *
 * Without this the layout only ran once at mount, so every search hit and every
 * expansion landed at a random position and stayed there until you found the
 * play button in the corner and pressed it yourself. Merging is the whole
 * interaction here, so settling after a merge is the tool's job, not yours.
 *
 * Pinned nodes carry `fixed: true` and are left where you put them.
 */
const SETTLE_MS = 1500;
/** How far in to zoom when centring on a node. Lower is closer. */
const FOCUS_RATIO = 0.25;

function AutoLayout({
  version,
  focus,
  fit,
}: {
  version: number;
  focus: Focus | null;
  fit: number;
}) {
  const { start, stop } = useWorkerLayoutForceAtlas2({ settings: { slowDown: 10 } });
  const { goto, reset } = useCamera();
  const sigma = useSigma();
  // Read inside the settle callback rather than as an effect dependency: a new
  // focus must not restart the layout, and a merge must not re-centre the camera.
  const pending = useRef<Focus | null>(null);
  pending.current = focus;
  // A pruning action leaves a handful of nodes scattered outside a camera that
  // was zoomed in somewhere else; fitting afterwards is what makes the result
  // visible. Tracked by nonce so repeating the action refits.
  const lastFit = useRef(fit);
  // Both camera moves are ONE-SHOT, consumed by nonce. Without this the focus
  // target is sticky: every later settle — after an expansion, after a prune —
  // re-centres on whatever was last searched for, so the camera keeps yanking
  // back to an old node while you are working somewhere else.
  const lastFocus = useRef(focus?.nonce ?? 0);

  useEffect(() => {
    start();
    const timer = setTimeout(() => {
      stop();
      // Centre only once the layout has finished moving things. Doing it at
      // merge time would aim the camera at the random position a new node is
      // seeded with, and land on empty space a second later.
      if (lastFit.current !== fit) {
        lastFit.current = fit;
        reset({ duration: 600 });
        return;
      }
      const want = pending.current;
      if (!want || want.nonce === lastFocus.current) return;
      lastFocus.current = want.nonce;
      const d = sigma.getNodeDisplayData(String(want.id));
      if (d) goto({ x: d.x, y: d.y, ratio: FOCUS_RATIO }, { duration: 600 });
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [version, start, stop, goto, reset, sigma, fit]);

  return null;
}

/** A request to centre the camera on a node. */
export type Focus = { id: number; nonce: number };

export type CanvasHandlers = {
  onSelect: (id: number) => void;
  onDoubleClick: (id: number) => void;
  onContextMenu: (id: number, x: number, y: number) => void;
  onHover: (id: string | null) => void;
  onPin: (id: string) => void;
};

/**
 * Gesture wiring lives in its own child so it can call `useRegisterEvents` /
 * `useSigma` — both require a component mounted inside `SigmaContainer`.
 *
 * Dragging bypasses React state entirely: `mousemovebody` writes x/y/fixed
 * straight onto the graphology graph, which sigma already listens to. Routing
 * a live drag through React state would re-render on every mouse move.
 */
function Events({ onSelect, onDoubleClick, onContextMenu, onHover, onPin }: CanvasHandlers) {
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();
  const dragged = useRef<string | null>(null);
  // Only a real drag pins — a plain click also goes through downNode/mouseup
  // but must not mark the node pinned without any movement in between.
  const moved = useRef(false);

  useEffect(() => {
    registerEvents({
      clickNode: (e) => onSelect(Number(e.node)),
      doubleClickNode: (e) => onDoubleClick(Number(e.node)),
      rightClickNode: (e) => {
        e.preventSigmaDefault();
        // preventSigmaDefault only stops sigma's own handling. Sigma binds a
        // `contextmenu` listener and, unlike its double-click handler, never
        // calls preventDefault on it — so without this the browser's native
        // menu opens on top of ours (visible in Firefox in particular).
        e.event.original.preventDefault();
        // Belt and braces: whatever armed a drag, opening the menu ends it.
        dragged.current = null;
        moved.current = false;
        // e.event.x/y are container-relative; the menu now positions with a fixed
        // viewport coordinate (it also opens from the Detail panel's actions button,
        // outside the canvas container), so convert to viewport space here.
        const rect = sigma.getContainer().getBoundingClientRect();
        onContextMenu(Number(e.node), rect.left + e.event.x, rect.top + e.event.y);
      },
      enterNode: (e) => onHover(e.node),
      leaveNode: () => onHover(null),
      downNode: (e) => {
        // Primary button only. A right-click also raises downNode, and the
        // context menu that follows swallows the mouseup — so the node stayed
        // armed and the next mouse move dragged it around. Touch events carry
        // no `button`; those are always a primary interaction.
        const src = e.event.original;
        if ("button" in src && src.button !== 0) return;
        dragged.current = e.node;
        moved.current = false;
      },
      mousemovebody: (e) => {
        const node = dragged.current;
        if (!node) return;
        const pos = sigma.viewportToGraph(e);
        const g = sigma.getGraph();
        g.setNodeAttribute(node, "x", pos.x);
        g.setNodeAttribute(node, "y", pos.y);
        g.setNodeAttribute(node, "fixed", true);
        moved.current = true;
        e.preventSigmaDefault();
      },
      mouseup: () => {
        if (dragged.current && moved.current) onPin(dragged.current);
        dragged.current = null;
        moved.current = false;
      },
    });
  }, [registerEvents, sigma, onSelect, onDoubleClick, onContextMenu, onHover, onPin]);

  return null;
}

export function Canvas({
  graph,
  mode,
  hovered,
  version,
  focus,
  fit,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onHover,
  onPin,
}: {
  graph: Graph;
  mode: Mode;
  hovered: string | null;
  /** Bumped on every merge; drives the settle-after-change layout run. */
  version: number;
  /** Node to centre on once the layout settles. The nonce lets the same node be
   * re-focused — searching for it twice should move the camera twice. */
  focus: Focus | null;
  /** Bumped to refit the camera around whatever is left after a pruning action. */
  fit: number;
} & CanvasHandlers) {
  const t = tokens(mode);
  return (
    <SigmaContainer
      graph={graph}
      style={{ height: "100%", width: "100%", background: t.bg }}
      settings={{ allowInvalidContainer: true, defaultEdgeType: "arrow", labelDensity: 0.2 }}
    >
      <Reducers mode={mode} hovered={hovered} />
      <AutoLayout version={version} focus={focus} fit={fit} />
      <Events
        onSelect={onSelect}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onHover={onHover}
        onPin={onPin}
      />
      <ControlsContainer position="bottom-right">
        <ZoomControl />
        <FullScreenControl />
        <LayoutForceAtlas2Control />
      </ControlsContainer>
      <ControlsContainer position="bottom-left">
        <MiniMap width="120px" height="120px" />
      </ControlsContainer>
    </SigmaContainer>
  );
}
