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
//   4. Un salt NEGATIV peste prag = scădere mare (informativ — vezi v12 mai jos).
//   5. Restul scăderilor (sub prag) se adună ca și consum normal.
//
// ORELE DE FUNCȚIONARE — CONTACT + MIȘCARE GPS (Radu, 2026-09-22, v11): vezi
// `intervalInFunctionare` mai jos — un pas contează ca funcționare dacă
// contact=true SAU utilajul s-a deplasat efectiv ≥PRAG_MISCARE_METRI, pentru
// că semnalul de contact singur s-a dovedit nesigur pe acest lanț de
// telemetrie (raportează des "oprit" chiar în timp ce utilajul se mișcă
// vizibil pe GPS) — vezi comentariul detaliat păstrat mai jos, la funcție.
//
// v12, 2026-09-22 (Radu) — ELIMINARE STEAGURI ROȘII, CONSUM MEDIU PONDERAT:
// după v11, mai rămâneau zile flagged "peste consumul plauzibil" (20-26 L/h)
// pe un prag fix (MAX_PLAUSIBLE_CONSUM_L_PE_ORA = 15 L/h) ales fără date
// reale. Verificare cu traseul GPS (aceleași citiri sincronizate din
// Traccar): utilajul chiar lucra extensiv în zilele flagged (40-55 km/zi,
// sute de poziții distincte) — nu era un artefact, doar un prag prea
// conservator pentru un utilaj de talia asta sub sarcină grea. Radu: "nu
// stiu cum trebuie facut" — deci, până avem date reale suficiente, NU mai
// aplicăm niciun prag de plauzibilitate: raportul arată consumul calculat
// (fără steag roșu), plus un nou consum MEDIU PONDERAT pe oră per utilaj
// (`consum_mediu_ponderat_l_pe_ora` = suma consumului pe zilele cu ore de
// funcționare > 0, împărțită la suma orelor acelorași zile — o zi cu 0 ore de
// funcționare nu participă deloc la calcul, ca să nu împartă la zero sau să
// distorsioneze media). Perioadă de TESTE până pe 30 septembrie 2026 — se
// adună date reale de consum per utilaj, apoi se decide (posibil per-utilaj)
// un prag de plauzibilitate calibrat pe media reală, nu pe o presupunere.
// `MAX_PLAUSIBLE_CONSUM_L_PE_ORA` rămâne definit doar ca referință istorică
// în cod, dar nu mai e folosit nicăieri în calcul.
//
// v13, 2026-09-23 (Radu a semnalat: Belarus 1523.3, 19 sept, "0.3h / 69.5L /
// 231.7 L/h" -- cifră absurdă) -- BUG DE ATRIBUIRE PE ZI, nu problemă de
// senzor: un interval extremă-la-extremă poate acoperi mai multe zile (gol
// de date, senzor "înțepenit" ore în șir etc.); `consumZilnic` punea TOT
// consumul intervalului pe ziua lui de ÎNCEPUT, în timp ce orele de
// funcționare erau (corect) distribuite zi cu zi din citirile brute -- de aici
// un raport L/h absurd pe ziua de start, chiar dacă media ponderată pe toată
// perioada rămânea corectă (aceleași litri, aceleași ore, doar pe zile
// greșite). Fix: `consumZilnic` distribuie acum scăderea fiecărui interval
// PROPORȚIONAL cu orele de funcționare ale fiecărei zile ÎN ACEL interval
// (vezi `oreDeFunctionarePeZiIntreIndici`) -- o zi fără nicio oră de
// funcționare în interval nu mai primește nimic din consum. Verificat pe
// cazul semnalat: 19 septembrie scade de la 69.5L/231.7 L/h la ~3L/~12 L/h,
// iar cea mai mare parte a celor 69.5L se mută pe 21-22 septembrie, unde
// utilajul chiar a funcționat ore în șir.
//
// Cu ocazia asta: `ziuaLocala` recrea `Intl.DateTimeFormat` la FIECARE apel
// (construcție scumpă), deși se cheamă de mii de ori per cerere pe toată
// flota -- suspectat drept contribuitor principal la erorile intermitente
// "Eroare la încărcarea raportului" (CPU Time exceeded în logurile funcției,
// ~2043ms folosiți dintr-un buget ~2000ms). Scos formatter-ul o singură dată
// la nivel de modul -- comportament identic, mult mai ieftin de rulat.
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
// verificare încrucișată, nu ca sursă de adevăr unică. NU e afectată de v12 —
// rămâne singurul steag activ în raport, pentru că nu depinde de pragul de
// plauzibilitate în discuție.
//
// FILTRU ZGOMOT SENZOR pe nivel_litri (Radu, 2026-09-22, v9+v10): vezi
// comentariile de la `eliminaFluctuatiiTranzitorii` și `extrageExtreme` mai
// jos — două tipare de zgomot pe citirile de combustibil (excursii mari care
// revin la loc, și zgomot fin continuu care nu revine), ambele corectate
// separat de problema orelor de funcționare de mai sus.
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

