// supabase/functions/get-cost-productie/index.ts
//
// Cost de producție per fermă + lună calendaristică, pentru
// /dashboard/cost-productie. Doar admin_central. Combină patru surse de
// cost, toate deja existente separat în aplicație:
//   - manoperă:   operatiuni.ore_lucru × ferme.cost_ora_lucru
//   - materiale:  operatiuni_substante.cantitate × substante.pret_unitar
//                 (pret_unitar e media ponderată din alimentările substanțe —
//                 vezi alimenteaza_substanta())
//   - indirecte:  cheltuieli_indirecte.valoare (facturi, salarii, chirii etc.,
//                 introduse de admin_central pe /cheltuieli-indirecte)
//   - combustibil: consum lunar dedus din combustibil_citiri, prin BILANȚ DE
//                 MASĂ (vezi v2 mai jos), înmulțit cu prețul mediu ponderat al
//                 motorinei cumpărate de fermă PÂNĂ la sfârșitul lunii
//                 respective (rezervor_alimentari.pret_litru)
//
// De ce edge function și nu query direct din pagină: agregarea combustibilului
// are nevoie de service role (bypass RLS pe combustibil_citiri, posibil multe
// mii de rânduri per utilaj) + paginare explicită (vezi fetchToateRandurile),
// exact ca în get-rezervor-central/get-combustibil-report. Restul costurilor
// sunt ieftine, dar le calculăm tot aici ca să existe UN singur loc cu
// rezultatul final (evită dublarea logicii de grupare pe lună în frontend).
//
// v2, 2026-09-24 (Radu) — ALOCARE PE PARCELE: cerere explicită — "este
// esențial să putem aloca consumul de motorină al unui utilaj pe fiecare
// parcelă în parte [...] astfel voi avea costul de producție alocat direct
// pe parcele". Fiecare rând fermă+lună capătă acum un array `parcele` —
// manoperă + materiale + combustibil (litri și cost) DEFALCATE pe fiecare
// parcelă lucrată în luna respectivă, folosind exact aceleași sesiuni GPS
// confirmate (operatiuni.utilaj_id + sesiune_inceput + sesiune_sfarsit) ca
// noul raport dedicat get-combustibil-parcele — vezi acel fișier pentru
// raționamentul complet al bilanțului de masă pe interval de sesiune.
// Manoperă și materiale erau deja atribuibile per parcelă (operatiuni.
// parcela_id există dintotdeauna) — doar combustibilul lipsea.
//
// Totalul `combustibil_litri`/`combustibil_cost` la nivel de fermă+lună
// RĂMÂNE calculat separat, prin bilanț de masă pe toată luna (nu mai prin
// simpla sumă a scăderilor negative ca în v1 — acel algoritm avea aceeași
// problemă de dublă numărare a zgomotului de senzor identificată și fixată
// în get-combustibil-report v15). Suma litrilor alocați pe parcele nu
// coincide neapărat cu acest total — diferența (`combustibil_nealocat_litri`)
// reprezintă timp/motorină ne-atribuibil unei parcele confirmate (deplasare
// între parcele, staționare, sesiuni încă neconfirmate în /activitati-parcele)
// și e afișată separat, transparent, nu ascunsă.
//
// IMPORTANT: pagina veche `/dashboard/cost-productie` interoga tabelele
// direct dintr-un Server Component Next.js cu clientul Supabase bazat pe
// cheia anonă (fără sesiunea utilizatorului) — RLS pe ferme/parcele/
// operatiuni/operatiuni_substante/cheltuieli_indirecte cere `authenticated`,
// deci acele query-uri întorceau mereu 0 rânduri. Raportul era practic mort
// (tabel gol) încă de la construire. Fixat aici + în frontend (acum client
// component autentificat, ca restul aplicației).

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

