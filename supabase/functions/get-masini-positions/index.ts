// supabase/functions/get-masini-positions/index.ts
//
// Returnează poziția curentă (din Traccar) pentru toate mașinile active,
// pentru harta din /masini. Analog get-utilaje-positions, dar fără date de
// combustibil (FMC130 n-are senzor) — include în schimb viteza curentă și
// cursa activă (dacă există), utile pentru dispecer. Doar admin_central.
//
// Secrete necesare: TRACCAR_URL, TRACCAR_USER, TRACCAR_PASSWORD.
//
// DEPLOYAT deja direct în Supabase (verify_jwt: true) — copie sursă de adevăr.

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
  speed: number;
  fixTime: string;
  attributes: Record<string, unknown>;
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
    return jsonResponse({ error: 'Doar admin general poate vedea harta mașinilor.' }, 403);
  }

  if (!TRACCAR_URL || !TRACCAR_USER || !TRACCAR_PASSWORD) {
    return jsonResponse(
      { error: 'Lipsesc secretele TRACCAR_URL/TRACCAR_USER/TRACCAR_PASSWORD pe server.' },
      500,
    );
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: masini, error: masiniError } = await adminClient
    .from('masini')
    .select(
      'id, nume, numar_inmatriculare, traccar_device_id, sofer_implicit_id, viteza_limita_kmh, ferma_id, utilizatori(nume), ferme(nume)',
    )
    .eq('activ', true);

  if (masiniError) {
    return jsonResponse({ error: `Eroare la citirea mașinilor: ${masiniError.message}` }, 500);
  }

  const masinaIds = (masini ?? []).map((m) => m.id);
  const cursaActivaByMasina = new Map<string, { id: string; data_ora_start: string; scop: string | null }>();

  if (masinaIds.length > 0) {
    const { data: curseActive } = await adminClient
      .from('curse')
      .select('id, masina_id, data_ora_start, scop')
      .in('masina_id', masinaIds)
      .is('data_ora_stop', null);

    for (const c of curseActive ?? []) {
      cursaActivaByMasina.set(c.masina_id, { id: c.id, data_ora_start: c.data_ora_start, scop: c.scop });
    }
  }

  const auth = 'Basic ' + btoa(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`);

  // Vezi list-traccar-devices/index.ts: fără `all=true`, Traccar întoarce
  // doar device-urile alocate explicit contului TRACCAR_USER, nu toate
  // (confirmat 2026-09-10/11 — mașini noi legate din Traccar nu apăreau
  // pe hartă / nu li se sincroniza poziția până la acest fix).
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

  // Fallback: GET /api/positions?all=true întoarce doar „ultima poziție"
  // conform pointer-ului intern al Traccar (device.positionId), care nu se
  // actualizează mereu la fel de fiabil ca istoricul real de poziții —
  // confirmat 2026-09-11 pe get-utilaje-positions (aceeași cauză aici, cod
  // identic). Pentru orice mașină cu device găsit dar fără poziție în
  // apelul bulk, mai facem un apel individual pe istoricul din ultimele
  // 30 de zile și luăm cea mai recentă poziție de acolo.
  const deviceIdsFaraPozitie = new Set<number>();
  for (const m of masini ?? []) {
    const d = m.traccar_device_id ? deviceByImei.get(m.traccar_device_id) : undefined;
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

  const rows = (masini ?? []).map((m: any) => {
    const device = m.traccar_device_id ? deviceByImei.get(m.traccar_device_id) : undefined;
    const position = device ? positionByDeviceId.get(device.id) : undefined;
    const cursaActiva = cursaActivaByMasina.get(m.id) ?? null;
    const contact = position?.attributes?.ignition;

    return {
      masina_id: m.id,
      nume: m.nume,
      numar_inmatriculare: m.numar_inmatriculare,
      sofer_nume: m.utilizatori?.nume ?? null,
      ferma_id: m.ferma_id,
      ferma_nume: m.ferme?.nume ?? null,
      viteza_limita_kmh: m.viteza_limita_kmh,
      status: device?.status ?? 'necunoscut',
      contact: typeof contact === 'boolean' ? contact : null,
      lat: position?.latitude ?? null,
      lon: position?.longitude ?? null,
      viteza_kmh: typeof position?.speed === 'number' ? Math.round(position.speed * 1.852 * 10) / 10 : null,
      ultima_actualizare: position?.fixTime ?? device?.lastUpdate ?? null,
      cursa_activa: cursaActiva,
    };
  });

  return jsonResponse({ masini: rows });
});
