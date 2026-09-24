// supabase/functions/get-rezervor-central-miscari/index.ts
//
// Mișcări zilnice ale rezervorului central al unei ferme, pentru un interval
// ales — Radu, 2026-09-24: "la rezervorul central pe fermă să am un dropdown
// sau o extindere să văd mișcările de combustibil - alimentări și total
// ieșiri pe zile. Să pot selecta intervalul de raportare."
//
// Extinde get-rezervor-central (care arată doar starea curentă cumulată de
// la `rezervor_nivel_initial_data`) cu o defalcare PE ZI, pentru un interval
// ales de admin:
//   - alimentat_litri: suma alimentărilor rezervorului central (tabela
//     `rezervor_alimentari`) în ziua respectivă, plus lista lor.
//   - iesiri_litri: consumul total (bilanț de masă) al TUTUROR utilajelor
//     calibrate ale fermei în ziua respectivă — adică motorina care a ieșit
//     efectiv din rezervor spre utilaje, aceeași aproximare (ardere de
//     motor) ca modelul din get-rezervor-central.
//
// Reutilizează verbatim algoritmul de bilanț de masă pe zi din
// get-combustibil-report v15/v16 (filtreazaCitiriPlauzibile,
// eliminaFluctuatiiTranzitorii, extrageExtreme, consumZilnic) — de data asta
// SUMAT peste toate utilajele calibrate ale fermei, nu afișat per utilaj.
//
// v2, 2026-09-24 (Radu): "La unele ferme autoturismele se alimenteaza din
// tancul de motorina" — la fermele unde mașinile de pasageri se alimentează
// tot din rezervorul central (vezi noua pagină /alimentari-auto, tabela
// `alimentari_masini`), acele alimentări sunt și ele o IEȘIRE reală din
// rezervor, la fel ca motorina arsă de utilaje — altfel "diferența netă"
// zilnică nu mai era corectă la fermele cu acest obicei. `iesiri_litri`
// rămâne totalul (utilaje + mașini), dar acum e defalcat explicit în
// `iesiri_utilaje_litri` / `iesiri_masini_litri`, plus lista itemizată
// `alimentari_masini` pe fiecare zi (mașină + cantitate), în oglindă cu
// `alimentari` (alimentările rezervorului central).

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

// Aceleași praguri/convenții ca get-combustibil-report v16.
const PRAG_MINIM_EVENIMENT_L = 15;
const TOLERANTA_CAPACITATE = 1.05;
const MAX_GAP_ORE = 1;
const PRAG_ZGOMOT_L = 5;
const FEREASTRA_REVENIRE_MINUTE = 15;
const PRAG_MISCARE_METRI = 20;

interface Citire {
  data_ora: string;
  nivel_litri: number;
  contact: boolean | null;
  latitudine: number | null;
  longitudine: number | null;
}

interface CitireIndexata {
  citire: Citire;
  index: number;
}

interface Eveniment {
  data_ora: string;
  delta_litri: number;
}

