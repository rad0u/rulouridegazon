'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';
import { Parcela, polygonLatLngs } from '../../lib/parcelaTypes';

// 2026-11-11 (Radu): „în rapoarte vreau un buton care să-mi dea un listing cu
// Ferme–Parcele–Suprafețe măsurate la zi" — pagină printabilă A4 (aceeași
// tehnică de tipărire ca la Inventar masă verde: raportul `.raport-lst` e
// copil DIRECT al `.rapoarte-ecran`, iar la tipărire se ascunde orice alt copil
// direct). Suprafața e `parcele.suprafata_mp` (actualizată de importul
// SW Maps / desenarea pe hartă). Decizie Radu (11.11): listingul conține DOAR
// parcelele cu contur GPS valid (măsurate); intrările fără contur (seed/test
// vechi) sunt excluse, cu o notă în raport cu numărul lor.

// 2026-11-11 (Radu): „pentru contabilitate, pentru a stabili producția în curs de
// execuție — vreau să evidențiez parcelele pe care se execută lucrări [...]
// parcele pe care au lucrat utilajele anul ăsta; dacă n-au fost lucrări
// detectate, înseamnă că nu este producție în execuție. Exemplu P4 de la
// Bobicești". Criteriu: orele de lucru ale utilajelor confirmate pe parcelă în
// anul curent (durata sesiunilor GPS din `operatiuni`; la operațiunile manuale,
// fără sesiune, `ore_lucru`). Sub PRAG_ORE_LUCRARI parcela NU e considerată în
// lucru — P4 Bobicești are doar 2 treceri de ~12 minute (0,4 h în total), deci
// simple traversări. Rândurile „în lucru" sunt evidențiate (fundal verde + DA).
// Prag ridicat de la 1 h la 3 h (Radu, 11.11.2026: „e mult prea puțin 1h în 2 luni").
const PRAG_ORE_LUCRARI = 3;

type RandOperatiune = {
  parcela_id: string;
  ore_lucru: number | null;
  sesiune_inceput: string | null;
  sesiune_sfarsit: string | null;
};

// Orele de lucru confirmate pe fiecare parcelă de la 1 ianuarie al anului dat
// (paginat: Supabase întoarce cel mult 1000 de rânduri pe cerere).
async function oreLucrariPeParcele(an: number): Promise<{ ore: Map<string, number>; error: string | null }> {
  const ore = new Map<string, number>();
  const PAGINA = 1000;
  for (let from = 0; ; from += PAGINA) {
    const { data, error } = await supabase
      .from('operatiuni')
      .select('parcela_id,ore_lucru,sesiune_inceput,sesiune_sfarsit')
      .gte('data', `${an}-01-01`)
      .lte('data', `${an}-12-31`)
      .order('id')
      .range(from, from + PAGINA - 1);
    if (error) return { ore, error: error.message };
    const randuri = (data as RandOperatiune[]) ?? [];
    for (const r of randuri) {
      let h = 0;
      if (r.sesiune_inceput && r.sesiune_sfarsit) {
        h = (new Date(r.sesiune_sfarsit).getTime() - new Date(r.sesiune_inceput).getTime()) / 3_600_000;
      } else if (r.ore_lucru !== null) {
        h = Number(r.ore_lucru);
      }
      if (h > 0) ore.set(r.parcela_id, (ore.get(r.parcela_id) ?? 0) + h);
    }
    if (randuri.length < PAGINA) break;
  }
  return { ore, error: null };
}

const ETICHETE_FERME: Record<string, { numar: string; nume: string }> = {
  Medgidia: { numar: 'F1', nume: 'Medgidia' },
  'Holboca (Iași)': { numar: 'F2', nume: 'Holboca (Iași)' },
  'Bobicești (Craiova)': { numar: 'F3', nume: 'Bobicești (Craiova)' },
  Timișoara: { numar: 'F4', nume: 'Sânpetru (Timișoara)' },
  Săbăreni: { numar: 'F5', nume: 'Săbăreni' },
};

type RandParcela = {
  id: string;
  nume: string;
  tipGazon: string | null;
  mp: number;
  inLucru: boolean;
};

type BlocFerma = {
  id: string;
  numar: string | null;
  nume: string;
  parcele: RandParcela[];
  totalMp: number;
  excluse: number;
};

const nf0 = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function mp(n: number) {
  return nf0.format(Math.round(n));
}
function ha(n: number) {
  return nf2.format(n / 10000);
}

