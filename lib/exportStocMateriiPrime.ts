// lib/exportStocMateriiPrime.ts
//
// 2026-11-16 (Radu): „în zona Rapoarte din Dashboard, un buton de export date
// stocuri materii prime pe fiecare fermă, în Excel".
//
// Generează în browser (fără server) un fișier .xlsx cu:
//  - „Centralizator": o linie pe fermă — nr. articole, valoare stoc (lei) — și total;
//  - câte o foaie pe fermă: Nr., Denumire, Cod, UM, Stoc curent, Preț unitar,
//    Valoare (formulă Excel = stoc × preț), cu total pe fermă;
//  - „Toate fermele": lista completă cu coloana Fermă (pentru filtre / pivot).
// Sursa: `materii_prime` (stoc_curent, pret_unitar) — exact ce arată pagina
// /materii-prime. Codul articolului se extrage din paranteza de la finalul
// denumirii, ex. „... (SABMPRIM000277)" → „SABMPRIM000277".
//
// exceljs se încarcă dinamic, doar la apăsarea butonului (nu îngreunează
// încărcarea Dashboard-ului).

import { supabase } from './supabaseClient';

type Rand = {
  nume: string;
  unitate_masura: string;
  stoc_curent: number | null;
  pret_unitar: number | null;
  ferma_id: string | null;
};

type Ferma = { id: string; nume: string };

const FORMAT_LEI = '#,##0.00';
const FORMAT_CANT = '#,##0.##';

function extrageCod(nume: string): { denumire: string; cod: string } {
  const m = nume.match(/^(.*?)\s*\(([A-Z0-9.\-_/]+)\)\s*$/i);
  return m ? { denumire: m[1], cod: m[2] } : { denumire: nume, cod: '' };
}

// Excel: numele foii max 31 caractere, fără : \ / ? * [ ]
function numeFoaie(nume: string, folosite: Set<string>): string {
  let baza = nume.replace(/[:\\/?*[\]]/g, '-').slice(0, 31).trim() || 'Ferma';
  let n = baza;
  let i = 2;
  while (folosite.has(n.toLowerCase())) {
    const suf = ` ${i++}`;
    n = baza.slice(0, 31 - suf.length) + suf;
  }
  folosite.add(n.toLowerCase());
  return n;
}

function dataAzi() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date());
}