// Vezi get-utilaj-istoric-parcele/index.ts pentru raționamentul complet:
// Supabase trunchiază implicit un .select() la 1000 de rânduri.
const PAGE_SIZE = 1000;
async function fetchToateRandurile(
  build: (from: number, to: number) => PromiseLike<{ data: Citire[] | null; error: { message: string } | null }>,
): Promise<{ data: Citire[]; error: string | null }> {
  const toate: Citire[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await build(offset, offset + PAGE_SIZE - 1);
    if (error) return { data: [], error: error.message };
    const pagina = data ?? [];
    toate.push(...pagina);
    if (pagina.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { data: toate, error: null };
}

function filtreazaCitiriPlauzibile(rows: Citire[], capacitate: number): Citire[] {
  const prag = capacitate * TOLERANTA_CAPACITATE;
  return rows.filter((r) => r.nivel_litri >= 0 && r.nivel_litri <= prag);
}

function eliminaFluctuatiiTranzitorii(rows: Citire[]): Citire[] {
  if (rows.length === 0) return [];
  const rezultat: Citire[] = [rows[0]];
  let i = 1;
  while (i < rows.length) {
    const ancora = rezultat[rezultat.length - 1];
    const r = rows[i];
    const diff = Math.abs(r.nivel_litri - ancora.nivel_litri);

    if (diff < PRAG_MINIM_EVENIMENT_L) {
      rezultat.push(r);
      i++;
      continue;
    }

    let j = i;
    let gasitRevenire = -1;
    while (j < rows.length) {
      const minute = (new Date(rows[j].data_ora).getTime() - new Date(ancora.data_ora).getTime()) / 60_000;
      if (minute > FEREASTRA_REVENIRE_MINUTE) break;
      if (Math.abs(rows[j].nivel_litri - ancora.nivel_litri) < PRAG_MINIM_EVENIMENT_L) {
        gasitRevenire = j;
        break;
      }
      j++;
    }

    if (gasitRevenire >= 0) {
      i = gasitRevenire;
      continue;
    }

    rezultat.push(r);
    i++;
  }
  return rezultat;
}

function extrageExtreme(rows: Citire[]): CitireIndexata[] {
  if (rows.length === 0) return [];

  const extreme: CitireIndexata[] = [{ citire: rows[0], index: 0 }];
  let directie = 0;
  let candidat: CitireIndexata = { citire: rows[0], index: 0 };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];

    if (directie === 0) {
      const delta = r.nivel_litri - extreme[0].citire.nivel_litri;
      if (Math.abs(delta) < PRAG_ZGOMOT_L) continue;
      directie = delta > 0 ? 1 : -1;
      candidat = { citire: r, index: i };
      continue;
    }

    if (directie === 1) {
      if (r.nivel_litri >= candidat.citire.nivel_litri) {
        candidat = { citire: r, index: i };
      } else if (candidat.citire.nivel_litri - r.nivel_litri >= PRAG_ZGOMOT_L) {
        extreme.push(candidat);
        directie = -1;
        candidat = { citire: r, index: i };
      }
    } else {
      if (r.nivel_litri <= candidat.citire.nivel_litri) {
        candidat = { citire: r, index: i };
      } else if (r.nivel_litri - candidat.citire.nivel_litri >= PRAG_ZGOMOT_L) {
        extreme.push(candidat);
        directie = 1;
        candidat = { citire: r, index: i };
      }
    }
  }

  if (candidat.index !== extreme[extreme.length - 1].index) {
    extreme.push(candidat);
  }

  return extreme;
}