const STIL = `
  .raport-lst { color: #000; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-top: 1rem; }
  .raport-lst h2 { margin: 0; font-size: 16pt; text-align: center; }
  .raport-lst .lst-antet { display: flex; justify-content: space-between; gap: 12px; margin: 6px 0 10px; font-size: 10pt; }
  .raport-lst .lst-bloc { margin-top: 12px; break-inside: avoid; page-break-inside: avoid; }
  .raport-lst .lst-bloc-titlu { background: #eee; border: 1px solid #000; border-bottom: none; padding: 4px 8px; font-weight: bold; font-size: 11pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .raport-lst table { width: 100%; border-collapse: collapse; }
  .raport-lst th, .raport-lst td { border: 1px solid #000; padding: 3px 6px; font-size: 10pt; text-align: left; }
  .raport-lst th { background: #f4f4f4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .raport-lst .dr { text-align: right; }
  .raport-lst .total td { font-weight: bold; background: #f4f4f4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .raport-lst tr.lucru td { background: #dff0d8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .raport-lst .legenda-lucru { display: inline-block; width: 14px; height: 10px; background: #dff0d8; border: 1px solid #000; margin-right: 5px; vertical-align: -1px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .raport-lst .mic { font-size: 8.5pt; color: #333; margin-top: 4px; }
  @media print {
    @page { size: A4 portrait; margin: 10mm; }
    body { background: #fff !important; }
    header { display: none !important; }
    body div:has(> header) { display: block !important; min-height: 0 !important; }
    main { display: block !important; min-height: 0 !important; padding: 0 !important; }
    .rapoarte-ecran > *:not(.raport-lst) { display: none !important; }
    .raport-lst { border: none; padding: 0 2px 0 0; margin: 0; border-radius: 0; box-sizing: border-box; width: 100%; }
  }
`;

