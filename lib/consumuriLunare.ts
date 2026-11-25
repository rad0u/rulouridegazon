// lib/consumuriLunare.ts
//
// 2026-11-17 (Radu): „Rapoarte – Consumuri lunare. Aleg Ferma, luna, și obțin
// un raport cu ce s-a utilizat pe fiecare parcelă a fermei respective:
// motorină, materii prime și fertilizatori — absolut tot. Raportul să fie
// printabil sau export în Excel."
//
// Surse (toate existente, aceleași cifre ca restul aplicației):
//  - Motorină pe parcelă: edge function `get-combustibil-parcele` (bilanț de
//    masă pe fiecare sesiune GPS, citiri filtrate). Sesiunile CONFIRMATE intră
//    în totaluri; cele detectate dar NECONFIRMATE se arată separat, orientativ
//    (pot încă să se schimbe până la confirmare în Activități parcele).
//  - Motorină în afara parcelelor: `lucrari_in_afara_fermei` (litri salvați la
//    confirmare).
//  - Fertilizanți / tratamente: `operatiuni_substante` × `substante`.
//  - Materii prime (semințe etc.): `operatiuni_materii_prime` × `materii_prime`.
//  - Ore de lucru + mp recoltați: `operatiuni` (ore = durata sesiunii GPS; la
//    operațiunile manuale, `ore_lucru`).
// Valori în lei: substanțe / materii prime la prețul unitar din gestiunea
// fermei (media ponderată curentă a intrărilor); motorina la prețul mediu
// ponderat al motorinei cumpărate de fermă (rezervor_alimentari) până la
// sfârșitul lunii — aceeași regulă ca raportul „Cost de producție".

import { supabase, supabaseUrl } from './supabaseClient';
import { LABEL_OPERATIUNE, type TipOperatiune } from './operatiuniTypes';

export type LinieMotorina = {
  utilaj: string;
  ore: number;
  litri: number | null;
  sesiuni: number;
  // 2026-11-23 (Radu): utilaj fără date de la sondă → litri APROXIMAȚI = ore × consumul
  // mediu pe oră al utilajelor de același model (ex. celelalte JCB-uri) din aceeași lună.
  estimat?: { lph: number; referinta: string };
};
// 2026-11-25 (Radu, cost de producție pentru contabilitate): `cod` = codul SmartBill al
// articolului din nomenclator; `pretAproximat` = cel puțin un consum fără preț fixat la
// înregistrare (consumuri dinainte de 25.11.2026) → evaluat la CMP-ul curent al gestiunii.
export type LinieMaterial = { nume: string; um: string; cantitate: number; valoare: number | null; cod?: string | null; pretAproximat?: boolean };

export type CicluParcela = { id: string; dataStart: string; stare: string; complet: boolean; tipGazon: string | null };
export type CostDirectManual = { data: string; categorie: string; descriere: string; cantitate: number | null; um: string | null; suma: number; document: string | null };

export type ParcelaConsum = {
  id: string;
  nume: string;
  suprafataMp: number | null;
  cultura: string | null;
  // 2026-11-25: ciclul de producție (obiectul de cost) activ la sfârșitul lunii.
  ciclu: CicluParcela | null;
  oreLucru: number;
  orePeTip: { tip: string; ore: number }[];
  mpRecoltat: number;
  // 2026-11-25: mp recoltați pe tip gazon (operatiuni_recoltare_tipuri); restul până la
  // mpRecoltat = recoltări vechi fără tip.
  recoltatPeTip: { tip: string; mp: number }[];
  // 2026-11-25: masa verde rămasă din ultimul inventar ≤ sfârșitul lunii (producție în curs).
  masaVerdeMp: number | null;
  masaVerdeData: string | null;
  directeManuale: CostDirectManual[];
  valoareDirecteManuale: number;
  motorina: LinieMotorina[]; // confirmat
  motorinaNeconfirmata: LinieMotorina[];
  substante: LinieMaterial[];
  materiiPrime: LinieMaterial[];
  litri: number; // confirmat
  valoareMotorina: number | null;
  valoareSubstante: number;
  valoareMateriiPrime: number;
  valoareTotala: number;
  areConsum: boolean;
};

export type LucrareInAfara = { data: string; utilaj: string; tip: string; ore: number | null; litri: number | null; locatie: string | null };

export type RaportConsumuri = {
  fermaId: string;
  fermaNume: string;
  luna: string; // AAAA-LL
  lunaText: string; // „octombrie 2026"
  deLa: string;
  panaLa: string;
  generatLa: string;
  pretMotorina: number | null; // lei / L — prețul folosit în calcule
  // 2026-11-23 (Radu): unde nu există achiziții cu preț, prețul se poate introduce manual.
  pretMotorinaAchizitii: number | null; // preț mediu ponderat din rezervor_alimentari
  pretMotorinaManual: boolean;
  // 2026-11-25: completat doar la un raport încărcat dintr-o lună închisă (înghețată).
  inchis?: { la: string; de: string | null } | null;
  parcele: ParcelaConsum[];
  inAfara: LucrareInAfara[];
  totaluri: {
    oreLucru: number;
    litri: number;
    litriNeconfirmati: number;
    litriInAfara: number;
    valoareMotorina: number | null;
    valoareSubstante: number;
    valoareMateriiPrime: number;
    valoareDirecteManuale: number;
    valoareTotala: number;
    mpRecoltat: number;
    recoltatPeTip: { tip: string; mp: number }[];
    masaVerdeMp: number;
    substante: LinieMaterial[];
    materiiPrime: LinieMaterial[];
  };
  avertismente: string[];
};

const MESAJ_FARA_PRET = 'Nu există achiziții de motorină cu preț pentru fermă — motorina apare doar în litri. Poți introduce prețul manual (lei/L) deasupra raportului.';

const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

export function textLuna(luna: string) {
  const [an, l] = luna.split('-').map(Number);
  return `${LUNI[l - 1]} ${an}`;
}

function limiteLuna(luna: string) {
  const [an, l] = luna.split('-').map(Number);
  const ultimaZi = new Date(Date.UTC(an, l, 0)).getUTCDate();
  return { deLa: `${luna}-01`, panaLa: `${luna}-${String(ultimaZi).padStart(2, '0')}` };
}

// Instantul UTC al miezului nopții (Europe/Bucharest) de după `panaLa`.
function sfarsitLunaUTC(panaLa: string): string {
  const d = new Date(`${panaLa}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const zi = d.toISOString().slice(0, 10);
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Bucharest', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${zi}T12:00:00Z`))
    .find((p) => p.type === 'timeZoneName')?.value;
  const ore = Number(tz?.match(/GMT([+-]\d+)/)?.[1] ?? 2);
  return new Date(new Date(`${zi}T00:00:00Z`).getTime() - ore * 3_600_000).toISOString();
}

export const comparaNume = (a: string, b: string) => a.localeCompare(b, 'ro', { numeric: true, sensitivity: 'base' });

type Rezultat<T> = { data: T[] | null; error: { message: string } | null };
async function toatePaginile<T>(build: (from: number, to: number) => PromiseLike<Rezultat<T>>): Promise<T[]> {
  const toate: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build(offset, offset + 999);
    if (error) throw new Error(error.message);
    toate.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return toate;
}

