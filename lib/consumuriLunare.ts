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

export type LinieMotorina = { utilaj: string; ore: number; litri: number | null; sesiuni: number };
export type LinieMaterial = { nume: string; um: string; cantitate: number; valoare: number | null };

export type ParcelaConsum = {
  id: string;
  nume: string;
  suprafataMp: number | null;
  cultura: string | null;
  oreLucru: number;
  orePeTip: { tip: string; ore: number }[];
  mpRecoltat: number;
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
  pretMotorina: number | null; // lei / L
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
    valoareTotala: number;
    mpRecoltat: number;
    substante: LinieMaterial[];
    materiiPrime: LinieMaterial[];
  };
  avertismente: string[];
};

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
  articol: { nume: string; unitate_masura: string; pret_unitar: number | null } | null;
  operatiuni: { parcela_id: string } | null;
};
type RezCombustibil = {
  rezultate: {
    nume: string;
    calibrat: boolean;
    eroare?: string;
    parcele?: { parcela_id: string; ore_total: number; litri_total: number | null; numar_sesiuni: number; confirmat: boolean }[];
  }[];
};

const rotunjit = (n: number, z = 2) => Math.round(n * 10 ** z) / 10 ** z;

function adaugaMaterial(lista: LinieMaterial[], nume: string, um: string, cant: number, pret: number | null) {
  const e = lista.find((x) => x.nume === nume && x.um === um);
  const val = pret === null ? null : cant * pret;
  if (e) {
    e.cantitate += cant;
    e.valoare = e.valoare === null || val === null ? null : e.valoare + val;
  } else {
    lista.push({ nume, um, cantitate: cant, valoare: val });
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
}

export async function incarcaConsumuriLunare(fermaId: string, luna: string): Promise<RaportConsumuri> {
  const { deLa, panaLa } = limiteLuna(luna);
  const avertismente: string[] = [];

  const { data: sesiune } = await supabase.auth.getSession();
  const token = sesiune.session?.access_token;

  const [fermaRes, parceleRes, operatiuni, substante, materii, inAfaraRes, alimentariRes, combustibil] = await Promise.all([
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
        .select('cantitate, articol:substante(nume,unitate_masura,pret_unitar), operatiuni!inner(parcela_id,data,parcele!inner(ferma_id))')
        .eq('operatiuni.parcele.ferma_id', fermaId)
        .gte('operatiuni.data', deLa)
        .lte('operatiuni.data', panaLa)
        .order('id')
        .range(a, b) as unknown as PromiseLike<Rezultat<RandMaterial>>,
    ),
    toatePaginile<RandMaterial>((a, b) =>
      supabase
        .from('operatiuni_materii_prime')
        .select('cantitate, articol:materii_prime(nume,unitate_masura,pret_unitar), operatiuni!inner(parcela_id,data,parcele!inner(ferma_id))')
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
  if (pretMotorina === null) avertismente.push('Nu există achiziții de motorină cu preț pentru fermă — motorina apare doar în litri.');

  const harta = new Map<string, ParcelaConsum>();
  for (const p of (parceleRes.data as { id: string; nume: string; suprafata_mp: number | null; tip_gazon: string | null }[]) ?? []) {
    harta.set(p.id, {
      id: p.id,
      nume: p.nume,
      suprafataMp: p.suprafata_mp === null ? null : Number(p.suprafata_mp),
      cultura: p.tip_gazon,
      oreLucru: 0,
      orePeTip: [],
      mpRecoltat: 0,
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
      adaugaMaterial(
        p[cheie],
        r.articol.nume,
        r.articol.unitate_masura,
        Number(r.cantitate),
        r.articol.pret_unitar === null ? null : Number(r.articol.pret_unitar),
      );
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
    p.valoareTotala = (p.valoareMotorina ?? 0) + p.valoareSubstante + p.valoareMateriiPrime;
    p.areConsum =
      p.oreLucru > 0 || p.litri > 0 || p.substante.length > 0 || p.materiiPrime.length > 0 || p.motorinaNeconfirmata.length > 0;
    for (const s of p.substante) adunaLinie(totSubst, s);
    for (const s of p.materiiPrime) adunaLinie(totMP, s);
  }
  totSubst.sort((a, b) => comparaNume(a.nume, b.nume));
  totMP.sort((a, b) => comparaNume(a.nume, b.nume));
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

  return {
    fermaId,
    fermaNume: (fermaRes.data as { nume: string } | null)?.nume ?? '—',
    luna,
    lunaText: textLuna(luna),
    deLa,
    panaLa,
    generatLa: new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' }),
    pretMotorina,
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
      valoareTotala: (valoareMotorina ?? 0) + valoareSubstante + valoareMateriiPrime,
      mpRecoltat: parcele.reduce((s, p) => s + p.mpRecoltat, 0),
      substante: totSubst,
      materiiPrime: totMP,
    },
    avertismente,
  };
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
  const ws = wb.addWorksheet('Sumar pe parcele');
  ws.columns = [{ width: 22 }, { width: 12 }, { width: 11 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 13 }, { width: 14 }];
  ws.addRow([titlu]).font = { bold: true, size: 14 };
  ws.addRow([`Perioada ${r.deLa} – ${r.panaLa} · generat ${r.generatLa}`]);
  ws.addRow([]);
  const a1 = ws.addRow(['Parcelă', 'Suprafață (ha)', 'Ore lucru', 'Motorină (L)', 'Motorină (lei)', 'Fertilizanți (lei)', 'Materii prime (lei)', 'Total (lei)', 'Recoltat (mp)', 'Motorină neconf. (L)']);
  antet(a1);
  const prim = a1.number + 1;
  for (const p of r.parcele.filter((x) => x.areConsum)) {
    const row = ws.addRow([
      p.nume,
      p.suprafataMp === null ? null : rotunjit(p.suprafataMp / 10000, 4),
      rotunjit(p.oreLucru, 1),
      rotunjit(p.litri, 1),
      v(p.valoareMotorina),
      v(p.valoareSubstante),
      v(p.valoareMateriiPrime),
      null,
      p.mpRecoltat || null,
      rotunjit(p.motorinaNeconfirmata.reduce((s, m) => s + (m.litri ?? 0), 0), 1) || null,
    ]);
    row.getCell(8).value = { formula: `SUM(E${row.number}:G${row.number})`, result: rotunjit(p.valoareTotala) };
  }
  if (r.totaluri.litriInAfara > 0 || r.inAfara.length > 0) {
    const row = ws.addRow([
      'În afara parcelelor',
      null,
      rotunjit(r.inAfara.reduce((s, l) => s + (l.ore ?? 0), 0), 1),
      rotunjit(r.totaluri.litriInAfara, 1),
      r.pretMotorina === null ? null : rotunjit(r.totaluri.litriInAfara * r.pretMotorina),
      0,
      0,
      null,
      null,
      null,
    ]);
    row.font = { italic: true };
    row.getCell(8).value = { formula: `SUM(E${row.number}:G${row.number})` };
  }
  const ult = ws.rowCount;
  const tot = ws.addRow(['TOTAL', null, ...['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((c) => ({ formula: `SUM(${c}${prim}:${c}${ult})` }))]);
  tot.font = { bold: true };
  for (let rr = prim; rr <= tot.number; rr++) {
    const row = ws.getRow(rr);
    row.getCell(2).numFmt = '#,##0.0000';
    row.getCell(3).numFmt = F_ORE;
    row.getCell(4).numFmt = F_ORE;
    for (const c of [5, 6, 7, 8]) row.getCell(c).numFmt = F_LEI;
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).numFmt = F_ORE;
  }
  ws.views = [{ state: 'frozen', ySplit: a1.number, xSplit: 1 }];
  ws.addRow([]);
  nota(ws, r.pretMotorina === null ? 'Motorină: fără preț de achiziție — valoare necalculată.' : `Motorină la prețul mediu de achiziție al fermei: ${r.pretMotorina.toFixed(2)} lei/L.`);
  nota(ws, 'Fertilizanți și materii prime la prețul unitar mediu din gestiunea fermei.');
  nota(ws, 'Motorina din sesiunile neconfirmate e orientativă și nu intră în totaluri.');
  const fara = r.parcele.filter((x) => !x.areConsum).map((x) => x.nume);
  if (fara.length) nota(ws, `Parcele fără consumuri în lună: ${fara.join(', ')}.`);
  for (const a of r.avertismente) nota(ws, a);
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // ── Detaliat (o linie per articol consumat) ──
  const wd = wb.addWorksheet('Detaliat');
  wd.columns = [{ width: 18 }, { width: 22 }, { width: 50 }, { width: 7 }, { width: 13 }, { width: 10 }, { width: 15 }, { width: 22 }];
  wd.addRow([titlu]).font = { bold: true, size: 13 };
  wd.addRow([]);
  const ad = wd.addRow(['Parcelă', 'Categorie', 'Articol / utilaj', 'UM', 'Cantitate', 'Ore', 'Valoare (lei)', 'Observații']);
  antet(ad);
  const linie = (vals: (string | number | null)[], italic = false) => {
    const row = wd.addRow(vals);
    row.getCell(5).numFmt = F_CANT;
    row.getCell(6).numFmt = F_ORE;
    row.getCell(7).numFmt = F_LEI;
    if (italic) row.font = { italic: true, color: { argb: 'FF8A5A00' } };
  };
  for (const p of r.parcele.filter((x) => x.areConsum)) {
    for (const m of p.motorina)
      linie([p.nume, 'Motorină', m.utilaj, 'L', m.litri === null ? null : rotunjit(m.litri, 1), rotunjit(m.ore, 1), m.litri !== null && r.pretMotorina !== null ? rotunjit(m.litri * r.pretMotorina) : null, m.litri === null ? 'fără senzor calibrat' : null]);
    for (const s of p.substante) linie([p.nume, 'Fertilizanți / tratamente', s.nume, s.um, rotunjit(s.cantitate, 3), null, v(s.valoare), null]);
    for (const s of p.materiiPrime) linie([p.nume, 'Materii prime', s.nume, s.um, rotunjit(s.cantitate, 3), null, v(s.valoare), null]);
    for (const m of p.motorinaNeconfirmata)
      linie([p.nume, 'Motorină (neconfirmat)', m.utilaj, 'L', m.litri === null ? null : rotunjit(m.litri, 1), rotunjit(m.ore, 1), null, 'orientativ, neconfirmat'], true);
  }
  for (const l of r.inAfara)
    linie(['În afara parcelelor', 'Motorină', l.utilaj, 'L', l.litri === null ? null : rotunjit(l.litri, 1), l.ore === null ? null : rotunjit(l.ore, 1), l.litri !== null && r.pretMotorina !== null ? rotunjit(l.litri * r.pretMotorina) : null, [l.data, l.tip, l.locatie].filter(Boolean).join(' · ')]);
  if (wd.rowCount > ad.number) wd.autoFilter = { from: { row: ad.number, column: 1 }, to: { row: wd.rowCount, column: 8 } };
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
  wt.columns = [{ width: 24 }, { width: 50 }, { width: 7 }, { width: 13 }, { width: 15 }];
  wt.addRow([`${titlu} — total fermă`]).font = { bold: true, size: 13 };
  wt.addRow([]);
  antet(wt.addRow(['Categorie', 'Articol', 'UM', 'Cantitate', 'Valoare (lei)']));
  const pt = wt.rowCount + 1;
  const rt = (vals: (string | number | null)[]) => {
    const row = wt.addRow(vals);
    row.getCell(4).numFmt = F_CANT;
    row.getCell(5).numFmt = F_LEI;
  };
  rt(['Motorină', 'Motorină — pe parcele (confirmat)', 'L', rotunjit(r.totaluri.litri, 1), r.pretMotorina === null ? null : rotunjit(r.totaluri.litri * r.pretMotorina)]);
  if (r.totaluri.litriInAfara > 0)
    rt(['Motorină', 'Motorină — în afara parcelelor', 'L', rotunjit(r.totaluri.litriInAfara, 1), r.pretMotorina === null ? null : rotunjit(r.totaluri.litriInAfara * r.pretMotorina)]);
  for (const t of r.totaluri.substante) rt(['Fertilizanți / tratamente', t.nume, t.um, rotunjit(t.cantitate, 3), v(t.valoare)]);
  for (const t of r.totaluri.materiiPrime) rt(['Materii prime', t.nume, t.um, rotunjit(t.cantitate, 3), v(t.valoare)]);
  const tt = wt.addRow(['TOTAL', null, null, null, { formula: `SUM(E${pt}:E${wt.rowCount})`, result: rotunjit(r.totaluri.valoareTotala) }]);
  tt.font = { bold: true };
  tt.getCell(5).numFmt = F_LEI;

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
