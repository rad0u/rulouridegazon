'use client';

// 2026-11-17 (Radu): „Rapoarte – Consumuri lunare". Alegi ferma și luna →
// raport cu tot ce s-a consumat pe fiecare parcelă: motorină, fertilizanți /
// tratamente, materii prime (+ ore de lucru, mp recoltați, valori în lei).
// Tipărire A4 (aceeași tehnică ca „Rapoarte": raportul e copil DIRECT al
// `.consumuri-ecran`, iar la tipărire restul copiilor se ascund) și export
// Excel. Logica de încărcare + exportul: lib/consumuriLunare.ts. Doar
// admin_central (motorina pe parcele vine din get-combustibil-parcele, care
// e doar pentru admin general).

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';
import {
  exportaConsumuriExcel,
  incarcaConsumuriLunare,
  incarcaLunaInchisa,
  inchideLuna,
  redeschideLuna,
  aplicaPretMotorina,
  type LinieMaterial,
  type LinieMotorina,
  type RaportConsumuri,
} from '../../lib/consumuriLunare';

const STIL = `
  .raport-cl { border: 1px solid #ddd; border-radius: 8px; padding: 1.25rem; background: #fff; }
  .raport-cl h2 { margin: 0 0 0.2rem; font-size: 1.3rem; }
  .raport-cl h3 { margin: 1.1rem 0 0.4rem; font-size: 1rem; }
  .raport-cl table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .raport-cl th, .raport-cl td { padding: 0.28rem 0.4rem; border-bottom: 1px solid #e5e5e5; text-align: left; vertical-align: top; }
  .raport-cl th { background: #f3f8f3; font-weight: 600; }
  .raport-cl td.n, .raport-cl th.n { text-align: right; white-space: nowrap; }
  .raport-cl tr.tot td { font-weight: 700; border-top: 2px solid #999; }
  .raport-cl .parcela { border: 1px solid #ddd; border-radius: 6px; padding: 0.7rem 0.8rem; margin: 0.8rem 0; break-inside: avoid; page-break-inside: avoid; }
  .raport-cl .parcela-cap { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.3rem; }
  .raport-cl .sub { font-size: 0.8rem; font-weight: 600; color: #555; margin: 0.5rem 0 0.15rem; text-transform: uppercase; letter-spacing: 0.03em; }
  .raport-cl .gri { color: #777; font-size: 0.8rem; }
  .raport-cl .neconf td { color: #8a5a00; font-style: italic; }
  .raport-cl .avert { color: #8a5a00; background: #fff6e0; padding: 0.45rem 0.6rem; border-radius: 5px; margin: 0.3rem 0; font-size: 0.85rem; }
  @media print {
    @page { size: A4 portrait; margin: 10mm; }
    body { background: #fff !important; }
    header { display: none !important; }
    body div:has(> header) { display: block !important; min-height: 0 !important; }
    main { display: block !important; min-height: 0 !important; padding: 0 !important; max-width: none !important; }
    .consumuri-ecran > *:not(.raport-cl) { display: none !important; }
    .raport-cl { border: none; padding: 0; border-radius: 0; font-size: 10pt; }
    .raport-cl table { font-size: 8.5pt; }
    .raport-cl .sumar { break-after: page; page-break-after: always; }
  }
`;

const nf0 = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfq = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 3 });
// 2026-11-17: peste 60 L/h (sau > 30 L în sub 0,5 h) = aproape sigur eroare de sondă.
function consumSuspect(litri: number | null, ore: number) {
  if (litri === null || litri <= 0) return false;
  if (ore < 0.5) return litri > 30;
  return litri / ore > 60;
}
const lei = (n: number | null) => (n === null ? '—' : `${nf2.format(n)} lei`);

