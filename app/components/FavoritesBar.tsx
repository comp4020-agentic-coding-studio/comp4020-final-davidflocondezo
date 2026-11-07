"use client";

import type { SearchResult } from "./LocationSearch.tsx";

export interface FavoritesBarProps {
  favorites: SearchResult[];
  onSelect: (place: SearchResult) => void;
  onRemove: (geohash: string) => void;
}

// Renders nothing with zero favorites, rather than an empty placeholder row
// — a visitor who's never starred anywhere shouldn't see a UI element for a
// feature they haven't used yet.
export default function FavoritesBar({ favorites, onSelect, onRemove }: FavoritesBarProps) {
  if (favorites.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
      {favorites.map((f) => (
        <span
          key={f.geohash}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            border: "1px solid #ccc",
            borderRadius: "999px",
            padding: "0.25rem 0.5rem 0.25rem 0.75rem",
            fontSize: "0.9rem",
          }}
        >
          <button
            type="button"
            onClick={() => onSelect(f)}
            style={{ border: "none", background: "none", padding: 0, font: "inherit", cursor: "pointer" }}
          >
            {f.name}
            {f.state ? `, ${f.state}` : ""}
          </button>
          <button
            type="button"
            aria-label={`Remove ${f.name} from favorites`}
            title="Remove from favorites"
            onClick={() => onRemove(f.geohash)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "1.1rem",
              height: "1.1rem",
              borderRadius: "50%",
              border: "none",
              background: "none",
              color: "#888",
              cursor: "pointer",
              padding: 0,
            }}
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}