type RandOp = {
  id: string;
  parcela_id: string;
  tip: string;
  data: string;
  ore_lucru: number | null;
  cantitate_mp_recoltat: number | null;
  sesiune_inceput: string | null;
  sesiune_sfarsit: string | null;
};
type RandMaterial = {
  cantitate: number;
  pret_unitar_consum: number | null;
  articol: {
    nume: string;
    unitate_masura: string;
    pret_unitar: number | null;
    nomenclator: { cod_smartbill: string | null } | null;
  } | null;
  operatiuni: { parcela_id: string } | null;
};
type RandRecoltareTip = { tip_gazon: string; mp: number; operatiuni: { parcela_id: string } | null };
type RandCiclu = { id: string; parcela_id: string; data_start: string; data_sfarsit: string | null; stare: string; complet: boolean; tip_gazon: string | null };
type RandDirectManual = {
  parcela_id: string;
  data: string;
  categorie: string;
  descriere: string;
  cantitate: number | null;
  unitate_masura: string | null;
  suma_fara_tva: number;
  document: string | null;
};
type RandInventarMV = {
  data_inventar: string;
  inventar_masa_verde_parcele: { parcela_id: string | null; suprafata_masa_verde_mp: number; tip: string | null }[];
};

export const ETICHETA_CATEGORIE_DIRECTA: Record<string, string> = {
  servicii_terti: 'Servicii terți',
  ambalare: 'Ambalare',
  altele: 'Altele',
};
type RezCombustibil = {
  rezultate: {
    utilaj_id?: string;
    nume: string;
    calibrat: boolean;
    eroare?: string;
    parcele?: { parcela_id: string; ore_total: number; litri_total: number | null; numar_sesiuni: number; confirmat: boolean }[];
  }[];
};

const rotunjit = (n: number, z = 2) => Math.round(n * 10 ** z) / 10 ** z;

// „F3 - JCB" → „jcb"; „F5 - Belarus 1221.3" → „belarus 1221.3"
function modelUtilaj(nume: string): string {
  return nume
    .replace(/^\s*F\d+\s*[-–]\s*/i, '')
    .trim()
    .toLowerCase();
}

