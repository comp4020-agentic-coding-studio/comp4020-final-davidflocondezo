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

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      void fetch(`/api/bom/search?q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`search failed: ${res.status}`);
          return res.json() as Promise<SearchResult[]>;
        })
        .then((data) => {
          setResults(data);
          setError(null);
        })
        .catch((err: unknown) => setError(String(err)));
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  return (
    <div style={{ position: "relative" }}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for a location..."
        style={{ width: "100%", padding: "0.5rem", fontSize: "1rem" }}
      />
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
