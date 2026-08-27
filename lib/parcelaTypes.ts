// Poligonul parcelei e stocat ca GeoJSON Polygon cu coordonate GPS reale
// [longitudine, latitudine] (convenția GeoJSON), ring închis (primul punct
// repetat la final). Se desenează direct pe harta satelit — vezi FarmMap.tsx.
//
// Notă: parcelele desenate în versiunea veche a aplicației (coordonate 0..1
// relative la o imagine încărcată manual) au coordonate complet diferite ca
// scară — bounding-box-ul de mai jos le filtrează automat ca "nedesenate",
// ca să nu apară poligoane absurde undeva în Golful Guineei.
export type PoligonHarta = {
  type: 'Polygon';
  coordinates: number[][][]; // [ring][punct][lon, lat]
};

export type Parcela = {
  id: string;
  ferma_id: string;
  nume: string;
  tip_gazon: string | null;
  stadiu: string | null;
  suprafata_mp: number | null;
  poligon_harta: PoligonHarta | null;
};

// Bounding box larg pentru România (cu marjă) — orice poligon în afara lui
// e aproape sigur o rămășiță din formatul vechi (pixeli 0..1), nu GPS real.
const RO_LAT_MIN = 42;
const RO_LAT_MAX = 50;
const RO_LON_MIN = 18;
const RO_LON_MAX = 32;

export function polygonLatLngs(parcela: Parcela): [number, number][] {
  const ring = parcela.poligon_harta?.coordinates?.[0];
  if (!ring || ring.length < 3) return [];

  const latLngs: [number, number][] = ring.map(([lon, lat]) => [lat, lon]);
  const plauzibil = latLngs.every(
    ([lat, lon]) => lat >= RO_LAT_MIN && lat <= RO_LAT_MAX && lon >= RO_LON_MIN && lon <= RO_LON_MAX,
  );

  return plauzibil ? latLngs : [];
}

export function areContur(parcela: Parcela): boolean {
  return polygonLatLngs(parcela).length >= 3;
}

export function centroidLatLng(latLngs: [number, number][]): [number, number] | null {
  if (latLngs.length === 0) return null;
  const sum = latLngs.reduce((acc, [lat, lon]) => [acc[0] + lat, acc[1] + lon], [0, 0]);
  return [sum[0] / latLngs.length, sum[1] / latLngs.length];
}

export const PARCELA_COLORS = [
  { fill: 'rgba(66, 153, 82, 0.35)', stroke: '#2f7d3d' },
  { fill: 'rgba(48, 112, 196, 0.35)', stroke: '#1f4e8c' },
  { fill: 'rgba(196, 122, 48, 0.35)', stroke: '#8c5a1f' },
  { fill: 'rgba(138, 63, 196, 0.35)', stroke: '#6a2f8c' },
  { fill: 'rgba(196, 63, 130, 0.35)', stroke: '#8c2f60' },
];
