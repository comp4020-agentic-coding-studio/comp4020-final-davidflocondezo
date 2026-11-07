"use client";

import { useEffect, useRef, useState } from "react";

export interface SearchResult {
  geohash: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export interface LocationSearchProps {
  onSelect: (result: SearchResult) => void;
}

export default function LocationSearch({ onSelect }: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function runSearch(q: string): void {
    void fetch(`/api/bom/search?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`search failed: ${res.status}`);
        return res.json() as Promise<SearchResult[]>;
      })
      .then((data) => {
        setResults(data);
        setError(null);
      })
      .catch((err: unknown) => setError(String(err)));
  }

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(() => runSearch(query), 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // The search button bypasses the debounce above (clearing any pending one
  // so it doesn't also fire moments later) for an immediate search on click,
  // rather than waiting out the same 300ms typing pause does.
  function handleSearchClick(): void {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 2) return;
    runSearch(query);
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a location..."
          style={{ flex: 1, padding: "0.5rem", fontSize: "1rem" }}
        />
        <button
          type="button"
          aria-label="Search"
          title="Search"
          onClick={handleSearchClick}
          style={{ display: "flex", alignItems: "center", padding: "0.5rem 0.75rem", flexShrink: 0 }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {results.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            position: "absolute",
            background: "white",
            border: "1px solid #ccc",
            width: "100%",
            zIndex: 1000,
          }}
        >
          {results.map((r) => (
            <li key={r.geohash}>
              <button
                type="button"
                onClick={() => {
                  onSelect(r);
                  setQuery(`${r.name}, ${r.state}`);
                  setResults([]);
                }}
                style={{ width: "100%", textAlign: "left", padding: "0.5rem", border: "none" }}
              >
                {r.name}, {r.state}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
