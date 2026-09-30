// supabase/functions/get-rezervor-central/index.ts
//
// Stoc de motorină la nivel de fermă (rezervor central), separat de rezervoarele
// individuale ale utilajelor. Doar admin_central poate apela funcția.
//
// MODEL DE CALCUL (simplificare asumată — vezi și schema-rezervor-central.sql):
//   nivel_curent = nivel_initial
//                + SUMA alimentărilor rezervorului central după data_initial
//                - SUMA consumului de motorină al utilajelor CALIBRATE ale fermei
//                  (toate scăderile din combustibil_citiri) după data_initial
//
// Se scade CONSUMUL utilajelor (arderea de motor), nu evenimentele de realimentare a
// utilajelor individuale — presupunem că, pe termen mediu, motorina arsă de utilaje e o
// aproximare rezonabilă a motorinei scoase din rezervorul central. Dacă în practică nu se
// potrivește cu realitatea (ex. utilajele au rezervoare mari, tampon considerabil), de
// reconsiderat modelul.
//
// La fel ca în get-combustibil-report/index.ts: înainte de a suma scăderile, se
// elimină citirile fizic imposibile (peste capacitatea reală a rezervorului
// utilajului) — de obicei artefacte ale unui senzor încă necalibrat în litri
// ("kvants") sau ale unui moment de recalibrare în teren. Fără acest filtru, un
// asemenea artefact (ex. un salt de zeci de litri la recalibrare) e numărat drept
// consum real și umflă total_consumat_litri.
//
// 2026-09-30 (Radu): BUG găsit — fermă Săbăreni arăta "Nivel curent" −7117L,
// deși avea nivel inițial 4940L + o alimentare de 7248L pe 24 sept. (deci ar
// fi trebuit să fie pozitiv). Cauza: acest fișier calcula total_consumat_litri
// ca sumă BRUTĂ a tuturor scăderilor consecutive între citiri (`if (delta < 0)
// totalConsumat += Math.abs(delta)`), fără filtrul de zgomot tranzitoriu
// (`eliminaFluctuatiiTranzitorii`) și fără bilanț de masă — spre deosebire de
// TOATE celelalte fișiere de combustibil (inclusiv get-rezervor-central-miscari,
// care calculează exact aceeași cifră dar pe zile, corect). Rezultatul: fiecare
// mic zgomot de senzor care coboară și revine (frecvent, la citiri la fiecare
// câteva secunde) era numărat ca și consum, fără să se scadă revenirea — o
// dublă numărare masivă. Verificat direct pe date reale (SQL): suma brută a
// scăderilor pentru Săbăreni de la 22 sept. era 19305L, de peste 12 ori mai
// mare decât cei ~1573L calculați corect (cu filtru + bilanț de masă) de
// get-rezervor-central-miscari pentru aceeași fermă și perioadă.
// Fix: aceeași abordare de bilanț de masă ca `consumPeLuna`/`consumZilnicLitri`
// din celelalte fișiere, aplicată pe TOT intervalul [nivel_initial_data, acum]
// dintr-o dată (fără găleți pe zi/lună): consum_utilaj = (prima citire − ultima
// citire) + suma realimentărilor detectate (salturi ≥15L) în tot intervalul,
// pe date deja trecute prin `eliminaFluctuatiiTranzitorii`.

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

// Toleranță peste capacitatea declarată a rezervorului până la care o citire e
// considerată totuși plauzibilă (supra-umplere, dilatare termică a motorinei,
// mic offset de senzor) — orice peste asta e aproape sigur o valoare brută
// necalibrată, nu litri reali. Vezi get-combustibil-report/index.ts.
const TOLERANTA_CAPACITATE = 1.05;
// 2026-09-30: aceleași praguri ca în celelalte fișiere de combustibil (vezi
// get-rezervor-central-miscari) — necesare pentru filtrul de zgomot tranzitoriu
// și pentru detecția realimentărilor (salturi pozitive peste prag).
const PRAG_MINIM_EVENIMENT_L = 15;
const PRAG_ZGOMOT_L = 5;
const FEREASTRA_REVENIRE_MINUTE = 15;

interface Citire {
  data_ora: string;
  nivel_litri: number;
}

interface CitireIndexata {
  citire: Citire;
  index: number;
}

