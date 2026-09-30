import { useEffect, useRef, useState } from "react";
import { search, type Hit } from "../api";

export function Search({ onPick }: Readonly<{ onPick: (h: Hit) => void }>) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      setError(null);
      return;
    }
    const mine = ++seq.current; // this render's request generation
    const timer = setTimeout(() => {
      search(q)
        .then((r) => {
          if (mine !== seq.current) return; // a newer query has since started
          setHits(r);
          setError(null);
        })
        .catch((e) => {
          if (mine !== seq.current) return;
          setError(String(e));
        });
    }, 200); // debounce: search is a scan on the server
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="search-panel">
      <input
        className="search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search…"
        aria-label="Search the decision graph"
      />
      {error && <div className="error">{error}</div>}
      <ul className="search-results">
        {hits.map((h) => (
          <li key={h.id}>
            <button type="button" className="search-hit" onClick={() => onPick(h)}>
              <span className={`chip ${h.labels[0]}`}>{h.labels[0]}</span>
              <strong>{h.caption}</strong>
              <small>
                {h.sub} · {h.degree} edges
              </small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
