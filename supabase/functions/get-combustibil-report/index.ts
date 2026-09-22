// supabase/functions/get-combustibil-report/index.ts
//
// Raport de consum combustibil per utilaj, pe o perioadă dată (implicit 7 zile),
// calculat din istoricul brut din public.combustibil_citiri (populat de
// sync-traccar-fuel). Doar admin_central poate apela funcția.
//
// Cum funcționează:
//   0. Se elimină citirile fizic imposibile: orice nivel_litri peste capacitatea
//      reală a rezervorului (+ o toleranță mică) sau negativ. Astfel de valori nu
//      sunt "litri prea mulți din greșeală" — sunt semn că senzorul DUT-E raporta
//      încă în unități brute ("kvants"), nu în litri calibrați. O citire imposibilă
//      nu poate fi folosită ca reper pentru un eveniment — se ignoră complet.
//   0b. Se elimină rafalele scurte de citiri aproape-zero care revin singure la
//       nivelul dinainte în câteva minute — artefact de senzor, nu rezervor gol.
//       Vezi comentariul de la `eliminaDropoutTranzitoriu` mai jos.
//   1. Citirile valide rămase se comprimă în puncte de întoarcere (extreme locale):
//      cât timp nivelul se mișcă în aceeași direcție, pașii intermediari se
//      contopesc într-un singur eveniment (altfel o realimentare turnată treptat
//      ar apărea fragmentată în mai multe pași mici, sub prag).
//   2. Se calculează diferența (delta) între punctele de întoarcere consecutive.
//   3. Un salt POZITIV peste prag = realimentare.
//   4. Un salt NEGATIV peste prag = scădere suspectă (posibil furt/scurgere).
//   5. Restul scăderilor (sub prag) se adună ca și consum normal.
//
// PRAGUL DE "SCĂDERE PLAUZIBILĂ" (Radu, 2026-09-19 — corectare a modelului
// inițial): NU se mai calculează pe orele CALENDARISTICE dintre două citiri, ci
// pe orele în care utilajul a functionat efectiv (contact/ignition pornit —
// același semnal și aceeași convenție ca la get-utilaj-istoric-parcele: pentru
// fiecare interval între două citiri brute consecutive, dacă starea de contact
// la începutul intervalului era pornită, intervalul contează ca funcționare).
// Motiv: un utilaj parcat 10 ore calendaristice n-a ars nimic în tot intervalul
// ăla — modelul vechi îi "permitea" totuși să piardă până la 150 l (10h × 15
// l/h) fără să fie marcat suspect. Acum: dacă orele de funcționare din interval
// sunt 0 (a stat parcat tot timpul), pragul se reduce la simplul prag minim de
// zgomot (PRAG_MINIM_EVENIMENT_L) — orice scădere peste asta, cât timp a stat
// parcat, e suspectă, indiferent cât timp calendaristic a trecut. Dacă utilajul
// n-are deloc semnal de contact înregistrat în intervalul respectiv (device mai
// vechi, fără ignition raportat), cădem înapoi pe orele calendaristice, ca să
// nu marcăm totul suspect din lipsă de date.
//
// IMPORTANT: raportul are sens doar pentru utilajele CALIBRATE (cu
// `tanc_capacitate_litri` completat în tabela `utilaje`) — pe utilajele
// necalibrate, `nivel_litri` e o valoare brută a senzorului ("kvants"), nu
// litri. Utilajele necalibrate sunt excluse din calculul de sondă, dar apar
// totuși cu totalul alimentărilor MANUALE, dacă există.
//
// COMPARAȚIE MANUAL vs SONDĂ (Radu, 2026-09-16): operatoarea de fermă
// înregistrează manual fiecare alimentare a unui utilaj în `alimentari_utilaje`;
// raportul de aici adaugă, pentru fiecare utilaj, totalul alimentărilor MANUALE
// din aceeași perioadă și diferența față de ce a detectat sonda — ca o
// verificare încrucișată, nu ca sursă de adevăr unică.
//
// CONSUM ZILNIC + RED FLAG (Radu, 2026-09-22): pe lângă evenimentele izolate de
// mai sus, se calculează acum și, per utilaj, un total de consum PE ZI (ziua
// locală România) + orele de funcționare din aceeași zi, cu un steag roșu când
// consumul nu e justificat de orele lucrate — fie utilajul n-a funcționat deloc
// dar nivelul a scăzut peste pragul de zgomot, fie consumul/oră depășește
// pragul plauzibil. E complementar cu „scăderi suspecte" de mai sus, nu un
// duplicat: acolo se prinde un salt BRUSC izolat; aici se prinde și cazul unor
// scăderi mici, distribuite pe parcursul zilei, care per eveniment nu trec
// pragul, dar însumate pe zi depășesc consumul plauzibil pentru orele lucrate.
// Fiecare interval (extreme pentru consum, citiri brute consecutive pentru ore)
// se atribuie zilei locale a ÎNCEPUTULUI intervalului — aceeași simplificare ca
// în get-utilaj-istoric-parcele (un interval care traversează miezul nopții se
// atribuie integral zilei de început, nu împărțit proporțional).
//
// FILTRU DROPOUT SENZOR (Radu, 2026-09-22 — după raportare "arată de speriat,
// verifică dacă e adevărat" pe Steyr 4105/Săbăreni): raportul inițial (v8)
// arăta zeci de evenimente "scădere suspectă"/"realimentare" fictive și zile
// întregi marcate nejustificat, cu rate de consum fizic imposibile (mii de
// l/h). Verificare pe datele brute: senzorul DUT-E are dropout-uri tranzitorii
// în care raportează 0 L timp de câteva citiri consecutive (secunde), apoi
// revine singur la nivelul dinainte — ex. Steyr 4105, 21.09.2026 10:36:15
// (105.1L) -> 10:36:42-10:36:57 (0L x6) -> 10:37:11 (104.1L), în 56 de secunde.
// Un rezervor de 150L+ nu se golește și realimentă singur în sub un minut, deci
// `extrageExtreme()` citea fiecare asemenea puseu ca o pereche reală de
// evenimente. NU e specific acestui utilaj — verificare pe toată flota arată
// același tipar peste tot, cu severitate diferită (ex. John Deere 5403: 97%
// din citirile ultimelor 10 zile sunt exact 0). `eliminaDropoutTranzitoriu`
// elimină aceste rafale ÎNAINTE de extrageExtreme, dar doar atunci când citirea
// de dinainte și cea de după rafală sunt apropiate (revine la fel) și rafala e
// scurtă — dacă rezervorul chiar rămâne gol (nu revine), citirile NU se elimină.
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

