// supabase/functions/get-combustibil-parcele/index.ts
//
// Raport NOU (2026-09-24, cerere Radu): consum de motorină alocat pe
// PARCELĂ, nu doar per utilaj/zi ca vechiul get-combustibil-report. Radu,
// pentru calculul prețului de producție: "este esențial să putem aloca
// consumul de motorină al unui utilaj pe fiecare parcelă în parte [...]
// dacă un utilaj a lucrat fragmentat pe o parcelă, vreau să știu doar cât a
// lucrat în total pe parcela respectivă în intervalul dat, câtă motorină a
// consumat în parcela în intervalul dat".
//
// Cum se face alocarea: folosește sesiunile GPS deja confirmate în
// `operatiuni` (utilaj_id + sesiune_inceput + sesiune_sfarsit + parcela_id
// — vezi get-sesiuni-detectate / ActivitatiParceleScreen, unde adminul
// confirmă fiecare sesiune detectată automat din traseul GPS). Pentru
// fiecare sesiune confirmată a unui utilaj, se calculează consumul prin
// ACELAȘI BILANȚ DE MASĂ ca în get-combustibil-report v15 (nivelul
// senzorului la începutul sesiunii minus nivelul la sfârșit, plus
// realimentările confirmate din acel interval), doar că intervalul e
// granița exactă a sesiunii (oră cu zecimale), nu ziua calendaristică.
// Sesiunile pe aceeași parcelă din intervalul cerut se ÎNSUMEAZĂ (ore +
// litri) — exact cererea lui Radu pentru munca fragmentată.
//
// Pe lângă defalcarea pe parcele, raportul include și consumul total
// cumulat PE ZI (aceeași logică `consumZilnic` ca în get-combustibil-report
// v15) — util ca reper: suma litrilor alocați pe parcele + timpul
// nealocat (mers între parcele, staționare, sesiuni încă neconfirmate) ar
// trebui să se apropie de acest total, dar nu va coincide perfect — normal,
// nu e un bug.
//
// Utilajele NECALIBRATE (fără tanc_capacitate_litri) apar cu orele lucrate
// pe fiecare parcelă (calculate GPS, nu au nevoie de senzor de combustibil),
// dar litri_total = null pentru fiecare parcelă.
//
// Doar admin_central (la fel ca get-combustibil-report / get-cost-productie).

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

// ── Constante — identice cu get-combustibil-report v15 (vezi acel fișier
// pentru raționamentul complet din spatele fiecăreia). ──
const PRAG_MINIM_EVENIMENT_L = 15;
const TOLERANTA_CAPACITATE = 1.05;
const MAX_GAP_ORE = 1;
const PRAG_ZGOMOT_L = 5;
const FEREASTRA_REVENIRE_MINUTE = 15;
const PRAG_MISCARE_METRI = 20;

interface Citire {
  data_ora: string;
  nivel_litri: number;
  contact: boolean | null;
  latitudine: number | null;
  longitudine: number | null;
}

interface CitireIndexata {
  citire: Citire;
  index: number;
}

interface Eveniment {
  data_ora: string;
  delta_litri: number;
}

interface ZiConsum {
  data: string;
  consum_litri: number;
  ore_functionare: number;
}

