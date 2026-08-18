// supabase/functions/get-utilaje-positions/index.ts
//
// Returnează poziția curentă (din Traccar) pentru toate utilajele active,
// pentru harta din /utilaje. Doar admin_central poate apela funcția.
//
// Secrete necesare (Supabase Dashboard -> Edge Functions -> Secrets):
//   TRACCAR_URL, TRACCAR_USER, TRACCAR_PASSWORD

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
  uniqueId: string;
  status: string;
  lastUpdate: string | null;
}

interface TraccarPosition {
  deviceId: number;
  latitude: number;
  longitude: number;
  fixTime: string;
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
    return jsonResponse({ error: 'Doar admin general poate vedea harta utilajelor.' }, 403);
  }

  if (!TRACCAR_URL || !TRACCAR_USER || !TRACCAR_PASSWORD) {
    return jsonResponse(
      { error: 'Lipsesc secretele TRACCAR_URL/TRACCAR_USER/TRACCAR_PASSWORD pe server.' },
      500,
    );
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: utilaje, error: utilajeError } = await adminClient
    .from('utilaje')
    .select('id, nume, tip, traccar_device_id, ferma_id, ferme(nume)')
    .eq('activ', true);

  if (utilajeError) {
    return jsonResponse({ error: `Eroare la citirea utilajelor: ${utilajeError.message}` }, 500);
  }

  const auth = 'Basic ' + btoa(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`);

  const [devicesRes, positionsRes] = await Promise.all([
    fetch(`${TRACCAR_URL}/api/devices`, { headers: { Authorization: auth } }),
    fetch(`${TRACCAR_URL}/api/positions`, { headers: { Authorization: auth } }),
  ]);

  if (!devicesRes.ok || !positionsRes.ok) {
    return jsonResponse({ error: 'Eroare la citirea din Traccar API.' }, 502);
  }

  const devices: TraccarDevice[] = await devicesRes.json();
  const positions: TraccarPosition[] = await positionsRes.json();

  const deviceByImei = new Map(devices.map((d) => [d.uniqueId, d]));
  const positionByDeviceId = new Map(positions.map((p) => [p.deviceId, p]));

  const rows = (utilaje ?? []).map((u: any) => {
    const device = u.traccar_device_id ? deviceByImei.get(u.traccar_device_id) : undefined;
    const position = device ? positionByDeviceId.get(device.id) : undefined;

    return {
      utilaj_id: u.id,
      nume: u.nume,
      tip: u.tip,
      ferma_id: u.ferma_id,
      ferma_nume: u.ferme?.nume ?? null,
      status: device?.status ?? 'necunoscut',
      lat: position?.latitude ?? null,
      lon: position?.longitude ?? null,
      ultima_actualizare: position?.fixTime ?? device?.lastUpdate ?? null,
    };
  });

  return jsonResponse({ utilaje: rows });
});