// Un motor de utilaj agricol arde, tipic, câțiva litri/oră DE FUNCȚIONARE — nu
// zeci. O scădere mai mare decât ce s-ar putea consuma plauzibil în orele
// EFECTIVE de funcționare dintre două citiri e considerată anomalie. De
// ajustat empiric pe măsură ce apar date reale de consum de la utilajele
// calibrate (deocamdată nu știm consumul lor real, doar că variază cu
// operația efectuată — valoarea de mai jos e o limită voit generoasă).
const MAX_PLAUSIBLE_CONSUM_L_PE_ORA = 15;
// Prag minim absolut (litri) pentru un eveniment (realimentare sau scădere
// suspectă), indiferent de câte ore de funcționare — evită să marcăm zgomot
// mic (sloshing, precizia senzorului) ca eveniment. E și pragul folosit când
// utilajul a stat parcat tot intervalul (0 ore de funcționare).
const PRAG_MINIM_EVENIMENT_L = 15;
// Același prag, reutilizat pentru a marca o diferență manual-vs-sondă drept
// "semnificativă" în UI.
const PRAG_DIFERENTA_SEMNIFICATIVA_L = 15;
// Toleranță peste capacitatea declarată a rezervorului până la care o citire e
// considerată totuși plauzibilă (supra-umplere, dilatare termică, mic offset
// de senzor) — orice peste asta e aproape sigur o valoare brută necalibrată.
const TOLERANTA_CAPACITATE = 1.05;
// Interval maxim între două citiri BRUTE considerat "continuu" pentru calculul
// orelor de funcționare — aceeași convenție ca în get-utilaj-istoric-parcele:
// un gol mai mare înseamnă device offline, nu funcționare/staționare certă.
const MAX_GAP_ORE = 1;
// Sub acest nivel absolut (litri), o citire e suspectă de dropout de senzor —
// vezi comentariul "FILTRU DROPOUT SENZOR" de sus. Nu se elimină automat doar
// pentru că e mică; se elimină doar dacă rafala revine la fel (vezi mai jos).
const PRAG_DROPOUT_SENZOR_L = 5;
// Durata maximă (minute), de la ultima citire plauzibilă dinainte de rafala de
// dropout până la prima citire plauzibilă de după, ca revenirea să fie
// considerată "instant" (deci dropout, nu un gol real urmat de realimentare
// separată, reală).
const MAX_MINUTE_REVENIRE_DROPOUT = 5;
// Cât de aproape trebuie să fie nivelul de dinainte și cel de după rafală ca
// să considerăm că "a revenit la fel" — reutilizăm pragul minim de eveniment.
const TOLERANTA_REVENIRE_DROPOUT_L = PRAG_MINIM_EVENIMENT_L;