// Vezi get-utilaj-istoric-parcele/index.ts pentru raționamentul complet:
// Supabase trunchiază implicit un .select() la 1000 de rânduri, ceea ce
// falsifică silențios agregările pe traseu lung fără paginare explicită.
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

// Elimină citirile fizic imposibile pentru un rezervor de `capacitate` litri.
function filtreazaCitiriPlauzibile(rows: Citire[], capacitate: number): Citire[] {
  const prag = capacitate * TOLERANTA_CAPACITATE;
  return rows.filter((r) => r.nivel_litri >= 0 && r.nivel_litri <= prag);
}

// 2026-09-30: identic cu get-rezervor-central-miscari / get-cost-productie —
// elimină excursii tranzitorii de senzor (salt care revine singur în câteva
// minute), ca să nu fie confundate cu consum/realimentare reală. Fereastra de
// revenire se măsoară de la citirea suspectă însăși, nu de la ultima citire
// bună (altfel un glitch imediat după o pauză de telemetrie scapă de filtru).
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
      const minute = (new Date(rows[j].data_ora).getTime() - new Date(r.data_ora).getTime()) / 60_000;
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

// 2026-09-30: extrage punctele de întoarcere (extreme locale, histerezis) —
// necesar ca să detectăm doar realimentările REALE (salturi pozitive peste
// prag), nu zgomotul fin al senzorului.
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
  if (candidat.index !== extreme[extreme.length - 1].index) extreme.push(candidat);
  return extreme;
}

// 2026-09-30: consum (bilanț de masă) pe TOT intervalul de citiri date —
// prima citire minus ultima, plus tot ce s-a realimentat (salturi ≥ prag) în
// interval. Vezi `consumPeLuna`/`consumZilnicLitri` în celelalte fișiere —
// aceeași formulă, dar aplicată dintr-o dată pe tot intervalul [nivel_initial_
// data, acum], nu pe găleți de zi/lună (aici ne interesează doar un total
// cumulat, nu o defalcare în timp).
function consumTotalInterval(rows: Citire[]): number {
  if (rows.length === 0) return 0;
  const extreme = extrageExtreme(rows);
  let realimentat = 0;
  for (let i = 1; i < extreme.length; i++) {
    const prev = extreme[i - 1].citire;
    const curr = extreme[i].citire;
    const delta = Number(curr.nivel_litri) - Number(prev.nivel_litri);
    if (delta >= PRAG_MINIM_EVENIMENT_L) realimentat += delta;
  }
  const netScazut = Number(rows[0].nivel_litri) - Number(rows[rows.length - 1].nivel_litri);
  return Math.max(0, netScazut + realimentat);
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
      .select('id, data_ora, cantitate_litri, pret_litru, note')
      .eq('ferma_id', f.id)
      .gte('data_ora', de_la)
      .order('data_ora', { ascending: false });

    if (alimentariError) {
      rezultate.push({ ferma_id: f.id, nume: f.nume, eroare: alimentariError.message });
      continue;
    }

    const totalAlimentat = (alimentari ?? []).reduce((s, a) => s + Number(a.cantitate_litri), 0);

    // Preț mediu ponderat al motorinei cumpărate de fermă (Radu, 2026-09-15:
    // prețul se introduce la fiecare alimentare fiindcă variază mereu — nu
    // există un preț unic curent). Folosit ulterior la calculul costului de
    // producție (consum din sondă × preț mediu al perioadei).
    const valoareTotalaAlimentari = (alimentari ?? []).reduce(
      (s, a) => s + Number(a.cantitate_litri) * Number(a.pret_litru),
      0,
    );
    const pretLitruMediu = totalAlimentat > 0 ? valoareTotalaAlimentari / totalAlimentat : null;

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
      const { data: citiri, error: citiriError } = await fetchToateRandurile(
        (from, to) =>
          adminClient
            .from('combustibil_citiri')
            .select('data_ora, nivel_litri')
            .eq('utilaj_id', u.id)
            .not('nivel_litri', 'is', null)
            .gte('data_ora', de_la)
            .order('data_ora', { ascending: true })
            .range(from, to),
      );

      if (citiriError) continue;

      const rows = eliminaFluctuatiiTranzitorii(filtreazaCitiriPlauzibile(citiri, u.tanc_capacitate_litri as number));
      totalConsumat += consumTotalInterval(rows);
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
      pret_litru_mediu: pretLitruMediu !== null ? Math.round(pretLitruMediu * 100) / 100 : null,
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
