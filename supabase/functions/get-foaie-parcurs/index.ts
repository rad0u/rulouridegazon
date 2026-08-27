// supabase/functions/get-foaie-parcurs/index.ts
//
// Date pentru foaia de parcurs lunară a unei mașini: toate cursele din luna
// cerută (indiferent de status — admin vede ce mai trebuie completat/validat
// înainte de printare), plus total km și info mașină/șofer. Doar admin_central.
//
// Parametri (query string): masina_id, an (ex. 2026), luna (1-12).
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
    .select('id, nume, numar_inmatriculare, marca_model, sofer_implicit_id, utilizatori(nume)')
    .eq('id', masinaId)
    .maybeSingle();

  if (masinaError || !masina) {
    return jsonResponse({ error: masinaError?.message ?? 'Mașină negăsită.' }, 404);
  }

  const de_la = new Date(Date.UTC(an, luna - 1, 1, 0, 0, 0)).toISOString();
  const pana_la = new Date(Date.UTC(an, luna, 1, 0, 0, 0)).toISOString();

  const { data: curseRaw, error: curseError } = await adminClient
    .from('curse')
    .select('id, sofer_id, data_ora_start, data_ora_stop, km, scop, status, note, utilizatori(nume)')
    .eq('masina_id', masinaId)
    .gte('data_ora_start', de_la)
    .lt('data_ora_start', pana_la)
    .order('data_ora_start', { ascending: true });

  if (curseError) {
    return jsonResponse({ error: `Eroare la citirea curselor: ${curseError.message}` }, 500);
  }

  const curse = (curseRaw ?? []).map((c: any) => ({
    id: c.id,
    data_ora_start: c.data_ora_start,
    data_ora_stop: c.data_ora_stop,
    km: c.km,
    scop: c.scop,
    status: c.status,
    note: c.note,
    sofer_nume: c.utilizatori?.nume ?? null,
  }));

  const total_km = curse.reduce((sum: number, c: any) => sum + (c.km ?? 0), 0);
  const nevalidate = curse.filter((c: any) => c.status !== 'validata').length;

  return jsonResponse({
    masina: {
      id: masina.id,
      nume: masina.nume,
      numar_inmatriculare: masina.numar_inmatriculare,
      marca_model: masina.marca_model,
      sofer_implicit_nume: (masina as any).utilizatori?.nume ?? null,
    },
    an,
    luna,
    curse,
    total_km: Math.round(total_km * 100) / 100,
    numar_curse: curse.length,
    numar_nevalidate: nevalidate,
  });
});