interface Citire {
  data_ora: string;
  nivel_litri: number;
  contact: boolean | null;
}

interface CitireIndexata {
  citire: Citire;
  index: number;
}

interface Eveniment {
  data_ora: string;
  delta_litri: number;
}

interface EvenimentSuspect extends Eveniment {
  // Ore de funcționare în intervalul în care s-a produs scăderea. null =
  // n-au existat deloc date de contact în interval, s-a folosit fallback pe
  // ore calendaristice.
  ore_functionare: number | null;
}

interface ZiConsum {
  data: string;
  consum_litri: number;
  ore_functionare: number;
  consum_pe_ora: number | null;
  nejustificat: boolean;
}

interface AlimentareManuala {
  utilaj_id: string;
  cantitate_litri: number;
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

// Elimină rafale scurte de citiri aproape-zero care sunt artefacte de senzor
// (dropout tranzitoriu al sondei DUT-E), nu un rezervor gol real. Semnul
// caracteristic, confirmat pe date reale: mai multe citiri consecutive de
// exact 0 L, la câteva secunde distanță, imediat înainte și după niveluri
// normale foarte apropiate (ex: 105.1L -> 0L x6 -> 104.1L, în 56 de secunde)
// — un rezervor de 150L+ nu se golește și realimentă singur în sub un minut.
// Fără acest filtru, fiecare asemenea puseu e citit de extrageExtreme() ca o
// "scădere suspectă" + "realimentare" fictive, de zeci-sute de litri.
//
// Regulă: o rafală de citiri sub PRAG_DROPOUT_SENZOR_L se elimină COMPLET doar
// dacă citirea plauzibilă păstrată chiar dinainte de rafală și prima citire de
// după rafală sunt apropiate (sub TOLERANTA_REVENIRE_DROPOUT_L) și la mai puțin
// de MAX_MINUTE_REVENIRE_DROPOUT minute distanță. Altfel (nu revine, sau
// revenirea durează prea mult, sau rafala e la începutul/sfârșitul intervalului
// și n-avem cu ce compara) citirile rămân neatinse — nu vrem să ascundem un
// rezervor cu adevărat gol doar pentru că se potrivește parțial tiparul.
function eliminaDropoutTranzitoriu(rows: Citire[]): Citire[] {
  const rezultat: Citire[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.nivel_litri > PRAG_DROPOUT_SENZOR_L) {
      rezultat.push(r);
      i++;
      continue;
    }

    // Am dat peste o citire aproape-zero -- găsim finalul rafalei.
    let j = i;
    while (j < rows.length && rows[j].nivel_litri <= PRAG_DROPOUT_SENZOR_L) j++;

    const inainte = rezultat[rezultat.length - 1] ?? null; // ultima citire plauzibilă păstrată
    const dupa = j < rows.length ? rows[j] : null;

    const minuteRevenire =
      inainte && dupa
        ? (new Date(dupa.data_ora).getTime() - new Date(inainte.data_ora).getTime()) / 60_000
        : Infinity;
    const revineLaFel =
      inainte !== null &&
      dupa !== null &&
      minuteRevenire >= 0 &&
      minuteRevenire <= MAX_MINUTE_REVENIRE_DROPOUT &&
      Math.abs(dupa.nivel_litri - inainte.nivel_litri) <= TOLERANTA_REVENIRE_DROPOUT_L;

    if (!revineLaFel) {
      for (let k = i; k < j; k++) rezultat.push(rows[k]);
    }
    // else: rafala e omisă complet din rezultat -- artefact de senzor.

    i = j;
  }
  return rezultat;
}

