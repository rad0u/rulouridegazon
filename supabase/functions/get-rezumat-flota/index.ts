// supabase/functions/get-rezumat-flota/index.ts
//
// Rezumat lunar al flotei de mașini de pasageri -- un rând per mașină activă
// cu total km / curse / curse nevalidate pe luna cerută, ca primă pagină a
// unui raport de foaie de parcurs (inspirat din raportul AROBS Track GPS
// atașat de Radu -- vezi NOTES.md). Fiecare rând trimite mai departe la
// foaia detaliată a mașinii (get-foaie-parcurs) din UI.
//
// Parametri (query string): an (ex. 2026), luna (1-12). Doar admin_central.
//
// DEPLOYAT deja direct în Supabase (verify_jwt: true).

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
    return jsonResponse({ error: 'Doar admin general poate vedea rezumatul flotei.' }, 403);
  }

  const url = new URL(req.url);
  const an = Number(url.searchParams.get('an'));
  const luna = Number(url.searchParams.get('luna'));

  if (!an || !luna || luna < 1 || luna > 12) {
    return jsonResponse({ error: 'Parametri lipsă/invalizi: an, luna.' }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: masiniRaw, error: masiniError } = await adminClient
    .from('masini')
    .select('id, nume, numar_inmatriculare, marca_model')
    .eq('activ', true)
    .order('nume');

  if (masiniError) {
    return jsonResponse({ error: `Eroare la citirea mașinilor: ${masiniError.message}` }, 500);
  }

  const de_la = new Date(Date.UTC(an, luna - 1, 1, 0, 0, 0)).toISOString();
  const pana_la = new Date(Date.UTC(an, luna, 1, 0, 0, 0)).toISOString();

  const { data: curseRaw, error: curseError } = await adminClient
    .from('curse')
    .select('masina_id, km, status, data_ora_start, data_ora_stop')
    .gte('data_ora_start', de_la)
    .lt('data_ora_start', pana_la);

  if (curseError) {
    return jsonResponse({ error: `Eroare la citirea curselor: ${curseError.message}` }, 500);
  }

  const perMasina = new Map<
    string,
    { total_km: number; numar_curse: number; numar_nevalidate: number; prima_cursa: string | null; ultima_cursa: string | null }
  >();

  for (const c of curseRaw ?? []) {
    const cur = perMasina.get(c.masina_id) ?? {
      total_km: 0,
      numar_curse: 0,
      numar_nevalidate: 0,
      prima_cursa: null,
      ultima_cursa: null,
    };
    cur.total_km += Number(c.km ?? 0);
    cur.numar_curse += 1;
    if (c.status !== 'validata') cur.numar_nevalidate += 1;
    if (!cur.prima_cursa || c.data_ora_start < cur.prima_cursa) cur.prima_cursa = c.data_ora_start;
    if (!cur.ultima_cursa || c.data_ora_start > cur.ultima_cursa) cur.ultima_cursa = c.data_ora_start;
    perMasina.set(c.masina_id, cur);
  }

  const rezultate = (masiniRaw ?? []).map((m: any) => {
    const agregat = perMasina.get(m.id);
    return {
      masina_id: m.id,
      nume: m.nume,
      numar_inmatriculare: m.numar_inmatriculare,
      marca_model: m.marca_model,
      total_km: agregat ? Math.round(agregat.total_km * 100) / 100 : 0,
      numar_curse: agregat?.numar_curse ?? 0,
      numar_nevalidate: agregat?.numar_nevalidate ?? 0,
    };
  });

  return jsonResponse({ an, luna, rezultate });
});
