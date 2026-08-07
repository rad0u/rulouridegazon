// supabase/functions/sync-traccar-fuel/index.ts
//
// Job programat (cron) care trage pozițiile curente din Traccar și salvează
// nivelul de combustibil (senzor DUT-E 232, citit prin RS232 pe FMC125) în
// public.combustibil_citiri.
//
// STARE: DRAFT — nu e încă deployat/activat.
// TODO înainte de activare:
//   1. Montează + configurează primul FMC125 (RS232 -> Digital Fuel Sensor / LLS,
//      Codec 8 Extended) și senzorul DUT-E 232, calibrat pe rezervor.
//   2. În Traccar, deschide device-ul -> Latest position -> More info, și
//      identifică exact numele atributului de combustibil (variază după codec,
//      posibil "fuel1" / vreun id numeric de tip "io84" etc). Actualizează
//      FUEL_ATTRIBUTE_CANDIDATES mai jos cu numele corect găsit.
//   3. Creează un user Traccar dedicat (read-only, API) și pune-i
//      credențialele ca secrete: TRACCAR_URL, TRACCAR_USER, TRACCAR_PASSWORD.
//   4. Adaugă utilajele în tabela public.utilaje, cu traccar_device_id =
//      IMEI-ul device-ului din Traccar (Devices -> Identifier).
//   5. Deployează funcția și programează-o (Supabase -> Edge Functions -> Cron,
//      sau pg_cron -> net.http_post) la un interval rezonabil (ex. la 15 min).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const TRACCAR_URL = Deno.env.get('TRACCAR_URL') ?? '';
const TRACCAR_USER = Deno.env.get('TRACCAR_USER') ?? '';
const TRACCAR_PASSWORD = Deno.env.get('TRACCAR_PASSWORD') ?? '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// TODO: confirmă numele real al atributului după prima citire reală din Traccar.
const FUEL_ATTRIBUTE_CANDIDATES = ['fuel1', 'fuel', 'fuelLevel'];

interface TraccarPosition {
  deviceId: number;
  fixTime: string;
  latitude: number;
  longitude: number;
  attributes: Record<string, unknown>;
}

interface TraccarDevice {
  id: number;
  uniqueId: string; // de regulă IMEI-ul device-ului
}

function extractFuelLiters(attributes: Record<string, unknown>): number | null {
  for (const key of FUEL_ATTRIBUTE_CANDIDATES) {
    const value = attributes[key];
    if (typeof value === 'number') return value;
  }
  return null;
}

Deno.serve(async () => {
  if (!TRACCAR_URL || !TRACCAR_USER || !TRACCAR_PASSWORD) {
    return new Response('Lipsesc credențialele Traccar (TRACCAR_URL/USER/PASSWORD).', {
      status: 500,
    });
  }

  const auth = 'Basic ' + btoa(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`);

  const [devicesRes, positionsRes] = await Promise.all([
    fetch(`${TRACCAR_URL}/api/devices`, { headers: { Authorization: auth } }),
    fetch(`${TRACCAR_URL}/api/positions`, { headers: { Authorization: auth } }),
  ]);

  if (!devicesRes.ok || !positionsRes.ok) {
    return new Response('Eroare la citirea din Traccar API.', { status: 502 });
  }

  const devices: TraccarDevice[] = await devicesRes.json();
  const positions: TraccarPosition[] = await positionsRes.json();

  const deviceById = new Map(devices.map((d) => [d.id, d]));

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: utilaje, error: utilajeError } = await supabase
    .from('utilaje')
    .select('id, traccar_device_id')
    .eq('activ', true);

  if (utilajeError) {
    return new Response(`Eroare la citirea utilajelor: ${utilajeError.message}`, { status: 500 });
  }

  const utilajByImei = new Map((utilaje ?? []).map((u) => [u.traccar_device_id, u.id]));

  const rows = [];
  for (const position of positions) {
    const device = deviceById.get(position.deviceId);
    if (!device) continue;

    const utilajId = utilajByImei.get(device.uniqueId);
    if (!utilajId) continue; // device Traccar fără utilaj mapat încă

    const nivelLitri = extractFuelLiters(position.attributes);
    if (nivelLitri === null) continue; // fără dată de fuel în această poziție

    rows.push({
      utilaj_id: utilajId,
      data_ora: position.fixTime,
      nivel_litri: nivelLitri,
      latitudine: position.latitude,
      longitudine: position.longitude,
      sursa: 'traccar',
    });
  }

  if (rows.length === 0) {
    return new Response(JSON.stringify({ inserted: 0 }), { status: 200 });
  }

  const { error: insertError } = await supabase
    .from('combustibil_citiri')
    .upsert(rows, { onConflict: 'utilaj_id,data_ora', ignoreDuplicates: true });

  if (insertError) {
    return new Response(`Eroare la salvare: ${insertError.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ inserted: rows.length }), { status: 200 });
});