// Comprimă o serie de citiri valide în punctele ei de întoarcere (extreme
// locale), păstrând și indexul în `rows` al fiecărei extreme — necesar ca să
// putem re-străbate citirile BRUTE dintre două extreme consecutive, la
// calculul orelor de funcționare.
function extrageExtreme(rows: Citire[]): CitireIndexata[] {
  const extreme: CitireIndexata[] = [];
  let directie = 0; // 0 = necunoscută, 1 = crește, -1 = scade

  rows.forEach((r, index) => {
    if (extreme.length === 0) {
      extreme.push({ citire: r, index });
      return;
    }
    const ultimul = extreme[extreme.length - 1].citire;
    const delta = r.nivel_litri - ultimul.nivel_litri;
    if (delta === 0) return; // fără schimbare, ignorăm

    const nouaDirectie = delta > 0 ? 1 : -1;
    if (directie === 0 || nouaDirectie === directie) {
      extreme[extreme.length - 1] = { citire: r, index };
      directie = nouaDirectie;
    } else {
      extreme.push({ citire: r, index });
      directie = nouaDirectie;
    }
  });

  return extreme;
}

// Ore de funcționare (contact pornit) între două citiri BRUTE, identificate
// prin indexul lor în `rows` — aceeași convenție ca get-utilaj-istoric-parcele:
// pentru fiecare pas, dacă citirea de la începutul pasului avea contact=true,
// pasul contează ca funcționare (plafonat la MAX_GAP_ORE, ca un gol în date să
// nu fie citit greșit drept ore de funcționare sau de staționare).
function oreDeFunctionareIntreIndici(
  rows: Citire[],
  idxStart: number,
  idxStop: number,
): { ore: number; areDateContact: boolean } {
  let ore = 0;
  let areDateContact = false;

  for (let i = idxStart; i < idxStop; i++) {
    const prev = rows[i];
    const curr = rows[i + 1];
    if (prev.contact !== null) areDateContact = true;
    if (prev.contact !== true) continue;

    const deltaOre = (new Date(curr.data_ora).getTime() - new Date(prev.data_ora).getTime()) / 3_600_000;
    if (deltaOre <= 0 || deltaOre > MAX_GAP_ORE) continue;

    ore += deltaOre;
  }

  return { ore, areDateContact };
}

