// supabase/functions/get-sesiuni-detectate/index.ts
//
// Sesiuni de lucru detectate automat din traseul GPS al utilajelor unei
// ferme: pentru fiecare utilaj, se caută intervale CONTINUE în care utilajul
// a fost în FUNCȚIUNE (vezi mai jos) în interiorul poligonului UNEI SINGURE
// parcele, mai lungi de PRAG_MINIM_MINUTE — ca să excludem simpla deplasare
// a utilajului traversând o parcelă.
//
// Radu, 2026-09-19: cerința e explicită — "munca fără utilaj nu există" —
// deci această coadă înlocuiește complet selecția manuală de parcelă din
// ParcelaPanel (care rămâne doar pentru istoric / corectări). Adminul de
// fermă nu mai alege parcela: aplicația o deduce din traseu și îl întreabă
// direct doar ce operațiune a fost (dropdown), iar dacă tipul cere
// substanțe, ce substanțe (al doilea dropdown, filtrat pe stocul fermei).
//
// v2, 2026-09-22 (Radu): la fel ca la get-combustibil-report v11, semnalul
// de `contact` (ignition) s-a dovedit nesigur — flichează fals (contact=false
// tranzitoriu) chiar în timpul lucrului real, continuu. Verificare pe
// Săbăreni (10 zile): Steyr 4105 producea 1766 "rulaje" de contact=true, din
// care 1760 (99.7%) sub pragul de 10 minute — coada rămânea aproape goală
// deși utilajul chiar lucra ore în șir (confirmat separat prin Traccar
// Replay). Fix: FUNCȚIUNE = contact=true SAU utilajul s-a mișcat efectiv
// ≥PRAG_MISCARE_METRI între cele două citiri ale intervalului — exact
// fallback-ul deja aplicat la orele de funcționare din raportul de
// combustibil. Garda cerută de Radu la decizia inițială (un utilaj parcat cu
// motorul oprit nu trebuie să apară ca "operațiune") rămâne intactă: fără
// mișcare reală ȘI fără contact, intervalul tot nu contează, deci un utilaj
// staționar cu motorul oprit nu produce o sesiune. Rămâne o mențiune: dacă
// utilajul e REMORCAT (tractat) cu motorul oprit, mișcarea reală poate trece
// pragul de 20m/interval — același compromis acceptat deja la v11.
//
// Decizie Radu 2026-09-22: algoritmul (v2) rămâne SUB OBSERVAȚIE până pe
// 1 octombrie 2026 — se monitorizează sesiunile produse pentru eventuale
// anomalii (sesiuni prea lungi/scurte, parcele greșite, falsuri din
// remorcare etc.) înainte de a decide dacă mai are nevoie de ajustări sau
// rămâne definitiv așa.
//
// CONTACT/MIȘCARE STRICT PE SESIUNE (decizia lui Radu, v1): dacă utilajul nu
// mai e „în funcțiune" (nici contact, nici mișcare) la un moment dat în
// mijlocul unei prezențe în parcelă, sesiunea se ÎNCHEIE exact acolo — o
// eventuală reluare ulterioară pe aceeași parcelă e o sesiune NOUĂ, separată.
//
// SESIUNI ÎN CURS: dacă bucla ajunge la ULTIMA citire cu o sesiune încă
// "deschisă" (n-a fost închisă de o schimbare de parcelă/funcțiune), sesiunea
// respectivă NU se raportează — s-ar putea ca utilajul să fie încă acolo. O
// sesiune apare în coadă doar după ce s-a încheiat cu adevărat (utilajul a
// plecat din parcelă sau a oprit motorul/mișcarea). Asta evită și o problemă
// de deduplicare: dacă am confirma o sesiune încă în desfășurare, la
// următoarea interogare traseul brut ar forma un interval mai lung care s-ar
// suprapune parțial cu cel deja confirmat, iar coada l-ar ignora complet
// (inclusiv partea neconfirmată încă).
//
// DEDUPLICARE: o sesiune deja confirmată (transformată în rând în
// `operatiuni`, cu utilaj_id + sesiune_inceput/sesiune_sfarsit completate) nu
// mai apare la interogări viitoare — se exclud sesiunile detectate care se
// suprapun cu o operațiune deja confirmată pentru același utilaj.
//
// ACCES: admin_ferma vede doar sesiunile propriei ferme (ferma_id dedus din
// profilul lui, ignoră orice ferma_id trimis din client); admin_central
// trebuie să specifice ferma_id explicit (poate vedea orice fermă).
//
// v3, 2026-09-24 (Radu): "muncă fără categorie" nu mai există ca listă de
// alegere pentru șefii de fermă — vezi lib/operatiuniTypes.ts și
// ActivitatiParceleScreen.tsx. Singura informație nouă de care are nevoie
// front-end-ul ca să decidă ce formular arată e dacă utilajul e marcat
// „utilaj de recoltare" (`utilaje.este_utilaj_recoltare`) — se adaugă acest
// flag pe fiecare sesiune returnată.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Aceleași convenții ca get-utilaj-istoric-parcele / get-combustibil-report.
const MAX_GAP_ORE = 1;
const PRAG_MINIM_MINUTE = 10;
// v2: prag de mișcare GPS pentru fallback-ul la semnalul de contact nesigur
// — identic cu PRAG_MISCARE_METRI din get-combustibil-report v11.
const PRAG_MISCARE_METRI = 20;

