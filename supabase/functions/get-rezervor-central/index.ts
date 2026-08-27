// supabase/functions/get-rezervor-central/index.ts
//
// Stoc de motorină la nivel de fermă (rezervor central), separat de rezervoarele
// individuale ale utilajelor. Doar admin_central poate apela funcția.
//
// MODEL DE CALCUL (simplificare asumată — vezi și schema-rezervor-central.sql):
//   nivel_curent = nivel_initial
//                + SUMA alimentărilor rezervorului central după data_initial
//                - SUMA consumului de motorină al utilajelor CALIBRATE ale fermei
//                  (toate scăderile din combustibil_citiri, inclusiv cele "suspecte")
//                  după data_initial
//
// Se scade CONSUMUL utilajelor (arderea de motor), nu evenimentele de realimentare a
// utilajelor individuale — presupunem că, pe termen mediu, motorina arsă de utilaje e o
// aproximare rezonabilă a motorinei scoase din rezervorul central. Dacă în practică nu se
// potrivește cu realitatea (ex. utilajele au rezervoare mari, tampon considerabil), de
// reconsiderat modelul.

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
    return jsonResponse({ error: 'Doar admin general poate vedea rezervorul central.' }, 403);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: ferme, error: fermeError } = await adminClient
    .from('ferme')
    .select(
      'id, nume, rezervor_capacitate_litri, rezervor_nivel_initial_litri, rezervor_nivel_initial_data',
    )
    .order('nume');

  if (fermeError) {
    return jsonResponse({ error: `Eroare la citirea fermelor: ${fermeError.message}` }, 500);
  }

  const rezultate = [];

  for (const f of ferme ?? []) {
    if (!f.rezervor_nivel_initial_data || f.rezervor_nivel_initial_litri === null) {
      rezultate.push({
        ferma_id: f.id,
        nume: f.nume,
        configurat: false,
        capacitate_litri: f.rezervor_capacitate_litri,
      });
      continue;
    }

    const de_la = f.rezervor_nivel_initial_data;

    const { data: alimentari, error: alimentariError } = await adminClient
      .from('rezervor_alimentari')
      .select('id, data_ora, cantitate_litri, note')
      .eq('ferma_id', f.id)
      .gte('data_ora', de_la)
      .order('data_ora', { ascending: false });

    if (alimentariError) {
      rezultate.push({ ferma_id: f.id, nume: f.nume, eroare: alimentariError.message });
      continue;
    }

    const totalAlimentat = (alimentari ?? []).reduce((s, a) => s + Number(a.cantitate_litri), 0);

    const { data: utilaje, error: utilajeError } = await adminClient
      .from('utilaje')
      .select('id, tanc_capacitate_litri')
      .eq('ferma_id', f.id)
      .eq('activ', true);

    if (utilajeError) {
      rezultate.push({ ferma_id: f.id, nume: f.nume, eroare: utilajeError.message });
      continue;
    }

    const utilajeCalibrate = (utilaje ?? []).filter(
      (u) => typeof u.tanc_capacitate_litri === 'number' && u.tanc_capacitate_litri > 0,
    );

    let totalConsumat = 0;

    for (const u of utilajeCalibrate) {
      const { data: citiri, error: citiriError } = await adminClient
        .from('combustibil_citiri')
        .select('data_ora, nivel_litri')
        .eq('utilaj_id', u.id)
        .not('nivel_litri', 'is', null)
        .gte('data_ora', de_la)
        .order('data_ora', { ascending: true });

      if (citiriError) continue;

      const rows = citiri ?? [];
      for (let i = 1; i < rows.length; i++) {
        const delta = Number(rows[i].nivel_litri) - Number(rows[i - 1].nivel_litri);
        if (delta < 0) totalConsumat += Math.abs(delta);
      }
    }

    const nivelCurent =
      Number(f.rezervor_nivel_initial_litri) + totalAlimentat - totalConsumat;

    rezultate.push({
      ferma_id: f.id,
      nume: f.nume,
      configurat: true,
      capacitate_litri: f.rezervor_capacitate_litri,
      nivel_initial_litri: f.rezervor_nivel_initial_litri,
      nivel_initial_data: f.rezervor_nivel_initial_data,
      total_alimentat_litri: Math.round(totalAlimentat * 10) / 10,
      total_consumat_litri: Math.round(totalConsumat * 10) / 10,
      nivel_curent_litri: Math.round(nivelCurent * 10) / 10,
      utilaje_calibrate_incluse: utilajeCalibrate.length,
      utilaje_total: (utilaje ?? []).length,
      ultima_alimentare: alimentari?.[0] ?? null,
      alimentari: alimentari ?? [],
    });
  }

  return jsonResponse({ ferme: rezultate });
});
