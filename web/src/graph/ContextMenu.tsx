import type { Degree } from "../api";

export type ContextMenuAction =
  | { kind: "expand"; degree: Degree }
  | { kind: "expand-all" }
  | { kind: "collapse" }
  | { kind: "pin" }
  | { kind: "focus" }
  | { kind: "hide" }
  | { kind: "copy-key" };

export function ContextMenu({
  at,
  nodeId,
  degrees,
  onAction,
  onClose,
}: {
  at: { x: number; y: number } | null;
  nodeId: number;
  degrees: Degree[];
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}) {
  if (!at) return null;
  return (
    <ul
      className="context-menu"
      style={{ left: at.x, top: at.y }}
      onMouseLeave={onClose}
      data-node-id={nodeId}
    >
      <li className="submenu">
        expand ▸
        <ul>
          {degrees.map((d) => (
            <li key={`${d.type}-${d.dir}`} onClick={() => onAction({ kind: "expand", degree: d })}>
              {d.dir === "out" ? `${d.type} ▸` : `◂ ${d.type}`} {d.count}
            </li>
          ))}
          <li onClick={() => onAction({ kind: "expand-all" })}>all</li>
        </ul>
      </li>
      <li onClick={() => onAction({ kind: "collapse" })}>collapse</li>
      <li className="sep" />
      <li onClick={() => onAction({ kind: "pin" })}>pin / unpin</li>
      <li onClick={() => onAction({ kind: "focus" })}>focus (hide others)</li>
      <li onClick={() => onAction({ kind: "hide" })}>hide</li>
      <li className="sep" />
      <li onClick={() => onAction({ kind: "copy-key" })}>copy domain key</li>
    </ul>
  );
}
