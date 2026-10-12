// Utilitare geografice simple (aproximare sferică, suficient de precisă la
// scara unei parcele/ferme — nu ne trebuie precizie geodezică de nivel WGS84).

const EARTH_RADIUS_M = 6371000;

export function distantaMetri(a: [number, number], b: [number, number]): number {
  const φ1 = (a[0] * Math.PI) / 180;
  const φ2 = (b[0] * Math.PI) / 180;
  const Δφ = ((b[0] - a[0]) * Math.PI) / 180;
  const Δλ = ((b[1] - a[1]) * Math.PI) / 180;
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Punctul aflat la `distanceM` metri și azimutul `bearingDeg` (0 = nord, sensul
// acelor de ceasornic) față de (lat, lon). Formula standard "destination point
// given distance and bearing".
export function destinationPoint(
  lat: number,
  lon: number,
  distanceM: number,
  bearingDeg: number,
): [number, number] {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return [(φ2 * 180) / Math.PI, (((λ2 * 180) / Math.PI + 540) % 360) - 180];
}

// Nivelul de zoom (proiecție Web Mercator) la care rezoluția hărții atinge
// `metersPerPixel` la latitudinea `latDeg`. Folosit ca să limităm zoom-ul
// maxim la rezoluția reală a unei imagini suprapuse — dincolo de acel nivel,
// mărirea nu mai arată detalii noi, doar pixeli măriți.
export function zoomForResolution(metersPerPixel: number, latDeg: number): number {
  const metersPerPixelAtZoom0 = 156543.03392 * Math.cos((latDeg * Math.PI) / 180);
  return Math.log2(metersPerPixelAtZoom0 / metersPerPixel);
}

// Generează un poligon regulat cu `puncte` colțuri care aproximează un cerc —
// pentru parcele perfect rotunde (ex. sub pivot de irigații). Rezultatul e o
// listă de [lat, lon], nedeschisă (fără repetarea primului punct la final —
// se închide la salvare, la fel ca poligoanele desenate manual).
export function generateCirclePolygon(
  center: [number, number],
  radiusM: number,
  puncte = 64,
): [number, number][] {
  const [lat, lon] = center;
  const ring: [number, number][] = [];
  for (let i = 0; i < puncte; i++) {
    const bearing = (360 * i) / puncte;
    ring.push(destinationPoint(lat, lon, radiusM, bearing));
  }
  return ring;
}

// Proiecție plană locală (metri) pe elipsoidul WGS84, centrată pe media
// punctelor: grad de latitudine = π/180·M (raza meridianului), grad de
// longitudine = π/180·N·cosφ (raza verticalului primar). Pe o sferă (R=6371 km)
// suprafețele ies cu ~0,27% prea mici la latitudinea României; cu elipsoidul
// coincid cu SW Maps (diferență < 0,01%).
export function proiectieLocala(ring: [number, number][]): [number, number][] {
  const lat0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lon0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const a = 6378137.0;
  const e2 = 0.00669437999014;
  const phi = (lat0 * Math.PI) / 180;
  const w = 1 - e2 * Math.sin(phi) * Math.sin(phi);
  const M = (a * (1 - e2)) / Math.pow(w, 1.5);
  const N = a / Math.sqrt(w);
  const rad = Math.PI / 180;
  return ring.map(([lat, lon]) => [(lon - lon0) * rad * N * Math.cos(phi), (lat - lat0) * rad * M]);
}

// Suprafața (mp) a unui poligon dat ca listă de [lat, lon] (nedeschis sau
// închis — punctul repetat la final nu schimbă rezultatul). Formula "shoelace"
// pe proiecția locală de mai sus.
export function ariePoligonMp(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const pts = proiectieLocala(ring);
  let suma = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    suma += x1 * y2 - x2 * y1;
  }
  return Math.abs(suma) / 2;
}

// Perimetrul (m) al poligonului (ring nedeschis; se închide automat).
export function perimetruPoligonM(ring: [number, number][]): number {
  if (ring.length < 2) return 0;
  const pts = proiectieLocala(ring);
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}
