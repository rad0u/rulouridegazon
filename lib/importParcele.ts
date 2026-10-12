// lib/importParcele.ts
//
// 2026-10-09 (Radu): "putem gasi o solutie pentru desenarea/definirea
// parcelelor din ferme, astfel incat sa export coordonatele din swmaps, cu
// care le masor si sa le importam in aplicatie astfel incat sa iasa parcelele
// definite cat mai exact, conform cu masuratorile si nu la ochi?"
//
// Parsează un fișier exportat din SW Maps (sau orice alt GIS/GPS) în poligoane
// candidate pentru parcele. Formate acceptate (text): GeoJSON, KML, GPX, CSV
// (puncte cu coloane latitudine/longitudine). KMZ (arhivă zip) și Shapefile NU
// sunt acceptate direct -- se exportă ca KML sau GeoJSON.
//
// Coordonatele se păstrează cu precizia din fișier (nicio rotunjire/simplificare)
// și se așteaptă în WGS84 (lat/lon în grade, ca la orice export GPS/GNSS).
// Funcții pure, fără dependențe de browser (testabile în Node).

import { ariePoligonMp, perimetruPoligonM, proiectieLocala } from './geo';

export type CandidatPoligon = {
  cheie: string;
  nume: string; // gol dacă fișierul n-are nume
  ring: [number, number][]; // [lat, lon], NEdeschis (fără punctul de închidere)
  suprafataMp: number;
  perimetruM: number;
  sursa: string; // 'Polygon' | 'Linie' | 'Traseu' | 'Puncte CSV' | 'Puncte (waypoint)'
  valid: boolean; // false => nu se poate importa (vezi `avertismente`)
  avertismente: string[];
};

export type RezultatParsare = {
  format: 'GeoJSON' | 'KML' | 'GPX' | 'CSV';
  candidati: CandidatPoligon[];
  avertismente: string[];
};

// Bounding box larg pentru România (aceleași limite ca în parcelaTypes.ts).
const RO_LAT_MIN = 42;
const RO_LAT_MAX = 50;
const RO_LON_MIN = 18;
const RO_LON_MAX = 32;

type Brut = { nume: string; puncte: [number, number][]; sursa: string };

function numar(v: string | number | undefined | null): number {
  if (typeof v === 'number') return v;
  if (v === undefined || v === null) return NaN;
  return parseFloat(String(v).trim().replace(',', '.'));
}

function decodeEntitati(t: string): string {
  return t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

// ---------------------------------------------------------------- GeoJSON ---

function numeDinProps(props: unknown): string {
  if (!props || typeof props !== 'object') return '';
  const p = props as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (/^(name|nume|title|label|parcela|parcel|id)$/i.test(k) && p[k] !== null && p[k] !== '') {
      return String(p[k]);
    }
  }
  return '';
}

function brutDinGeometrie(g: any, nume: string, brute: Brut[]) {
  if (!g || typeof g !== 'object') return;
  const lonLat = (c: any): [number, number] => [Number(c[1]), Number(c[0])];
  switch (g.type) {
    case 'Polygon':
      if (Array.isArray(g.coordinates?.[0])) {
        brute.push({ nume, puncte: g.coordinates[0].map(lonLat), sursa: 'Polygon' });
      }
      break;
    case 'MultiPolygon':
      (g.coordinates ?? []).forEach((poly: any, i: number) => {
        if (Array.isArray(poly?.[0])) {
          brute.push({
            nume: nume && g.coordinates.length > 1 ? `${nume} (${i + 1})` : nume,
            puncte: poly[0].map(lonLat),
            sursa: 'Polygon',
          });
        }
      });
      break;
    case 'LineString':
      if (Array.isArray(g.coordinates)) brute.push({ nume, puncte: g.coordinates.map(lonLat), sursa: 'Linie' });
      break;
    case 'MultiLineString':
      (g.coordinates ?? []).forEach((l: any, i: number) => {
        brute.push({ nume: nume && g.coordinates.length > 1 ? `${nume} (${i + 1})` : nume, puncte: l.map(lonLat), sursa: 'Linie' });
      });
      break;
    case 'GeometryCollection':
      (g.geometries ?? []).forEach((gg: any) => brutDinGeometrie(gg, nume, brute));
      break;
    default:
      break; // Point/MultiPoint ignorate
  }
}

function parseazaGeoJson(text: string): Brut[] {
  const json = JSON.parse(text);
  const brute: Brut[] = [];
  const vizita = (n: any) => {
    if (!n) return;
    if (n.type === 'FeatureCollection') (n.features ?? []).forEach(vizita);
    else if (n.type === 'Feature') brutDinGeometrie(n.geometry, numeDinProps(n.properties), brute);
    else brutDinGeometrie(n, '', brute);
  };
  vizita(json);
  return brute;
}

