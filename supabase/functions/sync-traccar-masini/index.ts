// supabase/functions/sync-traccar-masini/index.ts
//
// Job programat (cron, 5 min) pentru flota de mașini (Teltonika FMC130, fără
// senzor de combustibil). Într-o singură rulare:
//   1. Trage din Traccar istoricul de poziții noi (de la ultima citire
//      salvată încoace) pentru fiecare mașină activă -> public.masini_pozitii.
//      (Aceeași strategie ca supabase/functions/sync-traccar-fuel: cerem tot
//      istoricul, nu doar "poziția curentă", ca să nu pierdem rezoluție cât
//      timp mașina circulă.)
//   2. Detectează curse (segmente ignition on/off) din traseul nou +
//      ultima poziție deja salvată -> public.curse. O cursă rămâne "deschisă"
//      (data_ora_stop = NULL) cât timp contactul rămâne pornit; km se
//      acumulează progresiv (sumă haversine) la fiecare rulare.
//   3. Detectează alerte: depășire viteză (față de masini.viteza_limita_kmh,
//      doar pe front crescător, ca să nu spamăm) și intrare/ieșire din zone
//      geofence active -> public.alerte.
//
// Secrete necesare (aceleași ca sync-traccar-fuel): TRACCAR_URL, TRACCAR_USER,
// TRACCAR_PASSWORD.
//
// DEPLOYAT deja direct în Supabase (verify_jwt: false, la fel ca
// sync-traccar-fuel) — acest fișier e copia sursă de adevăr.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const TRACCAR_URL = Deno.env.get('TRACCAR_URL') ?? '';
const TRACCAR_USER = Deno.env.get('TRACCAR_USER') ?? '';
const TRACCAR_PASSWORD = Deno.env.get('TRACCAR_PASSWORD') ?? '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Vezi sync-traccar-fuel pentru raționamentul din spatele acestor constante.
const MAX_LOOKBACK_ORE = 3;
const DEFAULT_LOOKBACK_MINUTE = 20;
// Interval maxim între două citiri considerat "continuu" pentru o cursă —
// peste asta presupunem device offline, nu condus neîntrerupt.
const MAX_GAP_ORE = 1;
// Curse sub acest prag (zgomot de contact) nu se salvează.
const MIN_DURATA_SECUNDE = 60;
const MIN_KM = 0.05;
// Nu trimitem o alertă nouă de viteză pentru aceeași mașină mai des de atât
// (front crescător oricum elimină spam-ul continuu; asta e o plasă suplimentară).
const COOLDOWN_ALERTA_VITEZA_MINUTE = 15;