const PAGE_SIZE = 1000;
async function fetchToateRandurile<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: string | null }> {
  const toate: T[] = [];
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

function filtreazaCitiriPlauzibile(rows: Citire[], capacitate: number): Citire[] {
  const prag = capacitate * TOLERANTA_CAPACITATE;
  return rows.filter((r) => r.nivel_litri >= 0 && r.nivel_litri <= prag);
}

function eliminaFluctuatiiTranzitorii(rows: Citire[]): Citire[] {
  if (rows.length === 0) return [];
  const rezultat: Citire[] = [rows[0]];
  let i = 1;
  while (i < rows.length) {
    const ancora = rezultat[rezultat.length - 1];
    const r = rows[i];
    const diff = Math.abs(r.nivel_litri - ancora.nivel_litri);

    if (diff < PRAG_MINIM_EVENIMENT_L) {
      rezultat.push(r);
      i++;
      continue;
    }

    let j = i;
    let gasitRevenire = -1;
    while (j < rows.length) {
      const minute = (new Date(rows[j].data_ora).getTime() - new Date(ancora.data_ora).getTime()) / 60_000;
      if (minute > FEREASTRA_REVENIRE_MINUTE) break;
      if (Math.abs(rows[j].nivel_litri - ancora.nivel_litri) < PRAG_MINIM_EVENIMENT_L) {
        gasitRevenire = j;
        break;
      }
      j++;
    }

    if (gasitRevenire >= 0) {
      i = gasitRevenire;
      continue;
    }

    rezultat.push(r);
    i++;
  }
  return rezultat;
}

function extrageExtreme(rows: Citire[]): CitireIndexata[] {
  if (rows.length === 0) return [];

  const extreme: CitireIndexata[] = [{ citire: rows[0], index: 0 }];
  let directie = 0;
  let candidat: CitireIndexata = { citire: rows[0], index: 0 };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];

    if (directie === 0) {
      const delta = r.nivel_litri - extreme[0].citire.nivel_litri;
      if (Math.abs(delta) < PRAG_ZGOMOT_L) continue;
      directie = delta > 0 ? 1 : -1;
      candidat = { citire: r, index: i };
      continue;
    }

    if (directie === 1) {
      if (r.nivel_litri >= candidat.citire.nivel_litri) {
        candidat = { citire: r, index: i };
      } else if (candidat.citire.nivel_litri - r.nivel_litri >= PRAG_ZGOMOT_L) {
        extreme.push(candidat);
        directie = -1;
        candidat = { citire: r, index: i };
      }
    } else {
      if (r.nivel_litri <= candidat.citire.nivel_litri) {
        candidat = { citire: r, index: i };
      } else if (r.nivel_litri - candidat.citire.nivel_litri >= PRAG_ZGOMOT_L) {
        extreme.push(candidat);
        directie = 1;
        candidat = { citire: r, index: i };
      }
    }
  }

  if (candidat.index !== extreme[extreme.length - 1].index) {
    extreme.push(candidat);
  }

  return extreme;
}