export async function exportaStocMateriiPrime(): Promise<void> {
  const [{ data: fermeData, error: errF }, { data: mpData, error: errM }] = await Promise.all([
    supabase.from('ferme').select('id,nume').order('nume'),
    supabase.from('materii_prime').select('nume,unitate_masura,stoc_curent,pret_unitar,ferma_id').order('nume'),
  ]);
  if (errF) throw new Error(`Eroare la citirea fermelor: ${errF.message}`);
  if (errM) throw new Error(`Eroare la citirea materiilor prime: ${errM.message}`);

  const ferme = (fermeData as Ferma[]) ?? [];
  const randuri = ((mpData as Rand[]) ?? []).map((r) => ({
    ...r,
    stoc_curent: r.stoc_curent === null ? 0 : Number(r.stoc_curent),
    pret_unitar: r.pret_unitar === null ? null : Number(r.pret_unitar),
  }));

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rulouri de Gazon — aplicație ferme';
  wb.created = new Date();

  const azi = dataAzi();
  const [an, luna, zi] = azi.split('-');
  const dataRo = `${zi}.${luna}.${an}`;
  const folosite = new Set<string>();

  const stilAntet = (row: import('exceljs').Row) => {
    row.font = { bold: true };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F3E8' } };
      c.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
    });
  };

  // ── Centralizator (completat după foile pe fermă) ─────────────────────────
  const wsC = wb.addWorksheet(numeFoaie('Centralizator', folosite));
  wsC.columns = [{ width: 30 }, { width: 14 }, { width: 20 }];
  wsC.addRow([`Stoc materii prime pe ferme — la ${dataRo}`]).font = { bold: true, size: 14 };
  wsC.addRow([]);
  stilAntet(wsC.addRow(['Fermă', 'Nr. articole', 'Valoare stoc (lei)']));
  const legaturiCentralizator: { ferma: string; foaie: string; nr: number; randTotal: number }[] = [];

  // ── O foaie pe fermă ──────────────────────────────────────────────────────
  for (const f of ferme) {
    const lista = randuri.filter((r) => r.ferma_id === f.id);
    const numeWs = numeFoaie(f.nume, folosite);
    const ws = wb.addWorksheet(numeWs);
    ws.columns = [{ width: 6 }, { width: 58 }, { width: 18 }, { width: 7 }, { width: 14 }, { width: 16 }, { width: 18 }];
    ws.addRow([`Stoc materii prime — ${f.nume} — la ${dataRo}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    const antet = ws.addRow(['Nr.', 'Denumire', 'Cod', 'UM', 'Stoc curent', 'Preț unitar (lei)', 'Valoare (lei)']);
    stilAntet(antet);
    const primulRand = antet.number + 1;

    lista.forEach((r, i) => {
      const { denumire, cod } = extrageCod(r.nume);
      const row = ws.addRow([i + 1, denumire, cod, r.unitate_masura, r.stoc_curent, r.pret_unitar, null]);
      row.getCell(7).value =
        r.pret_unitar === null ? null : { formula: `E${row.number}*F${row.number}`, result: r.stoc_curent * r.pret_unitar };
      row.getCell(5).numFmt = FORMAT_CANT;
      row.getCell(6).numFmt = FORMAT_LEI;
      row.getCell(7).numFmt = FORMAT_LEI;
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    });

    const ultimulRand = primulRand + lista.length - 1;
    const valoare = lista.reduce((s, r) => s + (r.pret_unitar === null ? 0 : r.stoc_curent * r.pret_unitar), 0);
    let randTotal = 0;
    if (lista.length === 0) {
      ws.addRow(['', 'Fără materii prime în gestiune.']).font = { italic: true, color: { argb: 'FF777777' } };
    } else {
      const tot = ws.addRow(['', 'TOTAL', '', '', '', '', { formula: `SUM(G${primulRand}:G${ultimulRand})`, result: valoare }]);
      tot.font = { bold: true };
      tot.getCell(7).numFmt = FORMAT_LEI;
      tot.getCell(7).border = { top: { style: 'thin' } };
      randTotal = tot.number;
      ws.autoFilter = { from: { row: antet.number, column: 1 }, to: { row: ultimulRand, column: 7 } };
    }
    ws.views = [{ state: 'frozen', ySplit: antet.number }];
    const faraPret = lista.filter((r) => r.pret_unitar === null).length;
    if (faraPret > 0) {
      ws.addRow([]);
      ws.addRow(['', `${faraPret} articol(e) fără preț unitar — nu intră în valoare.`]).font = { italic: true, color: { argb: 'FFB00020' } };
    }
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

    legaturiCentralizator.push({ ferma: f.nume, foaie: numeWs, nr: lista.length, randTotal });
  }

  // completăm centralizatorul cu formule către foile fermelor
  const primulC = wsC.rowCount + 1;
  for (const l of legaturiCentralizator) {
    const ref = `'${l.foaie.replace(/'/g, "''")}'!G${l.randTotal}`;
    const valFerma = randuri
      .filter((r) => ferme.find((f) => f.nume === l.ferma)?.id === r.ferma_id)
      .reduce((s, r) => s + (r.pret_unitar === null ? 0 : r.stoc_curent * r.pret_unitar), 0);
    const row = wsC.addRow([l.ferma, l.nr, l.randTotal ? { formula: ref, result: valFerma } : 0]);
    row.getCell(3).numFmt = FORMAT_LEI;
  }
  const ultimulC = wsC.rowCount;
  const totalGeneral = randuri.reduce((s, r) => s + (r.pret_unitar === null ? 0 : r.stoc_curent * r.pret_unitar), 0);
  const totC = wsC.addRow([
    'TOTAL',
    { formula: `SUM(B${primulC}:B${ultimulC})`, result: randuri.filter((r) => r.ferma_id).length },
    { formula: `SUM(C${primulC}:C${ultimulC})`, result: totalGeneral },
  ]);
  totC.font = { bold: true };
  totC.getCell(3).numFmt = FORMAT_LEI;

  // ── Toate fermele (listă plată) ───────────────────────────────────────────
  const wsT = wb.addWorksheet(numeFoaie('Toate fermele', folosite));
  wsT.columns = [{ width: 24 }, { width: 58 }, { width: 18 }, { width: 7 }, { width: 14 }, { width: 16 }, { width: 18 }];
  const antetT = wsT.addRow(['Fermă', 'Denumire', 'Cod', 'UM', 'Stoc curent', 'Preț unitar (lei)', 'Valoare (lei)']);
  stilAntet(antetT);
  const numeFerma = new Map(ferme.map((f) => [f.id, f.nume]));
  const sortate = [...randuri].sort((a, b) =>
    (numeFerma.get(a.ferma_id ?? '') ?? '').localeCompare(numeFerma.get(b.ferma_id ?? '') ?? '', 'ro') || a.nume.localeCompare(b.nume, 'ro'),
  );
  for (const r of sortate) {
    const { denumire, cod } = extrageCod(r.nume);
    const row = wsT.addRow([numeFerma.get(r.ferma_id ?? '') ?? '(fără fermă)', denumire, cod, r.unitate_masura, r.stoc_curent, r.pret_unitar, null]);
    row.getCell(7).value =
      r.pret_unitar === null ? null : { formula: `E${row.number}*F${row.number}`, result: r.stoc_curent * r.pret_unitar };
    row.getCell(5).numFmt = FORMAT_CANT;
    row.getCell(6).numFmt = FORMAT_LEI;
    row.getCell(7).numFmt = FORMAT_LEI;
  }
  if (sortate.length > 0) {
    wsT.autoFilter = { from: { row: 1, column: 1 }, to: { row: wsT.rowCount, column: 7 } };
  }
  wsT.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Descărcare ────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stoc-materii-prime-${azi}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