// -------------------------------------------------------------------- KML ---

function punctiKml(coordText: string): [number, number][] {
  return coordText
    .trim()
    .split(/\s+/)
    .map((t) => t.split(','))
    .filter((p) => p.length >= 2)
    .map((p) => [numar(p[1]), numar(p[0])] as [number, number]); // lat, lon
}

function parseazaKml(text: string): Brut[] {
  const brute: Brut[] = [];
  const placemarks = text.match(/<(?:\w+:)?Placemark\b[\s\S]*?<\/(?:\w+:)?Placemark>/gi) ?? [];
  for (const pm of placemarks) {
    const nm = pm.match(/<(?:\w+:)?name\b[^>]*>([\s\S]*?)<\/(?:\w+:)?name>/i);
    const nume = nm ? decodeEntitati(nm[1]) : '';

    const poligoane = pm.match(/<(?:\w+:)?Polygon\b[\s\S]*?<\/(?:\w+:)?Polygon>/gi) ?? [];
    poligoane.forEach((pg, i) => {
      const exterior = pg.match(/<(?:\w+:)?outerBoundaryIs\b[\s\S]*?<\/(?:\w+:)?outerBoundaryIs>/i);
      const bloc = exterior ? exterior[0] : pg;
      const c = bloc.match(/<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/i);
      if (c) {
        brute.push({
          nume: nume && poligoane.length > 1 ? `${nume} (${i + 1})` : nume,
          puncte: punctiKml(c[1]),
          sursa: 'Polygon',
        });
      }
    });

    if (poligoane.length === 0) {
      const linii = pm.match(/<(?:\w+:)?LineString\b[\s\S]*?<\/(?:\w+:)?LineString>/gi) ?? [];
      linii.forEach((ln, i) => {
        const c = ln.match(/<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/i);
        if (c) {
          brute.push({
            nume: nume && linii.length > 1 ? `${nume} (${i + 1})` : nume,
            puncte: punctiKml(c[1]),
            sursa: 'Linie',
          });
        }
      });
    }
  }
  return brute;
}

// -------------------------------------------------------------------- GPX ---