function distantaMetri(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const latRad = (lat1 * Math.PI) / 180;
  const dLat = (lat2 - lat1) * 111_320;
  const dLon = (lon2 - lon1) * 111_320 * Math.cos(latRad);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function intervalInFunctionare(prev: Citire, curr: Citire): boolean {
  if (prev.contact === true) return true;
  if (prev.latitudine == null || prev.longitudine == null || curr.latitudine == null || curr.longitudine == null) {
    return false;
  }
  return distantaMetri(prev.latitudine, prev.longitudine, curr.latitudine, curr.longitudine) >= PRAG_MISCARE_METRI;
}

const FORMATTER_ZI_LOCALA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bucharest',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function ziuaLocala(dataIso: string): string {
  const parts = FORMATTER_ZI_LOCALA.formatToParts(new Date(dataIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function offsetLocalOre(dataStr: string): number {
  const ancora = new Date(`${dataStr}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest',
    timeZoneName: 'shortOffset',
  }).formatToParts(ancora);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2';
  const m = tz.match(/GMT([+-]\d+)/);
  return m ? parseInt(m[1], 10) : 2;
}

function inceputZileiLocaleUTC(dataStr: string): Date {
  const offsetOre = offsetLocalOre(dataStr);
  return new Date(new Date(`${dataStr}T00:00:00.000Z`).getTime() - offsetOre * 3_600_000);
}

function ziuaUrmatoare(dataStr: string): string {
  const d = new Date(`${dataStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function primaZiLuniiCurente(): string {
  const acum = new Date();
  return `${acum.getUTCFullYear()}-${String(acum.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function primaSiUltimaCitirePeZi(rows: Citire[]): Map<string, { prima: number; ultima: number }> {
  const rezultat = new Map<string, { prima: number; ultima: number }>();
  for (const r of rows) {
    const zi = ziuaLocala(r.data_ora);
    const existent = rezultat.get(zi);
    if (!existent) {
      rezultat.set(zi, { prima: r.nivel_litri, ultima: r.nivel_litri });
    } else {
      existent.ultima = r.nivel_litri;
    }
  }
  return rezultat;
}

function realimentariPeZi(realimentari: Eveniment[]): Map<string, number> {
  const rezultat = new Map<string, number>();
  for (const e of realimentari) {
    const zi = ziuaLocala(e.data_ora);
    rezultat.set(zi, (rezultat.get(zi) ?? 0) + e.delta_litri);
  }
  return rezultat;
}

function consumZilnic(rows: Citire[], realimentari: Eveniment[]): ZiConsum[] {
  const niveluriPeZi = primaSiUltimaCitirePeZi(rows);
  const realimentariZi = realimentariPeZi(realimentari);

  const orePeZi = new Map<string, number>();
  for (let i = 0; i < rows.length - 1; i++) {
    const prev = rows[i];
    const curr = rows[i + 1];
    if (!intervalInFunctionare(prev, curr)) continue;
    const deltaOre = (new Date(curr.data_ora).getTime() - new Date(prev.data_ora).getTime()) / 3_600_000;
    if (deltaOre <= 0 || deltaOre > MAX_GAP_ORE) continue;
    const zi = ziuaLocala(prev.data_ora);
    orePeZi.set(zi, (orePeZi.get(zi) ?? 0) + deltaOre);
  }

  const toateZilele = new Set<string>([...niveluriPeZi.keys(), ...orePeZi.keys()]);

  return Array.from(toateZilele)
    .sort((a, b) => (a < b ? -1 : 1))
    .map((zi) => {
      const niveluri = niveluriPeZi.get(zi);
      const netScazut = niveluri ? niveluri.prima - niveluri.ultima : 0;
      const realimentatZi = realimentariZi.get(zi) ?? 0;
      const consum = Math.round(Math.max(0, netScazut + realimentatZi) * 10) / 10;
      const ore = Math.round((orePeZi.get(zi) ?? 0) * 10) / 10;
      return { data: zi, consum_litri: consum, ore_functionare: ore };
    });
}

// ── NOU: bilanț de masă pe un interval ARBITRAR (granița unei sesiuni GPS
// pe o parcelă), nu pe o zi calendaristică. ──

// Nivelul (litri) cel mai apropiat de un moment dat, dintr-o serie de citiri
// CURĂȚATE (după filtreazaCitiriPlauzibile + eliminaFluctuatiiTranzitorii),
// sortată crescător. Preferă ultima citire ≤ moment; dacă momentul e înainte
// de prima citire disponibilă, folosește prima citire (cel mai apropiat
// reper posibil).
function nivelLaMoment(rows: Citire[], momentIso: string): number | null {
  if (rows.length === 0) return null;
  const momentMs = new Date(momentIso).getTime();
  let rezultat: Citire | null = null;
  for (const r of rows) {
    if (new Date(r.data_ora).getTime() <= momentMs) {
      rezultat = r;
    } else {
      break;
    }
  }
  return rezultat ? rezultat.nivel_litri : rows[0].nivel_litri;
}

function sumaRealimentariInInterval(realimentari: Eveniment[], startIso: string, endIso: string): number {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  let suma = 0;
  for (const e of realimentari) {
    const ms = new Date(e.data_ora).getTime();
    if (ms > startMs && ms <= endMs) suma += e.delta_litri;
  }
  return suma;
}

// Consumul (bilanț de masă) al UNEI sesiuni GPS pe o parcelă — nivelul la
// începutul sesiunii minus nivelul la sfârșit, plus realimentările
// confirmate din exact acel interval. null dacă nu există deloc citiri de
// combustibil pentru utilaj (utilaj necalibrat).
function consumSesiune(rows: Citire[], realimentari: Eveniment[], startIso: string, endIso: string): number | null {
  const nivelStart = nivelLaMoment(rows, startIso);
  const nivelEnd = nivelLaMoment(rows, endIso);
  if (nivelStart === null || nivelEnd === null) return null;
  const realimentatInterval = sumaRealimentariInInterval(realimentari, startIso, endIso);
  return Math.max(0, nivelStart - nivelEnd + realimentatInterval);
}

interface ParcelaAgregat {
  parcela_id: string;
  parcela_nume: string;
  ore_total: number;
  litri_total: number | null;
  numar_sesiuni: number;
}

interface OperatiuneSesiune {
  id: string;
  parcela_id: string;
  sesiune_inceput: string;
  sesiune_sfarsit: string;
  parcele: { nume: string } | null;
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
    .select('rol')
    .eq('id', callerUser.id)
    .maybeSingle();

  if (profileError || callerProfile?.rol !== 'admin_central') {
    return jsonResponse({ error: 'Doar admin general poate vedea raportul de combustibil pe parcele.' }, 403);
  }

  const url = new URL(req.url);
  const deLaParam = url.searchParams.get('de_la');
  const panaLaParam = url.searchParams.get('pana_la');
  const fermaIdParam = url.searchParams.get('ferma_id');
  const REGEX_DATA_ZI = /^\d{4}-\d{2}-\d{2}$/;

  const deLaStr = deLaParam && REGEX_DATA_ZI.test(deLaParam) ? deLaParam : primaZiLuniiCurente();
  const start = inceputZileiLocaleUTC(deLaStr);
  const de_la = start.toISOString();

  let pana_la: string | null = null;
  if (panaLaParam && REGEX_DATA_ZI.test(panaLaParam)) {
    const stopExclusiv = inceputZileiLocaleUTC(ziuaUrmatoare(panaLaParam));
    if (stopExclusiv.getTime() <= start.getTime()) {
      return jsonResponse({ error: 'Interval invalid: data de sfârșit trebuie să fie după data de început.' }, 400);
    }
    pana_la = stopExclusiv.toISOString();
  }
  // Padding de 1 zi peste `pana_la` pentru citirile de combustibil — o
  // sesiune care începe ultima zi a intervalului poate continua puțin după
  // miezul nopții; vrem nivelul de la sfârșitul ei, nu doar cel de la
  // granița exactă a intervalului cerut.
  const panaLaPadded = pana_la ? new Date(new Date(pana_la).getTime() + 24 * 3_600_000).toISOString() : null;

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let utilajeQuery = adminClient
    .from('utilaje')
    .select('id, nume, tanc_capacitate_litri, ferma_id, ferme(nume)')
    .eq('activ', true);
  if (fermaIdParam) utilajeQuery = utilajeQuery.eq('ferma_id', fermaIdParam);

  const { data: utilajeRaw, error: utilajeError } = await utilajeQuery;
  if (utilajeError) {
    return jsonResponse({ error: `Eroare la citirea utilajelor: ${utilajeError.message}` }, 500);
  }

  const rezultate = [];

  for (const u of (utilajeRaw ?? []) as any[]) {
    const calibrat = typeof u.tanc_capacitate_litri === 'number' && u.tanc_capacitate_litri > 0;

    let opQuery = adminClient
      .from('operatiuni')
      .select('id, parcela_id, sesiune_inceput, sesiune_sfarsit, parcele(nume)')
      .eq('utilaj_id', u.id)
      .not('sesiune_inceput', 'is', null)
      .not('sesiune_sfarsit', 'is', null)
      .gte('sesiune_inceput', de_la)
      .order('sesiune_inceput', { ascending: true });
    if (pana_la) opQuery = opQuery.lt('sesiune_inceput', pana_la);

    const { data: sesiuniRaw, error: sesiuniError } = await opQuery;
    if (sesiuniError) {
      rezultate.push({ utilaj_id: u.id, nume: u.nume, ferma_nume: u.ferme?.nume ?? null, calibrat, eroare: sesiuniError.message });
      continue;
    }
    const sesiuni = (sesiuniRaw ?? []) as unknown as OperatiuneSesiune[];

    let rows: Citire[] = [];
    let realimentari: Eveniment[] = [];
    let zileConsum: ZiConsum[] = [];

    if (calibrat && sesiuni.length > 0) {
      const { data: citiri, error: citiriError } = await fetchToateRandurile<Citire>((from, to) => {
        let q = adminClient
          .from('combustibil_citiri')
          .select('data_ora, nivel_litri, contact, latitudine, longitudine')
          .eq('utilaj_id', u.id)
          .not('nivel_litri', 'is', null)
          .gte('data_ora', de_la);
        if (panaLaPadded) q = q.lt('data_ora', panaLaPadded);
        return q.order('data_ora', { ascending: true }).range(from, to);
      });

      if (!citiriError) {
        rows = eliminaFluctuatiiTranzitorii(filtreazaCitiriPlauzibile(citiri, u.tanc_capacitate_litri as number));
        const extreme = extrageExtreme(rows);
        for (let i = 1; i < extreme.length; i++) {
          const prev = extreme[i - 1].citire;
          const curr = extreme[i].citire;
          const delta = Number(curr.nivel_litri) - Number(prev.nivel_litri);
          if (delta >= PRAG_MINIM_EVENIMENT_L) {
            realimentari.push({ data_ora: curr.data_ora, delta_litri: Math.round(delta * 10) / 10 });
          }
        }
        // consum_zilnic se calculează pe intervalul CERUT, nu pe fereastra
        // padded folosită doar pentru capătul sesiunilor — filtrăm citirile
        // padded suplimentare înainte de a apela consumZilnic.
        const rowsInterval = pana_la ? rows.filter((r) => r.data_ora < pana_la!) : rows;
        const realimentariInterval = pana_la ? realimentari.filter((e) => e.data_ora < pana_la!) : realimentari;
        zileConsum = consumZilnic(rowsInterval, realimentariInterval);
      }
    }

    const perParcela = new Map<string, ParcelaAgregat>();
    for (const s of sesiuni) {
      const oreSesiune = (new Date(s.sesiune_sfarsit).getTime() - new Date(s.sesiune_inceput).getTime()) / 3_600_000;
      const litriSesiune = calibrat ? consumSesiune(rows, realimentari, s.sesiune_inceput, s.sesiune_sfarsit) : null;

      const existent = perParcela.get(s.parcela_id) ?? {
        parcela_id: s.parcela_id,
        parcela_nume: s.parcele?.nume ?? '—',
        ore_total: 0,
        litri_total: calibrat ? 0 : null,
        numar_sesiuni: 0,
      };
      existent.ore_total += oreSesiune;
      if (calibrat && litriSesiune !== null && existent.litri_total !== null) {
        existent.litri_total += litriSesiune;
      }
      existent.numar_sesiuni += 1;
      perParcela.set(s.parcela_id, existent);
    }

    const parcele = Array.from(perParcela.values())
      .map((p) => ({
        ...p,
        ore_total: Math.round(p.ore_total * 10) / 10,
        litri_total: p.litri_total !== null ? Math.round(p.litri_total * 10) / 10 : null,
      }))
      .sort((a, b) => b.ore_total - a.ore_total);

    rezultate.push({
      utilaj_id: u.id,
      nume: u.nume,
      ferma_nume: u.ferme?.nume ?? null,
      calibrat,
      parcele,
      consum_zilnic: zileConsum,
    });
  }

  return jsonResponse({ de_la, pana_la, rezultate });
});