const EARTH_RADIUS_M = 6371000;
function distantaMetri(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const φ1 = (aLat * Math.PI) / 180;
  const φ2 = (bLat * Math.PI) / 180;
  const Δφ = ((bLat - aLat) * Math.PI) / 180;
  const Δλ = ((bLon - aLon) * Math.PI) / 180;
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Ray casting standard — ring e listă de [lon, lat] (același format ca
// parcele.poligon_harta / geofences.poligon).
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

interface TraccarPosition {
  deviceId: number;
  fixTime: string;
  latitude: number;
  longitude: number;
  speed: number; // noduri (knots) — convenția Traccar
  attributes: Record<string, unknown>;
}

interface TraccarDevice {
  id: number;
  uniqueId: string;
}

interface Masina {
  id: string;
  traccar_device_id: string | null;
  sofer_implicit_id: string | null;
  viteza_limita_kmh: number | null;
}

interface Geofence {
  id: string;
  nume: string;
  tip_alerta: string;
  ring: number[][];
}

interface Citire {
  data_ora: string;
  latitudine: number;
  longitudine: number;
  viteza_kmh: number | null;
  contact: boolean | null;
}

function extractContact(attributes: Record<string, unknown>): boolean | null {
  const value = attributes['ignition'];
  return typeof value === 'boolean' ? value : null;
}

function ringValid(poligon: unknown): number[][] | null {
  const ring = (poligon as { coordinates?: number[][][] } | null)?.coordinates?.[0];
  if (!ring || ring.length < 3) return null;
  return ring;
}

Deno.serve(async () => {
  if (!TRACCAR_URL || !TRACCAR_USER || !TRACCAR_PASSWORD) {
    return new Response('Lipsesc credențialele Traccar (TRACCAR_URL/USER/PASSWORD).', { status: 500 });
  }

  const auth = 'Basic ' + btoa(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const devicesRes = await fetch(`${TRACCAR_URL}/api/devices`, { headers: { Authorization: auth } });
  if (!devicesRes.ok) {
    return new Response('Eroare la citirea device-urilor din Traccar.', { status: 502 });
  }
  const devices: TraccarDevice[] = await devicesRes.json();
  const deviceByImei = new Map(devices.map((d) => [d.uniqueId, d]));

  const { data: masiniRaw, error: masiniError } = await supabase
    .from('masini')
    .select('id, traccar_device_id, sofer_implicit_id, viteza_limita_kmh')
    .eq('activ', true)
    .not('traccar_device_id', 'is', null);

  if (masiniError) {
    return new Response(`Eroare la citirea mașinilor: ${masiniError.message}`, { status: 500 });
  }
  const masini = (masiniRaw ?? []) as Masina[];

  const { data: geofenceRaw, error: geofenceError } = await supabase
    .from('geofences')
    .select('id, nume, tip_alerta, poligon')
    .eq('activ', true);

  if (geofenceError) {
    return new Response(`Eroare la citirea zonelor: ${geofenceError.message}`, { status: 500 });
  }
  const geofences: Geofence[] = (geofenceRaw ?? [])
    .map((g: { id: string; nume: string; tip_alerta: string; poligon: unknown }) => {
      const ring = ringValid(g.poligon);
      return ring ? { id: g.id, nume: g.nume, tip_alerta: g.tip_alerta, ring } : null;
    })
    .filter((g: Geofence | null): g is Geofence => g !== null);

  const now = new Date();
  const minFrom = new Date(now.getTime() - MAX_LOOKBACK_ORE * 3_600_000);
  const defaultFrom = new Date(now.getTime() - DEFAULT_LOOKBACK_MINUTE * 60_000);

  const perMasina: Record<string, { pozitii: number; curse: number; alerte: number }> = {};
  const erori: Record<string, string> = {};

  for (const masina of masini) {
    const device = deviceByImei.get(masina.traccar_device_id as string);
    if (!device) continue;
    perMasina[masina.id] = { pozitii: 0, curse: 0, alerte: 0 };

    // Ultima poziție deja salvată (referință pentru prima deltă a acestei
    // rulări — atât pentru km/curse, cât și pentru tranzițiile de geofence).
    const { data: ultimaRaw } = await supabase
      .from('masini_pozitii')
      .select('data_ora, latitudine, longitudine, viteza_kmh, contact')
      .eq('masina_id', masina.id)
      .order('data_ora', { ascending: false })
      .limit(1)
      .maybeSingle();
    const ultima = ultimaRaw as Citire | null;

    let from = ultima?.data_ora ? new Date(ultima.data_ora) : defaultFrom;
    if (from < minFrom) from = minFrom;
    if (from >= now) continue;

    const url = `${TRACCAR_URL}/api/positions?deviceId=${device.id}&from=${from.toISOString()}&to=${now.toISOString()}`;
    const posRes = await fetch(url, { headers: { Authorization: auth } });
    if (!posRes.ok) {
      erori[masina.id] = `Traccar a răspuns cu ${posRes.status} pentru device ${device.id}.`;
      continue;
    }

    const positions: TraccarPosition[] = await posRes.json();
    positions.sort((a, b) => new Date(a.fixTime).getTime() - new Date(b.fixTime).getTime());

    const noi: Citire[] = positions
      .filter((p) => p.latitude !== undefined && p.longitude !== undefined)
      .map((p) => ({
        data_ora: p.fixTime,
        latitudine: p.latitude,
        longitudine: p.longitude,
        viteza_kmh: typeof p.speed === 'number' ? Math.round(p.speed * 1.852 * 10) / 10 : null,
        contact: extractContact(p.attributes),
      }));

    if (noi.length > 0) {
      const rows = noi.map((c) => ({
        masina_id: masina.id,
        data_ora: c.data_ora,
        latitudine: c.latitudine,
        longitudine: c.longitudine,
        viteza_kmh: c.viteza_kmh,
        contact: c.contact,
        sursa: 'traccar',
      }));
      const { error: insertError } = await supabase
        .from('masini_pozitii')
        .upsert(rows, { onConflict: 'masina_id,data_ora', ignoreDuplicates: true });
      if (insertError) {
        erori[masina.id] = `Eroare la salvare poziții: ${insertError.message}`;
        continue;
      }
      perMasina[masina.id].pozitii = noi.length;
    }

    // Lanțul cronologic folosit pentru detectarea curselor + tranzițiile de
    // geofence: ultima poziție deja salvată (dacă există) + cele noi.
    const chain: Citire[] = ultima ? [ultima, ...noi] : noi;
    if (chain.length < 2) continue;

    // --- Detectare curse ---
    const { data: openCurseRaw } = await supabase
      .from('curse')
      .select('data_ora_start, km')
      .eq('masina_id', masina.id)
      .is('data_ora_stop', null)
      .order('data_ora_start', { ascending: false })
      .limit(1)
      .maybeSingle();

    let curStart: string | null = openCurseRaw?.data_ora_start ?? null;
    let curKm: number = openCurseRaw?.km ?? 0;
    let curseSalvate = 0;

    async function salveazaSegment(dataStart: string, dataStop: string | null, km: number) {
      if (dataStop) {
        const durataSec = (new Date(dataStop).getTime() - new Date(dataStart).getTime()) / 1000;
        if (durataSec < MIN_DURATA_SECUNDE && km < MIN_KM) {
          // Zgomot (contact bâlbâit câteva secunde) — ștergem dacă exista deja o cursă deschisă cu acest start.
          await supabase.from('curse').delete().eq('masina_id', masina.id).eq('data_ora_start', dataStart).is('data_ora_stop', null);
          return;
        }
      }
      const { data: existent } = await supabase
        .from('curse')
        .select('id, sofer_id')
        .eq('masina_id', masina.id)
        .eq('data_ora_start', dataStart)
        .maybeSingle();

      if (existent) {
        await supabase
          .from('curse')
          .update({ data_ora_stop: dataStop, km: Math.round(km * 100) / 100 })
          .eq('id', existent.id);
      } else {
        await supabase.from('curse').insert({
          masina_id: masina.id,
          sofer_id: masina.sofer_implicit_id,
          data_ora_start: dataStart,
          data_ora_stop: dataStop,
          km: Math.round(km * 100) / 100,
          status: 'detectata',
        });
        curseSalvate++;
      }
    }

    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1];
      const b = chain[i];
      const gapOre = (new Date(b.data_ora).getTime() - new Date(a.data_ora).getTime()) / 3_600_000;
      const aEraPornit = a.contact === true;
      const intervalContinuu = gapOre > 0 && gapOre <= MAX_GAP_ORE;

      if (aEraPornit && intervalContinuu) {
        if (curStart === null) curStart = a.data_ora;
        curKm += distantaMetri(a.latitudine, a.longitudine, b.latitudine, b.longitudine) / 1000;
      } else if (aEraPornit && !intervalContinuu) {
        // Gol prea mare cât timp mergea — închide cursa la ultima poziție bună (a).
        if (curStart !== null) {
          await salveazaSegment(curStart, a.data_ora, curKm);
          curStart = null;
          curKm = 0;
        }
      }

      if (b.contact !== true && curStart !== null) {
        // Contactul s-a oprit — închide cursa la poziția curentă (b).
        await salveazaSegment(curStart, b.data_ora, curKm);
        curStart = null;
        curKm = 0;
      }
    }

    if (curStart !== null) {
      // Cursă încă în desfășurare — salvează progresul, fără dată de stop.
      await salveazaSegment(curStart, null, curKm);
    }
    perMasina[masina.id].curse = curseSalvate;

    // --- Alerte: viteză (front crescător) + geofencing (tranziții) ---
    let alerteSalvate = 0;
    let ultimaAlertaVitezaMs = 0;
    if (masina.viteza_limita_kmh) {
      const { data: ultimaAlerta } = await supabase
        .from('alerte')
        .select('data_ora')
        .eq('masina_id', masina.id)
        .eq('tip', 'viteza')
        .order('data_ora', { ascending: false })
        .limit(1)
        .maybeSingle();
      ultimaAlertaVitezaMs = ultimaAlerta?.data_ora ? new Date(ultimaAlerta.data_ora).getTime() : 0;
    }

    const insideByGeofence = new Map<string, boolean>();
    if (chain[0]) {
      for (const g of geofences) {
        insideByGeofence.set(g.id, pointInRing(chain[0].longitudine, chain[0].latitudine, g.ring));
      }
    }

    for (let i = 1; i < chain.length; i++) {
      const b = chain[i];

      if (masina.viteza_limita_kmh && (b.viteza_kmh ?? 0) > masina.viteza_limita_kmh) {
        const a = chain[i - 1];
        const aSubLimita = (a.viteza_kmh ?? 0) <= masina.viteza_limita_kmh;
        const bTimeMs = new Date(b.data_ora).getTime();
        if (aSubLimita && bTimeMs - ultimaAlertaVitezaMs > COOLDOWN_ALERTA_VITEZA_MINUTE * 60_000) {
          await supabase.from('alerte').insert({
            masina_id: masina.id,
            tip: 'viteza',
            viteza_masurata: b.viteza_kmh,
            viteza_limita: masina.viteza_limita_kmh,
            data_ora: b.data_ora,
            latitudine: b.latitudine,
            longitudine: b.longitudine,
          });
          alerteSalvate++;
          ultimaAlertaVitezaMs = bTimeMs;
        }
      }

      for (const g of geofences) {
        const eraInauntru = insideByGeofence.get(g.id) ?? false;
        const acumInauntru = pointInRing(b.longitudine, b.latitudine, g.ring);
        if (!eraInauntru && acumInauntru && (g.tip_alerta === 'intrare' || g.tip_alerta === 'ambele')) {
          await supabase.from('alerte').insert({
            masina_id: masina.id,
            tip: 'intrare_zona',
            geofence_id: g.id,
            data_ora: b.data_ora,
            latitudine: b.latitudine,
            longitudine: b.longitudine,
          });
          alerteSalvate++;
        } else if (eraInauntru && !acumInauntru && (g.tip_alerta === 'iesire' || g.tip_alerta === 'ambele')) {
          await supabase.from('alerte').insert({
            masina_id: masina.id,
            tip: 'iesire_zona',
            geofence_id: g.id,
            data_ora: b.data_ora,
            latitudine: b.latitudine,
            longitudine: b.longitudine,
          });
          alerteSalvate++;
        }
        insideByGeofence.set(g.id, acumInauntru);
      }
    }
    perMasina[masina.id].alerte = alerteSalvate;
  }

  return new Response(JSON.stringify({ per_masina: perMasina, erori }), { status: 200 });
});
