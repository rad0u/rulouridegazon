// supabase/functions/get-foaie-parcurs/index.ts
//
// Date pentru foaia de parcurs lunară a unei mașini: toate cursele din luna
// cerută (indiferent de status — admin vede ce mai trebuie completat/validat
// înainte de printare), plus total km și info mașină/șofer. Doar admin_central.
//
// Parametri (query string): masina_id, an (ex. 2026), luna (1-12).
//
// v2, 2026-09-23 (Radu) -- ca la raportul AROBS atașat ca inspirație:
// adaugă adresa_pornire/adresa_sosire (geocodate de sync-traccar-masini la
// momentul cursei, vezi acel fișier) și un "km cumulat" per cursă -- suma
// tuturor km parcurși de mașina asta, din tot istoricul, până la și
// INCLUSIV cursa respectivă. NU e un odometru real (n-avem hardware pentru
// asta) -- e strict km calculați din traseul GPS, pornind de la 0 din
// momentul în care a început monitorizarea; util ca reper relativ între
// curse, nu ca kilometraj oficial al mașinii.
//
// DEPLOYAT deja direct în Supabase (verify_jwt: true) — copie sursă de adevăr.

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
    return jsonResponse({ error: 'Doar admin general poate genera foi de parcurs.' }, 403);
  }

  const url = new URL(req.url);
  const masinaId = url.searchParams.get('masina_id');
  const an = Number(url.searchParams.get('an'));
  const luna = Number(url.searchParams.get('luna'));

  if (!masinaId || !an || !luna || luna < 1 || luna > 12) {
    return jsonResponse({ error: 'Parametri lipsă/invalizi: masina_id, an, luna.' }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: masina, error: masinaError } = await adminClient
    .from('masini')
    .select('id, nume, numar_inmatriculare, marca_model, sofer_implicit_nume, ferma_id, ferme(nume)')
    .eq('id', masinaId)
    .maybeSingle();

  if (masinaError || !masina) {
    return jsonResponse({ error: masinaError?.message ?? 'Mașină negăsită.' }, 404);
  }

  const de_la = new Date(Date.UTC(an, luna - 1, 1, 0, 0, 0)).toISOString();
  const pana_la = new Date(Date.UTC(an, luna, 1, 0, 0, 0)).toISOString();

  // v2: km cumulat -- avem nevoie de TOATE cursele mașinii (nu doar luna
  // cerută) ca să calculăm suma progresivă până la fiecare cursă din lună.
  // Doar `data_ora_start` + `km`, ca să fie ieftin chiar dacă istoricul
  // crește -- restul câmpurilor se citesc separat, doar pentru luna cerută.
  //
  // v3, 2026-09-30 (Radu) -- ca la raportul AROBS: adaugă un "index GPS"
  // start/stop pe lună (echivalentul lor de index km auto, dar calculat din
  // traseul GPS -- NU un odometru real, vezi disclaimer-ul din UI), timpul
  // total de deplasare pe lună și numele fermei ("Grup vehicule" la AROBS).
  // index_start = suma GPS cumulată chiar ÎNAINTE de prima cursă din lună;
  // index_stop = suma GPS cumulată după ULTIMA cursă din lună (== rulaj la
  // finalul buclei, pentru că toateCurseleKm merge până la pana_la exclusiv).
  //
  // v4, 2026-09-30 (Radu): "nu mai creem conturi sofer. editam direct in
  // flota auto" -- sofer_implicit_nume vine acum direct din
  // masini.sofer_implicit_nume (text liber), nu mai e derivat prin join pe
  // utilizatori(nume).
  const { data: toateCurseleKm, error: toateCurseleError } = await adminClient
    .from('curse')
    .select('id, data_ora_start, km')
    .eq('masina_id', masinaId)
    .lt('data_ora_start', pana_la)
    .order('data_ora_start', { ascending: true });

  if (toateCurseleError) {
    return jsonResponse({ error: `Eroare la citirea istoricului de km: ${toateCurseleError.message}` }, 500);
  }

  const kmCumulatPanaLaId = new Map<string, number>();
  let rulaj = 0;
  let index_start = 0;
  let indexStartSetat = false;
  for (const c of toateCurseleKm ?? []) {
    if (!indexStartSetat && c.data_ora_start >= de_la) {
      index_start = Math.round(rulaj * 100) / 100;
      indexStartSetat = true;
    }
    rulaj += Number(c.km ?? 0);
    kmCumulatPanaLaId.set(c.id, Math.round(rulaj * 100) / 100);
  }
  if (!indexStartSetat) index_start = Math.round(rulaj * 100) / 100; // nicio cursă în lună
  const index_stop = Math.round(rulaj * 100) / 100;

  const { data: curseRaw, error: curseError } = await adminClient
    .from('curse')
    .select(
      'id, sofer_id, data_ora_start, data_ora_stop, km, scop, status, note, adresa_pornire, adresa_sosire, utilizatori(nume)',
    )
    .eq('masina_id', masinaId)
    .gte('data_ora_start', de_la)
    .lt('data_ora_start', pana_la)
    .order('data_ora_start', { ascending: true });

  if (curseError) {
    return jsonResponse({ error: `Eroare la citirea curselor: ${curseError.message}` }, 500);
  }

  // v3: Scopul deplasării nu mai necesită completare manuală -- vezi nota
  // v3 din capul funcției. Dacă un scop specific a fost totuși setat manual
  // (din /curse), îl păstrăm; altfel se afișează textul generic.
  const SCOP_IMPLICIT = 'Deplasare în interes de serviciu';

  const curse = (curseRaw ?? []).map((c: any) => ({
    id: c.id,
    data_ora_start: c.data_ora_start,
    data_ora_stop: c.data_ora_stop,
    km: c.km,
    km_cumulat: kmCumulatPanaLaId.get(c.id) ?? null,
    scop: c.scop ?? SCOP_IMPLICIT,
    status: c.status,
    note: c.note,
    adresa_pornire: c.adresa_pornire,
    adresa_sosire: c.adresa_sosire,
    sofer_nume: c.utilizatori?.nume ?? null,
  }));

  const total_km = curse.reduce((sum: number, c: any) => sum + (c.km ?? 0), 0);
  const nevalidate = curse.filter((c: any) => c.status !== 'validata').length;
  const timp_total_deplasare_secunde = curse.reduce((sum: number, c: any) => {
    if (!c.data_ora_stop) return sum;
    return sum + (new Date(c.data_ora_stop).getTime() - new Date(c.data_ora_start).getTime()) / 1000;
  }, 0);

  return jsonResponse({
    masina: {
      id: masina.id,
      nume: masina.nume,
      numar_inmatriculare: masina.numar_inmatriculare,
      marca_model: masina.marca_model,
      sofer_implicit_nume: masina.sofer_implicit_nume ?? null,
      ferma_nume: (masina as any).ferme?.nume ?? null,
    },
    an,
    luna,
    curse,
    total_km: Math.round(total_km * 100) / 100,
    numar_curse: curse.length,
    numar_nevalidate: nevalidate,
    timp_total_deplasare_secunde: Math.round(timp_total_deplasare_secunde),
    index_start,
    index_stop,
  });
});
