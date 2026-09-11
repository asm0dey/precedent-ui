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
import { tokens, type Mode } from "../skin";

/** Theme and hover live in the reducers, so a theme flip never rewrites attributes. */
function Reducers({ mode, hovered }: { mode: Mode; hovered: string | null }) {
  const sigma = useSigma();
  useEffect(() => {
    const t = tokens(mode);
    sigma.setSetting("nodeReducer", (node, data) => {
      const base = {
        ...data,
        color: t.labelColor[data.nodeLabel as string] ?? t.edge,
        zIndex: data.status === "superseded" ? 0 : 1,
      };
      if (!hovered) return base;
      const neighbours = sigma.getGraph().neighbors(hovered);
      if (node === hovered || neighbours.includes(node)) return { ...base, highlighted: true };
      return { ...base, color: t.edge, label: "" };
    });
    sigma.setSetting("edgeReducer", (edge, data) => {
      const base = { ...data, color: t.edge };
      if (!hovered) return base;
      return sigma.getGraph().extremities(edge).includes(hovered)
        ? base
        : { ...base, hidden: true };
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
