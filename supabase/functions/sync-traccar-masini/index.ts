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
// v2, 2026-09-23 (Radu) -- ADRESE PE FOAIA DE PARCURS: Radu a atașat un
// raport "Foaie de parcurs" de la firma care monitoriza flota înainte
// (AROBS Track GPS), ca inspirație pentru raportul din aplicație -- arată
// adresă completă (stradă, localitate) la plecare/sosire pentru fiecare
// cursă, nu doar coordonate. Adăugat: la momentul în care o cursă se START-ează
// (INSERT) și la momentul în care se ÎNCHIDE prima dată (data_ora_stop trece
// din NULL în nenul), se face o geocodare INVERSĂ (coordonate -> adresă text)
// prin Nominatim (OpenStreetMap, gratuit) și se salvează în `curse.adresa_pornire`
// / `curse.adresa_sosire`. Se face O SINGURĂ DATĂ per capăt de cursă (nu la
// fiecare rulare de cron cât cursa e încă deschisă) -- rezultatul rămâne
// stocat, raportul de foaie de parcurs doar îl citește, nu recalculează.
// Respectă politica de utilizare Nominatim (max ~1 cerere/secundă, User-Agent
// obligatoriu) -- volumul e mic (câteva curse noi finalizate per rulare de 5
// min, pe o flotă de câteva mașini), deci throttling-ul e neglijabil ca timp.
// Eșec de geocodare (rețea, adresă negăsită) -> NULL, nu blochează salvarea
// cursei; foaia de parcurs arată "—" în acel caz.
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

// v3, 2026-09-30 (Radu): "traseul are câte o intrare de fiecare dată când
// se oprește roata (semafor)" + "foaia de parcurs a înregistrat adrese doar
// până în 24.09". Verificat empiric pe Duster Roxana (GR06AEU): semnalul
// `ignition` de la Traccar e nesigur (la fel ca semnalul de "contact" la
// utilaje, vezi NOTES.md "Semnalul de contact e nesigur") — flanează fals
// pentru câteva zeci de secunde chiar cât mașina rulează neîntrerupt (ex.
// 24.09 20:29:48-20:31:02, 74s, în mijlocul unei deplasări continue) ȘI
// flanează adevărat pentru câteva minute cât mașina stă parcată (contact
// instabil/accesorii). Bucla de detectare de mai jos (fără toleranță)
// închidea o cursă la FIECARE asemenea blip și deschidea alta imediat ce
// semnalul revenea — o cursă reală de 15-20 minute devenea 10-20 "curse" de
// 2-6 minute fiecare (confirmat: 120+ curse/săptămână pentru o singură
// mașină, în loc de ~20-30 reale). Volumul ăsta de curse false a multiplicat
// și cererile de geocodare inversă (fiecare cursă nouă = 1-2 cereri către
// Nominatim), ceea ce foarte probabil a dus la limitarea/blocarea cererilor
// de către Nominatim începând cu 24.09 — de-aici și adresele lipsă de atunci
// încoace, pe toată flota, nu doar la o mașină.
// Fix: netezesteContact() aplică un filtru de debounce simetric pe lanțul de
// citiri ÎNAINTE de detectarea curselor — o schimbare de stare a
// contactului contează doar dacă persistă cel puțin TOLERANTA_CONTACT_MINUTE;
// altfel e tratată ca zgomot și rămâne starea veche. Nu modifică datele brute
// din masini_pozitii (doar lanțul folosit local la detectare), deci istoricul
// de poziții rămâne fidel semnalului real.
// Verificat empiric (simulare Node.js pe poziții reale Duster Roxana,
// 24.09-30.09): 44 curse (simulare batch a codului vechi) -> 21 curse, cu
// durate și distanțe plauzibile (15-45 min, 3-23 km) pentru curse reale.
// Notă: fix-ul previne fragmentarea curselor NOI de-acum încolo; cursele deja
// salvate (fragmentate, fără adresă) din 24.09-30.09 rămân în tabel — de
// curățat separat dacă e cazul.
const TOLERANTA_CONTACT_MINUTE = 3;
function netezesteContact(rows: Citire[]): Citire[] {
  const out = rows.map((r) => ({ ...r }));
  let stabil: boolean | null = null;
  for (const r of out) {
    if (r.contact !== null) {
      stabil = r.contact;
      break;
    }
  }
  if (stabil === null) return out;

  let i = 0;
  while (i < out.length) {
    const v = out[i].contact;
    if (v === stabil || v === null) {
      out[i].contact = stabil;
      i++;
      continue;
    }
    // v !== stabil -- posibilă tranziție; caută unde revine la `stabil`.
    let j = i;
    while (j < out.length && out[j].contact !== stabil) j++;
    const durataMinute =
      j < out.length ? (new Date(out[j].data_ora).getTime() - new Date(out[i].data_ora).getTime()) / 60000 : Infinity;
    if (durataMinute >= TOLERANTA_CONTACT_MINUTE) {
      // Persistă suficient -- tranziție reală.
      const nouaStare = v;
      for (let k = i; k < j; k++) out[k].contact = nouaStare;
      stabil = nouaStare;
    } else {
      // Blip trecător -- zgomot, rămâne starea veche.
      for (let k = i; k < j; k++) out[k].contact = stabil;
    }
    i = j;
  }
  return out;
}

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