// v12: NU mai e folosit în niciun calcul — păstrat doar ca referință istorică
// (a fost pragul de "consum plauzibil" care genera steagurile roșii eliminate
// la v12). Vezi comentariul v12 de sus.
const MAX_PLAUSIBLE_CONSUM_L_PE_ORA = 15;
// Prag minim absolut (litri) pentru un eveniment (realimentare sau scădere
// mare), indiferent de câte ore de funcționare — evită să marcăm zgomot mic
// (sloshing, precizia senzorului) ca eveniment. Reutilizat și ca prag de
// "salt suspect" + toleranță de "revenire" în `eliminaFluctuatiiTranzitorii`
// (vezi comentariul de acolo).
const PRAG_MINIM_EVENIMENT_L = 15;
// Același prag, reutilizat pentru a marca o diferență manual-vs-sondă drept
// "semnificativă" în UI — singurul steag rămas activ, vezi nota v12 de sus.
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
// comentariul de la `extrageExtreme`.
const PRAG_ZGOMOT_L = 5;
// Fereastra de timp (minute) în care o excursie (salt peste
// PRAG_MINIM_EVENIMENT_L) trebuie să revină aproape de nivelul dinainte ca să
// fie considerată zgomot tranzitoriu, nu un eveniment real. Vezi comentariul
// de la `eliminaFluctuatiiTranzitorii`.
const FEREASTRA_REVENIRE_MINUTE = 15;
// Distanța minimă (metri) între două citiri GPS consecutive ca să conteze
// drept mișcare reală (nu deriva normală a unui GPS staționar, care poate fi
// de câțiva metri). Vezi comentariul "ORELE DE FUNCȚIONARE" de sus.
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

interface EvenimentScadereMare extends Eveniment {
  // Ore de funcționare în intervalul în care s-a produs scăderea — informativ,
  // nu mai alimentează niciun steag (vezi v12 de sus). null = n-au existat
  // deloc date de contact SAU de poziție în interval, s-a folosit fallback pe
  // ore calendaristice.
  ore_functionare: number | null;
}