function lunaTrecuta() {
  const azi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date());
  const [an, l] = azi.split('-').map(Number);
  const d = new Date(Date.UTC(an, l - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function TabelMotorina({ linii, pret, neconfirmat }: { linii: LinieMotorina[]; pret: number | null; neconfirmat?: boolean }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Utilaj</th>
          <th className="n">Ore</th>
          <th className="n">Litri</th>
          {!neconfirmat && <th className="n">Valoare</th>}
        </tr>
      </thead>
      <tbody>
        {linii.map((m) => (
          <tr key={m.utilaj} className={neconfirmat ? 'neconf' : undefined}>
            <td>
              {m.utilaj}
              {m.litri === null && <span className="gri"> (fără senzor calibrat)</span>}
              {m.estimat && (
                <span style={{ color: '#8a5a00' }}>
                  {' '}
                  * aproximat: {nf1.format(m.estimat.lph)} L/h × ore (media {m.estimat.referinta})
                </span>
              )}
              {!m.estimat && consumSuspect(m.litri, m.ore) && <span style={{ color: '#b00020' }}> ⚠ consum suspect — verifică senzorul</span>}
            </td>
            <td className="n">{nf1.format(m.ore)}</td>
            <td className="n">{m.litri === null ? '—' : `${m.estimat ? '≈ ' : ''}${nf1.format(m.litri)}`}</td>
            {!neconfirmat && <td className="n">{m.litri === null || pret === null ? '—' : lei(m.litri * pret)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabelMaterial({ linii }: { linii: LinieMaterial[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Articol</th>
          <th>UM</th>
          <th className="n">Cantitate</th>
          <th className="n">Valoare</th>
        </tr>
      </thead>
      <tbody>
        {linii.map((m) => (
          <tr key={`${m.nume}|${m.um}`}>
            <td>
              {m.nume}
              {m.cod && <span className="gri"> · {m.cod}</span>}
              {m.pretAproximat && <span style={{ color: '#8a5a00' }}> * preț aproximat</span>}
            </td>
            <td>{m.um}</td>
            <td className="n">{nfq.format(m.cantitate)}</td>
            <td className="n">{lei(m.valoare)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ConsumuriLunareScreen() {
  const { role, loading: roleLoading } = useUserRole();
  const [ferme, setFerme] = useState<{ id: string; nume: string }[]>([]);
  const [fermaId, setFermaId] = useState('');
  const [luna, setLuna] = useState(lunaTrecuta());
  const [raportBrut, setRaportBrut] = useState<RaportConsumuri | null>(null);
  // 2026-11-23 (Radu): preț motorină introdus manual (lei/L), când ferma nu are achiziții cu preț
  const [pretManual, setPretManual] = useState('');
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [inchidereLoading, setInchidereLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== 'admin_central') return;
    void supabase
      .from('ferme')
      .select('id,nume')
      .order('nume')
      .then(({ data }) => setFerme((data as { id: string; nume: string }[]) ?? []));
  }, [role]);

  async function genereaza() {
    if (!fermaId) return setError('Alege o fermă.');
    if (!/^\d{4}-\d{2}$/.test(luna)) return setError('Alege luna.');
    setLoading(true);
    setError(null);
    setRaportBrut(null);
    try {
      // 2026-11-25: o lună închisă se afișează exact cum a fost trimisă la contabilitate.
      const inchisa = await incarcaLunaInchisa(fermaId, luna);
      if (inchisa) {
        setRaportBrut(inchisa);
        setPretManual('');
        return;
      }
      const r = await incarcaConsumuriLunare(fermaId, luna);
      setRaportBrut(r);
      // ultimul preț manual folosit pentru ferma asta (doar când nu există preț din achiziții)
      let salvat = '';
      try {
        salvat = r.pretMotorinaAchizitii === null ? localStorage.getItem(`pretMotorinaManual:${fermaId}`) ?? '' : '';
      } catch {
        salvat = '';
      }
      setPretManual(salvat);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const pretNumar = (() => {
    const t = pretManual.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : NaN;
  })();
  const raport = raportBrut
    ? raportBrut.inchis
      ? raportBrut // înghețat: prețul motorinei e deja cel folosit la închidere
      : aplicaPretMotorina(raportBrut, pretNumar === null || Number.isNaN(pretNumar) ? null : pretNumar)
    : null;

  async function inchide() {
    if (!raport || raport.inchis) return;
    const neconf = raport.totaluri.litriNeconfirmati > 0 || raport.parcele.some((p) => p.motorinaNeconfirmata.length > 0);
    const mesaj =
      `Închizi ${raport.lunaText} pentru ${raport.fermaNume}?\n\n` +
      'Cifrele se îngheață exact cum sunt acum (inclusiv prețul motorinei) și nu se mai schimbă la corecții ulterioare, până la redeschidere.' +
      (neconf ? '\n\nATENȚIE: există sesiuni GPS NECONFIRMATE în lună — motorina lor NU intră în cifrele închise. Confirmă-le întâi în Activități parcele.' : '') +
      (raport.pretMotorina === null ? '\n\nATENȚIE: motorina nu are preț — valoarea ei va lipsi din raportul închis.' : '');
    if (!window.confirm(mesaj)) return;
    setInchidereLoading(true);
    setError(null);
    try {
      await inchideLuna(raport);
      setRaportBrut(await incarcaLunaInchisa(raport.fermaId, raport.luna));
    } catch (e) {
      setError(`Luna nu s-a putut închide: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInchidereLoading(false);
    }
  }

  async function redeschide() {
    if (!raport?.inchis) return;
    if (!window.confirm(`Redeschizi ${raport.lunaText} pentru ${raport.fermaNume}? Raportul se va recalcula din datele curente — anunță contabilitatea dacă cifrele trimise se schimbă.`)) return;
    setInchidereLoading(true);
    setError(null);
    try {
      await redeschideLuna(raport.fermaId, raport.luna);
      setRaportBrut(null);
      await genereaza();
    } catch (e) {
      setError(`Luna nu s-a putut redeschide: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInchidereLoading(false);
    }
  }

  function schimbaPret(v: string) {
    setPretManual(v);
    try {
      if (fermaId) localStorage.setItem(`pretMotorinaManual:${fermaId}`, v);
    } catch {
      /* fără stocare locală — nu contează */
    }
  }

  async function exporta() {
    if (!raport) return;
    setExportLoading(true);
    try {
      await exportaConsumuriExcel(raport);
    } catch (e) {
      setError(`Exportul Excel a eșuat: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportLoading(false);
    }
  }

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

  const btn: React.CSSProperties = { padding: '0.6rem 1.2rem', fontWeight: 600, borderRadius: '6px', border: '1px solid #ccc', cursor: 'pointer' };
  const cuConsum = raport?.parcele.filter((p) => p.areConsum) ?? [];
  const faraConsum = raport?.parcele.filter((p) => !p.areConsum) ?? [];
  const t = raport?.totaluri;

  return (
    <main style={{ padding: 'clamp(1rem, 4vw, 2rem)', maxWidth: '1100px', margin: '0 auto' }}>
      <style dangerouslySetInnerHTML={{ __html: STIL }} />
      <div className="consumuri-ecran">
        <div>
          <h1 style={{ margin: '0.25rem 0' }}>Consumuri lunare</h1>
          <p style={{ color: '#666', marginTop: 0 }}>
            Tot ce s-a consumat pe fiecare parcelă a fermei, în luna aleasă: motorină, fertilizanți și tratamente, materii prime — cu
            ore de lucru, mp recoltați și valori în lei. Se tipărește pe A4 sau se exportă în Excel.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', margin: '1rem 0' }}>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem' }}>
            Ferma
            <select value={fermaId} onChange={(e) => setFermaId(e.target.value)} style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '180px' }}>
              <option value="">Alege ferma</option>
              {ferme.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nume}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem' }}>
            Luna
            <input type="month" value={luna} onChange={(e) => setLuna(e.target.value)} style={{ padding: '0.45rem', borderRadius: '6px', border: '1px solid #ccc' }} />
          </label>
          <button onClick={() => void genereaza()} disabled={loading} style={{ ...btn, background: '#eaf7ea', cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? 'Se calculează... (până la un minut)' : 'Generează'}
          </button>
          {raport && (
            <>
              <button onClick={() => window.print()} style={{ ...btn, background: '#f5f5f5' }}>
                Tipărește (A4)
              </button>
              <button onClick={() => void exporta()} disabled={exportLoading} style={{ ...btn, background: '#f5f5f5' }}>
                {exportLoading ? 'Se generează...' : 'Export Excel'}
              </button>
              {raport.inchis ? (
                <button onClick={() => void redeschide()} disabled={inchidereLoading} style={{ ...btn, background: '#fff6e0' }}>
                  {inchidereLoading ? '...' : 'Redeschide luna'}
                </button>
              ) : (
                <button onClick={() => void inchide()} disabled={inchidereLoading} style={{ ...btn, background: '#e3f0ff' }}>
                  {inchidereLoading ? 'Se închide...' : 'Închide luna (trimis la contabilitate)'}
                </button>
              )}
            </>
          )}
        </div>

        {error && <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>}

        {raportBrut?.inchis && (
          <p style={{ background: '#eaf7ea', border: '1px solid #b7dcb7', padding: '0.6rem 0.8rem', borderRadius: '6px', margin: '0 0 1rem' }}>
            <strong>Lună închisă</strong> la {raportBrut.inchis.la}
            {raportBrut.inchis.de ? ` de ${raportBrut.inchis.de}` : ''} — cifrele sunt înghețate exact cum au fost trimise la contabilitate.
          </p>
        )}

        {raportBrut && !raportBrut.inchis && (
          <div
            style={{
              display: 'flex',
              gap: '0.6rem',
              flexWrap: 'wrap',
              alignItems: 'center',
              margin: '0 0 1rem',
              padding: '0.6rem 0.8rem',
              borderRadius: '6px',
              background: raportBrut.pretMotorinaAchizitii === null && pretNumar === null ? '#fff4e5' : '#f5f5f5',
              border: '1px solid #e0c9a6',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Preț motorină (lei/L)
              <input
                type="text"
                inputMode="decimal"
                value={pretManual}
                onChange={(e) => schimbaPret(e.target.value)}
                placeholder={raportBrut.pretMotorinaAchizitii !== null ? nf2.format(raportBrut.pretMotorinaAchizitii) : 'ex. 7,20'}
                style={{ width: '90px', padding: '0.4rem', borderRadius: '6px', border: '1px solid #ccc' }}
              />
            </label>
            <span style={{ fontSize: '0.8rem', color: '#555' }}>
              {pretNumar !== null && Number.isNaN(pretNumar)
                ? 'Preț invalid — scrie un număr mai mare ca 0.'
                : raportBrut.pretMotorinaAchizitii === null
                  ? pretNumar === null
                    ? 'Ferma nu are achiziții de motorină cu preț — introdu prețul ca să se calculeze valorile.'
                    : 'Preț introdus manual — se folosește în raport, la tipărire și în Excel.'
                  : pretNumar === null
                    ? `Se folosește prețul mediu de achiziție (${nf2.format(raportBrut.pretMotorinaAchizitii)} lei/L). Poți scrie alt preț.`
                    : 'Preț introdus manual, în locul prețului mediu de achiziție.'}
            </span>
            {pretManual !== '' && (
              <button onClick={() => schimbaPret('')} style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem' }}>
                Șterge
              </button>
            )}
          </div>
        )}

        {raport && t && (
          <div className="raport-cl">
            <div className="sumar">
              <h2>
                Consumuri lunare — {raport.fermaNume} — {raport.lunaText}
              </h2>
              <p className="gri" style={{ margin: '0 0 0.6rem' }}>
                Perioada {raport.deLa} – {raport.panaLa} · generat {raport.generatLa}
                {raport.inchis && ` · LUNĂ ÎNCHISĂ (${raport.inchis.la})`}
                {raport.pretMotorina !== null &&
                  ` · motorină ${nf2.format(raport.pretMotorina)} lei/L (${raport.pretMotorinaManual ? 'preț introdus manual' : 'preț mediu de achiziție'})`}
              </p>
              {raport.avertismente.map((a, i) => (
                <div key={i} className="avert">
                  {a}
                </div>
              ))}

              <h3>Sumar pe parcele</h3>
              <table>
                <thead>
                  <tr>
                    <th>Parcelă</th>
                    <th>Ciclu</th>
                    <th className="n">Ore lucru</th>
                    <th className="n">Motorină (L)</th>
                    <th className="n">Motorină</th>
                    <th className="n">Fertilizanți</th>
                    <th className="n">Materii prime</th>
                    <th className="n">Directe manuale</th>
                    <th className="n">Total</th>
                    <th className="n">Recoltat (mp)</th>
                    <th className="n">Masă verde (mp)</th>
                  </tr>
                </thead>
                <tbody>
                  {cuConsum.map((p) => (
                    <tr key={p.id}>
                      <td>{p.nume}</td>
                      <td className="gri">{p.ciclu ? `din ${p.ciclu.dataStart}${p.ciclu.complet ? '' : ' · incomplet'}` : 'fără ciclu'}</td>
                      <td className="n">{nf1.format(p.oreLucru)}</td>
                      <td className="n">{nf1.format(p.litri)}</td>
                      <td className="n">{lei(p.valoareMotorina)}</td>
                      <td className="n">{lei(p.valoareSubstante)}</td>
                      <td className="n">{lei(p.valoareMateriiPrime)}</td>
                      <td className="n">{p.valoareDirecteManuale ? lei(p.valoareDirecteManuale) : '—'}</td>
                      <td className="n">
                        <strong>{lei(p.valoareTotala)}</strong>
                      </td>
                      <td className="n">{p.mpRecoltat ? nf0.format(p.mpRecoltat) : '—'}</td>
                      <td className="n">{p.masaVerdeMp === null ? '—' : nf0.format(p.masaVerdeMp)}</td>
                    </tr>
                  ))}
                  {(raport.inAfara.length > 0 || t.litriInAfara > 0) && (
                    <tr>
                      <td>
                        <em>În afara parcelelor</em>
                      </td>
                      <td />
                      <td className="n">{nf1.format(raport.inAfara.reduce((s, l) => s + (l.ore ?? 0), 0))}</td>
                      <td className="n">{nf1.format(t.litriInAfara)}</td>
                      <td className="n">{raport.pretMotorina === null ? '—' : lei(t.litriInAfara * raport.pretMotorina)}</td>
                      <td className="n">—</td>
                      <td className="n">—</td>
                      <td className="n">—</td>
                      <td className="n">{raport.pretMotorina === null ? '—' : lei(t.litriInAfara * raport.pretMotorina)}</td>
                      <td className="n">—</td>
                      <td className="n">—</td>
                    </tr>
                  )}
                  <tr className="tot">
                    <td>TOTAL</td>
                    <td />
                    <td className="n">{nf1.format(t.oreLucru + raport.inAfara.reduce((s, l) => s + (l.ore ?? 0), 0))}</td>
                    <td className="n">{nf1.format(t.litri + t.litriInAfara)}</td>
                    <td className="n">{lei(t.valoareMotorina)}</td>
                    <td className="n">{lei(t.valoareSubstante)}</td>
                    <td className="n">{lei(t.valoareMateriiPrime)}</td>
                    <td className="n">{t.valoareDirecteManuale ? lei(t.valoareDirecteManuale) : '—'}</td>
                    <td className="n">{lei(t.valoareTotala)}</td>
                    <td className="n">{t.mpRecoltat ? nf0.format(t.mpRecoltat) : '—'}</td>
                    <td className="n">{t.masaVerdeMp ? nf0.format(t.masaVerdeMp) : '—'}</td>
                  </tr>
                </tbody>
              </table>
              {t.litriNeconfirmati > 0 && (
                <p className="gri">
                  + {nf1.format(t.litriNeconfirmati)} L motorină din sesiuni neconfirmate (orientativ, neincluse în total).
                </p>
              )}
              {faraConsum.length > 0 && <p className="gri">Parcele fără consumuri în lună: {faraConsum.map((p) => p.nume).join(', ')}.</p>}
              {(t.recoltatPeTip ?? []).length > 0 && (
                <p style={{ fontSize: '0.85rem' }}>
                  <strong>Recoltat pe tip gazon:</strong> {t.recoltatPeTip.map((x) => `${x.tip} ${nf0.format(x.mp)} mp`).join(' · ')}
                  {t.mpRecoltat - t.recoltatPeTip.reduce((s, x) => s + x.mp, 0) > 0 &&
                    ` · fără tip ${nf0.format(t.mpRecoltat - t.recoltatPeTip.reduce((s, x) => s + x.mp, 0))} mp`}
                </p>
              )}

              {(t.substante.length > 0 || t.materiiPrime.length > 0) && (
                <>
                  <h3>Total fermă pe articole</h3>
                  {t.substante.length > 0 && (
                    <>
                      <div className="sub">Fertilizanți și tratamente</div>
                      <TabelMaterial linii={t.substante} />
                    </>
                  )}
                  {t.materiiPrime.length > 0 && (
                    <>
                      <div className="sub">Materii prime</div>
                      <TabelMaterial linii={t.materiiPrime} />
                    </>
                  )}
                </>
              )}
            </div>

            <h3>Detaliu pe parcele</h3>
            {cuConsum.length === 0 && <p className="gri">Nicio parcelă cu consumuri în luna aleasă.</p>}
            {cuConsum.map((p) => (
              <div key={p.id} className="parcela">
                <div className="parcela-cap">
                  <strong style={{ fontSize: '1.05rem' }}>Parcela {p.nume}</strong>
                  <span className="gri">
                    {p.suprafataMp ? `${nf2.format(p.suprafataMp / 10000)} ha` : ''}
                    {p.cultura ? ` · ${p.cultura}` : ''}
                    {p.ciclu ? ` · ciclu din ${p.ciclu.dataStart}${p.ciclu.complet ? '' : ' (incomplet)'}` : ' · fără ciclu'}
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  <strong>{nf1.format(p.oreLucru)} h</strong> de lucru
                  {p.orePeTip.length > 0 && ` (${p.orePeTip.map((x) => `${x.tip} ${nf1.format(x.ore)} h`).join(' · ')})`}
                  {p.mpRecoltat > 0 && (
                    <>
                      {' · '}
                      <strong>{nf0.format(p.mpRecoltat)} mp</strong> recoltați
                      {(p.recoltatPeTip ?? []).length > 0 && ` (${p.recoltatPeTip.map((x) => `${x.tip} ${nf0.format(x.mp)}`).join(' · ')})`}
                    </>
                  )}
                  {p.masaVerdeMp !== null && (
                    <>
                      {' · masă verde '}
                      <strong>{nf0.format(p.masaVerdeMp)} mp</strong> (inventar {p.masaVerdeData})
                    </>
                  )}
                  {' · total consumuri '}
                  <strong>{lei(p.valoareTotala)}</strong>
                </div>

                {p.motorina.length > 0 && (
                  <>
                    <div className="sub">Motorină — {nf1.format(p.litri)} L</div>
                    <TabelMotorina linii={p.motorina} pret={raport.pretMotorina} />
                  </>
                )}
                {p.substante.length > 0 && (
                  <>
                    <div className="sub">Fertilizanți și tratamente — {lei(p.valoareSubstante)}</div>
                    <TabelMaterial linii={p.substante} />
                  </>
                )}
                {p.materiiPrime.length > 0 && (
                  <>
                    <div className="sub">Materii prime — {lei(p.valoareMateriiPrime)}</div>
                    <TabelMaterial linii={p.materiiPrime} />
                  </>
                )}
                {(p.directeManuale ?? []).length > 0 && (
                  <>
                    <div className="sub">Costuri directe manuale — {lei(p.valoareDirecteManuale)}</div>
                    <table>
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Categorie</th>
                          <th>Descriere</th>
                          <th>Document</th>
                          <th className="n">Sumă (fără TVA)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.directeManuale.map((d, i) => (
                          <tr key={i}>
                            <td>{d.data}</td>
                            <td>{d.categorie}</td>
                            <td>
                              {d.descriere}
                              {d.cantitate !== null && <span className="gri"> · {nfq.format(d.cantitate)} {d.um ?? ''}</span>}
                            </td>
                            <td>{d.document ?? ''}</td>
                            <td className="n">{lei(d.suma)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {p.motorinaNeconfirmata.length > 0 && (
                  <>
                    <div className="sub" style={{ color: '#8a5a00' }}>
                      Motorină din sesiuni neconfirmate (orientativ, nu intră în total)
                    </div>
                    <TabelMotorina linii={p.motorinaNeconfirmata} pret={null} neconfirmat />
                  </>
                )}
              </div>
            ))}

            {raport.inAfara.length > 0 && (
              <div className="parcela">
                <strong>În afara parcelelor</strong>
                <table style={{ marginTop: '0.3rem' }}>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Utilaj</th>
                      <th>Lucrare</th>
                      <th>Unde</th>
                      <th className="n">Ore</th>
                      <th className="n">Litri</th>
                    </tr>
                  </thead>
                  <tbody>
                    {raport.inAfara.map((l, i) => (
                      <tr key={i}>
                        <td>{l.data}</td>
                        <td>{l.utilaj}</td>
                        <td>{l.tip}</td>
                        <td>{l.locatie ?? ''}</td>
                        <td className="n">{l.ore === null ? '—' : nf1.format(l.ore)}</td>
                        <td className="n">{l.litri === null ? '—' : nf1.format(l.litri)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="gri" style={{ marginTop: '1rem' }}>
              Motorina pe parcele = bilanțul nivelului din rezervor pe fiecare sesiune GPS confirmată în Activități parcele. Fertilizanții și
              materiile prime = cantitățile declarate la confirmarea lucrărilor, la costul mediu al gestiunii fermei din momentul consumului.
              Doar costuri directe — costurile indirecte se înregistrează în contabilitate.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
