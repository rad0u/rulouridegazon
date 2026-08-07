export type PoligonHarta = {
  type: 'Polygon';
  coordinates: number[][][]; // fracții 0..1 din lățimea/înălțimea imaginii, ring închis
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

export type Point = { x: number; y: number };

export function polygonPoints(parcela: Parcela): Point[] {
  const ring = parcela.poligon_harta?.coordinates?.[0];
  if (!ring) return [];
  return ring.map(([x, y]) => ({ x, y }));
}

export function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0.5, y: 0.5 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export const PARCELA_COLORS = [
  { fill: 'rgba(66, 153, 82, 0.35)', stroke: '#2f7d3d' },
  { fill: 'rgba(48, 112, 196, 0.35)', stroke: '#1f4e8c' },
  { fill: 'rgba(196, 122, 48, 0.35)', stroke: '#8c5a1f' },
  { fill: 'rgba(138, 63, 196, 0.35)', stroke: '#6a2f8c' },
  { fill: 'rgba(196, 63, 130, 0.35)', stroke: '#8c2f60' },
];