function distantaMetri(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const latRad = (lat1 * Math.PI) / 180;
  const dLat = (lat2 - lat1) * 111_320;
  const dLon = (lon2 - lon1) * 111_320 * Math.cos(latRad);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function intervalInFunctionare(prev: Citire, curr: Citire): boolean {
  if (prev.contact === true) return true;
  if (prev.latitudine == null || prev.longitudine == null || curr.latitudine == null || curr.longitudine == null) {
    return false;
  }
  return distantaMetri(prev.latitudine, prev.longitudine, curr.latitudine, curr.longitudine) >= PRAG_MISCARE_METRI;
}

const FORMATTER_ZI_LOCALA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bucharest',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function ziuaLocala(dataIso: string): string {
  const parts = FORMATTER_ZI_LOCALA.formatToParts(new Date(dataIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function offsetLocalOre(dataStr: string): number {
  const ancora = new Date(`${dataStr}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest',
    timeZoneName: 'shortOffset',
  }).formatToParts(ancora);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2';
  const m = tz.match(/GMT([+-]\d+)/);
  return m ? parseInt(m[1], 10) : 2;
}

function inceputZileiLocaleUTC(dataStr: string): Date {
  const offsetOre = offsetLocalOre(dataStr);
  return new Date(new Date(`${dataStr}T00:00:00.000Z`).getTime() - offsetOre * 3_600_000);
}

function ziuaUrmatoare(dataStr: string): string {
  const d = new Date(`${dataStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function primaSiUltimaCitirePeZi(rows: Citire[]): Map<string, { prima: number; ultima: number }> {
  const rezultat = new Map<string, { prima: number; ultima: number }>();
  for (const r of rows) {
    const zi = ziuaLocala(r.data_ora);
    const existent = rezultat.get(zi);
    if (!existent) {
      rezultat.set(zi, { prima: r.nivel_litri, ultima: r.nivel_litri });
    } else {
      existent.ultima = r.nivel_litri;
    }
  }
  return rezultat;
}

function realimentariPeZi(realimentari: Eveniment[]): Map<string, number> {
  const rezultat = new Map<string, number>();
  for (const e of realimentari) {
    const zi = ziuaLocala(e.data_ora);
    rezultat.set(zi, (rezultat.get(zi) ?? 0) + e.delta_litri);
  }
  return rezultat;
}

// Consum (litri), per zi locală, pentru un singur utilaj — identic cu
// `consumZilnic` din get-combustibil-report, dar întoarce doar Map<zi, litri>
// (aici nu ne interesează orele de funcționare, doar litrii ieșiți).
function consumZilnicLitri(rows: Citire[], realimentari: Eveniment[]): Map<string, number> {
  const niveluriPeZi = primaSiUltimaCitirePeZi(rows);
  const realimentariZi = realimentariPeZi(realimentari);

  const rezultat = new Map<string, number>();
  for (const [zi, niveluri] of niveluriPeZi) {
    const netScazut = niveluri.prima - niveluri.ultima;
    const realimentatZi = realimentariZi.get(zi) ?? 0;
    const consum = Math.max(0, netScazut + realimentatZi);
    rezultat.set(zi, consum);
  }
  return rezultat;
}

interface AlimentareRezervor {
  id: string;
  data_ora: string;
  cantitate_litri: number;
  pret_litru: number;
  note: string | null;
}

// v2: o alimentare de mașină din rezervorul central, cu numele mașinii deja
// atașat (rezolvat din tabela `masini`, nu vine direct din DB).
interface AlimentareMasina {
  id: string;
  data_ora: string;
  cantitate_litri: number;
  note: string | null;
  masina_nume: string;
}

interface ZiMiscare {
  data: string;
  alimentat_litri: number;
  alimentari: AlimentareRezervor[];
  iesiri_litri: number;
  iesiri_utilaje_litri: number;
  iesiri_masini_litri: number;
  alimentari_masini: AlimentareMasina[];
  diferenta_neta_litri: number;
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
    return jsonResponse({ error: 'Doar admin general poate vedea mișcările rezervorului central.' }, 403);
  }

  const url = new URL(req.url);
  const fermaId = url.searchParams.get('ferma_id');
  if (!fermaId) {
    return jsonResponse({ error: 'Lipsește ferma_id.' }, 400);
  }

  const REGEX_DATA_ZI = /^\d{4}-\d{2}-\d{2}$/;
  const deLaParam = url.searchParams.get('de_la');
  const panaLaParam = url.searchParams.get('pana_la');

  const aziStr = new Date().toISOString().slice(0, 10);
  const deLaStr =
    deLaParam && REGEX_DATA_ZI.test(deLaParam)
      ? deLaParam
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const panaLaStr = panaLaParam && REGEX_DATA_ZI.test(panaLaParam) ? panaLaParam : aziStr;

  const de_la = inceputZileiLocaleUTC(deLaStr).toISOString();
  const stopExclusiv = inceputZileiLocaleUTC(ziuaUrmatoare(panaLaStr));

  if (stopExclusiv.getTime() <= new Date(de_la).getTime()) {
    return jsonResponse({ error: 'Interval invalid: data de sfârșit trebuie să fie după data de început.' }, 400);
  }
  const nrZile = (stopExclusiv.getTime() - new Date(de_la).getTime()) / (24 * 3_600_000);
  if (nrZile > 366) {
    return jsonResponse({ error: 'Intervalul selectat e prea mare (peste 366 de zile).' }, 400);
  }
  const pana_la = stopExclusiv.toISOString();

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: ferma, error: fermaError } = await adminClient
    .from('ferme')
    .select('id, nume')
    .eq('id', fermaId)
    .maybeSingle();

  if (fermaError || !ferma) {
    return jsonResponse({ error: fermaError?.message ?? 'Ferma nu a fost găsită.' }, 404);
  }

  // Alimentările rezervorului central în interval, grupate pe zi.
  const { data: alimentariRaw, error: alimentariError } = await adminClient
    .from('rezervor_alimentari')
    .select('id, data_ora, cantitate_litri, pret_litru, note')
    .eq('ferma_id', fermaId)
    .gte('data_ora', de_la)
    .lt('data_ora', pana_la)
    .order('data_ora', { ascending: false });

  if (alimentariError) {
    return jsonResponse({ error: `Eroare la citirea alimentărilor: ${alimentariError.message}` }, 500);
  }

  const alimentariPeZiMap = new Map<string, AlimentareRezervor[]>();
  for (const a of (alimentariRaw ?? []) as AlimentareRezervor[]) {
    const zi = ziuaLocala(a.data_ora);
    const lista = alimentariPeZiMap.get(zi) ?? [];
    lista.push(a);
    alimentariPeZiMap.set(zi, lista);
  }

  // Ieșiri (consum utilaje calibrate ale fermei), pe zi — sumat peste toate
  // utilajele, la fel ca modelul din get-rezervor-central, dar defalcat zi cu
  // zi în loc de un total cumulat pe toată perioada de la nivelul inițial.
  const { data: utilaje, error: utilajeError } = await adminClient
    .from('utilaje')
    .select('id, tanc_capacitate_litri')
    .eq('ferma_id', fermaId)
    .eq('activ', true);

  if (utilajeError) {
    return jsonResponse({ error: `Eroare la citirea utilajelor: ${utilajeError.message}` }, 500);
  }

  const utilajeCalibrate = (utilaje ?? []).filter(
    (u) => typeof u.tanc_capacitate_litri === 'number' && u.tanc_capacitate_litri > 0,
  );

  const iesiriUtilajePeZi = new Map<string, number>();

  for (const u of utilajeCalibrate) {
    const { data: citiri, error: citiriError } = await fetchToateRandurile((from, to) =>
      adminClient
        .from('combustibil_citiri')
        .select('data_ora, nivel_litri, contact, latitudine, longitudine')
        .eq('utilaj_id', u.id)
        .not('nivel_litri', 'is', null)
        .gte('data_ora', de_la)
        .lt('data_ora', pana_la)
        .order('data_ora', { ascending: true })
        .range(from, to),
    );

    if (citiriError) continue;

    const rows = eliminaFluctuatiiTranzitorii(filtreazaCitiriPlauzibile(citiri, u.tanc_capacitate_litri as number));
    const extreme = extrageExtreme(rows);

    const realimentari: Eveniment[] = [];
    for (let i = 1; i < extreme.length; i++) {
      const prev = extreme[i - 1].citire;
      const curr = extreme[i].citire;
      const delta = Number(curr.nivel_litri) - Number(prev.nivel_litri);
      if (delta >= PRAG_MINIM_EVENIMENT_L) {
        realimentari.push({ data_ora: curr.data_ora, delta_litri: delta });
      }
    }

    const consumZi = consumZilnicLitri(rows, realimentari);
    for (const [zi, litri] of consumZi) {
      iesiriUtilajePeZi.set(zi, (iesiriUtilajePeZi.get(zi) ?? 0) + litri);
    }
  }

  // v2: ieșiri către mașinile de pasageri alimentate din rezervorul central
  // (tabela nouă `alimentari_masini`, vezi /alimentari-auto) — la fermele
  // unde asta nu se întâmplă, listele de mai jos sunt goale și nu schimbă
  // nimic față de v1.
  const { data: masiniFerma, error: masiniError } = await adminClient
    .from('masini')
    .select('id, nume')
    .eq('ferma_id', fermaId);

  const masiniMap = new Map<string, string>();
  for (const m of (masiniFerma ?? []) as { id: string; nume: string }[]) {
    masiniMap.set(m.id, m.nume);
  }

  const iesiriMasiniPeZi = new Map<string, number>();
  const alimentariMasiniPeZiMap = new Map<string, AlimentareMasina[]>();

  if (!masiniError && masiniMap.size > 0) {
    const { data: alimentariMasiniRaw, error: alimentariMasiniError } = await adminClient
      .from('alimentari_masini')
      .select('id, data_ora, cantitate_litri, note, masina_id')
      .in('masina_id', Array.from(masiniMap.keys()))
      .gte('data_ora', de_la)
      .lt('data_ora', pana_la)
      .order('data_ora', { ascending: false });

    if (!alimentariMasiniError) {
      for (const a of (alimentariMasiniRaw ?? []) as {
        id: string;
        data_ora: string;
        cantitate_litri: number;
        note: string | null;
        masina_id: string;
      }[]) {
        const zi = ziuaLocala(a.data_ora);
        iesiriMasiniPeZi.set(zi, (iesiriMasiniPeZi.get(zi) ?? 0) + Number(a.cantitate_litri));
        const lista = alimentariMasiniPeZiMap.get(zi) ?? [];
        lista.push({
          id: a.id,
          data_ora: a.data_ora,
          cantitate_litri: a.cantitate_litri,
          note: a.note,
          masina_nume: masiniMap.get(a.masina_id) ?? '—',
        });
        alimentariMasiniPeZiMap.set(zi, lista);
      }
    }
  }

  const toateZilele = new Set<string>([
    ...alimentariPeZiMap.keys(),
    ...iesiriUtilajePeZi.keys(),
    ...iesiriMasiniPeZi.keys(),
  ]);

  const zile: ZiMiscare[] = Array.from(toateZilele)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((zi) => {
      const alimentari = (alimentariPeZiMap.get(zi) ?? []).sort((a, b) => (a.data_ora < b.data_ora ? 1 : -1));
      const alimentatLitri = Math.round(alimentari.reduce((s, a) => s + Number(a.cantitate_litri), 0) * 10) / 10;
      const iesiriUtilajeLitri = Math.round((iesiriUtilajePeZi.get(zi) ?? 0) * 10) / 10;
      const iesiriMasiniLitri = Math.round((iesiriMasiniPeZi.get(zi) ?? 0) * 10) / 10;
      const iesiriLitri = Math.round((iesiriUtilajeLitri + iesiriMasiniLitri) * 10) / 10;
      const alimentariMasini = (alimentariMasiniPeZiMap.get(zi) ?? []).sort((a, b) => (a.data_ora < b.data_ora ? 1 : -1));
      return {
        data: zi,
        alimentat_litri: alimentatLitri,
        alimentari,
        iesiri_litri: iesiriLitri,
        iesiri_utilaje_litri: iesiriUtilajeLitri,
        iesiri_masini_litri: iesiriMasiniLitri,
        alimentari_masini: alimentariMasini,
        diferenta_neta_litri: Math.round((alimentatLitri - iesiriLitri) * 10) / 10,
      };
    });

  return jsonResponse({
    ferma_id: fermaId,
    ferma_nume: ferma.nume,
    de_la: deLaStr,
    pana_la: panaLaStr,
    utilaje_calibrate_incluse: utilajeCalibrate.length,
    utilaje_total: (utilaje ?? []).length,
    zile,
  });
});
