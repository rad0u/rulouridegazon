// supabase/functions/get-combustibil-report/index.ts
//
// Raport de consum combustibil per utilaj, pe o perioadă dată (implicit 7 zile),
// calculat din istoricul brut din public.combustibil_citiri (populat de
// sync-traccar-fuel). Doar admin_central poate apela funcția.
//
// Cum funcționează:
//   - Se ia istoricul de citiri al fiecărui utilaj, în ordine cronologică.
//   - Se calculează diferența (delta) între citiri consecutive.
//   - Un salt POZITIV peste prag = realimentare.
//   - Un salt NEGATIV peste prag = scădere suspectă (posibil furt/scurgere) —
//     pragul e ales suficient de mare încât să nu poată fi explicat de consumul
//     normal al motorului în intervalul dintre două citiri (vezi
//     MAX_PLAUSIBLE_CONSUM_L_PE_ORA mai jos).
//   - Restul scăderilor (sub prag) se adună ca și consum normal.
//
// IMPORTANT: raportul are sens doar pentru utilajele CALIBRATE (cu
// `tanc_capacitate_litri` completat în tabela `utilaje`) — pe utilajele
// necalibrate, `nivel_litri` e o valoare brută a senzorului ("kvants"), nu
// litri, deci pragurile de mai jos (gândite în litri) n-ar avea sens. Utilajele
// necalibrate sunt excluse din calcul și marcate explicit ca atare.

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

// Un motor de utilaj agricol arde, tipic, câțiva litri/oră — nu zeci. O scădere
// mai mare decât ce s-ar putea consuma plauzibil în intervalul dintre două
// citiri e considerată anomalie, nu consum normal. De ajustat empiric pe măsură
// ce apar date reale de consum de la utilajele calibrate.
const MAX_PLAUSIBLE_CONSUM_L_PE_ORA = 15;
// Prag minim absolut (litri) pentru un eveniment (realimentare sau scădere
// suspectă), indiferent de cât timp a trecut — evită să marcăm zgomot mic
// (sloshing) ca eveniment.
const PRAG_MINIM_EVENIMENT_L = 15;

interface Citire {
  data_ora: string;
  nivel_litri: number;
}

interface Eveniment {
  data_ora: string;
  delta_litri: number;
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
    return jsonResponse({ error: 'Doar admin general poate vedea raportul de combustibil.' }, 403);
  }

  const url = new URL(req.url);
  const zile = Math.min(90, Math.max(1, Number(url.searchParams.get('zile')) || 7));
  const de_la = new Date(Date.now() - zile * 24 * 60 * 60 * 1000).toISOString();

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: utilaje, error: utilajeError } = await adminClient
    .from('utilaje')
    .select('id, nume, tanc_capacitate_litri, ferme(nume)')
    .eq('activ', true);

  if (utilajeError) {
    return jsonResponse({ error: `Eroare la citirea utilajelor: ${utilajeError.message}` }, 500);
  }

  const calibrate = (utilaje ?? []).filter(
    (u: any) => typeof u.tanc_capacitate_litri === 'number' && u.tanc_capacitate_litri > 0,
  );
  const necalibrate = (utilaje ?? []).filter((u: any) => !calibrate.includes(u));

  const rezultate = [];

  for (const u of calibrate as any[]) {
    const { data: citiri, error: citiriError } = await adminClient
      .from('combustibil_citiri')
      .select('data_ora, nivel_litri')
      .eq('utilaj_id', u.id)
      .gte('data_ora', de_la)
      .order('data_ora', { ascending: true });

    if (citiriError) {
      rezultate.push({
        utilaj_id: u.id,
        nume: u.nume,
        ferma_nume: u.ferme?.nume ?? null,
        eroare: citiriError.message,
      });
      continue;
    }

    const rows = (citiri ?? []) as Citire[];

    let consumNormalLitri = 0;
    let realimentatLitri = 0;
    const realimentari: Eveniment[] = [];
    const scaderiSuspecte: Eveniment[] = [];

    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      const delta = Number(curr.nivel_litri) - Number(prev.nivel_litri);
      const oreIntreCitiri =
        (new Date(curr.data_ora).getTime() - new Date(prev.data_ora).getTime()) / 3_600_000;
      const pragScaderePlauzibila = Math.max(
        PRAG_MINIM_EVENIMENT_L,
        MAX_PLAUSIBLE_CONSUM_L_PE_ORA * Math.max(oreIntreCitiri, 0),
      );

      if (delta >= PRAG_MINIM_EVENIMENT_L) {
        realimentatLitri += delta;
        realimentari.push({ data_ora: curr.data_ora, delta_litri: Math.round(delta * 10) / 10 });
      } else if (delta < 0 && Math.abs(delta) > pragScaderePlauzibila) {
        scaderiSuspecte.push({ data_ora: curr.data_ora, delta_litri: Math.round(delta * 10) / 10 });
      } else if (delta < 0) {
        consumNormalLitri += Math.abs(delta);
      }
    }

    rezultate.push({
      utilaj_id: u.id,
      nume: u.nume,
      ferma_nume: u.ferme?.nume ?? null,
      tanc_capacitate_litri: u.tanc_capacitate_litri,
      nr_citiri: rows.length,
      prima_citire: rows[0]?.data_ora ?? null,
      ultima_citire: rows[rows.length - 1]?.data_ora ?? null,
      consum_normal_litri: Math.round(consumNormalLitri * 10) / 10,
      realimentat_litri: Math.round(realimentatLitri * 10) / 10,
      realimentari,
      scaderi_suspecte: scaderiSuspecte,
    });
  }

  return jsonResponse({
    zile,
    de_la,
    rezultate,
    necalibrate: (necalibrate as any[]).map((u) => ({
      utilaj_id: u.id,
      nume: u.nume,
      ferma_nume: u.ferme?.nume ?? null,
    })),
  });
});
