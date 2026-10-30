// lib/inventarMasaVerde.ts
//
// 2026-10-30 (Radu): "Inventar masă verde" — evidența gazonului rămas de
// recoltat, măsurat cu SW Maps pe fiecare parcelă. Un inventar = un import
// (fermă + dată); se păstrează istoricul, iar importul NU modifică parcelele
// (tabela `parcele` rămâne neatinsă). Tabele: inventar_masa_verde,
// inventar_masa_verde_parcele (vezi supabase/schema-inventar-masa-verde.sql).

import { proiectieLocala } from './geo';

export type PoligonGeoJson = { type: 'Polygon'; coordinates: number[][][] };

export type Inventar = {
  id: string;
  ferma_id: string;
  data_inventar: string; // YYYY-MM-DD
  nota: string | null;
  nume_fisier: string | null;
  created_at: string;
};

export type RandInventar = {
  id: string;
  inventar_id: string;
  parcela_id: string | null;
  nume_parcela: string;
  suprafata_totala_mp: number | null;
  poligon_parcela: PoligonGeoJson | null;
  suprafata_masa_verde_mp: number;
  poligon_masa_verde: PoligonGeoJson;
};

export type GrupParcela = {
  cheie: string;
  nume: string;
  totalMp: number | null;
  masaVerdeMp: number;
  poligonParcela: PoligonGeoJson | null;
  poligoaneMasaVerde: PoligonGeoJson[];
};

const colatorNume = new Intl.Collator('ro', { numeric: true });

// Grupează rândurile inventarului pe parcelă (aceeași parcelă poate avea mai multe
// contururi măsurate — suprafețele se adună), sortate după nume (1, 2, 10...).
export function grupeazaPeParcela(randuri: RandInventar[]): GrupParcela[] {
  const grupuri = new Map<string, GrupParcela>();
  for (const r of randuri) {
    const cheie = r.parcela_id ?? `nume:${r.nume_parcela}`;
    let g = grupuri.get(cheie);
    if (!g) {
      g = {
        cheie,
        nume: r.nume_parcela,
        totalMp: r.suprafata_totala_mp,
        masaVerdeMp: 0,
        poligonParcela: r.poligon_parcela,
        poligoaneMasaVerde: [],
      };
      grupuri.set(cheie, g);
    }
    g.masaVerdeMp += Number(r.suprafata_masa_verde_mp);
    g.poligoaneMasaVerde.push(r.poligon_masa_verde);
  }
  return Array.from(grupuri.values()).sort((a, b) => colatorNume.compare(a.nume, b.nume));
}

export type DesenSvg = {
  viewBox: string;
  cale: (poligon: PoligonGeoJson) => string;
  latimeM: number;
  inaltimeM: number;
  x0: number;
  yJos: number;
  unit: number; // 1% din cea mai mare dimensiune (m), pentru dimensiuni relative (text, săgeată)
};

// Proiecție plană comună (metri) pentru conturul parcelei și conturul măsurat, cu nordul în sus.
export function pregatesteDesen(poligoane: PoligonGeoJson[]): DesenSvg | null {
  const inele = poligoane
    .map((p) => (p.coordinates?.[0] ?? []).map(([lon, lat]) => [lat, lon] as [number, number]))
    .filter((r) => r.length >= 3);
  if (inele.length === 0) return null;

  const toate = inele.flat();
  const proiectate = proiectieLocala(toate);
  const xs = proiectate.map((p) => p[0]);
  const ys = proiectate.map((p) => -p[1]); // y SVG crește în jos
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const latime = Math.max(maxX - minX, 1);
  const inaltime = Math.max(maxY - minY, 1);
  const pad = Math.max(latime, inaltime) * 0.06;

  // Poziția fiecărui inel în lista proiectată (aceeași ordine ca la `inele`).
  const cai = new Map<PoligonGeoJson, string>();
  let offset = 0;
  const listaValida = poligoane.filter((p) => (p.coordinates?.[0] ?? []).length >= 3);
  inele.forEach((inel, i) => {
    const puncte = proiectate.slice(offset, offset + inel.length);
    offset += inel.length;
    cai.set(
      listaValida[i],
      'M' + puncte.map(([x, y]) => `${(x - minX + pad).toFixed(2)},${(-y - minY + pad).toFixed(2)}`).join('L') + 'Z',
    );
  });

  return {
    viewBox: `0 0 ${(latime + 2 * pad).toFixed(2)} ${(inaltime + 2 * pad).toFixed(2)}`,
    cale: (p) => cai.get(p) ?? '',
    latimeM: latime + 2 * pad,
    inaltimeM: inaltime + 2 * pad,
    x0: pad,
    yJos: inaltime + pad,
    unit: Math.max(latime, inaltime) / 100,
  };
}

// Lungime „frumoasă” pentru bara de scară (m), cel mult ~30% din lățimea desenului.
export function lungimeScara(latimeM: number): number {
  const optiuni = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  const tinta = latimeM * 0.3;
  let alege = optiuni[0];
  for (const o of optiuni) if (o <= tinta) alege = o;
  return alege;
}

export function formatMp(n: number): string {
  return Math.round(n).toLocaleString('ro-RO');
}

export function formatHa(mp: number): string {
  return (mp / 10000).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDataLunga(dataIso: string): string {
  return new Date(`${dataIso}T12:00:00`).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
}