const RO_LAT_MIN = 42;
const RO_LAT_MAX = 50;
const RO_LON_MIN = 18;
const RO_LON_MAX = 32;

interface Citire {
  data_ora: string;
  latitudine: number | null;
  longitudine: number | null;
  contact: boolean | null;
}

interface ParcelaRaw {
  id: string;
  nume: string;
  poligon_harta: { type: 'Polygon'; coordinates: number[][][] } | null;
}

interface ParcelaRing {
  id: string;
  nume: string;
  ring: number[][];
}

function poligonValid(parcela: ParcelaRaw): number[][] | null {
  const ring = parcela.poligon_harta?.coordinates?.[0];
  if (!ring || ring.length < 3) return null;
  const plauzibil = ring.every(
    ([lon, lat]) => lat >= RO_LAT_MIN && lat <= RO_LAT_MAX && lon >= RO_LON_MIN && lon <= RO_LON_MAX,
  );
  return plauzibil ? ring : null;
}

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

function gasesteParcela(lat: number, lon: number, parcele: ParcelaRing[]): { id: string; nume: string } | null {
  for (const p of parcele) {
    if (pointInRing(lon, lat, p.ring)) return { id: p.id, nume: p.nume };
  }
  return null;
}

// v2: distanța aproximativă (metri) între două puncte GPS apropiate —
// identică cu distantaMetri din get-combustibil-report v11 (aproximare
// echirectangulară, suficient de precisă pe distanțe mici).
function distantaMetri(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const latRad = (lat1 * Math.PI) / 180;
  const dLat = (lat2 - lat1) * 111_320;
  const dLon = (lon2 - lon1) * 111_320 * Math.cos(latRad);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

// v2: intervalul dintre două citiri consecutive contează ca "în funcțiune"
// dacă motorul era pornit LA ÎNCEPUTUL intervalului SAU utilajul s-a mișcat
// efectiv ≥PRAG_MISCARE_METRI până la citirea următoare — fallback identic cu
// intervalInFunctionare din get-combustibil-report v11, pentru cazul în care
// `contact` flichează fals tranzitoriu chiar în timpul lucrului real.
function intervalInFunctionare(prev: Citire, curr: Citire): boolean {
  if (prev.contact === true) return true;
  if (prev.latitudine == null || prev.longitudine == null || curr.latitudine == null || curr.longitudine == null) {
    return false;
  }
  return distantaMetri(prev.latitudine, prev.longitudine, curr.latitudine, curr.longitudine) >= PRAG_MISCARE_METRI;
}

// Vezi get-utilaj-istoric-parcele/index.ts pentru raționamentul complet:
// Supabase trunchiază implicit un .select() la 1000 de rânduri.
const PAGE_SIZE = 1000;
async function fetchToateRandurile(
  build: (from: number, to: number) => PromiseLike<{ data: Citire[] | null; error: { message: string } | null }>,
): Promise<{ data: Citire[]; error: string | null }> {
  const toate: Citire[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await build(offset, offset + PAGE_SIZE - 1);
    if (error) return { data: [], error: error.message };
    const pagina = data ?? [];
    toate.push(...pagina);
    if (pagina.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { data: toate, error: null };
}

interface Sesiune {
  utilaj_id: string;
  utilaj_nume: string;
  utilaj_recoltare: boolean;
  parcela_id: string;
  parcela_nume: string;
  inceput: string;
  sfarsit: string;
  ore: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Lipsește autentificarea.' }, 401);
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: callerUser },
    error: callerError,
  } = await callerClient.auth.getUser();

  if (callerError || !callerUser) {
    return jsonResponse({ error: 'Sesiune invalidă.' }, 401);
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from('utilizatori')
    .select('rol, ferma_id')
    .eq('id', callerUser.id)
    .maybeSingle();

  if (profileError || !callerProfile || (callerProfile.rol !== 'admin_central' && callerProfile.rol !== 'admin_ferma')) {
    return jsonResponse({ error: 'Doar administratorii pot vedea activitățile detectate.' }, 403);
  }

  const url = new URL(req.url);

  let fermaId: string;
  if (callerProfile.rol === 'admin_ferma') {
    if (!callerProfile.ferma_id) {
      return jsonResponse({ error: 'Contul tău nu are o fermă asociată.' }, 400);
    }
    fermaId = callerProfile.ferma_id;
  } else {
    const paramFerma = url.searchParams.get('ferma_id');
    if (!paramFerma) {
      return jsonResponse({ error: 'Lipsește ferma_id.' }, 400);
    }
    fermaId = paramFerma;
  }

  const zile = Math.min(30, Math.max(1, Number(url.searchParams.get('zile')) || 3));
  const de_la = new Date(Date.now() - zile * 24 * 60 * 60 * 1000).toISOString();

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: utilajeRaw, error: utilajeError } = await adminClient
    .from('utilaje')
    .select('id, nume, este_utilaj_recoltare')
    .eq('ferma_id', fermaId)
    .eq('activ', true);

  if (utilajeError) {
    return jsonResponse({ error: `Eroare la citirea utilajelor: ${utilajeError.message}` }, 500);
  }

  const utilaje = (utilajeRaw ?? []) as { id: string; nume: string; este_utilaj_recoltare: boolean }[];
  if (utilaje.length === 0) {
    return jsonResponse({ zile, de_la, ferma_id: fermaId, are_parcele_desenate: false, sesiuni: [] });
  }

  const { data: parceleRaw, error: parceleError } = await adminClient
    .from('parcele')
    .select('id, nume, poligon_harta')
    .eq('ferma_id', fermaId);

  if (parceleError) {
    return jsonResponse({ error: `Eroare la citirea parcelelor: ${parceleError.message}` }, 500);
  }

  const parcele = ((parceleRaw ?? []) as ParcelaRaw[])
    .map((p) => {
      const ring = poligonValid(p);
      return ring ? { id: p.id, nume: p.nume, ring } : null;
    })
    .filter((p): p is ParcelaRing => p !== null);

  if (parcele.length === 0) {
    return jsonResponse({ zile, de_la, ferma_id: fermaId, are_parcele_desenate: false, sesiuni: [] });
  }

  const utilajIds = utilaje.map((u) => u.id);

  // Sesiuni deja confirmate (transformate în operațiuni) pentru utilajele
  // acestei ferme, ca să nu le mai propunem din nou.
  const confirmatePorUtilaj = new Map<string, { start: number; stop: number }[]>();
  const { data: confirmateRaw, error: confirmateError } = await adminClient
    .from('operatiuni')
    .select('utilaj_id, sesiune_inceput, sesiune_sfarsit')
    .in('utilaj_id', utilajIds)
    .not('sesiune_inceput', 'is', null)
    .not('sesiune_sfarsit', 'is', null)
    .gte('sesiune_sfarsit', de_la);

  if (!confirmateError) {
    for (const c of (confirmateRaw ?? []) as { utilaj_id: string; sesiune_inceput: string; sesiune_sfarsit: string }[]) {
      const lista = confirmatePorUtilaj.get(c.utilaj_id) ?? [];
      lista.push({ start: new Date(c.sesiune_inceput).getTime(), stop: new Date(c.sesiune_sfarsit).getTime() });
      confirmatePorUtilaj.set(c.utilaj_id, lista);
    }
  }

  const sesiuni: Sesiune[] = [];

  for (const utilaj of utilaje) {
    const { data: citiri, error: citiriError } = await fetchToateRandurile((from, to) =>
      adminClient
        .from('combustibil_citiri')
        .select('data_ora, latitudine, longitudine, contact')
        .eq('utilaj_id', utilaj.id)
        .not('latitudine', 'is', null)
        .not('longitudine', 'is', null)
        .gte('data_ora', de_la)
        .order('data_ora', { ascending: true })
        .range(from, to),
    );

    if (citiriError || citiri.length < 2) continue;

    const confirmate = confirmatePorUtilaj.get(utilaj.id) ?? [];

    let current: { parcelaId: string; parcelaNume: string; start: string; end: string } | null = null;

    const inchideSiSalveaza = () => {
      if (!current) return;
      const durataMinute = (new Date(current.end).getTime() - new Date(current.start).getTime()) / 60_000;
      if (durataMinute > PRAG_MINIM_MINUTE) {
        const startMs = new Date(current.start).getTime();
        const endMs = new Date(current.end).getTime();
        const seSuprapune = confirmate.some((c) => startMs < c.stop && endMs > c.start);
        if (!seSuprapune) {
          sesiuni.push({
            utilaj_id: utilaj.id,
            utilaj_nume: utilaj.nume,
            utilaj_recoltare: utilaj.este_utilaj_recoltare,
            parcela_id: current.parcelaId,
            parcela_nume: current.parcelaNume,
            inceput: current.start,
            sfarsit: current.end,
            ore: Math.round((durataMinute / 60) * 10) / 10,
          });
        }
      }
      current = null;
    };

    for (let i = 1; i < citiri.length; i++) {
      const prev = citiri[i - 1];
      const curr = citiri[i];

      const deltaOre = (new Date(curr.data_ora).getTime() - new Date(prev.data_ora).getTime()) / 3_600_000;
      // v2: era `prev.contact === true` strict — acum contact SAU mișcare GPS
      // reală (vezi comentariul intervalInFunctionare de mai sus).
      const functionareOk = intervalInFunctionare(prev, curr);
      const parcelaPrev =
        functionareOk && prev.latitudine !== null && prev.longitudine !== null
          ? gasesteParcela(prev.latitudine, prev.longitudine, parcele)
          : null;
      const valid = functionareOk && parcelaPrev !== null && deltaOre > 0 && deltaOre <= MAX_GAP_ORE;

      if (valid && current && current.parcelaId === parcelaPrev!.id) {
        current.end = curr.data_ora;
      } else {
        inchideSiSalveaza();
        if (valid) {
          current = { parcelaId: parcelaPrev!.id, parcelaNume: parcelaPrev!.nume, start: prev.data_ora, end: curr.data_ora };
        }
      }
    }
    // Notă: NU închidem `current` rămas deschis la finalul buclei — vezi
    // comentariul de sus ("SESIUNI ÎN CURS"). O sesiune încă în desfășurare
    // nu e raportată până nu se încheie cu adevărat.
  }

  sesiuni.sort((a, b) => (a.inceput < b.inceput ? 1 : -1));

  return jsonResponse({ zile, de_la, ferma_id: fermaId, are_parcele_desenate: true, sesiuni });
});
