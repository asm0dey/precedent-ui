import {
  SigmaContainer,
  ControlsContainer,
  FullScreenControl,
  ZoomControl,
  useSigma,
  useRegisterEvents,
} from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import { LayoutForceAtlas2Control } from "@react-sigma/layout-forceatlas2";
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
        // e.event.x/y are container-relative; the menu now positions with a fixed
        // viewport coordinate (it also opens from the Detail panel's actions button,
        // outside the canvas container), so convert to viewport space here.
        const rect = sigma.getContainer().getBoundingClientRect();
        onContextMenu(Number(e.node), rect.left + e.event.x, rect.top + e.event.y);
      },
      enterNode: (e) => onHover(e.node),
      leaveNode: () => onHover(null),
      downNode: (e) => {
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
  onSelect,
  onDoubleClick,
  onContextMenu,
  onHover,
  onPin,
}: {
  graph: Graph;
  mode: Mode;
  hovered: string | null;
} & CanvasHandlers) {
  const t = tokens(mode);
  return (
    <SigmaContainer
      graph={graph}
      style={{ height: "100%", width: "100%", background: t.bg }}
      settings={{ allowInvalidContainer: true, defaultEdgeType: "arrow", labelDensity: 0.2 }}
    >
      <Reducers mode={mode} hovered={hovered} />
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
        <LayoutForceAtlas2Control autoRunFor={1000} />
      </ControlsContainer>
      <ControlsContainer position="bottom-left">
        <MiniMap width="120px" height="120px" />
      </ControlsContainer>
    </SigmaContainer>
  );
}