// Ziua locală (România), indiferent de fusul serverului — aceeași funcție ca
// în get-utilaj-istoric-parcele.
function ziuaLocala(dataIso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(dataIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Consum total (litri) + ore de funcționare, per zi locală, pentru un utilaj —
// vezi comentariul de sus ("CONSUM ZILNIC + RED FLAG").
function consumZilnicSiRedFlag(rows: Citire[], extreme: CitireIndexata[]): ZiConsum[] {
  const consumPeZi = new Map<string, number>();
  for (let i = 1; i < extreme.length; i++) {
    const prev = extreme[i - 1].citire;
    const curr = extreme[i].citire;
    const delta = Number(curr.nivel_litri) - Number(prev.nivel_litri);
    if (delta >= 0) continue; // doar scăderile sunt consum
    const zi = ziuaLocala(prev.data_ora);
    consumPeZi.set(zi, (consumPeZi.get(zi) ?? 0) + Math.abs(delta));
  }

  const orePeZi = new Map<string, number>();
  for (let i = 0; i < rows.length - 1; i++) {
    const prev = rows[i];
    const curr = rows[i + 1];
    if (prev.contact !== true) continue;
    const deltaOre = (new Date(curr.data_ora).getTime() - new Date(prev.data_ora).getTime()) / 3_600_000;
    if (deltaOre <= 0 || deltaOre > MAX_GAP_ORE) continue;
    const zi = ziuaLocala(prev.data_ora);
    orePeZi.set(zi, (orePeZi.get(zi) ?? 0) + deltaOre);
  }

  const toateZilele = new Set<string>([...consumPeZi.keys(), ...orePeZi.keys()]);

  return Array.from(toateZilele)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((zi) => {
      const consum = Math.round((consumPeZi.get(zi) ?? 0) * 10) / 10;
      const ore = Math.round((orePeZi.get(zi) ?? 0) * 10) / 10;
      const consumPeOra = ore > 0 ? Math.round((consum / ore) * 10) / 10 : null;
      const nejustificat =
        (ore === 0 && consum > PRAG_MINIM_EVENIMENT_L) ||
        (ore > 0 && consumPeOra !== null && consumPeOra > MAX_PLAUSIBLE_CONSUM_L_PE_ORA);
      return { data: zi, consum_litri: consum, ore_functionare: ore, consum_pe_ora: consumPeOra, nejustificat };
    });
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

  // Alimentările manuale (operatoare de fermă / admin) din aceeași perioadă,
  // pentru toate utilajele deodată -- mai eficient decât un query per utilaj.
  const manualPorUtilaj = new Map<string, { suma: number; nr: number }>();
  const { data: alimentariManuale, error: alimentariManualeError } = await adminClient
    .from('alimentari_utilaje')
    .select('utilaj_id, cantitate_litri')
    .gte('data_ora', de_la);

  if (!alimentariManualeError) {
    for (const a of (alimentariManuale ?? []) as AlimentareManuala[]) {
      const curent = manualPorUtilaj.get(a.utilaj_id) ?? { suma: 0, nr: 0 };
      curent.suma += Number(a.cantitate_litri);
      curent.nr += 1;
      manualPorUtilaj.set(a.utilaj_id, curent);
    }
  }

  const rezultate = [];

  for (const u of calibrate as any[]) {
    const { data: citiri, error: citiriError } = await fetchToateRandurile((from, to) =>
      adminClient
        .from('combustibil_citiri')
        .select('data_ora, nivel_litri, contact')
        .eq('utilaj_id', u.id)
        .not('nivel_litri', 'is', null)
        .gte('data_ora', de_la)
        .order('data_ora', { ascending: true })
        .range(from, to),
    );

    if (citiriError) {
      rezultate.push({
        utilaj_id: u.id,
        nume: u.nume,
        ferma_nume: u.ferme?.nume ?? null,
        eroare: citiriError,
      });
      continue;
    }

    const rows = eliminaDropoutTranzitoriu(filtreazaCitiriPlauzibile(citiri, u.tanc_capacitate_litri as number));
    const extreme = extrageExtreme(rows);

    let consumNormalLitri = 0;
    let realimentatLitri = 0;
    const realimentari: Eveniment[] = [];
    const scaderiSuspecte: EvenimentSuspect[] = [];

    for (let i = 1; i < extreme.length; i++) {
      const prev = extreme[i - 1].citire;
      const curr = extreme[i].citire;
      const delta = Number(curr.nivel_litri) - Number(prev.nivel_litri);

      const oreIntreCitiriCalendar =
        (new Date(curr.data_ora).getTime() - new Date(prev.data_ora).getTime()) / 3_600_000;

      const { ore: oreFunctionare, areDateContact } = oreDeFunctionareIntreIndici(
        rows,
        extreme[i - 1].index,
        extreme[i].index,
      );

      // Cu date de contact disponibile, folosim orele REALE de funcționare --
      // fără ele, cădem înapoi pe orele calendaristice (comportamentul vechi),
      // ca să nu marcăm totul suspect din lipsă de semnal de ignition.
      const oreDeFolosit = areDateContact ? oreFunctionare : oreIntreCitiriCalendar;

      const pragScaderePlauzibila = Math.max(
        PRAG_MINIM_EVENIMENT_L,
        MAX_PLAUSIBLE_CONSUM_L_PE_ORA * Math.max(oreDeFolosit, 0),
      );

      if (delta >= PRAG_MINIM_EVENIMENT_L) {
        realimentatLitri += delta;
        realimentari.push({ data_ora: curr.data_ora, delta_litri: Math.round(delta * 10) / 10 });
      } else if (delta < 0 && Math.abs(delta) > pragScaderePlauzibila) {
        scaderiSuspecte.push({
          data_ora: curr.data_ora,
          delta_litri: Math.round(delta * 10) / 10,
          ore_functionare: areDateContact ? Math.round(oreFunctionare * 10) / 10 : null,
        });
      } else if (delta < 0) {
        consumNormalLitri += Math.abs(delta);
      }
    }

    const consumZilnic = consumZilnicSiRedFlag(rows, extreme);
    const zileNejustificate = consumZilnic.filter((z) => z.nejustificat).length;

    const manual = manualPorUtilaj.get(u.id) ?? { suma: 0, nr: 0 };
    const diferentaLitri = Math.round((realimentatLitri - manual.suma) * 10) / 10;

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
      consum_zilnic: consumZilnic,
      zile_nejustificate: zileNejustificate,
      manual_litri: Math.round(manual.suma * 10) / 10,
      manual_nr: manual.nr,
      diferenta_litri: diferentaLitri,
      diferenta_semnificativa: Math.abs(diferentaLitri) > PRAG_DIFERENTA_SEMNIFICATIVA_L,
    });
  }

  return jsonResponse({
    zile,
    de_la,
    rezultate,
    necalibrate: (necalibrate as any[]).map((u) => {
      const manual = manualPorUtilaj.get(u.id) ?? { suma: 0, nr: 0 };
      return {
        utilaj_id: u.id,
        nume: u.nume,
        ferma_nume: u.ferme?.nume ?? null,
        manual_litri: Math.round(manual.suma * 10) / 10,
        manual_nr: manual.nr,
      };
    }),
  });
});
