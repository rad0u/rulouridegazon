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