function atribut(tag: string, nume: string): number {
  const m = tag.match(new RegExp(`\\b${nume}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return m ? numar(m[1]) : NaN;
}

function punctiGpx(bloc: string, tag: string): [number, number][] {
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  return (bloc.match(re) ?? []).map((t) => [atribut(t, 'lat'), atribut(t, 'lon')] as [number, number]);
}

function parseazaGpx(text: string): Brut[] {
  const brute: Brut[] = [];
  const nume = (bloc: string) => {
    const m = bloc.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i);
    return m ? decodeEntitati(m[1]) : '';
  };
  for (const trk of text.match(/<trk\b[\s\S]*?<\/trk>/gi) ?? []) {
    brute.push({ nume: nume(trk), puncte: punctiGpx(trk, 'trkpt'), sursa: 'Traseu' });
  }
  for (const rte of text.match(/<rte\b[\s\S]*?<\/rte>/gi) ?? []) {
    brute.push({ nume: nume(rte), puncte: punctiGpx(rte, 'rtept'), sursa: 'Traseu' });
  }
  if (brute.length === 0) {
    const wpt = punctiGpx(text, 'wpt');
    if (wpt.length >= 3) brute.push({ nume: '', puncte: wpt, sursa: 'Puncte (waypoint)' });
  }
  return brute;
}

// -------------------------------------------------------------------- CSV ---

function imparteLinieCsv(linie: string, delim: string): string[] {
  const out: string[] = [];
  let curent = '';
  let inChei = false;
  for (let i = 0; i < linie.length; i++) {
    const ch = linie[i];
    if (ch === '"') {
      if (inChei && linie[i + 1] === '"') {
        curent += '"';
        i++;
      } else inChei = !inChei;
    } else if (ch === delim && !inChei) {
      out.push(curent);
      curent = '';
    } else curent += ch;
  }
  out.push(curent);
  return out.map((c) => c.trim());
}

function parseazaCsv(text: string): { brute: Brut[]; avertismente: string[] } {
  const avertismente: string[] = [];
  const linii = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (linii.length < 2) throw new Error('Fișierul CSV pare gol.');

  const antet = linii[0];
  const delim = [';', '\t', ','].reduce((best, d) =>
    antet.split(d).length > antet.split(best).length ? d : best,
  );
  const cap = imparteLinieCsv(antet, delim).map((h) => h.toLowerCase());

  const idxLat = cap.findIndex((h) => /^(lat|latitude|latitudine|y)$/.test(h) || h.includes('latitud'));
  const idxLon = cap.findIndex(
    (h) => /^(lon|lng|long|longitude|longitudine|x)$/.test(h) || h.includes('longitud'),
  );
  const idxLatF = idxLat >= 0 ? idxLat : cap.findIndex((h) => h.includes('lat'));
  const idxLonF = idxLon >= 0 ? idxLon : cap.findIndex((h) => h.includes('lon') || h.includes('lng'));
  if (idxLatF < 0 || idxLonF < 0) {
    throw new Error('Nu am găsit coloanele de latitudine/longitudine în CSV (ex. „Latitude”, „Longitude”).');
  }
  const idxNume = cap.findIndex(
    (h, i) =>
      i !== idxLatF &&
      i !== idxLonF &&
      /^(name|nume|parcela|parcel|feature|feature name|feature_name|group|grup|poligon|polygon|layer|fid)$/.test(h),
  );

  const randuri = linii.slice(1).map((l) => imparteLinieCsv(l, delim));
  const grupuri = new Map<string, [number, number][]>();
  const toate: [number, number][] = [];
  for (const r of randuri) {
    const lat = numar(r[idxLatF]);
    const lon = numar(r[idxLonF]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    toate.push([lat, lon]);
    const k = idxNume >= 0 ? r[idxNume] ?? '' : '';
    if (!grupuri.has(k)) grupuri.set(k, []);
    grupuri.get(k)!.push([lat, lon]);
  }

  // coloane lat/lon inversate în fișier -> le întoarcem automat
  const inRo = (lat: number, lon: number) =>
    lat >= RO_LAT_MIN && lat <= RO_LAT_MAX && lon >= RO_LON_MIN && lon <= RO_LON_MAX;
  if (toate.length > 0 && !toate.every(([a, b]) => inRo(a, b)) && toate.every(([a, b]) => inRo(b, a))) {
    for (const p of toate) { const t = p[0]; p[0] = p[1]; p[1] = t; }
    for (const g of Array.from(grupuri.values())) for (const p of g) { const t = p[0]; p[0] = p[1]; p[1] = t; }
    avertismente.push('Coloanele latitudine/longitudine păreau inversate — le-am întors automat.');
  }

  const brute: Brut[] = [];
  const grupuriMari = Array.from(grupuri.entries()).filter(([, p]) => p.length >= 3);
  if (idxNume >= 0 && grupuriMari.length > 0) {
    for (const [k, puncte] of grupuriMari) brute.push({ nume: k, puncte, sursa: 'Puncte CSV' });
    const ignorate = grupuri.size - grupuriMari.length;
    if (ignorate > 0) avertismente.push(`${ignorate} grup(uri) cu mai puțin de 3 puncte au fost ignorate.`);
  } else {
    if (idxNume >= 0) {
      avertismente.push(
        'Coloana de nume are valori diferite pe fiecare punct, deci am tratat TOATE punctele din fișier ca vârfurile unui singur poligon, în ordinea din fișier.',
      );
    }
    brute.push({ nume: '', puncte: toate, sursa: 'Puncte CSV' });
  }
  return { brute, avertismente };
}

// --------------------------------------------------------- curățare/validare

// Un contur măsurat din mers (GNSS, câte un punct pe secundă) are aproape
// mereu mici bucle de zgomot, mai ales în colțuri unde operatorul stă pe loc —
// acestea sunt inofensive. Semnalăm doar încrucișările dintre părți ale
// conturului aflate departe unele de altele ca DISTANȚĂ PARCURSĂ pe contur
// (ex. puncte în ordine greșită, "fundă", traseu care se întoarce peste el).
function seIntersecteaza(ring: [number, number][]): boolean {
  const n = ring.length;
  const a = proiectieLocala(ring);
  const cum: number[] = [0]; // distanța cumulată până la începutul laturii i
  for (let i = 0; i < n; i++) {
    const [x1, y1] = a[i];
    const [x2, y2] = a[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(x2 - x1, y2 - y1));
  }
  const total = cum[n];
  const prag = Math.min(10, total / 8); // metri
  const ccw = (p: number[], q: number[], r: number[]) => (r[1] - p[1]) * (q[0] - p[0]) > (q[1] - p[1]) * (r[0] - p[0]);
  const inter = (p1: number[], p2: number[], p3: number[], p4: number[]) =>
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // laturi vecine (închiderea)
      const inainte = cum[j] - cum[i + 1]; // de la capătul laturii i la începutul laturii j
      const inapoi = total - (cum[j + 1] - cum[i]); // de la capătul laturii j, în jur, la începutul laturii i
      if (Math.min(inainte, inapoi) <= prag) continue;
      if (inter(a[i], a[(i + 1) % n], a[j], a[(j + 1) % n])) return true;
    }
  }
  return false;
}

function curataSiValideaza(brut: Brut, index: number): CandidatPoligon {
  const avertismente: string[] = [];
  let puncte = brut.puncte.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));

  // elimină punctele consecutive identice
  puncte = puncte.filter((p, i) => i === 0 || p[0] !== puncte[i - 1][0] || p[1] !== puncte[i - 1][1]);
  // elimină punctul de închidere (primul repetat la final)
  if (puncte.length > 1) {
    const f = puncte[0];
    const l = puncte[puncte.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) puncte = puncte.slice(0, -1);
  }

  let valid = true;
  if (puncte.length < 3) {
    valid = false;
    avertismente.push('Sub 3 puncte distincte — nu formează un poligon.');
  }

  if (valid) {
    const inRo = puncte.every(([lat, lon]) => lat >= RO_LAT_MIN && lat <= RO_LAT_MAX && lon >= RO_LON_MIN && lon <= RO_LON_MAX);
    if (!inRo) {
      valid = false;
      const inversat = puncte.every(
        ([lat, lon]) => lon >= RO_LAT_MIN && lon <= RO_LAT_MAX && lat >= RO_LON_MIN && lat <= RO_LON_MAX,
      );
      avertismente.push(
        inversat
          ? 'Coordonate în afara României — par inversate (lat/lon). Verifică exportul.'
          : 'Coordonate în afara României — probabil alt sistem de coordonate (nu WGS84 grade). Exportă în WGS84 / lat-lon.',
      );
    }
  }

  if (valid && brut.sursa === 'Linie') avertismente.push('Era o linie, nu un poligon — am închis-o automat.');
  if (valid && brut.sursa === 'Traseu') avertismente.push('Era un traseu GPS — l-am închis automat ca poligon.');
  if (valid && brut.sursa === 'Puncte (waypoint)') avertismente.push('Waypoint-uri luate ca vârfuri, în ordinea din fișier.');
  if (valid && seIntersecteaza(puncte)) {
    avertismente.push('Conturul se intersectează cu el însuși (puncte în ordine greșită?) — verifică pe hartă.');
  }

  return {
    cheie: `c${index}`,
    nume: brut.nume,
    ring: puncte,
    suprafataMp: valid ? ariePoligonMp(puncte) : 0,
    perimetruM: valid ? perimetruPoligonM(puncte) : 0,
    sursa: brut.sursa,
    valid,
    avertismente,
  };
}

// ---------------------------------------------------------------- publice ---

export function parseazaFisier(numeFisier: string, text: string): RezultatParsare {
  const nume = numeFisier.toLowerCase();
  if (text.startsWith('PK')) {
    throw new Error('KMZ/arhivă zip nu e suportat — exportă din SW Maps ca KML sau GeoJSON.');
  }

  let format: RezultatParsare['format'];
  let brute: Brut[];
  let avertismente: string[] = [];
  const t = text.replace(/^﻿/, '').trimStart();

  if (t.startsWith('{') || nume.endsWith('.geojson')) {
    format = 'GeoJSON';
    brute = parseazaGeoJson(t);
  } else if (/<kml\b/i.test(t)) {
    format = 'KML';
    brute = parseazaKml(t);
  } else if (/<gpx\b/i.test(t)) {
    format = 'GPX';
    brute = parseazaGpx(t);
  } else if (t.startsWith('<')) {
    throw new Error('Fișier XML necunoscut — sunt acceptate KML, GPX, GeoJSON și CSV.');
  } else {
    format = 'CSV';
    const r = parseazaCsv(t);
    brute = r.brute;
    avertismente = r.avertismente;
  }

  const candidati = brute.map((b, i) => curataSiValideaza(b, i));
  if (candidati.length === 0) {
    throw new Error('Nu am găsit niciun poligon în fișier.');
  }
  return { format, candidati, avertismente };
}

// Cheie de comparare a numelor de parcele ("Parcelă P1" ~ "P1" ~ "1" ~ "parcela 1").
export function cheieNume(nume: string): string {
  let s = nume
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  s = s.replace(/^parcela/, '');
  if (/^p\d/.test(s)) s = s.slice(1);
  return s.replace(/^0+(?=\d)/, '');
}
