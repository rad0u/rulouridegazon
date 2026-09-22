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
//   0b. Se elimină excursiile tranzitorii — salturi (de orice mărime) care revin
//       singure aproape de nivelul dinainte în câteva minute — artefact de senzor,
//       nu un eveniment real. Vezi comentariul de la `eliminaFluctuatiiTranzitorii`.
//   1. Citirile valide rămase se comprimă în puncte de întoarcere (extreme locale,
//      cu histerezis — un mic prag de zgomot sub care o oscilație nu e considerată
//      o schimbare de direcție reală). Vezi comentariul de la `extrageExtreme`.
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
// consumul nu e justificat de orele lucrate. Fiecare interval se atribuie zilei
// locale a ÎNCEPUTULUI intervalului — aceeași simplificare ca în
// get-utilaj-istoric-parcele.
//
// FILTRU ZGOMOT SENZOR, v2 — GENERALIZAT (Radu, 2026-09-22, după verificare pe
// Steyr 4105/Săbăreni): prima variantă a filtrului (v9) elimina doar rafale de
// citiri APROAPE-ZERO care revin la loc — bazat pe un caz real (dropout la 0L
// timp de 15 secunde, apoi revenire). Radu a arătat însă, cu Traccar Replay,
// că utilajul chiar lucra masiv în perioadele marcate suspecte — deci volumul
// mare de citiri NU e semnul problemei. Investigând mai departe (21.09.2026),
// am găsit DOUĂ tipare diferite de zgomot, nu unul:
//
//   (a) Excursii de amplitudine mare, nu doar spre 0 — pe 15-16.09.2026,
//       senzorul a produs citiri haotice pe o plajă largă (0, 53.7, 107.4,
//       121.3, 137.8L, dar și valori peste capacitate care erau deja
//       eliminate de filtrul de la pasul 0) timp de peste 2 ore, fiecare
//       revenind rapid (secunde-minute) la nivelul dinainte. Filtrul v9,
//       limitat la <=5L, nu prindea aceste excursii mai mari (ex. 121.3L),
//       care contaminau ancora folosită pentru verificarea rafalelor de 0
//       învecinate. Fix: `eliminaFluctuatiiTranzitorii` (v10) generalizează
//       verificarea "revine la loc" la ORICE salt peste pragul minim de
//       eveniment, nu doar la valorile aproape-zero.
//
//   (b) Zgomot fin, continuu (1-8L), care NU revine niciodată complet — o
//       oscilație lentă în jurul unei valori, chiar și cu utilajul staționat
//       (contact=false), vizibilă pe 17.09.2026 ora 07:25-07:45. Fiecare pas
//       individual e sub pragul de eveniment (15L), deci `extrageExtreme()`
//       (v9) îl trata ca o schimbare reală de direcție de fiecare dată când
//       oscila — iar `consumZilnicSiRedFlag` aduna FIECARE scădere, oricât de
//       mică, fără să scadă urcările simetrice. Pe o zi întreagă cu mii de
//       citiri, zecile-sutele de asemenea oscilații mici se adună fals la sute
//       de litri "consumați" (exact tiparul din raport: 292.6L in 1.3h ore
//       reale de funcționare). Fix: `extrageExtreme` (v10) folosește acum
//       histerezis — un punct de întoarcere nou se confirmă doar când seria
//       inversează cu cel puțin PRAG_ZGOMOT_L față de candidatul curent, nu la
//       orice schimbare nenulă (algoritm clasic "zigzag", folosit pentru
//       detecția de extreme pe semnale zgomotoase).
//
// Cele două fixuri sunt complementare: (a) elimină salturile mari care revin
// (rafale/excursii izolate), (b) elimină zgomotul mic continuu care nu revine
// niciodată dar nici nu reprezintă o tendință reală. Verificat după deploy pe
// exact cazurile raportate de Radu (evenimentele din 15.09.2026 17:23-17:46 și
// ziua de 17.09.2026).
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
// utilajul a stat parcat tot intervalul (0 ore de funcționare). Reutilizat și
// ca prag de "salt suspect" + toleranță de "revenire" în
// `eliminaFluctuatiiTranzitorii` (vezi comentariul de acolo).
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
// Prag de zgomot (litri) pentru histerezis în `extrageExtreme` — o oscilație
// mai mică decât asta NU e considerată o schimbare reală de direcție. Vezi
// comentariul "FILTRU ZGOMOT SENZOR, v2" de sus, cazul (b).
const PRAG_ZGOMOT_L = 5;
// Fereastra de timp (minute) în care o excursie (salt peste
// PRAG_MINIM_EVENIMENT_L) trebuie să revină aproape de nivelul dinainte ca să
// fie considerată zgomot tranzitoriu, nu un eveniment real. Vezi comentariul
// "FILTRU ZGOMOT SENZOR, v2" de sus, cazul (a). Lărgit față de v9 (5 minute)
// la 15, pe baza unui caz real cu un gol de aproape 9 minute între citiri
// plauzibile în timpul unei rafale de zgomot.
const FEREASTRA_REVENIRE_MINUTE = 15;

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