// Vezi get-rezervor-central/index.ts — aceeași toleranță, ca citirile brute
// necalibrate ("kvants") să nu umfle consumul calculat.
const TOLERANTA_CAPACITATE = 1.05;
// v2: aceleași praguri ca get-combustibil-report v15 / get-combustibil-parcele
// — vezi acele fișiere pentru raționamentul complet.
const PRAG_MINIM_EVENIMENT_L = 15;
const PRAG_ZGOMOT_L = 5;
const FEREASTRA_REVENIRE_MINUTE = 15;

interface Citire {
  data_ora: string;
  nivel_litri: number;
}

interface CitireIndexata {
  citire: Citire;
  index: number;
}

interface Eveniment {
  data_ora: string;
  delta_litri: number;
}

// Vezi get-utilaj-istoric-parcele/index.ts: .select() implicit se
// trunchiază la 1000 de rânduri — paginare explicită obligatorie.
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

function filtreazaCitiriPlauzibile(rows: Citire[], capacitate: number): Citire[] {
  const prag = capacitate * TOLERANTA_CAPACITATE;
  return rows.filter((r) => r.nivel_litri >= 0 && r.nivel_litri <= prag);
}

// v2: identic cu get-combustibil-report v15 / get-combustibil-parcele —
// elimină excursii tranzitorii de senzor (salt care revine singur în
// câteva minute), ca să nu fie confundate cu realimentări/scăderi reale.
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

// v2: extrage punctele de întoarcere (extreme locale, histerezis) — aceeași
// logică ca get-combustibil-report v15, necesară ca să detectăm doar
// realimentările REALE (salturi pozitive peste prag), nu zgomotul fin.
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
  if (candidat.index !== extreme[extreme.length - 1].index) extreme.push(candidat);
  return extreme;
}

