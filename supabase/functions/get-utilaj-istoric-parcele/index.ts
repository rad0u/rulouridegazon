// supabase/functions/get-utilaj-istoric-parcele/index.ts
//
// Istoric pe zile pentru un utilaj: câte ore a funcționat (contact/ignition
// pornit) și pe ce parcele, calculat din traseul GPS salvat în
// combustibil_citiri (populat de sync-traccar-fuel la fiecare sincronizare).
// Doar admin_central poate apela funcția.
//
// Cum funcționează:
//   - Se ia traseul cronologic al utilajului (lat/lon + stare contact) pe
//     perioada cerută.
//   - Pentru fiecare interval între două citiri consecutive: dacă starea de
//     contact la ÎNCEPUTUL intervalului era pornită, intervalul contează ca
//     „funcționare" — se adaugă la total ore/zi.
//   - Poziția de la începutul intervalului e testată (point-in-polygon)
//     împotriva poligoanelor parcelelor fermei utilajului — dacă e în
//     interiorul uneia, intervalul se adaugă și la ore/parcelă/zi.
//   - Intervale mai lungi decât MAX_GAP_ORE sunt ignorate (semnalează
//     device offline / gol în date, nu funcționare continuă).
//   - Ziua e determinată în fus orar România (Europe/Bucharest), nu UTC.
//   - Suma orelor pe parcele poate fi mai mică decât totalul de funcționare —
//     diferența e timp cu contactul pornit în afara oricărei parcele
//     (deplasare între parcele, drum, etc.).

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

// Interval maxim între două citiri considerat "continuu" — cron-ul rulează la
// 15 min, deci un gol mai mare de atât înseamnă device offline, nu funcționare.
const MAX_GAP_ORE = 1;

// Bounding-box larg pentru România — filtrează poligoane vechi (format pixeli
// 0..1 din versiunea pre-satelit), la fel ca lib/parcelaTypes.ts din frontend.
const RO_LAT_MIN = 42;
const RO_LAT_MAX = 50;
const RO_LON_MIN = 18;
const RO_LON_MAX = 32;

interface Citire {
  data_ora: string;
  latitudine: number | null;
  longitudine: number | null;
  contact: boolean | null;
}

interface Parcela {
  id: string;
  nume: string;
  poligon_harta: { type: 'Polygon'; coordinates: number[][][] } | null;
}

function poligonValid(parcela: Parcela): number[][] | null {
  const ring = parcela.poligon_harta?.coordinates?.[0];
  if (!ring || ring.length < 3) return null;
  const plauzibil = ring.every(
    ([lon, lat]) => lat >= RO_LAT_MIN && lat <= RO_LAT_MAX && lon >= RO_LON_MIN && lon <= RO_LON_MAX,
  );
  return plauzibil ? ring : null;
}

// Ray casting standard — ring e listă de [lon, lat].
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function gasesteParcela(
  lat: number,
  lon: number,
  parcele: { id: string; nume: string; ring: number[][] }[],
): { id: string; nume: string } | null {
  for (const p of parcele) {
    if (pointInRing(lon, lat, p.ring)) return { id: p.id, nume: p.nume };
  }
  return null;
}

function ziuaLocala(dataIso: string): string {
  // YYYY-MM-DD în fus orar România, indiferent de fusul serverului.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(dataIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
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
    return jsonResponse({ error: 'Doar admin general poate vedea istoricul utilajului.' }, 403);
  }

  const url = new URL(req.url);
  const utilajId = url.searchParams.get('utilaj_id');
  if (!utilajId) {
    return jsonResponse({ error: 'Lipsește utilaj_id.' }, 400);
  }
  const zile = Math.min(90, Math.max(1, Number(url.searchParams.get('zile')) || 14));
  const de_la = new Date(Date.now() - zile * 24 * 60 * 60 * 1000).toISOString();

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: utilaj, error: utilajError } = await adminClient
    .from('utilaje')
    .select('id, nume, ferma_id')
    .eq('id', utilajId)
    .maybeSingle();

  if (utilajError || !utilaj) {
    return jsonResponse({ error: utilajError?.message ?? 'Utilaj negăsit.' }, 404);
  }

  const { data: parceleRaw, error: parceleError } = await adminClient
    .from('parcele')
    .select('id, nume, poligon_harta')
    .eq('ferma_id', utilaj.ferma_id);

  if (parceleError) {
    return jsonResponse({ error: `Eroare la citirea parcelelor: ${parceleError.message}` }, 500);
  }

  const parcele = (parceleRaw as Parcela[])
    .map((p) => {
      const ring = poligonValid(p);
      return ring ? { id: p.id, nume: p.nume, ring } : null;
    })
    .filter((p): p is { id: string; nume: string; ring: number[][] } => p !== null);

  const { data: citiriRaw, error: citiriError } = await adminClient
    .from('combustibil_citiri')
    .select('data_ora, latitudine, longitudine, contact')
    .eq('utilaj_id', utilajId)
    .not('latitudine', 'is', null)
    .not('longitudine', 'is', null)
    .gte('data_ora', de_la)
    .order('data_ora', { ascending: true });

  if (citiriError) {
    return jsonResponse({ error: `Eroare la citirea traseului: ${citiriError.message}` }, 500);
  }

  const citiri = (citiriRaw ?? []) as Citire[];

  const totalOreByDay = new Map<string, number>();
  const oreByDayParcela = new Map<string, Map<string, { nume: string; ore: number }>>();

  for (let i = 1; i < citiri.length; i++) {
    const prev = citiri[i - 1];
    const curr = citiri[i];

    if (prev.contact !== true) continue;
    if (prev.latitudine === null || prev.longitudine === null) continue;

    const deltaOre = (new Date(curr.data_ora).getTime() - new Date(prev.data_ora).getTime()) / 3_600_000;
    if (deltaOre <= 0 || deltaOre > MAX_GAP_ORE) continue;

    const zi = ziuaLocala(prev.data_ora);
    totalOreByDay.set(zi, (totalOreByDay.get(zi) ?? 0) + deltaOre);

    const parcela = gasesteParcela(prev.latitudine, prev.longitudine, parcele);
    if (parcela) {
      if (!oreByDayParcela.has(zi)) oreByDayParcela.set(zi, new Map());
      const dayMap = oreByDayParcela.get(zi)!;
      const existent = dayMap.get(parcela.id);
      if (existent) {
        existent.ore += deltaOre;
      } else {
        dayMap.set(parcela.id, { nume: parcela.nume, ore: deltaOre });
      }
    }
  }

  const zileList = Array.from(totalOreByDay.keys())
    .sort((a, b) => (a < b ? 1 : -1))
    .map((zi) => {
      const parceleZi = Array.from(oreByDayParcela.get(zi)?.values() ?? [])
        .map((p) => ({ nume: p.nume, ore: Math.round(p.ore * 10) / 10 }))
        .sort((a, b) => b.ore - a.ore);

      return {
        data: zi,
        total_ore_functionare: Math.round((totalOreByDay.get(zi) ?? 0) * 10) / 10,
        parcele: parceleZi,
      };
    });

  return jsonResponse({
    utilaj_id: utilaj.id,
    utilaj_nume: utilaj.nume,
    zile,
    de_la,
    are_parcele_desenate: parcele.length > 0,
    zile_istoric: zileList,
  });
});
