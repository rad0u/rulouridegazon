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
//   - combustibil: consum lunar dedus din combustibil_citiri (aceeași metodă
//                 de „scădere de nivel" ca get-rezervor-central), înmulțit cu
//                 prețul mediu ponderat al motorinei cumpărate de fermă PÂNĂ
//                 la sfârșitul lunii respective (rezervor_alimentari.pret_litru)
//
// De ce edge function și nu query direct din pagină: agregarea combustibilului
// are nevoie de service role (bypass RLS pe combustibil_citiri, posibil multe
// mii de rânduri per utilaj) + paginare explicită (vezi fetchToateRandurile),
// exact ca în get-rezervor-central/get-combustibil-report. Restul costurilor
// sunt ieftine, dar le calculăm tot aici ca să existe UN singur loc cu
// rezultatul final (evită dublarea logicii de grupare pe lună în frontend).
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

interface Citire {
  data_ora: string;
  nivel_litri: number;
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

function perioada(data: string): string {
  // 'data' e deja 'YYYY-MM-DD' (coloană date) sau ISO timestamp — primele 7
  // caractere dau 'YYYY-MM' fără conversii de fus orar (evită off-by-one la
  // limita de lună pe care ar introduce-o new Date().toISOString()).
  return data.slice(0, 7);
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
      adminClient.from('parcele').select('ferma_id, suprafata_mp'),
      adminClient.from('operatiuni').select('id, parcela_id, data, ore_lucru, parcele(ferma_id)'),
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
  const parcele = (parceleRes.data ?? []) as { ferma_id: string; suprafata_mp: number | null }[];
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

  // --- Suprafață per fermă (constantă, nu variază pe lună) ---
  const suprafataPerFerma = new Map<string, number>();
  for (const p of parcele) {
    suprafataPerFerma.set(p.ferma_id, (suprafataPerFerma.get(p.ferma_id) ?? 0) + Number(p.suprafata_mp || 0));
  }

  const costOraPerFerma = new Map<string, number>(ferme.map((f) => [f.id, Number(f.cost_ora_lucru || 0)]));

  // cheie compusă "fermaId|YYYY-MM" pentru toate liniile
  const cheie = (fermaId: string, period: string) => `${fermaId}|${period}`;
  const laborByCheie = new Map<string, number>();
  const materialByCheie = new Map<string, number>();
  const indirectByCheie = new Map<string, number>();
  const fuelLitriByCheie = new Map<string, number>();
  const periodsByFerma = new Map<string, Set<string>>();

  function adaugaPerioada(fermaId: string, period: string) {
    if (!periodsByFerma.has(fermaId)) periodsByFerma.set(fermaId, new Set());
    periodsByFerma.get(fermaId)!.add(period);
  }

  // --- Manoperă (+ hartă operatiune_id -> {fermaId, period} pentru materiale) ---
  const opInfo = new Map<string, { fermaId: string; period: string }>();
  for (const op of operatiuni) {
    const fermaId = op.parcele?.ferma_id;
    if (!fermaId || !op.data) continue;
    const period = perioada(op.data);
    opInfo.set(op.id, { fermaId, period });
    const costOra = costOraPerFerma.get(fermaId) ?? 0;
    const ore = Number(op.ore_lucru || 0);
    const k = cheie(fermaId, period);
    laborByCheie.set(k, (laborByCheie.get(k) ?? 0) + ore * costOra);
    adaugaPerioada(fermaId, period);
  }

  // --- Materiale (substanțe), pe luna operațiunii lor ---
  for (const m of materiale) {
    const info = opInfo.get(m.operatiune_id);
    if (!info) continue;
    const pret = Number(m.substante?.pret_unitar || 0);
    const qty = Number(m.cantitate || 0);
    const k = cheie(info.fermaId, info.period);
    materialByCheie.set(k, (materialByCheie.get(k) ?? 0) + pret * qty);
    adaugaPerioada(info.fermaId, info.period);
  }

  // --- Cheltuieli indirecte ---
  for (const item of indirecte) {
    if (!item.ferma_id || !item.data) continue;
    const period = perioada(item.data);
    const k = cheie(item.ferma_id, period);
    indirectByCheie.set(k, (indirectByCheie.get(k) ?? 0) + Number(item.valoare || 0));
    adaugaPerioada(item.ferma_id, period);
  }

  // --- Preț mediu ponderat al motorinei per fermă, ca funcție cumulativă în timp ---
  // alimentariByFerma[fermaId] = listă ordonată cronologic de puncte
  // {data_ora, pretMediuCumulativPanaAici} — pentru o lună dată, folosim
  // ultimul punct cu data_ora <= sfârșitul lunii.
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
    // sfârșitul lunii 'YYYY-MM' — folosim prima zi a lunii următoare ca prag exclusiv
    const [an, luna] = period.split('-').map(Number);
    const sfarsitLuna = new Date(Date.UTC(an, luna, 1)).toISOString();
    let ultimul: number | null = null;
    for (const p of puncte) {
      if (p.data_ora < sfarsitLuna) ultimul = p.pretMediuCumulativ;
      else break;
    }
    return ultimul;
  }

  // --- Consum lunar de motorină per fermă, din citirile de sondă ale utilajelor calibrate ---
  const utilajeCalibrate = utilaje.filter(
    (u) => typeof u.tanc_capacitate_litri === 'number' && (u.tanc_capacitate_litri as number) > 0,
  );

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

    const rows = filtreazaCitiriPlauzibile(citiri, u.tanc_capacitate_litri as number);
    for (let i = 1; i < rows.length; i++) {
      const delta = Number(rows[i].nivel_litri) - Number(rows[i - 1].nivel_litri);
      if (delta >= 0) continue; // doar scăderile = consum; creșterile sunt realimentări ale utilajului
      const period = perioada(rows[i].data_ora);
      const k = cheie(u.ferma_id, period);
      fuelLitriByCheie.set(k, (fuelLitriByCheie.get(k) ?? 0) + Math.abs(delta));
      adaugaPerioada(u.ferma_id, period);
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
    total: number;
    area: number;
    costPerMp: number;
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
        total: Math.round(total * 100) / 100,
        area,
        costPerMp: area > 0 ? Math.round((total / area) * 100) / 100 : 0,
      });
    }
  }

  rows.sort((a, b) => (a.ferma === b.ferma ? a.period.localeCompare(b.period) : a.ferma.localeCompare(b.ferma)));

  return jsonResponse({ rows });
});
