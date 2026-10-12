// Unități de măsură admise pentru substanțe și materii prime: litru, kilogram, bucată.
// Cantitățile se țin în DB mereu în unitatea de bază; subunitățile (ml, g) sunt doar pentru introducere.

export const UNITATI_BAZA = ['l', 'kg', 'buc'] as const;
export type UnitateBaza = (typeof UNITATI_BAZA)[number];

export type OptiuneUm = { um: string; factor: number };

const SUBUNITATI: Record<string, OptiuneUm[]> = {
  l: [{ um: 'ml', factor: 0.001 }],
  kg: [{ um: 'g', factor: 0.001 }],
  buc: [],
};

/** Opțiunile de introducere pentru o unitate de bază: baza (factor 1) + subunitățile ei. */
export function optiuniUm(baza: string): OptiuneUm[] {
  return [{ um: baza, factor: 1 }, ...(SUBUNITATI[baza] ?? [])];
}

/** Interpretează un text cu zecimale cu punct sau virgulă. Returnează NaN dacă nu e număr valid. */
export function parseazaNumar(text: string): number {
  const t = text.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(t)) return Number.NaN;
  return Number(t);
}

/** Convertește o cantitate introdusă în `um` în unitatea de bază (ex. 250 ml → 0,25 l). */
export function inBaza(valoare: number, um: string, baza: string): number {
  const opt = optiuniUm(baza).find((o) => o.um === um);
  const factor = opt ? opt.factor : 1;
  // rotunjire la 6 zecimale ca să nu rămână resturi de virgulă mobilă (3 × 0,001)
  return Math.round(valoare * factor * 1e6) / 1e6;
}

/** Afișează o cantitate din baza de date: 0.25 → "0,25". */
export function formateazaCantitate(valoare: number): string {
  return String(Math.round(valoare * 1e6) / 1e6).replace('.', ',');
}