// v5, 2026-10-21 (Radu): "la foile de parcurs tot nu vad locatia pornire si
// locatia sosire completate". Diagnostic (21.10, funcție de test
// debug-geocode rulată din rețeaua Supabase Edge): Nominatim
// (nominatim.openstreetmap.org) răspunde 403 "Access denied" la orice cerere
// venită de aici (IP-uri cloud partajate, blocate de OSM Foundation) — de
// aceea 100% din cursele de după 24.09 au rămas fără adresă; Photon
// (photon.komoot.io, tot date OpenStreetMap, gratuit, fără cheie) răspunde 200.
// Schimbări:
//  1. geocodare inversă prin Photon (în loc de Nominatim), cu layer=street
//     (fără el întoarce cel mai apropiat obiect de orice fel — "Popas
//     Cristian", "1 Martie" — nu strada); dacă nu găsește nicio stradă, a doua
//     cerere fără layer (localitate); dacă nici așa, coordonatele ca text;
//  2. eșec de rețea / HTTP != 200 => NULL și rândul e reluat la rularea
//     următoare (nu mai rămâne definitiv fără adresă); 3 eșecuri la rând =>
//     oprim geocodarea în rularea curentă;
//  3. coordonatele de sosire se salvează pe cursă (latitudine_stop /
//     longitudine_stop), ca adresa de sosire să poată fi completată oricând;
//  4. buget de timp pe rulare + completare treptată a curselor rămase fără
//     adresă (cele mai recente întâi) la sfârșitul fiecărei rulări, cu cereri
//     în paralel (max. 3 în zbor), dar cu start la cel mult 1 cerere/secundă.
const PHOTON_URL = 'https://photon.komoot.io/reverse';
const BUGET_GEOCODARE_MS = 100_000; // per rulare de cron (cronul rulează la 5 min)
const PAUZA_GEOCODARE_MS = 1000; // cel mult ~1 cerere începută pe secundă, politicos față de serviciul gratuit
const MAX_ESECURI_CONSECUTIVE = 3; // furnizor căzut/blocat => oprim geocodarea în rularea asta
const MAX_CURSE_COMPLETARE = 150; // câte curse fără adresă citim la o rulare pentru completare
const CONCURENTA_COMPLETARE = 3; // curse completate în paralel (cererile rămân cadențate de poarta de start)
let inceputRulareMs = Date.now(); // resetat la începutul fiecărei invocări
let urmatoareaCerereMs = 0;
let esecuriConsecutive = 0;
const cacheGeocodare = new Map<string, string>();