// Consum mediu (L/h) pe parcele, din sesiunile confirmate ale utilajelor de referință,
// în aceeași perioadă. Liniile peste 60 L/h (senzor suspect) nu intră în medie.
async function consumMediuReferinta(
  referinte: { id: string; nume: string; ferma_id: string }[],
  deLa: string,
  panaLa: string,
  token: string | undefined,
): Promise<{ lph: number; folosite: string[] } | null> {
  let litri = 0;
  let ore = 0;
  const folosite: string[] = [];
  await Promise.all(
    referinte.map(async (u) => {
      try {
        const res = await fetch(
          `${supabaseUrl}/functions/v1/get-combustibil-parcele?${new URLSearchParams({ ferma_id: u.ferma_id, utilaj_id: u.id, de_la: deLa, pana_la: panaLa, fara_zilnic: '1' })}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const json = (await res.json().catch(() => null)) as RezCombustibil | null;
        if (!res.ok || !json) return;
        let l = 0;
        let o = 0;
        for (const r of json.rezultate ?? []) {
          for (const lp of r.parcele ?? []) {
            // litri 0 = de obicei sondă fără date (capacitate trecută, dar nicio citire) — nu intră în medie
            if (!lp.confirmat || lp.litri_total === null || lp.litri_total <= 0 || lp.ore_total <= 0) continue;
            if (lp.litri_total / lp.ore_total > 60) continue;
            l += lp.litri_total;
            o += lp.ore_total;
          }
        }
        if (o >= 1) {
          litri += l;
          ore += o;
          folosite.push(u.nume);
        }
      } catch {
        /* referința lipsește din medie */
      }
    }),
  );
  return ore >= 1 && litri > 0 ? { lph: litri / ore, folosite: folosite.sort() } : null;
}

function adaugaMaterial(
  lista: LinieMaterial[],
  nume: string,
  um: string,
  cant: number,
  pret: number | null,
  cod: string | null = null,
  pretAproximat = false,
) {
  const e = lista.find((x) => x.nume === nume && x.um === um);
  const val = pret === null ? null : cant * pret;
  if (e) {
    e.cantitate += cant;
    e.valoare = e.valoare === null || val === null ? null : e.valoare + val;
    e.pretAproximat = e.pretAproximat || pretAproximat;
    e.cod = e.cod ?? cod;
  } else {
    lista.push({ nume, um, cantitate: cant, valoare: val, cod, pretAproximat });
  }
}

function adunaLinie(lista: LinieMaterial[], l: LinieMaterial) {
  const e = lista.find((x) => x.nume === l.nume && x.um === l.um);
  if (!e) {
    lista.push({ ...l });
    return;
  }
  e.cantitate += l.cantitate;
  e.valoare = e.valoare === null || l.valoare === null ? null : e.valoare + l.valoare;
  e.pretAproximat = e.pretAproximat || l.pretAproximat;
  e.cod = e.cod ?? l.cod;
}

export async function incarcaConsumuriLunare(fermaId: string, luna: string): Promise<RaportConsumuri> {
  const { deLa, panaLa } = limiteLuna(luna);
  const avertismente: string[] = [];

  const { data: sesiune } = await supabase.auth.getSession();
  const token = sesiune.session?.access_token;

  const [
    fermaRes,
    parceleRes,
    operatiuni,
    substante,
    materii,
    inAfaraRes,
    alimentariRes,
    combustibil,
    recoltareTipuri,
    cicluriRes,
    directeRes,
    inventareRes,
  ] = await Promise.all([
    supabase.from('ferme').select('nume').eq('id', fermaId).maybeSingle(),
    supabase.from('parcele').select('id,nume,suprafata_mp,tip_gazon').eq('ferma_id', fermaId),
    toatePaginile<RandOp>((a, b) =>
      supabase
        .from('operatiuni')
        .select('id,parcela_id,tip,data,ore_lucru,cantitate_mp_recoltat,sesiune_inceput,sesiune_sfarsit,parcele!inner(ferma_id)')
        .eq('parcele.ferma_id', fermaId)
        .gte('data', deLa)
        .lte('data', panaLa)
        .order('id')
        .range(a, b) as unknown as PromiseLike<Rezultat<RandOp>>,
    ),
    toatePaginile<RandMaterial>((a, b) =>
      supabase
        .from('operatiuni_substante')
        .select(
          'cantitate, pret_unitar_consum, articol:substante(nume,unitate_masura,pret_unitar,nomenclator:substante_nomenclator(cod_smartbill)), operatiuni!inner(parcela_id,data,parcele!inner(ferma_id))',
        )
        .eq('operatiuni.parcele.ferma_id', fermaId)
        .gte('operatiuni.data', deLa)
        .lte('operatiuni.data', panaLa)
        .order('id')
        .range(a, b) as unknown as PromiseLike<Rezultat<RandMaterial>>,
    ),
    toatePaginile<RandMaterial>((a, b) =>
      supabase
        .from('operatiuni_materii_prime')
        .select(
          'cantitate, pret_unitar_consum, articol:materii_prime(nume,unitate_masura,pret_unitar,nomenclator:materii_prime_nomenclator(cod_smartbill)), operatiuni!inner(parcela_id,data,parcele!inner(ferma_id))',
        )
        .eq('operatiuni.parcele.ferma_id', fermaId)
        .gte('operatiuni.data', deLa)
        .lte('operatiuni.data', panaLa)
        .order('id')
        .range(a, b) as unknown as PromiseLike<Rezultat<RandMaterial>>,
    ),
    supabase
      .from('lucrari_in_afara_fermei')
      .select('data,tip,ore_detectate,ore_lucru,litri_combustibil,locatie,utilaje(nume)')
      .eq('ferma_id', fermaId)
      .gte('data', deLa)
      .lte('data', panaLa)
      .order('data'),
    supabase
      .from('rezervor_alimentari')
      .select('cantitate_litri,pret_litru')
      .eq('ferma_id', fermaId)
      .lt('data_ora', sfarsitLunaUTC(panaLa)),
    (async (): Promise<RezCombustibil | null> => {
      // 2026-11-17: o cerere per utilaj (o lună întreagă pentru toată ferma
      // depășea limita de CPU a funcției), câte 4 în paralel.
      const { data: ut, error: errUt } = await supabase.from('utilaje').select('id,nume').eq('ferma_id', fermaId).eq('activ', true);
      if (errUt) {
        avertismente.push(`Motorina pe parcele nu s-a putut calcula (${errUt.message}).`);
        return null;
      }
      const lista = (ut as { id: string; nume: string }[]) ?? [];
      const rezultate: RezCombustibil['rezultate'] = [];
      const esuate: string[] = [];
      let idx = 0;
      const lucrator = async () => {
        while (idx < lista.length) {
          const u = lista[idx++];
          let ok = false;
          for (let incercare = 0; incercare < 2 && !ok; incercare++) {
            try {
              const res = await fetch(
                `${supabaseUrl}/functions/v1/get-combustibil-parcele?${new URLSearchParams({ ferma_id: fermaId, utilaj_id: u.id, de_la: deLa, pana_la: panaLa, fara_zilnic: '1' })}`,
                { headers: { Authorization: `Bearer ${token}` } },
              );
              const json = await res.json().catch(() => null);
              if (res.ok && json) {
                rezultate.push(...((json as RezCombustibil).rezultate ?? []));
                ok = true;
              }
            } catch {
              /* reîncercăm o dată */
            }
          }
          if (!ok) esuate.push(u.nume);
        }
      };
      await Promise.all([lucrator(), lucrator(), lucrator(), lucrator()]);
      if (esuate.length) {
        avertismente.push(`Motorina nu s-a putut calcula pentru: ${esuate.join(', ')}. Restul raportului e complet; reîncearcă peste câteva minute.`);
      }
      return { rezultate };
    })(),
    // 2026-11-25: mp recoltați pe tip gazon
    toatePaginile<RandRecoltareTip>((a, b) =>
      supabase
        .from('operatiuni_recoltare_tipuri')
        .select('tip_gazon, mp, operatiuni!inner(parcela_id,data,parcele!inner(ferma_id))')
        .eq('operatiuni.parcele.ferma_id', fermaId)
        .gte('operatiuni.data', deLa)
        .lte('operatiuni.data', panaLa)
        .order('id')
        .range(a, b) as unknown as PromiseLike<Rezultat<RandRecoltareTip>>,
    ).catch((e: Error) => {
      avertismente.push(`Tipurile de gazon recoltate nu s-au putut citi (${e.message}).`);
      return [] as RandRecoltareTip[];
    }),
    // 2026-11-25: ciclurile care se suprapun cu luna
    supabase
      .from('parcele_cicluri')
      .select('id,parcela_id,data_start,data_sfarsit,stare,complet,tip_gazon,parcele!inner(ferma_id)')
      .eq('parcele.ferma_id', fermaId)
      .lte('data_start', panaLa)
      .or(`data_sfarsit.is.null,data_sfarsit.gte.${deLa}`)
      .order('data_start'),
    // 2026-11-25: costuri directe introduse manual
    supabase
      .from('costuri_directe_manuale')
      .select('parcela_id,data,categorie,descriere,cantitate,unitate_masura,suma_fara_tva,document,parcele!inner(ferma_id)')
      .eq('parcele.ferma_id', fermaId)
      .gte('data', deLa)
      .lte('data', panaLa)
      .order('data'),
    // 2026-11-25: inventarele de masă verde până la sfârșitul lunii (cel mai recent pe parcelă)
    supabase
      .from('inventar_masa_verde')
      .select('data_inventar, inventar_masa_verde_parcele(parcela_id,suprafata_masa_verde_mp,tip)')
      .eq('ferma_id', fermaId)
      .lte('data_inventar', panaLa)
      .order('data_inventar', { ascending: false }),
  ]);

  if (parceleRes.error) throw new Error(`Parcele: ${parceleRes.error.message}`);
  if (inAfaraRes.error) avertismente.push(`Lucrările în afara parcelelor nu s-au putut citi (${inAfaraRes.error.message}).`);

  // preț mediu ponderat motorină (cumpărată de fermă până la sfârșitul lunii)
  let pretMotorina: number | null = null;
  if (!alimentariRes.error) {
    let q = 0;
    let v = 0;
    for (const a of (alimentariRes.data as { cantitate_litri: number; pret_litru: number | null }[]) ?? []) {
      if (a.pret_litru === null) continue;
      q += Number(a.cantitate_litri);
      v += Number(a.cantitate_litri) * Number(a.pret_litru);
    }
    pretMotorina = q > 0 ? v / q : null;
  }
  if (pretMotorina === null) avertismente.push(MESAJ_FARA_PRET);

  const harta = new Map<string, ParcelaConsum>();
  for (const p of (parceleRes.data as { id: string; nume: string; suprafata_mp: number | null; tip_gazon: string | null }[]) ?? []) {
    harta.set(p.id, {
      id: p.id,
      nume: p.nume,
      suprafataMp: p.suprafata_mp === null ? null : Number(p.suprafata_mp),
      cultura: p.tip_gazon,
      ciclu: null,
      oreLucru: 0,
      orePeTip: [],
      mpRecoltat: 0,
      recoltatPeTip: [],
      masaVerdeMp: null,
      masaVerdeData: null,
      directeManuale: [],
      valoareDirecteManuale: 0,
      motorina: [],
      motorinaNeconfirmata: [],
      substante: [],
      materiiPrime: [],
      litri: 0,
      valoareMotorina: null,
      valoareSubstante: 0,
      valoareMateriiPrime: 0,
      valoareTotala: 0,
      areConsum: false,
    });
  }

  // ore + recoltare
  for (const o of operatiuni) {
    const p = harta.get(o.parcela_id);
    if (!p) continue;
    const ore =
      o.sesiune_inceput && o.sesiune_sfarsit
        ? (new Date(o.sesiune_sfarsit).getTime() - new Date(o.sesiune_inceput).getTime()) / 3_600_000
        : Number(o.ore_lucru ?? 0);
    p.oreLucru += ore;
    const eticheta = LABEL_OPERATIUNE[o.tip as TipOperatiune] ?? o.tip;
    const t = p.orePeTip.find((x) => x.tip === eticheta);
    if (t) t.ore += ore;
    else p.orePeTip.push({ tip: eticheta, ore });
    p.mpRecoltat += Number(o.cantitate_mp_recoltat ?? 0);
  }

  // substanțe și materii prime
  for (const [lista, cheie] of [
    [substante, 'substante'],
    [materii, 'materiiPrime'],
  ] as const) {
    for (const r of lista) {
      const p = r.operatiuni ? harta.get(r.operatiuni.parcela_id) : undefined;
      if (!p || !r.articol) continue;
      // 2026-11-25: prețul fixat la consum (CMP din momentul înregistrării); consumurile
      // vechi, fără preț fixat, rămân la CMP-ul curent și sunt marcate „preț aproximat".
      const aproximat = r.pret_unitar_consum === null;
      const pret = !aproximat ? Number(r.pret_unitar_consum) : r.articol.pret_unitar === null ? null : Number(r.articol.pret_unitar);
      adaugaMaterial(
        p[cheie],
        r.articol.nume,
        r.articol.unitate_masura,
        Number(r.cantitate),
        pret,
        r.articol.nomenclator?.cod_smartbill ?? null,
        aproximat,
      );
    }
  }

  // 2026-11-25: recoltat pe tip gazon
  for (const r of recoltareTipuri) {
    const p = r.operatiuni ? harta.get(r.operatiuni.parcela_id) : undefined;
    if (!p) continue;
    const t = p.recoltatPeTip.find((x) => x.tip === r.tip_gazon);
    if (t) t.mp += Number(r.mp);
    else p.recoltatPeTip.push({ tip: r.tip_gazon, mp: Number(r.mp) });
  }

  // 2026-11-25: ciclul activ la sfârșitul lunii (ultimul început ≤ sfârșitul lunii)
  if (cicluriRes.error) {
    avertismente.push(`Ciclurile parcelelor nu s-au putut citi (${cicluriRes.error.message}).`);
  } else {
    const schimbate = new Set<string>();
    for (const c of (cicluriRes.data as unknown as RandCiclu[]) ?? []) {
      const p = harta.get(c.parcela_id);
      if (!p) continue;
      if (p.ciclu) schimbate.add(p.nume);
      p.ciclu = { id: c.id, dataStart: c.data_start, stare: c.stare, complet: c.complet, tipGazon: c.tip_gazon };
    }
    if (schimbate.size > 0) {
      avertismente.push(
        `Parcela ${Array.from(schimbate).sort(comparaNume).join(', ')}: ciclul s-a schimbat în cursul lunii — tot consumul lunii apare pe ciclul nou. Pentru contabilitate, împarte-l după data închiderii ciclului vechi.`,
      );
    }
    const faraCiclu = Array.from(harta.values()).filter((p) => !p.ciclu).map((p) => p.nume);
    if (faraCiclu.length > 0) avertismente.push(`Fără ciclu de producție definit: ${faraCiclu.sort(comparaNume).join(', ')}.`);
  }

  // 2026-11-25: costuri directe manuale
  if (directeRes.error) {
    avertismente.push(`Costurile directe manuale nu s-au putut citi (${directeRes.error.message}).`);
  } else {
    for (const d of (directeRes.data as unknown as RandDirectManual[]) ?? []) {
      const p = harta.get(d.parcela_id);
      if (!p) continue;
      p.directeManuale.push({
        data: d.data,
        categorie: ETICHETA_CATEGORIE_DIRECTA[d.categorie] ?? d.categorie,
        descriere: d.descriere,
        cantitate: d.cantitate === null ? null : Number(d.cantitate),
        um: d.unitate_masura,
        suma: Number(d.suma_fara_tva),
        document: d.document,
      });
    }
  }

  // 2026-11-25: masa verde din cel mai recent inventar care conține parcela
  if (inventareRes.error) {
    avertismente.push(`Inventarul de masă verde nu s-a putut citi (${inventareRes.error.message}).`);
  } else {
    for (const inv of (inventareRes.data as unknown as RandInventarMV[]) ?? []) {
      const pePar = new Map<string, number>();
      for (const r of inv.inventar_masa_verde_parcele ?? []) {
        if (!r.parcela_id) continue;
        const semn = r.tip === 'calamitat' ? -1 : 1;
        pePar.set(r.parcela_id, (pePar.get(r.parcela_id) ?? 0) + semn * Number(r.suprafata_masa_verde_mp));
      }
      for (const [parcelaId, mp] of Array.from(pePar.entries())) {
        const p = harta.get(parcelaId);
        if (!p || p.masaVerdeData !== null) continue; // păstrăm inventarul cel mai recent
        p.masaVerdeMp = Math.max(0, mp);
        p.masaVerdeData = inv.data_inventar;
      }
    }
  }

  // motorină pe parcele
  if (combustibil) {
    for (const u of combustibil.rezultate ?? []) {
      if (u.eroare) {
        avertismente.push(`${u.nume}: ${u.eroare}`);
        continue;
      }
      for (const lp of u.parcele ?? []) {
        const p = harta.get(lp.parcela_id);
        if (!p) continue;
        const linie: LinieMotorina = { utilaj: u.nume, ore: lp.ore_total, litri: lp.litri_total, sesiuni: lp.numar_sesiuni };
        (lp.confirmat ? p.motorina : p.motorinaNeconfirmata).push(linie);
      }
    }
  }

  // 2026-11-23 (Radu): „aproximează-mi în tabel consumul în funcție de consumul mediu
  // pe oră al unui JCB [...] cu o notă că e aproximat. Asta doar acolo unde nu avem
  // date citite." — pentru utilajele fără litri (sondă care nu transmite / necalibrată),
  // litri = ore × media L/h a utilajelor de același model, cu sondă, din aceeași lună.
  if (combustibil) {
    // 2026-11-23: un utilaj cu capacitatea rezervorului completată, dar fără NICIO citire
    // de nivel în lună (ex. F3 - JCB: sonda nu transmite), iese din funcție cu 0 L, nu
    // cu „fără date". Verificăm direct citirile și îl tratăm ca utilaj fără date.
    const cuZero = (combustibil.rezultate ?? []).filter(
      (u) => u.utilaj_id && !u.eroare && (u.parcele ?? []).some((lp) => lp.ore_total > 0) && (u.parcele ?? []).every((lp) => !lp.litri_total),
    );
    await Promise.all(
      cuZero.map(async (u) => {
        const { count, error } = await supabase
          .from('combustibil_citiri')
          .select('id', { count: 'exact', head: true })
          .eq('utilaj_id', u.utilaj_id!)
          .not('nivel_litri', 'is', null)
          .gt('nivel_litri', 0)
          .gte('data_ora', `${deLa}T00:00:00+02:00`)
          .lte('data_ora', `${panaLa}T23:59:59+02:00`);
        if (error || (count ?? 0) > 0) return;
        for (const p of Array.from(harta.values())) {
          for (const m of [...p.motorina, ...p.motorinaNeconfirmata]) if (m.utilaj === u.nume) m.litri = null;
        }
      }),
    );

    const faraDate = Array.from(
      new Set(
        Array.from(harta.values()).flatMap((p) =>
          [...p.motorina, ...p.motorinaNeconfirmata].filter((m) => m.litri === null && m.ore > 0).map((m) => m.utilaj),
        ),
      ),
    );
    if (faraDate.length > 0) {
      const { data: toate } = await supabase
        .from('utilaje')
        .select('id,nume,ferma_id,tanc_capacitate_litri')
        .eq('activ', true)
        .not('tanc_capacitate_litri', 'is', null);
      const calibrate = ((toate as { id: string; nume: string; ferma_id: string; tanc_capacitate_litri: number | null }[]) ?? []).filter(
        (u) => Number(u.tanc_capacitate_litri) > 0,
      );
      const peModel = new Map<string, string[]>();
      for (const n of faraDate) {
        const m = modelUtilaj(n);
        peModel.set(m, [...(peModel.get(m) ?? []), n]);
      }
      for (const [model, utilajeFaraDate] of Array.from(peModel.entries())) {
        const referinte = calibrate.filter((u) => modelUtilaj(u.nume) === model && !utilajeFaraDate.includes(u.nume));
        if (referinte.length === 0) {
          avertismente.push(
            `${utilajeFaraDate.join(', ')}: fără date de la sondă și fără alt utilaj de același model cu sondă — motorina nu se poate aproxima.`,
          );
          continue;
        }
        const medie = await consumMediuReferinta(referinte, deLa, panaLa, token);
        if (!medie) {
          avertismente.push(
            `${utilajeFaraDate.join(', ')}: fără date de la sondă, iar utilajele de același model (${referinte.map((r) => r.nume).join(', ')}) nu au ore cu litri în ${textLuna(luna)} — motorina nu se poate aproxima.`,
          );
          continue;
        }
        const referinta = medie.folosite.join(', ');
        let oreTot = 0;
        for (const p of Array.from(harta.values())) {
          for (const m of [...p.motorina, ...p.motorinaNeconfirmata]) {
            if (m.litri !== null || !utilajeFaraDate.includes(m.utilaj)) continue;
            m.litri = m.ore * medie.lph;
            m.estimat = { lph: medie.lph, referinta };
            if (p.motorina.includes(m)) oreTot += m.ore;
          }
        }
        avertismente.push(
          `APROXIMAT — ${utilajeFaraDate.join(', ')}: sonda nu transmite date, motorina e estimată ca ore × ${medie.lph.toFixed(1).replace('.', ',')} L/h (consumul mediu pe oră în ${textLuna(luna)} al: ${referinta}); ${oreTot.toFixed(1).replace('.', ',')} h confirmate pe parcele ≈ ${(oreTot * medie.lph).toFixed(0)} L.`,
        );
      }
    }
  }

  const parcele = Array.from(harta.values()).sort((a, b) => comparaNume(a.nume, b.nume));
  const totSubst: LinieMaterial[] = [];
  const totMP: LinieMaterial[] = [];
  let necalibrateCuOre = 0;
  for (const p of parcele) {
    p.motorina.sort((a, b) => comparaNume(a.utilaj, b.utilaj));
    p.motorinaNeconfirmata.sort((a, b) => comparaNume(a.utilaj, b.utilaj));
    p.substante.sort((a, b) => comparaNume(a.nume, b.nume));
    p.materiiPrime.sort((a, b) => comparaNume(a.nume, b.nume));
    p.orePeTip.sort((a, b) => b.ore - a.ore);
    p.litri = p.motorina.reduce((s, m) => s + (m.litri ?? 0), 0);
    necalibrateCuOre += p.motorina.filter((m) => m.litri === null).length;
    p.valoareMotorina = pretMotorina === null ? null : p.litri * pretMotorina;
    p.valoareSubstante = p.substante.reduce((s, m) => s + (m.valoare ?? 0), 0);
    p.valoareMateriiPrime = p.materiiPrime.reduce((s, m) => s + (m.valoare ?? 0), 0);
    p.valoareDirecteManuale = p.directeManuale.reduce((s, d) => s + d.suma, 0);
    p.recoltatPeTip.sort((a, b) => b.mp - a.mp);
    p.valoareTotala = (p.valoareMotorina ?? 0) + p.valoareSubstante + p.valoareMateriiPrime + p.valoareDirecteManuale;
    p.areConsum =
      p.oreLucru > 0 ||
      p.litri > 0 ||
      p.substante.length > 0 ||
      p.materiiPrime.length > 0 ||
      p.motorinaNeconfirmata.length > 0 ||
      p.directeManuale.length > 0;
    for (const s of p.substante) adunaLinie(totSubst, s);
    for (const s of p.materiiPrime) adunaLinie(totMP, s);
  }
  totSubst.sort((a, b) => comparaNume(a.nume, b.nume));
  totMP.sort((a, b) => comparaNume(a.nume, b.nume));
  if ([...totSubst, ...totMP].some((m) => m.pretAproximat)) {
    avertismente.push(
      'Unele consumuri de materiale sunt dinainte de fixarea prețului la consum (25.11.2026) — sunt evaluate la costul mediu curent al gestiunii și marcate „preț aproximat".',
    );
  }
  if (necalibrateCuOre > 0) {
    avertismente.push('Unele utilaje nu au senzor de combustibil calibrat — apar cu ore, fără litri.');
  }

  const inAfara: LucrareInAfara[] = ((inAfaraRes.data as unknown as {
    data: string;
    tip: string;
    ore_detectate: number | null;
    ore_lucru: number | null;
    litri_combustibil: number | null;
    locatie: string | null;
    utilaje: { nume: string } | null;
  }[]) ?? []).map((l) => ({
    data: l.data,
    utilaj: l.utilaje?.nume ?? '—',
    tip: LABEL_OPERATIUNE[l.tip as TipOperatiune] ?? l.tip,
    ore: l.ore_detectate !== null ? Number(l.ore_detectate) : l.ore_lucru !== null ? Number(l.ore_lucru) : null,
    litri: l.litri_combustibil === null ? null : Number(l.litri_combustibil),
    locatie: l.locatie,
  }));

  const litri = parcele.reduce((s, p) => s + p.litri, 0);
  const litriInAfara = inAfara.reduce((s, l) => s + (l.litri ?? 0), 0);
  const litriNeconfirmati = parcele.reduce((s, p) => s + p.motorinaNeconfirmata.reduce((t, m) => t + (m.litri ?? 0), 0), 0);
  if (litriNeconfirmati > 0 || parcele.some((p) => p.motorinaNeconfirmata.length > 0)) {
    avertismente.push(
      'Există sesiuni GPS detectate dar NECONFIRMATE în Activități parcele — motorina lor apare separat, orientativ, și nu intră în totaluri. Raportul devine definitiv după confirmarea lor.',
    );
  }
  const valoareSubstante = parcele.reduce((s, p) => s + p.valoareSubstante, 0);
  const valoareMateriiPrime = parcele.reduce((s, p) => s + p.valoareMateriiPrime, 0);
  const valoareMotorina = pretMotorina === null ? null : (litri + litriInAfara) * pretMotorina;
  const valoareDirecteManuale = parcele.reduce((s, p) => s + p.valoareDirecteManuale, 0);
  const recoltatPeTip: { tip: string; mp: number }[] = [];
  for (const p of parcele) {
    for (const r of p.recoltatPeTip) {
      const t = recoltatPeTip.find((x) => x.tip === r.tip);
      if (t) t.mp += r.mp;
      else recoltatPeTip.push({ ...r });
    }
  }
  recoltatPeTip.sort((a, b) => b.mp - a.mp);

  return {
    fermaId,
    fermaNume: (fermaRes.data as { nume: string } | null)?.nume ?? '—',
    luna,
    lunaText: textLuna(luna),
    deLa,
    panaLa,
    generatLa: new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' }),
    pretMotorina,
    pretMotorinaAchizitii: pretMotorina,
    pretMotorinaManual: false,
    inchis: null,
    parcele,
    inAfara,
    totaluri: {
      oreLucru: parcele.reduce((s, p) => s + p.oreLucru, 0),
      litri,
      litriNeconfirmati,
      litriInAfara,
      valoareMotorina,
      valoareSubstante,
      valoareMateriiPrime,
      valoareDirecteManuale,
      valoareTotala: (valoareMotorina ?? 0) + valoareSubstante + valoareMateriiPrime + valoareDirecteManuale,
      mpRecoltat: parcele.reduce((s, p) => s + p.mpRecoltat, 0),
      recoltatPeTip,
      masaVerdeMp: parcele.reduce((s, p) => s + (p.masaVerdeMp ?? 0), 0),
      substante: totSubst,
      materiiPrime: totMP,
    },
    avertismente,
  };
}

const MESAJ_FARA_PRET_MANUAL_PREFIX = 'Preț motorină introdus manual: ';

// 2026-11-23 (Radu): „acolo unde nu avem prețul motorinei [...] să am posibilitatea
// să introduc eu manual într-un câmp prețul în lei/litru, astfel încât să-mi iasă
// totuși raportul". Recalculează valorile de motorină fără a reciti datele.
// pret = null → revine la prețul din achiziții (dacă există).
export function aplicaPretMotorina(r: RaportConsumuri, pret: number | null): RaportConsumuri {
  const manual = pret !== null;
  const pretFolosit = manual ? pret : r.pretMotorinaAchizitii;
  const parcele = r.parcele.map((p) => {
    const valoareMotorina = pretFolosit === null ? null : p.litri * pretFolosit;
    return {
      ...p,
      valoareMotorina,
      valoareTotala: (valoareMotorina ?? 0) + p.valoareSubstante + p.valoareMateriiPrime + (p.valoareDirecteManuale ?? 0),
    };
  });
  const t = r.totaluri;
  const valoareMotorina = pretFolosit === null ? null : (t.litri + t.litriInAfara) * pretFolosit;
  const avertismente = r.avertismente.filter((a) => a !== MESAJ_FARA_PRET && !a.startsWith(MESAJ_FARA_PRET_MANUAL_PREFIX));
  if (manual) {
    avertismente.unshift(
      `${MESAJ_FARA_PRET_MANUAL_PREFIX}${pretFolosit!.toFixed(2)} lei/L` +
        (r.pretMotorinaAchizitii === null
          ? ' (ferma nu are achiziții de motorină cu preț).'
          : ` (în locul prețului mediu de achiziție, ${r.pretMotorinaAchizitii.toFixed(2)} lei/L).`),
    );
  } else if (pretFolosit === null) {
    avertismente.unshift(MESAJ_FARA_PRET);
  }
  return {
    ...r,
    pretMotorina: pretFolosit,
    pretMotorinaManual: manual,
    parcele,
    totaluri: {
      ...t,
      valoareMotorina,
      valoareTotala: (valoareMotorina ?? 0) + t.valoareSubstante + t.valoareMateriiPrime + (t.valoareDirecteManuale ?? 0),
    },
    avertismente,
  };
}

// ─────────────────────────── Lună închisă (înghețată) ───────────────────────────
// 2026-11-25 (Radu): contabilitatea face notele contabile în SmartBill pe baza
// raportului. Odată trimis, raportul lunii se închide: se salvează exact cum a fost
// (inclusiv prețul motorinei introdus manual), iar corecțiile ulterioare din aplicație
// nu-l mai schimbă, până la redeschiderea explicită.

export async function incarcaLunaInchisa(fermaId: string, luna: string): Promise<RaportConsumuri | null> {
  const { data, error } = await supabase
    .from('consumuri_lunare_inchise')
    .select('raport, inchis_la, utilizatori(nume)')
    .eq('ferma_id', fermaId)
    .eq('luna', luna)
    .maybeSingle();
  if (error) throw new Error(`Luna închisă: ${error.message}`);
  if (!data) return null;
  const rand = data as unknown as { raport: RaportConsumuri; inchis_la: string; utilizatori: { nume: string } | null };
  return {
    ...rand.raport,
    inchis: {
      la: new Date(rand.inchis_la).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' }),
      de: rand.utilizatori?.nume ?? null,
    },
  };
}

export async function inchideLuna(r: RaportConsumuri): Promise<void> {
  const { inchis: _ignorat, ...raport } = r;
  const { error } = await supabase.from('consumuri_lunare_inchise').insert({ ferma_id: r.fermaId, luna: r.luna, raport });
  if (error) throw new Error(error.code === '23505' ? 'Luna e deja închisă.' : error.message);
}

export async function redeschideLuna(fermaId: string, luna: string): Promise<void> {
  const { error, count } = await supabase
    .from('consumuri_lunare_inchise')
    .delete({ count: 'exact' })
    .eq('ferma_id', fermaId)
    .eq('luna', luna);
  if (error) throw new Error(error.message);
  if (!count) throw new Error('Luna nu a putut fi redeschisă (fără drept sau deja deschisă).');
}

// ─────────────────────────────── Export Excel ───────────────────────────────

const F_LEI = '#,##0.00';
const F_CANT = '#,##0.##';
const F_ORE = '#,##0.0';

export async function exportaConsumuriExcel(r: RaportConsumuri): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rulouri de Gazon — aplicație ferme';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const titlu = `Consumuri lunare — ${r.fermaNume} — ${r.lunaText}`;
  const antet = (row: import('exceljs').Row) => {
    row.font = { bold: true };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F3E8' } };
      c.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
    });
  };
  const nota = (ws: import('exceljs').Worksheet, text: string) => {
    ws.addRow([text]).font = { italic: true, color: { argb: 'FF777777' } };
  };
  const v = (n: number | null) => (n === null ? null : rotunjit(n));

  // ── Sumar ──
  // 2026-11-25: coloane noi pentru contabilitate — ciclu, costuri directe manuale, masă verde.
  const ws = wb.addWorksheet('Sumar pe parcele');
  ws.columns = [
    { width: 20 }, // A Parcelă
    { width: 12 }, // B Ciclu din
    { width: 12 }, // C Ciclu
    { width: 11 }, // D ha
    { width: 10 }, // E ore
    { width: 12 }, // F motorină L
    { width: 14 }, // G motorină lei
    { width: 14 }, // H fertilizanți lei
    { width: 14 }, // I materii prime lei
    { width: 14 }, // J directe manuale lei
    { width: 15 }, // K total lei
    { width: 12 }, // L recoltat mp
    { width: 13 }, // M masă verde mp
    { width: 13 }, // N motorină neconf. L
  ];
  ws.addRow([titlu]).font = { bold: true, size: 14 };
  ws.addRow([`Perioada ${r.deLa} – ${r.panaLa} · generat ${r.generatLa}`]);
  if (r.inchis) ws.addRow([`LUNĂ ÎNCHISĂ pentru contabilitate la ${r.inchis.la}${r.inchis.de ? ` de ${r.inchis.de}` : ''} — cifre înghețate.`]).font = { bold: true, color: { argb: 'FF1F6F1F' } };
  ws.addRow([]);
  const a1 = ws.addRow([
    'Parcelă',
    'Ciclu început',
    'Ciclu',
    'Suprafață (ha)',
    'Ore lucru',
    'Motorină (L)',
    'Motorină (lei)',
    'Fertilizanți (lei)',
    'Materii prime (lei)',
    'Directe manuale (lei)',
    'Total direct (lei)',
    'Recoltat (mp)',
    'Masă verde rămasă (mp)',
    'Motorină neconf. (L)',
  ]);
  antet(a1);
  const prim = a1.number + 1;
  const textCiclu = (p: ParcelaConsum) => (p.ciclu ? (p.ciclu.complet ? 'complet' : 'incomplet') : 'fără ciclu');
  for (const p of r.parcele.filter((x) => x.areConsum)) {
    const row = ws.addRow([
      p.nume,
      p.ciclu?.dataStart ?? null,
      textCiclu(p),
      p.suprafataMp === null ? null : rotunjit(p.suprafataMp / 10000, 4),
      rotunjit(p.oreLucru, 1),
      rotunjit(p.litri, 1),
      v(p.valoareMotorina),
      v(p.valoareSubstante),
      v(p.valoareMateriiPrime),
      v(p.valoareDirecteManuale ?? 0),
      null,
      p.mpRecoltat || null,
      p.masaVerdeMp === null ? null : rotunjit(p.masaVerdeMp, 0),
      rotunjit(p.motorinaNeconfirmata.reduce((s, m) => s + (m.litri ?? 0), 0), 1) || null,
    ]);
    row.getCell(11).value = { formula: `SUM(G${row.number}:J${row.number})`, result: rotunjit(p.valoareTotala) };
  }
  if (r.totaluri.litriInAfara > 0 || r.inAfara.length > 0) {
    const row = ws.addRow([
      'În afara parcelelor',
      null,
      null,
      null,
      rotunjit(r.inAfara.reduce((s, l) => s + (l.ore ?? 0), 0), 1),
      rotunjit(r.totaluri.litriInAfara, 1),
      r.pretMotorina === null ? null : rotunjit(r.totaluri.litriInAfara * r.pretMotorina),
      0,
      0,
      0,
      null,
      null,
      null,
      null,
    ]);
    row.font = { italic: true };
    row.getCell(11).value = { formula: `SUM(G${row.number}:J${row.number})` };
  }
  const ult = ws.rowCount;
  const tot = ws.addRow([
    'TOTAL',
    null,
    null,
    ...['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'].map((c) => ({ formula: `SUM(${c}${prim}:${c}${ult})` })),
  ]);
  tot.font = { bold: true };
  for (let rr = prim; rr <= tot.number; rr++) {
    const row = ws.getRow(rr);
    row.getCell(4).numFmt = '#,##0.0000';
    row.getCell(5).numFmt = F_ORE;
    row.getCell(6).numFmt = F_ORE;
    for (const c of [7, 8, 9, 10, 11]) row.getCell(c).numFmt = F_LEI;
    row.getCell(12).numFmt = '#,##0';
    row.getCell(13).numFmt = '#,##0';
    row.getCell(14).numFmt = F_ORE;
  }
  ws.views = [{ state: 'frozen', ySplit: a1.number, xSplit: 1 }];
  ws.addRow([]);
  nota(
    ws,
    r.pretMotorina === null
      ? 'Motorină: fără preț de achiziție — valoare necalculată.'
      : r.pretMotorinaManual
        ? `Motorină la prețul introdus manual: ${r.pretMotorina.toFixed(2)} lei/L.`
        : `Motorină la prețul mediu de achiziție al fermei: ${r.pretMotorina.toFixed(2)} lei/L.`,
  );
  nota(ws, 'Fertilizanți și materii prime la costul mediu ponderat al gestiunii fermei din momentul consumului (vezi foaia Explicații).');
  nota(ws, 'Motorina din sesiunile neconfirmate e orientativă și nu intră în totaluri.');
  const fara = r.parcele.filter((x) => !x.areConsum).map((x) => x.nume);
  if (fara.length) nota(ws, `Parcele fără consumuri în lună: ${fara.join(', ')}.`);
  for (const a of r.avertismente) nota(ws, a);
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // ── Detaliat (o linie per articol consumat) ──
  const wd = wb.addWorksheet('Detaliat');
  wd.columns = [{ width: 18 }, { width: 22 }, { width: 50 }, { width: 17 }, { width: 7 }, { width: 13 }, { width: 10 }, { width: 15 }, { width: 26 }];
  wd.addRow([titlu]).font = { bold: true, size: 13 };
  wd.addRow([]);
  const ad = wd.addRow(['Parcelă', 'Categorie', 'Articol / utilaj', 'Cod SmartBill', 'UM', 'Cantitate', 'Ore', 'Valoare (lei)', 'Observații']);
  antet(ad);
  // vals: [parcelă, categorie, articol, UM, cantitate, ore, valoare, observații]; codul se inserează pe poziția 4.
  const linie = (vals: (string | number | null)[], italic = false, cod: string | null = null) => {
    const row = wd.addRow([vals[0], vals[1], vals[2], cod, ...vals.slice(3)]);
    row.getCell(6).numFmt = F_CANT;
    row.getCell(7).numFmt = F_ORE;
    row.getCell(8).numFmt = F_LEI;
    if (italic) row.font = { italic: true, color: { argb: 'FF8A5A00' } };
  };
  const obsPret = (m: LinieMaterial) => (m.pretAproximat ? 'preț aproximat (CMP curent)' : null);
  for (const p of r.parcele.filter((x) => x.areConsum)) {
    for (const m of p.motorina)
      linie([p.nume, 'Motorină', m.utilaj, 'L', m.litri === null ? null : rotunjit(m.litri, 1), rotunjit(m.ore, 1), m.litri !== null && r.pretMotorina !== null ? rotunjit(m.litri * r.pretMotorina) : null, m.estimat ? `APROXIMAT: ${rotunjit(m.estimat.lph, 1)} L/h × ore (media ${m.estimat.referinta})` : m.litri === null ? 'fără senzor calibrat' : null]);
    for (const s of p.substante) linie([p.nume, 'Fertilizanți / tratamente', s.nume, s.um, rotunjit(s.cantitate, 3), null, v(s.valoare), obsPret(s)], false, s.cod ?? null);
    for (const s of p.materiiPrime) linie([p.nume, 'Materii prime', s.nume, s.um, rotunjit(s.cantitate, 3), null, v(s.valoare), obsPret(s)], false, s.cod ?? null);
    for (const d of p.directeManuale ?? [])
      linie([p.nume, `Direct manual — ${d.categorie}`, d.descriere, d.um, d.cantitate === null ? null : rotunjit(d.cantitate, 3), null, v(d.suma), [d.data, d.document].filter(Boolean).join(' · ') || null]);
    for (const m of p.motorinaNeconfirmata)
      linie([p.nume, 'Motorină (neconfirmat)', m.utilaj, 'L', m.litri === null ? null : rotunjit(m.litri, 1), rotunjit(m.ore, 1), null, m.estimat ? `orientativ, neconfirmat; APROXIMAT ${rotunjit(m.estimat.lph, 1)} L/h` : 'orientativ, neconfirmat'], true);
  }
  for (const l of r.inAfara)
    linie(['În afara parcelelor', 'Motorină', l.utilaj, 'L', l.litri === null ? null : rotunjit(l.litri, 1), l.ore === null ? null : rotunjit(l.ore, 1), l.litri !== null && r.pretMotorina !== null ? rotunjit(l.litri * r.pretMotorina) : null, [l.data, l.tip, l.locatie].filter(Boolean).join(' · ')]);
  if (wd.rowCount > ad.number) wd.autoFilter = { from: { row: ad.number, column: 1 }, to: { row: wd.rowCount, column: 9 } };
  wd.views = [{ state: 'frozen', ySplit: ad.number }];

  // ── Matrice: articole (vertical) × parcele (orizontal) ──
  const cuConsum = r.parcele.filter((x) => x.substante.length || x.materiiPrime.length || x.litri > 0);
  const wm = wb.addWorksheet('Articole x parcele');
  wm.columns = [{ width: 22 }, { width: 48 }, { width: 7 }, ...cuConsum.map(() => ({ width: 12 })), { width: 13 }];
  wm.addRow([`${titlu} — cantități`]).font = { bold: true, size: 13 };
  wm.addRow([]);
  const am = wm.addRow(['Categorie', 'Articol', 'UM', ...cuConsum.map((p) => p.nume), 'Total']);
  antet(am);
  const col = (n: number) => {
    let s = '';
    while (n > 0) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const randMatrice = (cat: string, nume: string, um: string, valori: (number | null)[]) => {
    const row = wm.addRow([cat, nume, um, ...valori]);
    const c = 4 + cuConsum.length;
    row.getCell(c).value = cuConsum.length
      ? { formula: `SUM(D${row.number}:${col(3 + cuConsum.length)}${row.number})`, result: valori.reduce<number>((s, x) => s + (x ?? 0), 0) }
      : 0;
    row.getCell(c).font = { bold: true };
    for (let i = 4; i <= c; i++) row.getCell(i).numFmt = F_CANT;
  };
  randMatrice('Motorină', 'Motorină (sesiuni confirmate)', 'L', cuConsum.map((p) => (p.litri ? rotunjit(p.litri, 1) : null)));
  for (const t of r.totaluri.substante)
    randMatrice('Fertilizanți / tratamente', t.nume, t.um, cuConsum.map((p) => p.substante.find((s) => s.nume === t.nume && s.um === t.um)?.cantitate ?? null));
  for (const t of r.totaluri.materiiPrime)
    randMatrice('Materii prime', t.nume, t.um, cuConsum.map((p) => p.materiiPrime.find((s) => s.nume === t.nume && s.um === t.um)?.cantitate ?? null));
  wm.views = [{ state: 'frozen', ySplit: am.number, xSplit: 3 }];
  wm.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // ── Total fermă pe articole ──
  const wt = wb.addWorksheet('Total pe articole');
  wt.columns = [{ width: 24 }, { width: 50 }, { width: 17 }, { width: 7 }, { width: 13 }, { width: 15 }];
  wt.addRow([`${titlu} — total fermă`]).font = { bold: true, size: 13 };
  wt.addRow([]);
  antet(wt.addRow(['Categorie', 'Articol', 'Cod SmartBill', 'UM', 'Cantitate', 'Valoare (lei)']));
  const pt = wt.rowCount + 1;
  // vals: [categorie, articol, UM, cantitate, valoare]; codul se inserează pe poziția 3.
  const rt = (vals: (string | number | null)[], cod: string | null = null) => {
    const row = wt.addRow([vals[0], vals[1], cod, ...vals.slice(2)]);
    row.getCell(5).numFmt = F_CANT;
    row.getCell(6).numFmt = F_LEI;
  };
  rt(['Motorină', 'Motorină — pe parcele (confirmat)', 'L', rotunjit(r.totaluri.litri, 1), r.pretMotorina === null ? null : rotunjit(r.totaluri.litri * r.pretMotorina)]);
  if (r.totaluri.litriInAfara > 0)
    rt(['Motorină', 'Motorină — în afara parcelelor', 'L', rotunjit(r.totaluri.litriInAfara, 1), r.pretMotorina === null ? null : rotunjit(r.totaluri.litriInAfara * r.pretMotorina)]);
  for (const t of r.totaluri.substante) rt(['Fertilizanți / tratamente', t.nume, t.um, rotunjit(t.cantitate, 3), v(t.valoare)], t.cod ?? null);
  for (const t of r.totaluri.materiiPrime) rt(['Materii prime', t.nume, t.um, rotunjit(t.cantitate, 3), v(t.valoare)], t.cod ?? null);
  const directePeCategorie = new Map<string, number>();
  for (const p of r.parcele) for (const d of p.directeManuale ?? []) directePeCategorie.set(d.categorie, (directePeCategorie.get(d.categorie) ?? 0) + d.suma);
  for (const [cat, suma] of Array.from(directePeCategorie.entries())) rt(['Directe manuale', cat, null, null, v(suma)]);
  const tt = wt.addRow(['TOTAL', null, null, null, null, { formula: `SUM(F${pt}:F${wt.rowCount})`, result: rotunjit(r.totaluri.valoareTotala) }]);
  tt.font = { bold: true };
  tt.getCell(6).numFmt = F_LEI;

  // ── Producție: recoltat pe tip gazon + masă verde rămasă (2026-11-25) ──
  const tipuri = Array.from(new Set(r.parcele.flatMap((p) => (p.recoltatPeTip ?? []).map((t) => t.tip)))).sort();
  const wp = wb.addWorksheet('Producție');
  wp.columns = [{ width: 20 }, { width: 12 }, { width: 12 }, ...tipuri.map(() => ({ width: 12 })), { width: 13 }, { width: 13 }, { width: 15 }, { width: 13 }];
  wp.addRow([`${titlu} — producție obținută și în curs`]).font = { bold: true, size: 13 };
  wp.addRow([]);
  const ap = wp.addRow(['Parcelă', 'Ciclu început', 'Ciclu', ...tipuri.map((t) => `Recoltat ${t} (mp)`), 'Recoltat fără tip (mp)', 'Recoltat total (mp)', 'Masă verde rămasă (mp)', 'Inventar din']);
  antet(ap);
  const pp = wp.rowCount + 1;
  for (const p of r.parcele.filter((x) => x.mpRecoltat > 0 || x.masaVerdeMp !== null || x.ciclu)) {
    const peTip = tipuri.map((t) => (p.recoltatPeTip ?? []).find((x) => x.tip === t)?.mp ?? null);
    const cuTip = peTip.reduce<number>((s, x) => s + (x ?? 0), 0);
    const row = wp.addRow([
      p.nume,
      p.ciclu?.dataStart ?? null,
      textCiclu(p),
      ...peTip,
      p.mpRecoltat - cuTip > 0 ? rotunjit(p.mpRecoltat - cuTip, 0) : null,
      p.mpRecoltat || null,
      p.masaVerdeMp === null ? null : rotunjit(p.masaVerdeMp, 0),
      p.masaVerdeData,
    ]);
    for (let c = 4; c <= 6 + tipuri.length; c++) row.getCell(c).numFmt = '#,##0';
  }
  const tp = wp.addRow([
    'TOTAL',
    null,
    null,
    ...Array.from({ length: tipuri.length + 3 }, (_, i) => {
      const c = col(4 + i);
      return { formula: `SUM(${c}${pp}:${c}${wp.rowCount})` };
    }),
  ]);
  tp.font = { bold: true };
  for (let c = 4; c <= 6 + tipuri.length; c++) tp.getCell(c).numFmt = '#,##0';
  wp.views = [{ state: 'frozen', ySplit: ap.number, xSplit: 1 }];
  wp.addRow([]);
  nota(wp, 'Recoltat = suprafața raportată de operator la confirmarea recoltării (mp), pe tip de gazon. „Fără tip" = recoltări dinainte de 25.11.2026 la care tipul nu a putut fi determinat.');
  nota(wp, 'Masă verde rămasă = suprafața gazonului încă nerecoltat, din cel mai recent inventar măsurat (RTK) până la sfârșitul lunii, minus zonele calamitate. Data inventarului e în ultima coloană.');

  // ── Explicații pentru contabilitate (2026-11-25) ──
  const we = wb.addWorksheet('Explicații');
  we.columns = [{ width: 28 }, { width: 110 }];
  we.addRow(['Explicații — ce conține raportul și de unde vin cifrele']).font = { bold: true, size: 13 };
  we.addRow([]);
  antet(we.addRow(['Element', 'Explicație']));
  const ex = (a: string, b: string) => {
    const row = we.addRow([a, b]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell(1).font = { bold: true };
  };
  ex('Ce este', 'Costurile DIRECTE de producție ale fermei pe luna aleasă, pe fiecare parcelă: motorină, fertilizanți/tratamente, materii prime (semințe etc.) și costuri directe introduse manual (servicii terți, ambalare). NU conține costuri indirecte (arendă, salarii, amortizări, utilități etc.) — acestea se înregistrează în contabilitate.');
  ex('Obiect de cost', 'Parcela + ciclul de producție. Un ciclu începe la însămânțare și se încheie când parcela e recoltată complet. „Complet" = ciclu început după 01.10.2026, cu toate consumurile înregistrate în aplicație. „Incomplet" = ciclu început înainte de 01.10.2026; consumurile anterioare datei de 01.10.2026 nu sunt în aplicație (au fost tratate în contabilitate).');
  ex('Motorină — cantitate', 'Măsurată de sonda de combustibil a fiecărui utilaj, pe fiecare sesiune de lucru detectată prin GPS pe parcelă și confirmată de șeful de fermă (bilanț: nivel la început − nivel la sfârșit + alimentări din timpul sesiunii). Unde sonda nu transmite, cantitatea e aproximată ca ore × consumul mediu orar al utilajelor de același model (marcat APROXIMAT). Motorina consumată în afara parcelelor apare separat.');
  ex('Motorină — valoare', 'Cantitatea × prețul mediu ponderat al motorinei cumpărate de fermă până la sfârșitul lunii (sau prețul introdus manual, dacă e menționat în nota din foaia Sumar).');
  ex('Fertilizanți / materii prime', 'Cantitățile raportate de șeful de fermă la fiecare operațiune, scăzute automat din gestiunea fermei în aplicație. Valoare = cantitate × costul mediu ponderat al gestiunii fermei din momentul consumului. Consumurile marcate „preț aproximat" sunt dinainte de 25.11.2026 și sunt evaluate la costul mediu curent.');
  ex('Cod SmartBill', 'Codul articolului din nomenclatorul SmartBill, pentru potrivirea cu gestiunea din contabilitate. Gol = codul nu a fost încă completat în aplicație.');
  ex('Directe manuale', 'Costuri directe pe parcelă introduse de administrator pe baza documentelor (factură, aviz): servicii prestate de terți, materiale de ambalare etc. Sume fără TVA.');
  ex('Ore lucru', 'Durata sesiunilor de lucru ale utilajelor pe parcelă (GPS). Utilă ca bază de repartizare; nu e evaluată în lei (salariile sunt în contabilitate).');
  ex('Producție', 'Foaia Producție: mp recoltați pe tip de gazon (producție obținută) și masa verde rămasă din ultimul inventar (producție în curs).');
  ex('Luna închisă', 'Când luna e închisă în aplicație, cifrele sunt înghețate exact cum au fost trimise contabilității; corecțiile ulterioare din aplicație nu le mai modifică, până la redeschiderea explicită a lunii.');

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const slug = r.fermaNume.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  a.download = `consumuri-${slug}-${r.luna}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
