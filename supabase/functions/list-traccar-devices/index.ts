// supabase/functions/list-traccar-devices/index.ts
//
// Listăză device-urile din Traccar care NU sunt încă legate de niciun rând
// din public.utilaje SAU public.masini (după IMEI / uniqueId) — folosit de
// formularul „Adaugă utilaj” din /utilaje și de formularul „Adaugă mașină
// nouă” din /masini, ca să se poată prelua numele și IMEI-ul direct din
// Traccar în loc să fie copiate manual. Doar admin_central poate apela.
//
// 2026-09-28 (Radu): "as vrea sa separam utilajele de auto" — până acum
// funcția excludea doar device-urile deja legate în `utilaje`, deci toate
// device-urile mașinilor (deja legate în `masini`) apăreau ca „nelegate” în
// formularul de la Utilaje, riscând să fie adăugate din greșeală ca utilaj.
// Acum excludem ambele tabele, ca lista să fie corectă pentru ambele fluxuri.
//
// IMPORTANT: GET /api/devices din Traccar, FĂRĂ parametrul `all=true`,
// întoarce implicit doar device-urile alocate explicit contului folosit la
// autentificare (TRACCAR_USER) — nu toate device-urile din instanță, chiar
// dacă contul respectiv e admin. Confirmat 2026-09-10: contul folosit de
// aplicație vedea doar 2 din cele 5 device-uri vizibile în aplicația mobilă
// Traccar (logată cu alt cont). `all=true` cere ca TRACCAR_USER să aibă
// drept de admin/manager în Traccar — altfel Traccar îl ignoră silențios,
// fără eroare.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TRACCAR_URL = Deno.env.get('TRACCAR_URL') ?? '';
const TRACCAR_USER = Deno.env.get('TRACCAR_USER') ?? '';
const TRACCAR_PASSWORD = Deno.env.get('TRACCAR_PASSWORD') ?? '';

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

interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  status: string;
  lastUpdate: string | null;
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
    return jsonResponse({ error: 'Doar admin general poate vedea device-urile Traccar.' }, 403);
  }

  if (!TRACCAR_URL || !TRACCAR_USER || !TRACCAR_PASSWORD) {
    return jsonResponse(
      { error: 'Lipsesc secretele TRACCAR_URL/TRACCAR_USER/TRACCAR_PASSWORD pe server.' },
      500,
    );
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const [utilajeRes, masiniRes] = await Promise.all([
    adminClient.from('utilaje').select('traccar_device_id').not('traccar_device_id', 'is', null),
    adminClient.from('masini').select('traccar_device_id').not('traccar_device_id', 'is', null),
  ]);

  if (utilajeRes.error) {
    return jsonResponse({ error: `Eroare la citirea utilajelor: ${utilajeRes.error.message}` }, 500);
  }
  if (masiniRes.error) {
    return jsonResponse({ error: `Eroare la citirea mașinilor: ${masiniRes.error.message}` }, 500);
  }

  const idLegate = new Set<string>([
    ...(utilajeRes.data ?? []).map((u) => u.traccar_device_id as string),
    ...(masiniRes.data ?? []).map((m) => m.traccar_device_id as string),
  ]);

  const auth = 'Basic ' + btoa(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`);
  const devicesRes = await fetch(`${TRACCAR_URL}/api/devices?all=true`, {
    headers: { Authorization: auth },
  });

  if (!devicesRes.ok) {
    return jsonResponse({ error: 'Eroare la citirea device-urilor din Traccar.' }, 502);
  }

  const devices: TraccarDevice[] = await devicesRes.json();

  const nelegate = devices
    .filter((d) => !idLegate.has(d.uniqueId))
    .map((d) => ({
      traccar_device_id: d.uniqueId,
      nume_traccar: d.name,
      status: d.status,
      ultima_actualizare: d.lastUpdate,
    }));

  return jsonResponse({ device_nelegate: nelegate, total_device_traccar: devices.length });
});
