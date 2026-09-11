import { useEffect, useState } from "react";
import { search, type Hit } from "../api";

export function Search({ onPick }: { onPick: (h: Hit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) return setHits([]);
    const timer = setTimeout(() => {
      search(q).then(setHits).catch((e) => setError(String(e)));
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
      />
      {error && <div className="error">{error}</div>}
      <ul className="search-results">
        {hits.map((h) => (
          <li key={h.id} onClick={() => onPick(h)}>
            <span className={`chip ${h.labels[0]}`}>{h.labels[0]}</span>
            <strong>{h.caption}</strong>
            <small>
              {h.sub} · {h.degree} edges
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}