// v2: nivelul cel mai apropiat de un moment dat, dintr-o serie curățată,
// sortată crescător — vezi get-combustibil-parcele pentru raționament.
function nivelLaMoment(rows: Citire[], momentIso: string): number | null {
  if (rows.length === 0) return null;
  const momentMs = new Date(momentIso).getTime();
  let rezultat: Citire | null = null;
  for (const r of rows) {
    if (new Date(r.data_ora).getTime() <= momentMs) rezultat = r;
    else break;
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

function consumSesiune(rows: Citire[], realimentari: Eveniment[], startIso: string, endIso: string): number | null {
  const nivelStart = nivelLaMoment(rows, startIso);
  const nivelEnd = nivelLaMoment(rows, endIso);
  if (nivelStart === null || nivelEnd === null) return null;
  const realimentatInterval = sumaRealimentariInInterval(realimentari, startIso, endIso);
  return Math.max(0, nivelStart - nivelEnd + realimentatInterval);
}

function perioada(data: string): string {
  // 'data' e deja 'YYYY-MM-DD' (coloană date) sau ISO timestamp — primele 7
  // caractere dau 'YYYY-MM' fără conversii de fus orar (evită off-by-one la
  // limita de lună pe care ar introduce-o new Date().toISOString()).
  return data.slice(0, 7);
}

// v2: bilanț de masă LUNAR — prima și ultima citire ale fiecărei luni
// ("YYYY-MM", din perioada() de mai sus), plus realimentările confirmate din
// aceeași lună. Înlocuiește suma brută a scăderilor negative din v1, care
// avea aceeași problemă de dublă numărare a zgomotului de senzor fixată deja
// în get-combustibil-report v15.
function consumPeLuna(rows: Citire[], realimentari: Eveniment[]): Map<string, number> {
  const niveluriPeLuna = new Map<string, { prima: number; ultima: number }>();
  for (const r of rows) {
    const luna = perioada(r.data_ora);
    const existent = niveluriPeLuna.get(luna);
    if (!existent) niveluriPeLuna.set(luna, { prima: r.nivel_litri, ultima: r.nivel_litri });
    else existent.ultima = r.nivel_litri;
  }
  const realimentariPeLuna = new Map<string, number>();
  for (const e of realimentari) {
    const luna = perioada(e.data_ora);
    realimentariPeLuna.set(luna, (realimentariPeLuna.get(luna) ?? 0) + e.delta_litri);
  }
  const rezultat = new Map<string, number>();
  for (const [luna, niveluri] of niveluriPeLuna) {
    const netScazut = niveluri.prima - niveluri.ultima;
    const realimentatLuna = realimentariPeLuna.get(luna) ?? 0;
    rezultat.set(luna, Math.max(0, netScazut + realimentatLuna));
  }
  return rezultat;
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
    return jsonResponse({ error: 'Doar admin general poate vedea costul de producție.' }, 403);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const [fermeRes, parceleRes, operatiuniRes, materialeRes, indirecteRes, alimentariRes, utilajeRes] =
    await Promise.all([
      adminClient.from('ferme').select('id, nume, cost_ora_lucru'),
      adminClient.from('parcele').select('id, ferma_id, nume, suprafata_mp'),
      adminClient
        .from('operatiuni')
        .select('id, parcela_id, data, ore_lucru, utilaj_id, sesiune_inceput, sesiune_sfarsit, parcele(ferma_id)'),
      adminClient.from('operatiuni_substante').select('operatiune_id, cantitate, substante(pret_unitar)'),
      adminClient.from('cheltuieli_indirecte').select('ferma_id, data, valoare'),
      adminClient
        .from('rezervor_alimentari')
        .select('ferma_id, data_ora, cantitate_litri, pret_litru')
        .order('data_ora', { ascending: true }),
      adminClient.from('utilaje').select('id, ferma_id, tanc_capacitate_litri').eq('activ', true),
    ]);

  for (const [label, res] of [
    ['ferme', fermeRes],
    ['parcele', parceleRes],
    ['operatiuni', operatiuniRes],
    ['operatiuni_substante', materialeRes],
    ['cheltuieli_indirecte', indirecteRes],
    ['rezervor_alimentari', alimentariRes],
    ['utilaje', utilajeRes],
  ] as const) {
    if (res.error) {
      return jsonResponse({ error: `Eroare la citirea ${label}: ${res.error.message}` }, 500);
    }
  }

  const ferme = (fermeRes.data ?? []) as { id: string; nume: string; cost_ora_lucru: number | null }[];
  const parcele = (parceleRes.data ?? []) as { id: string; ferma_id: string; nume: string; suprafata_mp: number | null }[];
  const operatiuni = (operatiuniRes.data ?? []) as any[];
  const materiale = (materialeRes.data ?? []) as any[];
  const indirecte = (indirecteRes.data ?? []) as { ferma_id: string; data: string; valoare: number }[];
  const alimentari = (alimentariRes.data ?? []) as {
    ferma_id: string;
    data_ora: string;
    cantitate_litri: number;
    pret_litru: number;
  }[];
  const utilaje = (utilajeRes.data ?? []) as { id: string; ferma_id: string; tanc_capacitate_litri: number | null }[];

  const numeParcela = new Map<string, string>(parcele.map((p) => [p.id, p.nume]));

  // --- Suprafață per fermă (constantă, nu variază pe lună) ---
  const suprafataPerFerma = new Map<string, number>();
  for (const p of parcele) {
    suprafataPerFerma.set(p.ferma_id, (suprafataPerFerma.get(p.ferma_id) ?? 0) + Number(p.suprafata_mp || 0));
  }

  const costOraPerFerma = new Map<string, number>(ferme.map((f) => [f.id, Number(f.cost_ora_lucru || 0)]));

  // chei compuse: "fermaId|YYYY-MM" (nivel fermă+lună) și
  // "fermaId|YYYY-MM|parcelaId" (v2, nivel parcelă) pentru toate liniile.
  const cheie = (fermaId: string, period: string) => `${fermaId}|${period}`;
  const cheieParcela = (fermaId: string, period: string, parcelaId: string) => `${fermaId}|${period}|${parcelaId}`;

  const laborByCheie = new Map<string, number>();
  const materialByCheie = new Map<string, number>();
  const indirectByCheie = new Map<string, number>();
  const fuelLitriByCheie = new Map<string, number>();
  const periodsByFerma = new Map<string, Set<string>>();

  const laborByParcelaCheie = new Map<string, number>();
  const materialByParcelaCheie = new Map<string, number>();
  const fuelLitriByParcelaCheie = new Map<string, number>();
  // parcelaId -> {fermaId, period} distincte apărute, pentru asamblarea finală
  const parceleByCheie = new Map<string, Set<string>>(); // cheie(fermaId,period) -> set de parcela_id

  function adaugaPerioada(fermaId: string, period: string) {
    if (!periodsByFerma.has(fermaId)) periodsByFerma.set(fermaId, new Set());
    periodsByFerma.get(fermaId)!.add(period);
  }

  function adaugaParcelaLaCheie(fermaId: string, period: string, parcelaId: string) {
    const k = cheie(fermaId, period);
    if (!parceleByCheie.has(k)) parceleByCheie.set(k, new Set());
    parceleByCheie.get(k)!.add(parcelaId);
  }

  // --- Manoperă (+ hartă operatiune_id -> {fermaId, period, parcelaId} pentru materiale) ---
  const opInfo = new Map<string, { fermaId: string; period: string; parcelaId: string }>();
  for (const op of operatiuni) {
    const fermaId = op.parcele?.ferma_id;
    if (!fermaId || !op.data || !op.parcela_id) continue;
    const period = perioada(op.data);
    opInfo.set(op.id, { fermaId, period, parcelaId: op.parcela_id });
    const costOra = costOraPerFerma.get(fermaId) ?? 0;
    const ore = Number(op.ore_lucru || 0);
    const val = ore * costOra;

    const k = cheie(fermaId, period);
    laborByCheie.set(k, (laborByCheie.get(k) ?? 0) + val);
    adaugaPerioada(fermaId, period);

    const kp = cheieParcela(fermaId, period, op.parcela_id);
    laborByParcelaCheie.set(kp, (laborByParcelaCheie.get(kp) ?? 0) + val);
    adaugaParcelaLaCheie(fermaId, period, op.parcela_id);
  }

  // --- Materiale (substanțe), pe luna operațiunii lor ---
  for (const m of materiale) {
    const info = opInfo.get(m.operatiune_id);
    if (!info) continue;
    const pret = Number(m.substante?.pret_unitar || 0);
    const qty = Number(m.cantitate || 0);
    const val = pret * qty;

    const k = cheie(info.fermaId, info.period);
    materialByCheie.set(k, (materialByCheie.get(k) ?? 0) + val);
    adaugaPerioada(info.fermaId, info.period);

    const kp = cheieParcela(info.fermaId, info.period, info.parcelaId);
    materialByParcelaCheie.set(kp, (materialByParcelaCheie.get(kp) ?? 0) + val);
    adaugaParcelaLaCheie(info.fermaId, info.period, info.parcelaId);
  }

  // --- Cheltuieli indirecte (rămân doar la nivel de fermă — nu au parcela_id) ---
  for (const item of indirecte) {
    if (!item.ferma_id || !item.data) continue;
    const period = perioada(item.data);
    const k = cheie(item.ferma_id, period);
    indirectByCheie.set(k, (indirectByCheie.get(k) ?? 0) + Number(item.valoare || 0));
    adaugaPerioada(item.ferma_id, period);
  }

  // --- Preț mediu ponderat al motorinei per fermă, ca funcție cumulativă în timp ---
  const alimentariByFerma = new Map<string, { data_ora: string; pretMediuCumulativ: number }[]>();
  {
    const cumulativ = new Map<string, { litri: number; valoare: number }>();
    for (const a of alimentari) {
      const stare = cumulativ.get(a.ferma_id) ?? { litri: 0, valoare: 0 };
      stare.litri += Number(a.cantitate_litri);
      stare.valoare += Number(a.cantitate_litri) * Number(a.pret_litru);
      cumulativ.set(a.ferma_id, stare);

      const pretMediuCumulativ = stare.litri > 0 ? stare.valoare / stare.litri : 0;
      if (!alimentariByFerma.has(a.ferma_id)) alimentariByFerma.set(a.ferma_id, []);
      alimentariByFerma.get(a.ferma_id)!.push({ data_ora: a.data_ora, pretMediuCumulativ });
    }
  }

  function pretMotorinaPanaLaSfarsitulLunii(fermaId: string, period: string): number | null {
    const puncte = alimentariByFerma.get(fermaId);
    if (!puncte || puncte.length === 0) return null;
    const [an, luna] = period.split('-').map(Number);
    const sfarsitLuna = new Date(Date.UTC(an, luna, 1)).toISOString();
    let ultimul: number | null = null;
    for (const p of puncte) {
      if (p.data_ora < sfarsitLuna) ultimul = p.pretMediuCumulativ;
      else break;
    }
    return ultimul;
  }

  // --- Consum de motorină per fermă+lună (bilanț de masă) și per
  // fermă+lună+parcelă (sumă de sesiuni GPS confirmate) — v2 ---
  const utilajeCalibrate = utilaje.filter(
    (u) => typeof u.tanc_capacitate_litri === 'number' && (u.tanc_capacitate_litri as number) > 0,
  );

  // Sesiuni confirmate, grupate pe utilaj — reutilizăm array-ul `operatiuni`
  // deja încărcat mai sus, nu mai facem un query separat.
  const sesiuniPeUtilaj = new Map<string, { fermaId: string; period: string; parcelaId: string; start: string; stop: string }[]>();
  for (const op of operatiuni) {
    if (!op.utilaj_id || !op.sesiune_inceput || !op.sesiune_sfarsit || !op.parcela_id) continue;
    const fermaId = op.parcele?.ferma_id;
    if (!fermaId) continue;
    const lista = sesiuniPeUtilaj.get(op.utilaj_id) ?? [];
    lista.push({
      fermaId,
      period: perioada(op.data),
      parcelaId: op.parcela_id,
      start: op.sesiune_inceput,
      stop: op.sesiune_sfarsit,
    });
    sesiuniPeUtilaj.set(op.utilaj_id, lista);
  }

  for (const u of utilajeCalibrate) {
    const { data: citiri, error: citiriError } = await fetchToateRandurile((from, to) =>
      adminClient
        .from('combustibil_citiri')
        .select('data_ora, nivel_litri')
        .eq('utilaj_id', u.id)
        .not('nivel_litri', 'is', null)
        .order('data_ora', { ascending: true })
        .range(from, to),
    );
    if (citiriError) continue;

    const rows = eliminaFluctuatiiTranzitorii(filtreazaCitiriPlauzibile(citiri, u.tanc_capacitate_litri as number));

    // Realimentările confirmate (salturi pozitive peste prag) pe tot
    // istoricul utilajului — folosite atât pentru bilanțul lunar, cât și
    // pentru bilanțul per sesiune (defalcarea pe parcele, mai jos).
    const extreme = extrageExtreme(rows);
    const realimentari: Eveniment[] = [];
    for (let i = 1; i < extreme.length; i++) {
      const prev = extreme[i - 1].citire;
      const curr = extreme[i].citire;
      const delta = Number(curr.nivel_litri) - Number(prev.nivel_litri);
      if (delta >= PRAG_MINIM_EVENIMENT_L) {
        realimentari.push({ data_ora: curr.data_ora, delta_litri: delta });
      }
    }

    // Total lunar (bilanț de masă) — nivelul top-level `combustibil_litri`.
    const consumLunar = consumPeLuna(rows, realimentari);
    for (const [luna, litri] of consumLunar) {
      const k = cheie(u.ferma_id, luna);
      fuelLitriByCheie.set(k, (fuelLitriByCheie.get(k) ?? 0) + litri);
      adaugaPerioada(u.ferma_id, luna);
    }

    // Defalcare pe parcele — o sesiune GPS confirmată la un moment dat.
    const sesiuni = sesiuniPeUtilaj.get(u.id) ?? [];
    for (const s of sesiuni) {
      const litriSesiune = consumSesiune(rows, realimentari, s.start, s.stop);
      if (litriSesiune === null) continue;
      const kp = cheieParcela(s.fermaId, s.period, s.parcelaId);
      fuelLitriByParcelaCheie.set(kp, (fuelLitriByParcelaCheie.get(kp) ?? 0) + litriSesiune);
      adaugaParcelaLaCheie(s.fermaId, s.period, s.parcelaId);
    }
  }

  // --- Asamblare rânduri finale ---
  const rows: Array<{
    ferma_id: string;
    ferma: string;
    period: string;
    labor: number;
    material: number;
    indirect: number;
    combustibil_litri: number;
    combustibil_cost: number | null;
    combustibil_nealocat_litri: number;
    total: number;
    area: number;
    costPerMp: number;
    parcele: Array<{
      parcela_id: string;
      parcela_nume: string;
      labor: number;
      material: number;
      combustibil_litri: number;
      combustibil_cost: number | null;
      total: number;
    }>;
  }> = [];

  for (const f of ferme) {
    const periods = Array.from(periodsByFerma.get(f.id) ?? []).sort();
    const area = suprafataPerFerma.get(f.id) ?? 0;

    for (const period of periods) {
      const k = cheie(f.id, period);
      const labor = laborByCheie.get(k) ?? 0;
      const material = materialByCheie.get(k) ?? 0;
      const indirect = indirectByCheie.get(k) ?? 0;
      const litriConsumati = fuelLitriByCheie.get(k) ?? 0;
      const pretMotorina = litriConsumati > 0 ? pretMotorinaPanaLaSfarsitulLunii(f.id, period) : null;
      const combustibilCost = pretMotorina !== null ? litriConsumati * pretMotorina : null;

      const parcelaIds = Array.from(parceleByCheie.get(k) ?? []);
      let litriAlocatiTotal = 0;
      const parceleLinie = parcelaIds
        .map((parcelaId) => {
          const kp = cheieParcela(f.id, period, parcelaId);
          const laborP = laborByParcelaCheie.get(kp) ?? 0;
          const materialP = materialByParcelaCheie.get(kp) ?? 0;
          const litriP = fuelLitriByParcelaCheie.get(kp) ?? 0;
          litriAlocatiTotal += litriP;
          const combustibilCostP = pretMotorina !== null ? litriP * pretMotorina : null;
          const totalP = laborP + materialP + (combustibilCostP ?? 0);
          return {
            parcela_id: parcelaId,
            parcela_nume: numeParcela.get(parcelaId) ?? '—',
            labor: Math.round(laborP * 100) / 100,
            material: Math.round(materialP * 100) / 100,
            combustibil_litri: Math.round(litriP * 10) / 10,
            combustibil_cost: combustibilCostP !== null ? Math.round(combustibilCostP * 100) / 100 : null,
            total: Math.round(totalP * 100) / 100,
          };
        })
        .sort((a, b) => b.total - a.total);

      const nealocatLitri = Math.max(0, litriConsumati - litriAlocatiTotal);
      const total = labor + material + indirect + (combustibilCost ?? 0);

      rows.push({
        ferma_id: f.id,
        ferma: f.nume,
        period,
        labor: Math.round(labor * 100) / 100,
        material: Math.round(material * 100) / 100,
        indirect: Math.round(indirect * 100) / 100,
        combustibil_litri: Math.round(litriConsumati * 10) / 10,
        combustibil_cost: combustibilCost !== null ? Math.round(combustibilCost * 100) / 100 : null,
        combustibil_nealocat_litri: Math.round(nealocatLitri * 10) / 10,
        total: Math.round(total * 100) / 100,
        area,
        costPerMp: area > 0 ? Math.round((total / area) * 100) / 100 : 0,
        parcele: parceleLinie,
      });
    }
  }

  rows.sort((a, b) => (a.ferma === b.ferma ? a.period.localeCompare(b.period) : a.ferma.localeCompare(b.ferma)));

  return jsonResponse({ rows });
});