// Elimină excursii tranzitorii: un salt (de ORICE mărime, nu doar spre 0) care
// revine aproape de nivelul dinainte în câteva minute e aproape sigur zgomot
// de senzor, nu un eveniment real — un rezervor nu se golește/umple și revine
// singur la loc în câteva minute. Vezi comentariul "FILTRU ZGOMOT SENZOR, v2",
// cazul (a), pentru exemplul real care a impus generalizarea față de v9
// (limitat la citiri <=5L).
//
// Regulă: pornind de la ultima citire păstrată ("ancora"), dacă o citire nouă
// diferă cu cel puțin PRAG_MINIM_EVENIMENT_L, căutăm în următoarele
// FEREASTRA_REVENIRE_MINUTE minute o citire care revine la mai puțin de
// PRAG_MINIM_EVENIMENT_L față de ancoră. Dacă găsim una, TOATE citirile dintre
// ele sunt zgomot și se elimină complet. Dacă nu găsim nicio revenire în
// fereastră, saltul e considerat real (posibilă realimentare sau scădere
// reală) și devine noua ancoră — nu vrem să ascundem un eveniment real doar
// pentru că nu a revenit la timp.
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

    // Salt suspect fața de ancoră -- căutăm o revenire în fereastra de timp.
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
      // Tot ce e între i și gasitRevenire (exclusiv) e zgomot -- sărim direct
      // la punctul de revenire, care va fi acceptat ca simplă continuare a
      // ancorei la următoarea iterație (diferența față de ancoră e mică).
      i = gasitRevenire;
      continue;
    }

    // Nicio revenire în fereastră -- salt real, devine noua ancoră.
    rezultat.push(r);
    i++;
  }
  return rezultat;
}

// Comprimă o serie de citiri valide în punctele ei de întoarcere (extreme
// locale), folosind HISTEREZIS: un nou punct de întoarcere se confirmă doar
// când seria inversează cu cel puțin PRAG_ZGOMOT_L față de candidatul curent
// (algoritmul clasic "zigzag" pentru detecția extremelor pe semnale
// zgomotoase). Vezi comentariul "FILTRU ZGOMOT SENZOR, v2", cazul (b): fără
// histerezis, o oscilație continuă de 1-8L (des întâlnită chiar cu utilajul
// staționat) genera câte o extremă nouă la fiecare inversare, iar suma
// scăderilor individuale (fiecare sub pragul de eveniment, deci nemarcată
// "suspectă", dar tot adunată ca și consum) umfla artificial consumul zilnic
// raportat.
//
// Păstrează și indexul în `rows` al fiecărei extreme -- necesar ca să putem
// re-străbate citirile BRUTE dintre două extreme consecutive, la calculul
// orelor de funcționare.
function extrageExtreme(rows: Citire[]): CitireIndexata[] {
  if (rows.length === 0) return [];

  const extreme: CitireIndexata[] = [{ citire: rows[0], index: 0 }];
  let directie = 0; // 0 = nedeterminată, 1 = căutăm un maxim, -1 = căutăm un minim
  let candidat: CitireIndexata = { citire: rows[0], index: 0 };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];

    if (directie === 0) {
      const delta = r.nivel_litri - extreme[0].citire.nivel_litri;
      if (Math.abs(delta) < PRAG_ZGOMOT_L) continue; // încă în zgomot, direcția nu e clară
      directie = delta > 0 ? 1 : -1;
      candidat = { citire: r, index: i };
      continue;
    }

    if (directie === 1) {
      // Căutăm un maxim -- extindem candidatul cât timp urcă.
      if (r.nivel_litri >= candidat.citire.nivel_litri) {
        candidat = { citire: r, index: i };
      } else if (candidat.citire.nivel_litri - r.nivel_litri >= PRAG_ZGOMOT_L) {
        // A scăzut destul față de candidat -- confirmăm candidatul ca maxim.
        extreme.push(candidat);
        directie = -1;
        candidat = { citire: r, index: i };
      }
    } else {
      // directie === -1, căutăm un minim -- extindem candidatul cât timp scade.
      if (r.nivel_litri <= candidat.citire.nivel_litri) {
        candidat = { citire: r, index: i };
      } else if (r.nivel_litri - candidat.citire.nivel_litri >= PRAG_ZGOMOT_L) {
        extreme.push(candidat);
        directie = 1;
        candidat = { citire: r, index: i };
      }
    }
  }

  // Ultimul candidat (coada seriei) se adaugă și el, chiar dacă nu s-a mai
  // confirmat printr-o inversare -- altfel am pierde ultimul segment.
  if (candidat.index !== extreme[extreme.length - 1].index) {
    extreme.push(candidat);
  }

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

    const rows = eliminaFluctuatiiTranzitorii(filtreazaCitiriPlauzibile(citiri, u.tanc_capacitate_litri as number));
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
