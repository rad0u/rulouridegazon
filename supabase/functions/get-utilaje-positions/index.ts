// supabase/functions/get-utilaje-positions/index.ts
//
// Returnează poziția curentă (din Traccar) pentru toate utilajele active,
// pentru harta din /utilaje. Doar admin_central poate apela funcția.
//
// Secrete necesare (Supabase Dashboard -> Edge Functions -> Secrets):
//   TRACCAR_URL, TRACCAR_USER, TRACCAR_PASSWORD
//
// v12, 2026-09-24 (Radu): adăugat `este_utilaj_recoltare` la fiecare utilaj
// returnat — checkbox nou în /utilaje ("Utilaj de recoltare"), folosit de
// ActivitatiParceleScreen (prin get-sesiuni-detectate) ca să decidă dacă
// arată selecția de tip operațiune sau doar suprafața (mp) recoltată.

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
    .select('id, nume, tip, traccar_device_id, ferma_id, tanc_capacitate_litri, poza_url, este_utilaj_recoltare, ferme(nume)')
    .eq('activ', true);

  if (utilajeError) {
    return jsonResponse({ error: `Eroare la citirea utilajelor: ${utilajeError.message}` }, 500);
  }

  // Ultima citire de combustibil per utilaj (nivel_litri e valoare BRUTĂ,
  // necalibrată, până se face calibrarea senzorului DUT-E pe rezervorul real —
  // vezi TODO în supabase/functions/sync-traccar-fuel/index.ts).
  const utilajIds = (utilaje ?? []).map((u) => u.id);
  const latestFuelByUtilaj = new Map<string, { nivel_litri: number; data_ora: string }>();

  if (utilajIds.length > 0) {
    const { data: citiri } = await adminClient
      .from('combustibil_citiri')
      .select('utilaj_id, nivel_litri, data_ora')
      .in('utilaj_id', utilajIds)
      .not('nivel_litri', 'is', null)
      .order('data_ora', { ascending: false });

    for (const c of citiri ?? []) {
      if (!latestFuelByUtilaj.has(c.utilaj_id)) {
        latestFuelByUtilaj.set(c.utilaj_id, { nivel_litri: c.nivel_litri, data_ora: c.data_ora });
      }
    }
  }

  const auth = 'Basic ' + btoa(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`);

  // Vezi list-traccar-devices/index.ts: fără `all=true`, Traccar întoarce
  // doar device-urile alocate explicit contului TRACCAR_USER, nu toate
  // (confirmat 2026-09-10/11 — utilaje noi legate din Traccar nu apăreau
  // pe hartă / nu li se sincroniza combustibilul până la acest fix).
  const [devicesRes, positionsRes] = await Promise.all([
    fetch(`${TRACCAR_URL}/api/devices?all=true`, { headers: { Authorization: auth } }),
    fetch(`${TRACCAR_URL}/api/positions?all=true`, { headers: { Authorization: auth } }),
  ]);

  if (!devicesRes.ok || !positionsRes.ok) {
    return jsonResponse({ error: 'Eroare la citirea din Traccar API.' }, 502);
  }

  const devices: TraccarDevice[] = await devicesRes.json();
  const positions: TraccarPosition[] = await positionsRes.json();

  const deviceByImei = new Map(devices.map((d) => [d.uniqueId, d]));
  const positionByDeviceId = new Map(positions.map((p) => [p.deviceId, p]));

  // Fallback: GET /api/positions?all=true întoarce doar „ultima poziție“
  // conform pointer-ului intern al Traccar (device.positionId), care nu se
  // actualizează mereu la fel de fiabil ca istoricul real de poziții —
  // confirmat 2026-09-11: unele device-uri au poziție vizibilă în Traccar
  // (hartă/app), dar lipsesc din /api/positions?all=true. Pentru orice
  // utilaj cu device găsit dar fără poziție în apelul bulk, mai facem un
  // apel individual pe istoricul recent (aceeași strategie ca la
  // sync-traccar-fuel, care funcționează corect) și luăm cea mai recentă
  // poziție din ultimele 30 de zile.
  const deviceIdsFaraPozitie = new Set<number>();
  for (const u of utilaje ?? []) {
    const d = u.traccar_device_id ? deviceByImei.get(u.traccar_device_id) : undefined;
    if (d && !positionByDeviceId.has(d.id)) {
      deviceIdsFaraPozitie.add(d.id);
    }
  }

  if (deviceIdsFaraPozitie.size > 0) {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fallbackResults = await Promise.all(
      Array.from(deviceIdsFaraPozitie).map(async (deviceId) => {
        const url = `${TRACCAR_URL}/api/positions?deviceId=${deviceId}&from=${from.toISOString()}&to=${to.toISOString()}`;
        const res = await fetch(url, { headers: { Authorization: auth } });
        if (!res.ok) return null;
        const list: TraccarPosition[] = await res.json();
        if (list.length === 0) return null;
        return list.reduce((cea_mai_recenta, p) =>
          new Date(p.fixTime) > new Date(cea_mai_recenta.fixTime) ? p : cea_mai_recenta,
        );
      }),
    );
    for (const p of fallbackResults) {
      if (p) positionByDeviceId.set(p.deviceId, p);
    }
  }

  const rows = (utilaje ?? []).map((u: any) => {
    const device = u.traccar_device_id ? deviceByImei.get(u.traccar_device_id) : undefined;
    const position = device ? positionByDeviceId.get(device.id) : undefined;
    const fuel = latestFuelByUtilaj.get(u.id);

    return {
      utilaj_id: u.id,
      nume: u.nume,
      tip: u.tip,
      ferma_id: u.ferma_id,
      ferma_nume: u.ferme?.nume ?? null,
      poza_url: u.poza_url ?? null,
      status: device?.status ?? 'necunoscut',
      lat: position?.latitude ?? null,
      lon: position?.longitude ?? null,
      ultima_actualizare: position?.fixTime ?? device?.lastUpdate ?? null,
      combustibil_nivel: fuel?.nivel_litri ?? null,
      combustibil_data: fuel?.data_ora ?? null,
      combustibil_capacitate_litri: u.tanc_capacitate_litri ?? null,
      este_utilaj_recoltare: u.este_utilaj_recoltare ?? false,
    };
  });

  return jsonResponse({ utilaje: rows });
});
