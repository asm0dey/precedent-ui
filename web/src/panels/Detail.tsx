import { useEffect, useState } from "react";
import { getNode, type NodeDetail } from "../api";

export function Detail({
  nodeId,
  refreshedAt,
  more,
  onExpand,
  onOpenMenu,
  menuOpen,
}: {
  nodeId: number | null;
  // Bumped by App after a graph refresh, so this re-fetches fresh degrees
  // for the still-selected node even though `nodeId` itself didn't change.
  refreshedAt: number;
  more: Record<string, number>;
  onExpand: (type: string, dir: "out" | "in", offset?: number) => void;
  onOpenMenu: (x: number, y: number) => void;
  menuOpen: boolean;
}) {
  const [n, setN] = useState<NodeDetail | null>(null);

  useEffect(() => {
    if (nodeId === null) {
      setN(null);
      return;
    }
    let live = true;
    getNode(nodeId)
      .then((detail) => {
        if (live) setN(detail);
      })
      .catch(() => {
        if (live) setN(null);
      });
    return () => {
      live = false;
    };
  }, [nodeId, refreshedAt]);

  if (nodeId === null || !n) return <div className="detail-empty">nothing selected</div>;

  const label = n.labels[0];
  const p = n.props as Record<string, string>;
  const superseded = p.status === "superseded";

  return (
    <div className={`detail${superseded ? " superseded" : ""}`}>
      <div className="detail-header">
        <span className={`chip ${label}`}>{label}</span>
        <button
          type="button"
          className="detail-actions-btn"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onOpenMenu(r.left, r.bottom);
          }}
        >
          actions ▾
        </button>
      </div>
      <h2>{n.caption}</h2>
      {label === "Decision" && (
        <>
          {p.statement && <p className="statement">{p.statement}</p>}
          {/* The rationale leads: the what is recoverable from the code, the why is not.
              Omitted entirely when absent — an empty "rationale" heading reads as
              "this decision has no reason", which is not what a missing field means. */}
          {p.rationale && (
            <section className="rationale">
              <h3>rationale</h3>
              <p>{p.rationale}</p>
            </section>
          )}
          {p.despite && (
            <section className="despite">
              <h3>despite precedent</h3>
              <p>{p.despite}</p>
            </section>
          )}
          <dl className="meta">
            <dt>scope</dt>
            <dd>{p.scope}</dd>
            <dt>status</dt>
            <dd className={`status-${p.status}`}>{p.status}</dd>
            <dt>created</dt>
            <dd>{p.created}</dd>
          </dl>
        </>
      )}
      <section className="expand">
        <h3>expand</h3>
        <ul className="expand-list">
          {n.degrees.map((d) => {
            const key = `${n.id}-${d.type}-${d.dir}`;
            const remaining = more[key];
            const shown = remaining === undefined ? undefined : d.count - remaining;
            return (
              <li key={key} className="expand-row">
                <button
                  type="button"
                  className="chip-expand"
                  onClick={() => onExpand(d.type, d.dir)}
                >
                  {d.dir === "out" ? `${d.type} ▸` : `◂ ${d.type}`} {d.count}
                </button>
                {remaining !== undefined && remaining > 0 && (
                  <button
                    type="button"
                    className="more-link"
                    onClick={() => onExpand(d.type, d.dir, shown)}
                  >
                    +{remaining} more
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