export default function RapoarteScreen() {
  const { role, loading: roleLoading } = useUserRole();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocuri, setBlocuri] = useState<BlocFerma[] | null>(null);
  const [generatLa, setGeneratLa] = useState<Date | null>(null);
  const [anLucrari, setAnLucrari] = useState<number>(new Date().getFullYear());

  async function genereaza() {
    setLoading(true);
    setError(null);

    const [{ data: ferme, error: errF }, { data: parcele, error: errP }] = await Promise.all([
      supabase.from('ferme').select('id,nume').order('nume'),
      supabase.from('parcele').select('id,ferma_id,nume,tip_gazon,stadiu,suprafata_mp,poligon_harta'),
    ]);

    const an = new Date().getFullYear();
    const { ore: orePeParcela, error: errO } = await oreLucrariPeParcele(an);

    setLoading(false);
    if (errF || errP || errO) {
      setError(errF?.message ?? errP?.message ?? errO ?? 'Eroare la citirea datelor.');
      return;
    }
    setAnLucrari(an);

    const listaParcele = (parcele as Parcela[]) ?? [];
    const rezultat: BlocFerma[] = ((ferme as { id: string; nume: string }[]) ?? []).map((f) => {
      const et = ETICHETE_FERME[f.nume];
      const randuri: RandParcela[] = listaParcele
        .filter((p) => p.ferma_id === f.id && polygonLatLngs(p).length > 0)
        .map((p) => ({
          id: p.id,
          nume: p.nume,
          tipGazon: p.tip_gazon,
          mp: Number(p.suprafata_mp ?? 0),
          inLucru: (orePeParcela.get(p.id) ?? 0) >= PRAG_ORE_LUCRARI,
        }))
        .sort((a, b) => a.nume.localeCompare(b.nume, 'ro', { numeric: true, sensitivity: 'base' }));
      return {
        id: f.id,
        numar: et?.numar ?? null,
        nume: et?.nume ?? f.nume,
        parcele: randuri,
        totalMp: randuri.reduce((acc, r) => acc + r.mp, 0),
        excluse: listaParcele.filter((p) => p.ferma_id === f.id && polygonLatLngs(p).length === 0).length,
      };
    });

    rezultat.sort((a, b) => {
      if (a.numar && b.numar) return a.numar.localeCompare(b.numar);
      if (a.numar) return -1;
      if (b.numar) return 1;
      return a.nume.localeCompare(b.nume);
    });

    setBlocuri(rezultat);
    setGeneratLa(new Date());
  }

  // Listingul se generează automat la deschiderea paginii (din meniu sau din
  // cardul „Listing parcele" de pe Dashboard); butonul rămâne pentru regenerare.
  useEffect(() => {
    if (role === 'admin_central') void genereaza();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  if (roleLoading) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Se verifică accesul...</p>
      </main>
    );
  }
  if (role !== 'admin_central') {
    return (
      <main style={{ padding: '2rem' }}>
        <h1>Acces interzis</h1>
        <p>Această secțiune este disponibilă doar pentru admin general.</p>
      </main>
    );
  }

  const totalGeneral = (blocuri ?? []).reduce((acc, b) => acc + b.totalMp, 0);
  const nrParcele = (blocuri ?? []).reduce((acc, b) => acc + b.parcele.length, 0);
  const nrExcluse = (blocuri ?? []).reduce((acc, b) => acc + b.excluse, 0);

  return (
    <main style={{ padding: 'clamp(1rem, 4vw, 2rem)', maxWidth: '1000px', margin: '0 auto' }}>
      <style dangerouslySetInnerHTML={{ __html: STIL }} />
      <div className="rapoarte-ecran">
        <div>
          <h1 style={{ margin: '0.25rem 0' }}>Rapoarte</h1>
          <p style={{ color: '#666', marginTop: 0 }}>
            Listing Ferme – Parcele – Suprafețe măsurate, la zi, cu totaluri pe fermă și general. Se tipărește pe A4.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => void genereaza()}
            disabled={loading}
            style={{ padding: '0.6rem 1.2rem', fontWeight: 600, borderRadius: '6px', border: '1px solid #ccc', background: '#eaf7ea' }}
          >
            {loading ? 'Se generează...' : 'Listing Ferme – Parcele – Suprafețe'}
          </button>
          {blocuri && (
            <button
              onClick={() => window.print()}
              style={{ padding: '0.6rem 1.2rem', fontWeight: 600, borderRadius: '6px', border: '1px solid #ccc', background: '#f5f5f5' }}
            >
              Tipărește (A4)
            </button>
          )}
        </div>

        {error && <p style={{ color: '#b00020' }}>{error}</p>}

        {blocuri && generatLa && (
          <section className="raport-lst">
            <h2>LISTING FERME — PARCELE — SUPRAFEȚE MĂSURATE</h2>
            <div className="lst-antet">
              <div>
                <strong>La data:</strong> {generatLa.toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' })}
              </div>
              <div>
                <strong>Total general:</strong> {mp(totalGeneral)} mp ({ha(totalGeneral)} ha) · {nrParcele} parcele
              </div>
            </div>

            {blocuri.map((b) => (
              <div className="lst-bloc" key={b.id}>
                <div className="lst-bloc-titlu">
                  {b.numar ? `${b.numar} — ` : ''}
                  {b.nume}
                </div>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '6%' }}>Nr.</th>
                      <th>Parcelă</th>
                      <th>Cultură</th>
                      <th className="dr">Suprafață (mp)</th>
                      <th className="dr">Suprafață (ha)</th>
                      <th style={{ width: '14%' }}>Lucrări {anLucrari}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.parcele.length === 0 && (
                      <tr>
                        <td colSpan={6}>Nicio parcelă cu contur măsurat.</td>
                      </tr>
                    )}
                    {b.parcele.map((p, i) => (
                      <tr key={p.id} className={p.inLucru ? 'lucru' : undefined}>
                        <td>{i + 1}</td>
                        <td>{p.nume}</td>
                        <td>{p.tipGazon ?? ''}</td>
                        <td className="dr">{mp(p.mp)}</td>
                        <td className="dr">{ha(p.mp)}</td>
                        <td>{p.inLucru ? 'DA' : ''}</td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={3}>Total {b.numar ?? b.nume}</td>
                      <td className="dr">{mp(b.totalMp)}</td>
                      <td className="dr">{ha(b.totalMp)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}

            <div className="lst-bloc">
              <div className="lst-bloc-titlu">Total general</div>
              <table>
                <thead>
                  <tr>
                    <th>Fermă</th>
                    <th className="dr">Parcele</th>
                    <th className="dr">Suprafață (mp)</th>
                    <th className="dr">Suprafață (ha)</th>
                  </tr>
                </thead>
                <tbody>
                  {blocuri.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {b.numar ? `${b.numar} — ` : ''}
                        {b.nume}
                      </td>
                      <td className="dr">{b.parcele.length}</td>
                      <td className="dr">{mp(b.totalMp)}</td>
                      <td className="dr">{ha(b.totalMp)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>TOTAL</td>
                    <td className="dr">{nrParcele}</td>
                    <td className="dr">{mp(totalGeneral)}</td>
                    <td className="dr">{ha(totalGeneral)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mic">
                <span className="legenda-lucru" />
                Rând evidențiat + „DA" = parcelă pe care au lucrat utilajele în {anLucrari} (producție în curs de execuție);
                parcelele neevidențiate nu au lucrări detectate în {anLucrari}.
              </p>
              <p className="mic">
                Sunt incluse doar parcelele cu contur GPS măsurat (suprafața importată din SW Maps sau desenată pe hartă).
                {nrExcluse > 0
                  ? ` ${nrExcluse} intrări fără contur valid nu sunt incluse în listing.`
                  : ''}
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