// v12: fără `nejustificat` — vezi nota v12 de sus. Zilele cu 0 ore de
// funcționare rămân cu `consum_pe_ora: null` (nu împărțim la zero) și nu
// participă la consumul mediu ponderat.
interface ZiConsum {
  data: string;
  consum_litri: number;
  ore_functionare: number;
  consum_pe_ora: number | null;
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
// singur la loc în câteva minute.
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
// zgomotoase). Fără histerezis, o oscilație continuă de 1-8L (des întâlnită
// chiar cu utilajul staționat) genera câte o extremă nouă la fiecare
// inversare, iar suma scăderilor individuale (fiecare sub pragul de
// eveniment, deci nemarcată "suspectă", dar tot adunată ca și consum) umfla
// artificial consumul zilnic raportat.
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

// Distanța aproximativă (metri) între două puncte GPS apropiate -- proiecție
// plană simplă (echirectangulară), suficient de precisă pe distanțe mici (sub
// câțiva km, cazul de aici) și mult mai ieftină decât haversine complet.
function distantaMetri(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const latRad = (lat1 * Math.PI) / 180;
  const dLat = (lat2 - lat1) * 111_320;
  const dLon = (lon2 - lon1) * 111_320 * Math.cos(latRad);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

// Un pas între două citiri brute consecutive contează ca funcționare dacă
// ORICARE dintre semnale o confirmă: contact=true SAU utilajul s-a deplasat
// cel puțin PRAG_MISCARE_METRI. Vezi comentariul "ORELE DE FUNCȚIONARE" de
// sus -- semnalul de contact singur s-a dovedit nesigur pe acest lanț de
// telemetrie (raportează des "oprit" chiar în timp ce utilajul se mișcă
// vizibil pe GPS).
function intervalInFunctionare(prev: Citire, curr: Citire): boolean {
  if (prev.contact === true) return true;
  if (prev.latitudine == null || prev.longitudine == null || curr.latitudine == null || curr.longitudine == null) {
    return false;
  }
  return distantaMetri(prev.latitudine, prev.longitudine, curr.latitudine, curr.longitudine) >= PRAG_MISCARE_METRI;
}

// Ore de funcționare între două citiri BRUTE, identificate prin indexul lor
// în `rows` -- vezi `intervalInFunctionare` pentru criteriul folosit (contact
// SAU mișcare GPS).
function oreDeFunctionareIntreIndici(
  rows: Citire[],
  idxStart: number,
  idxStop: number,
): { ore: number; areDateOperare: boolean } {
  let ore = 0;
  let areDateOperare = false;

  for (let i = idxStart; i < idxStop; i++) {
    const prev = rows[i];
    const curr = rows[i + 1];
    if (prev.contact !== null || (prev.latitudine != null && prev.longitudine != null)) areDateOperare = true;
    if (!intervalInFunctionare(prev, curr)) continue;

    const deltaOre = (new Date(curr.data_ora).getTime() - new Date(prev.data_ora).getTime()) / 3_600_000;
    if (deltaOre <= 0 || deltaOre > MAX_GAP_ORE) continue;

    ore += deltaOre;
  }

  return { ore, areDateOperare };
}

// Ca `oreDeFunctionareIntreIndici`, dar întoarce orele defalcate PE ZI LOCALĂ
// în loc de un singur total -- folosit în `consumZilnic` (v13) ca să
// distribuim proporțional consumul unui interval extremă-la-extremă pe zilele
// pe care le acoperă efectiv, în loc să-l punem tot pe ziua lui de start.
// Vezi nota v13 de sus.
function oreDeFunctionarePeZiIntreIndici(rows: Citire[], idxStart: number, idxStop: number): Map<string, number> {
  const oreInterval = new Map<string, number>();
  for (let i = idxStart; i < idxStop; i++) {
    const prev = rows[i];
    const curr = rows[i + 1];
    if (!intervalInFunctionare(prev, curr)) continue;
    const deltaOre = (new Date(curr.data_ora).getTime() - new Date(prev.data_ora).getTime()) / 3_600_000;
    if (deltaOre <= 0 || deltaOre > MAX_GAP_ORE) continue;
    const zi = ziuaLocala(prev.data_ora);
    oreInterval.set(zi, (oreInterval.get(zi) ?? 0) + deltaOre);
  }
  return oreInterval;
}

// Ziua locală (România), indiferent de fusul serverului — aceeași funcție ca
// în get-utilaj-istoric-parcele.
//
// v13: formatter-ul e construit O SINGURĂ DATĂ la nivel de modul (nu la
// fiecare apel) -- vezi nota v13 de sus.
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

// Consum total (litri) + ore de funcționare, per zi locală, pentru un utilaj —
// v12: fără steag roșu, vezi nota v12 de sus.
function consumZilnic(rows: Citire[], extreme: CitireIndexata[]): ZiConsum[] {
  // v13: vezi nota de sus -- distribuim scăderea fiecărui interval
  // extremă-la-extremă PROPORȚIONAL cu orele de funcționare ale fiecărei zile
  // ÎN ACEL interval, nu integral pe ziua lui de start. Fallback la
  // comportamentul vechi (atribuire integrală pe ziua de start) doar dacă
  // intervalul n-are deloc date de operare (nici contact, nici poziție).
  const consumPeZi = new Map<string, number>();
  for (let i = 1; i < extreme.length; i++) {
    const prev = extreme[i - 1].citire;
    const curr = extreme[i].citire;
    const delta = Number(curr.nivel_litri) - Number(prev.nivel_litri);
    if (delta >= 0) continue; // doar scăderile sunt consum
    const consumAbsolut = Math.abs(delta);

    const oreInterval = oreDeFunctionarePeZiIntreIndici(rows, extreme[i - 1].index, extreme[i].index);
    const totalOreInterval = Array.from(oreInterval.values()).reduce((a, b) => a + b, 0);

    if (totalOreInterval > 0) {
      for (const [zi, ore] of oreInterval) {
        consumPeZi.set(zi, (consumPeZi.get(zi) ?? 0) + (consumAbsolut * ore) / totalOreInterval);
      }
    } else {
      const zi = ziuaLocala(prev.data_ora);
      consumPeZi.set(zi, (consumPeZi.get(zi) ?? 0) + consumAbsolut);
    }
  }

  const orePeZi = new Map<string, number>();
  for (let i = 0; i < rows.length - 1; i++) {
    const prev = rows[i];
    const curr = rows[i + 1];
    if (!intervalInFunctionare(prev, curr)) continue;
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
      // v12: zi cu 0 ore de funcționare -> nu calculăm nimic (rămâne null),
      // nici steag -- vezi cererea lui Radu ("la cele cu zero inca nu
      // calcula nimic").
      const consumPeOra = ore > 0 ? Math.round((consum / ore) * 10) / 10 : null;
      return { data: zi, consum_litri: consum, ore_functionare: ore, consum_pe_ora: consumPeOra };
    });
}

// v12: consum mediu PONDERAT pe oră, per utilaj, pe toată perioada cerută —
// suma consumului pe zilele cu ore de funcționare > 0, împărțită la suma
// acelorași ore. O zi cu 0 ore nu participă deloc (nici la numărător, nici la
// numitor) -- altfel am împărți la zero sau am distorsiona media cu zile fără
// funcționare. null dacă utilajul n-a funcționat deloc în toată perioada.
function consumMediuPonderat(zile: ZiConsum[]): number | null {
  let sumaConsum = 0;
  let sumaOre = 0;
  for (const z of zile) {
    if (z.ore_functionare > 0) {
      sumaConsum += z.consum_litri;
      sumaOre += z.ore_functionare;
    }
  }
  if (sumaOre === 0) return null;
  return Math.round((sumaConsum / sumaOre) * 10) / 10;
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
        .select('data_ora, nivel_litri, contact, latitudine, longitudine')
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
    const scaderiMari: EvenimentScadereMare[] = [];

    for (let i = 1; i < extreme.length; i++) {
      const prev = extreme[i - 1].citire;
      const curr = extreme[i].citire;
      const delta = Number(curr.nivel_litri) - Number(prev.nivel_litri);

      // v12: ore_functionare rămâne calculat DOAR ca informație afișată lângă
      // eveniment -- nu mai alimentează niciun prag (vezi nota v12 de sus).
      const { ore: oreFunctionare, areDateOperare } = oreDeFunctionareIntreIndici(
        rows,
        extreme[i - 1].index,
        extreme[i].index,
      );

      if (delta >= PRAG_MINIM_EVENIMENT_L) {
        realimentatLitri += delta;
        realimentari.push({ data_ora: curr.data_ora, delta_litri: Math.round(delta * 10) / 10 });
      } else if (delta < 0 && Math.abs(delta) > PRAG_MINIM_EVENIMENT_L) {
        // v12: prag FIX (nu mai depinde de MAX_PLAUSIBLE_CONSUM_L_PE_ORA) --
        // orice scădere de peste 15L e listată aici, informativ, indiferent
        // de câte ore a funcționat utilajul în interval.
        scaderiMari.push({
          data_ora: curr.data_ora,
          delta_litri: Math.round(delta * 10) / 10,
          ore_functionare: areDateOperare ? Math.round(oreFunctionare * 10) / 10 : null,
        });
      } else if (delta < 0) {
        consumNormalLitri += Math.abs(delta);
      }
    }

    const zileConsum = consumZilnic(rows, extreme);

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
      scaderi_mari: scaderiMari,
      consum_zilnic: zileConsum,
      consum_mediu_ponderat_l_pe_ora: consumMediuPonderat(zileConsum),
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
