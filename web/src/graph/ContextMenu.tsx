import { useEffect, useRef } from "react";
import type { Degree } from "../api";

export type ContextMenuAction =
  | { kind: "expand"; degree: Degree }
  | { kind: "expand-all" }
  | { kind: "collapse"; depth: number }
  | { kind: "pin" }
  | { kind: "hide" }
  | { kind: "copy-key" };

type Row =
  | { kind: "heading"; text: string }
  | { kind: "sep" }
  | {
      kind: "item";
      label: string;
      action: ContextMenuAction;
      disabled?: boolean;
      title?: string;
    };

/**
 * A flat menu, not a nested submenu — the brief's illustrative markup nests "expand"
 * under its own `<ul>`, but a two-level keyboard menu needs its own ArrowRight/Left
 * open-close model and a focus trap per level. Flattening the degree rows into the
 * main list (under a non-interactive "expand" heading) keeps one roving-focus model
 * for the whole menu: ArrowUp/Down and wraparound work the same everywhere.
 */
function rowsFor(degrees: Degree[]): Row[] {
  return [
    { kind: "heading", text: "expand" },
    ...degrees.map(
      (d): Row => ({
        kind: "item",
        label: d.dir === "out" ? `${d.type} ▸ ${d.count}` : `◂ ${d.type} ${d.count}`,
        action: { kind: "expand", degree: d },
      }),
    ),
    { kind: "item", label: "all", action: { kind: "expand-all" } },
    { kind: "sep" },
    { kind: "heading", text: "keep only" },
    ...[1, 2, 3].map(
      (depth): Row => ({
        kind: "item",
        label: depth === 1 ? "this node + 1 hop" : `this node + ${depth} hops`,
        action: { kind: "collapse", depth },
        title: `drop everything more than ${depth} hop${depth === 1 ? "" : "s"} away`,
      }),
    ),
    { kind: "sep" },
    { kind: "item", label: "pin / unpin", action: { kind: "pin" } },
    { kind: "item", label: "hide", action: { kind: "hide" } },
    { kind: "sep" },
    { kind: "item", label: "copy domain key", action: { kind: "copy-key" } },
  ];
}

export function ContextMenu({
  at,
  nodeId,
  degrees,
  caption,
  onAction,
  onClose,
}: {
  at: { x: number; y: number } | null;
  nodeId: number;
  degrees: Degree[];
  caption: string;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  // What had focus before the menu opened, so it can be restored on close —
  // matters most for the keyboard entry point (Detail panel's actions button).
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (at) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      itemRefs.current[0]?.focus();
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current.focus();
      restoreFocusRef.current = null;
    }
  }, [at]);

  // Dismiss on a click outside — onMouseLeave alone leaves no way out for a menu
  // opened, then not exited, by keyboard or touch.
  useEffect(() => {
    if (!at) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [at, onClose]);

  if (!at) return null;

  const rows = rowsFor(degrees);
  let itemIndex = 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const items = itemRefs.current.filter((el): el is HTMLLIElement => el !== null);
    const current = items.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <ul
      ref={rootRef}
      className="context-menu"
      style={{ left: at.x, top: at.y }}
      role="menu"
      aria-label={`Actions for ${caption}`}
      onMouseLeave={onClose}
      onKeyDown={onKeyDown}
      data-node-id={nodeId}
    >
      {rows.map((row, i) => {
        if (row.kind === "heading") {
          return (
            <li key={`h-${i}`} role="presentation" className="menu-heading">
              {row.text}
            </li>
          );
        }
        if (row.kind === "sep") {
          return <li key={`s-${i}`} role="separator" className="sep" />;
        }
        const idx = itemIndex++;
        // A disabled item keeps its place in the roving-focus order and stays
        // reachable, so a keyboard user can read why it is unavailable instead
        // of it silently vanishing from the menu.
        return (
          // NOSONAR below: Enter and Space are handled once, by the <ul>, for the
          // focused item (roving focus) — a listener per item would duplicate it.
          <li // NOSONAR
            key={`i-${i}`}
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={row.disabled || undefined}
            className={row.disabled ? "disabled" : undefined}
            title={row.title}
            onClick={() => {
              if (row.disabled) return;
              onAction(row.action);
            }}
          >
            {row.label}
          </li>
        );
      })}
    </ul>
  );
}
