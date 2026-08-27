// supabase/functions/sync-traccar-fuel/index.ts
//
// Job programat (cron) care trage istoricul de poziții din Traccar și salvează
// poziția (lat/lon), starea de contact (ignition) și — dacă e disponibil —
// nivelul de combustibil (senzor DUT-E, citit prin FMC125) în
// public.combustibil_citiri.
//
// STARE: ACTIVĂ (deployată 2026-08-18, extinsă 2026-08-27) — secretele
// TRACCAR_URL/USER/PASSWORD sunt setate, cron-ul rulează la 5 minute (vezi
// schema-cron-sync-traccar.sql).
//
// CONFIRMAT (2026-08-18, pilot Săbăreni): atributul de combustibil în Traccar
// e "io201" (Teltonika FMC125, RS232 -> LLS, DUT-E 232). Atributul de contact
// e "ignition" (boolean) — confirmat 2026-08-27.
//
// 2026-08-27 (v1): se salvează o citire pentru ORICE utilaj cu poziție
// validă, chiar dacă n-are (încă) valoare de combustibil — altfel utilajele
// fără senzor de combustibil calibrat n-ar avea deloc istoric de
// poziție/traseu, necesar pentru raportul „ore lucrate pe parcelă"
// (get-utilaj-istoric-parcele).
//
// 2026-08-27 (v2): în loc să cerem din Traccar doar "poziția curentă"
// (GET /api/positions), cerem TOT istoricul de poziții de la ultima citire
// salvată până acum (GET /api/positions?deviceId=X&from=...&to=...).
// Motiv: verificat direct în Traccar (Reports -> Positions) — cât timp
// utilajul se mișcă, FMC125 raportează o poziție nouă la fiecare 2-15
// secunde; cât timp stă pe loc, doar o dată pe oră (heartbeat). Cu vechea
// abordare (o singură citire per rulare de cron), rezoluția reală era
// limitată la intervalul de cron (5 min), pierzând aproape toate pozițiile
// intermediare cât timp utilajul lucra. Acum prindem fiecare poziție reală
// raportată de device, ceea ce dă mult mai multă precizie la atribuirea
// ore-lucrate-pe-parcelă din get-utilaj-istoric-parcele.
//
// TODO rămase:
//   1. Calibrează senzorul DUT-E pe rezervorul real (Service DUT-E, tabel de
//      tarare) — abia după calibrare "io201" corespunde unor litri reali.
//   2. Adaugă restul utilajelor în tabela public.utilaje, cu traccar_device_id
//      = IMEI-ul device-ului din Traccar (Devices -> Identifier). Pilotul
//      (FMC125 Săbăreni, IMEI 862272083141426) e deja adăugat.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const TRACCAR_URL = Deno.env.get('TRACCAR_URL') ?? '';
const TRACCAR_USER = Deno.env.get('TRACCAR_USER') ?? '';
const TRACCAR_PASSWORD = Deno.env.get('TRACCAR_PASSWORD') ?? '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Confirmat din Traccar (Latest position -> More info) pe pilotul Săbăreni.
const FUEL_ATTRIBUTE_CANDIDATES = ['io201', 'fuel1', 'fuel', 'fuelLevel'];

// Dacă ultima citire salvată e mai veche decât atât (ex. cron-ul a fost oprit
// temporar, sau utilajul a fost offline zile întregi), nu recuperăm tot golul
// dintr-o singură rulare — am putea cere de la Traccar zeci de mii de puncte
// dintr-o dată. Rămâne un gol în istoric, dar nu blocăm/încetinim sincronizarea.
const MAX_LOOKBACK_ORE = 3;
// Interval implicit de căutat înapoi când utilajul n-are încă nicio citire
// salvată (prima rulare pentru el).
const DEFAULT_LOOKBACK_MINUTE = 20;

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

function extractContact(attributes: Record<string, unknown>): boolean | null {
  const value = attributes['ignition'];
  return typeof value === 'boolean' ? value : null;
}

Deno.serve(async () => {
  if (!TRACCAR_URL || !TRACCAR_USER || !TRACCAR_PASSWORD) {
    return new Response('Lipsesc credențialele Traccar (TRACCAR_URL/USER/PASSWORD).', {
      status: 500,
    });
  }

  const auth = 'Basic ' + btoa(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const devicesRes = await fetch(`${TRACCAR_URL}/api/devices`, { headers: { Authorization: auth } });
  if (!devicesRes.ok) {
    return new Response('Eroare la citirea device-urilor din Traccar.', { status: 502 });
  }
  const devices: TraccarDevice[] = await devicesRes.json();
  const deviceByImei = new Map(devices.map((d) => [d.uniqueId, d]));

  const { data: utilaje, error: utilajeError } = await supabase
    .from('utilaje')
    .select('id, traccar_device_id')
    .eq('activ', true)
    .not('traccar_device_id', 'is', null);

  if (utilajeError) {
    return new Response(`Eroare la citirea utilajelor: ${utilajeError.message}`, { status: 500 });
  }

  const now = new Date();
  const minFrom = new Date(now.getTime() - MAX_LOOKBACK_ORE * 3_600_000);
  const defaultFrom = new Date(now.getTime() - DEFAULT_LOOKBACK_MINUTE * 60_000);

  const rows: Record<string, unknown>[] = [];
  const perUtilaj: Record<string, number> = {};
  const erori: Record<string, string> = {};

  for (const utilaj of utilaje ?? []) {
    const device = deviceByImei.get(utilaj.traccar_device_id as string);
    if (!device) continue;

    // Pornim de unde am rămas ultima dată, ca să prindem TOT istoricul de
    // poziții raportate de Traccar de atunci — nu doar "poziția curentă".
    const { data: ultima } = await supabase
      .from('combustibil_citiri')
      .select('data_ora')
      .eq('utilaj_id', utilaj.id)
      .order('data_ora', { ascending: false })
      .limit(1)
      .maybeSingle();

    let from = ultima?.data_ora ? new Date(ultima.data_ora as string) : defaultFrom;
    if (from < minFrom) from = minFrom;
    if (from >= now) continue;

    const url = `${TRACCAR_URL}/api/positions?deviceId=${device.id}&from=${from.toISOString()}&to=${now.toISOString()}`;
    const posRes = await fetch(url, { headers: { Authorization: auth } });

    if (!posRes.ok) {
      erori[utilaj.id] = `Traccar a răspuns cu ${posRes.status} pentru device ${device.id}.`;
      continue;
    }

    const positions: TraccarPosition[] = await posRes.json();
    perUtilaj[utilaj.id] = positions.length;

    for (const position of positions) {
      if (position.latitude === undefined || position.longitude === undefined) continue;

      rows.push({
        utilaj_id: utilaj.id,
        data_ora: position.fixTime,
        nivel_litri: extractFuelLiters(position.attributes),
        contact: extractContact(position.attributes),
        latitudine: position.latitude,
        longitudine: position.longitude,
        sursa: 'traccar',
      });
    }
  }

  if (rows.length === 0) {
    return new Response(JSON.stringify({ inserted: 0, per_utilaj: perUtilaj, erori }), { status: 200 });
  }

  const { error: insertError } = await supabase
    .from('combustibil_citiri')
    .upsert(rows, { onConflict: 'utilaj_id,data_ora', ignoreDuplicates: true });

  if (insertError) {
    return new Response(`Eroare la salvare: ${insertError.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ inserted: rows.length, per_utilaj: perUtilaj, erori }), { status: 200 });
});
