// First-pass station list, for the "nearest radar site" label only — the
// radar imagery itself is RainViewer's global tile layer (see lib/radar.ts),
// not a per-station image, so a wrong id here only mislabels the nearest
// site, it can't break the map. IDR713 (Sydney/Terrey Hills) was confirmed
// against bom.gov.au; the rest are not yet individually re-checked.
export interface RadarStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export const RADAR_STATIONS: RadarStation[] = [
  { id: "IDR713", name: "Sydney (Terrey Hills)", lat: -33.7008, lon: 151.2094 },
  { id: "IDR022", name: "Melbourne (Laverton)", lat: -37.8553, lon: 144.754 },
  { id: "IDR663", name: "Brisbane (Mt Stapylton)", lat: -27.7178, lon: 153.2403 },
  { id: "IDR703", name: "Perth (Serpentine)", lat: -32.3908, lon: 115.8667 },
  { id: "IDR643", name: "Adelaide (Buckland Park)", lat: -34.6169, lon: 138.469 },
  { id: "IDR763", name: "Hobart (Mt Koonya)", lat: -43.1122, lon: 147.8057 },
  { id: "IDR633", name: "Darwin (Berrimah)", lat: -12.4575, lon: 130.9253 },
  { id: "IDR403", name: "Canberra (Captains Flat)", lat: -35.6616, lon: 149.5122 },
];

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestStation(lat: number, lon: number): RadarStation {
  return RADAR_STATIONS.reduce((best, s) =>
    haversineKm(lat, lon, s.lat, s.lon) < haversineKm(lat, lon, best.lat, best.lon) ? s : best,
  );
}