function geocodareDisponibila(): boolean {
  return Date.now() - inceputRulareMs < BUGET_GEOCODARE_MS && esecuriConsecutive < MAX_ESECURI_CONSECUTIVE;
}

function adresaDinProprietati(p: Record<string, unknown>): string | null {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const strada = text(p.street) ?? (p.type === 'street' ? text(p.name) : null);
  const numar = text(p.housenumber);
  const localitate = text(p.city) ?? text(p.locality) ?? text(p.district) ?? text(p.county);
  const parti: string[] = [];
  if (strada) parti.push(numar ? `${strada} ${numar}` : strada);
  if (localitate) parti.push(localitate);
  if (parti.length > 0) return parti.join(', ');
  return text(p.name);
}

// O cerere Photon. undefined = eșec (rețea / HTTP != 200 / buget epuizat) -> se
// reîncearcă la o rulare viitoare; null = răspuns valid, dar fără niciun rezultat.
async function cerePhoton(lat: number, lon: number, layer: string | null): Promise<Record<string, unknown> | null | undefined> {
  // Poartă de start: cel puțin PAUZA între începuturile cererilor, chiar dacă
  // sunt lansate în paralel (slotul se rezervă sincron, înainte de await).
  const start = Math.max(Date.now(), urmatoareaCerereMs);
  urmatoareaCerereMs = start + PAUZA_GEOCODARE_MS;
  const asteapta = start - Date.now();
  if (asteapta > 0) await new Promise((r) => setTimeout(r, asteapta));
  if (!geocodareDisponibila()) return undefined;

  try {
    const res = await fetch(`${PHOTON_URL}?lat=${lat}&lon=${lon}${layer ? `&layer=${layer}` : ''}`, {
      headers: { 'User-Agent': 'RulouriDeGazon-FlotaAuto/1.0 (radu.dragulinescu@me.com)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      esecuriConsecutive++;
      console.warn(`[geocodare] Photon a răspuns ${res.status}`);
      return undefined;
    }
    const json = await res.json();
    esecuriConsecutive = 0;
    return (json?.features?.[0]?.properties as Record<string, unknown> | undefined) ?? null;
  } catch (e) {
    esecuriConsecutive++;
    console.warn(`[geocodare] eroare: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

// Întoarce adresa text (strada + localitatea; localitatea singură dacă nu e nicio
// stradă; coordonatele ca text dacă furnizorul n-are nimic pentru punct) ori
// NULL dacă geocodarea n-a putut fi făcută acum — în cazul ăsta coloana rămâne
// NULL și rândul e reluat la o rulare viitoare.
async function reverseGeocode(latIn: number, lonIn: number): Promise<string | null> {
  const lat = Number(latIn);
  const lon = Number(lonIn);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cheie = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const dinCache = cacheGeocodare.get(cheie);
  if (dinCache) return dinCache;
  if (!geocodareDisponibila()) return null;

  const pStrada = await cerePhoton(lat, lon, 'street');
  if (pStrada === undefined) return null;
  let adresa = pStrada ? adresaDinProprietati(pStrada) : null;
  if (!adresa) {
    const pGeneral = await cerePhoton(lat, lon, null);
    if (pGeneral === undefined) return null;
    adresa = pGeneral ? adresaDinProprietati(pGeneral) : null;
  }
  const rezultat = adresa ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  cacheGeocodare.set(cheie, rezultat);
  return rezultat;
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
  // v5: bugetul de timp și contorul de eșecuri se resetează la fiecare invocare
  // (instanța edge poate fi refolosită între invocări).
  inceputRulareMs = Date.now();
  esecuriConsecutive = 0;

  if (!TRACCAR_URL || !TRACCAR_USER || !TRACCAR_PASSWORD) {
    return new Response('Lipsesc credențialele Traccar (TRACCAR_URL/USER/PASSWORD).', { status: 500 });
  }

  const auth = 'Basic ' + btoa(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Vezi list-traccar-devices/index.ts: fără `all=true`, Traccar întoarce
  // doar device-urile alocate explicit contului TRACCAR_USER, nu toate
  // (confirmat 2026-09-10/11 — mașini noi legate din Traccar nu apăreau
  // pe hartă / nu li se sincroniza poziția până la acest fix).
  const devicesRes = await fetch(`${TRACCAR_URL}/api/devices?all=true`, { headers: { Authorization: auth } });
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
    // v3: trecut prin netezesteContact() -- vezi nota v3 de mai sus -- ca să
    // eliminăm blip-urile scurte de contact înainte de a detecta curse.
    const chain: Citire[] = netezesteContact(ultima ? [ultima, ...noi] : noi);
    if (chain.length < 2) continue;

    // --- Detectare curse ---
    const { data: openCurseRaw } = await supabase
      .from('curse')
      .select('data_ora_start, km, latitudine_start, longitudine_start')
      .eq('masina_id', masina.id)
      .is('data_ora_stop', null)
      .order('data_ora_start', { ascending: false })
      .limit(1)
      .maybeSingle();

    let curStart: string | null = openCurseRaw?.data_ora_start ?? null;
    let curKm: number = openCurseRaw?.km ?? 0;
    // v2: coordonatele capătului de plecare al cursei deschise, dacă exista
    // deja una — necesare doar ca fallback (normal, adresa de plecare a fost
    // deja geocodată la INSERT-ul inițial); dacă lipsesc (rânduri foarte
    // vechi fără aceste coloane), rămân null și pur și simplu nu recalculăm.
    let curStartLat: number | null = (openCurseRaw as any)?.latitudine_start ?? null;
    let curStartLon: number | null = (openCurseRaw as any)?.longitudine_start ?? null;
    let curseSalvate = 0;

    async function salveazaSegment(
      dataStart: string,
      latStart: number | null,
      lonStart: number | null,
      dataStop: string | null,
      latStop: number | null,
      lonStop: number | null,
      km: number,
    ) {
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
        .select('id, sofer_id, adresa_pornire')
        .eq('masina_id', masina.id)
        .eq('data_ora_start', dataStart)
        .maybeSingle();

      if (existent) {
        const update: Record<string, unknown> = { data_ora_stop: dataStop, km: Math.round(km * 100) / 100 };
        // v2: geocodăm adresa de sosire o singură dată — exact la momentul
        // în care cursa asta se închide prima dată acum (nu la fiecare
        // update ulterior, care ar fi doar km recalculat pe o cursă deja
        // închisă — asta nu se întâmplă în fluxul curent, dar verificăm
        // oricum ca să nu geocodăm de două ori).
        // v5: salvăm și coordonatele de sosire; adresa se scrie doar dacă
        // geocodarea a reușit (altfel rămâne NULL și o completează
        // trecerea de completare de la finalul rulării).
        if (dataStop && latStop != null && lonStop != null) {
          update.latitudine_stop = latStop;
          update.longitudine_stop = lonStop;
          const adresaSosire = await reverseGeocode(latStop, lonStop);
          if (adresaSosire) update.adresa_sosire = adresaSosire;
        }
        if (!existent.adresa_pornire && latStart != null && lonStart != null) {
          const adresaPornire = await reverseGeocode(latStart, lonStart);
          if (adresaPornire) update.adresa_pornire = adresaPornire;
        }
        await supabase.from('curse').update(update).eq('id', existent.id);
      } else {
        const adresaPornire = latStart != null && lonStart != null ? await reverseGeocode(latStart, lonStart) : null;
        const adresaSosire =
          dataStop && latStop != null && lonStop != null ? await reverseGeocode(latStop, lonStop) : null;
        await supabase.from('curse').insert({
          masina_id: masina.id,
          sofer_id: masina.sofer_implicit_id,
          data_ora_start: dataStart,
          data_ora_stop: dataStop,
          km: Math.round(km * 100) / 100,
          status: 'detectata',
          latitudine_start: latStart,
          longitudine_start: lonStart,
          adresa_pornire: adresaPornire,
          adresa_sosire: adresaSosire,
          latitudine_stop: dataStop ? latStop : null,
          longitudine_stop: dataStop ? lonStop : null,
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
        if (curStart === null) {
          curStart = a.data_ora;
          curStartLat = a.latitudine;
          curStartLon = a.longitudine;
        }
        curKm += distantaMetri(a.latitudine, a.longitudine, b.latitudine, b.longitudine) / 1000;
      } else if (aEraPornit && !intervalContinuu) {
        // Gol prea mare cât timp mergea — închide cursa la ultima poziție bună (a).
        if (curStart !== null) {
          await salveazaSegment(curStart, curStartLat, curStartLon, a.data_ora, a.latitudine, a.longitudine, curKm);
          curStart = null;
          curStartLat = null;
          curStartLon = null;
          curKm = 0;
        }
      }

      if (b.contact !== true && curStart !== null) {
        // Contactul s-a oprit — închide cursa la poziția curentă (b).
        await salveazaSegment(curStart, curStartLat, curStartLon, b.data_ora, b.latitudine, b.longitudine, curKm);
        curStart = null;
        curStartLat = null;
        curStartLon = null;
        curKm = 0;
      }
    }

    if (curStart !== null) {
      // Cursă încă în desfășurare — salvează progresul, fără dată de stop
      // (deci fără geocodare de sosire încă).
      await salveazaSegment(curStart, curStartLat, curStartLon, null, null, null, curKm);
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

  // v5: completare treptată a adreselor lipsă (curse vechi + cele la care
  // geocodarea a eșuat), cele mai recente întâi, cât ține bugetul de timp.
  let adreseCompletate = 0;
  try {
    const { data: lipsa } = await supabase
      .from('curse')
      .select(
        'id, latitudine_start, longitudine_start, adresa_pornire, data_ora_stop, latitudine_stop, longitudine_stop, adresa_sosire',
      )
      .or('adresa_pornire.is.null,and(data_ora_stop.not.is.null,adresa_sosire.is.null)')
      .order('data_ora_start', { ascending: false })
      .limit(MAX_CURSE_COMPLETARE);

    // deno-lint-ignore no-explicit-any
    const completeaza = async (c: any): Promise<number> => {
      const patch: Record<string, string> = {};
      if (!c.adresa_pornire && c.latitudine_start != null && c.longitudine_start != null) {
        const a = await reverseGeocode(c.latitudine_start, c.longitudine_start);
        if (a) patch.adresa_pornire = a;
      }
      if (c.data_ora_stop && !c.adresa_sosire && c.latitudine_stop != null && c.longitudine_stop != null) {
        const a = await reverseGeocode(c.latitudine_stop, c.longitudine_stop);
        if (a) patch.adresa_sosire = a;
      }
      if (Object.keys(patch).length === 0) return 0;
      const { error: patchError } = await supabase.from('curse').update(patch).eq('id', c.id);
      if (patchError) {
        erori['completare_adrese'] = patchError.message;
        return 0;
      }
      return Object.keys(patch).length;
    };

    const lista = lipsa ?? [];
    for (let i = 0; i < lista.length && geocodareDisponibila(); i += CONCURENTA_COMPLETARE) {
      const rezultate = await Promise.all(lista.slice(i, i + CONCURENTA_COMPLETARE).map(completeaza));
      adreseCompletate += rezultate.reduce((a, b) => a + b, 0);
    }
  } catch (e) {
    erori['completare_adrese'] = e instanceof Error ? e.message : String(e);
  }

  return new Response(
    JSON.stringify({ per_masina: perMasina, erori, adrese_completate: adreseCompletate, geocodare_esecuri_consecutive: esecuriConsecutive }),
    { status: 200 },
  );
});
