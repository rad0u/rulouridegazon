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
              {consumSuspect(m.litri, m.ore) && <span style={{ color: '#b00020' }}> ⚠ consum suspect — verifică senzorul</span>}
            </td>
            <td className="n">{nf1.format(m.ore)}</td>
            <td className="n">{m.litri === null ? '—' : nf1.format(m.litri)}</td>
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
            <td>{m.nume}</td>
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
  const [raport, setRaport] = useState<RaportConsumuri | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
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
    setRaport(null);
    try {
      setRaport(await incarcaConsumuriLunare(fermaId, luna));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
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
            </>
          )}
        </div>

        {error && <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>}

        {raport && t && (
          <div className="raport-cl">
            <div className="sumar">
              <h2>
                Consumuri lunare — {raport.fermaNume} — {raport.lunaText}
              </h2>
              <p className="gri" style={{ margin: '0 0 0.6rem' }}>
                Perioada {raport.deLa} – {raport.panaLa} · generat {raport.generatLa}
                {raport.pretMotorina !== null && ` · motorină ${nf2.format(raport.pretMotorina)} lei/L (preț mediu de achiziție)`}
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
                    <th className="n">Ore lucru</th>
                    <th className="n">Motorină (L)</th>
                    <th className="n">Motorină</th>
                    <th className="n">Fertilizanți</th>
                    <th className="n">Materii prime</th>
                    <th className="n">Total</th>
                    <th className="n">Recoltat (mp)</th>
                  </tr>
                </thead>
                <tbody>
                  {cuConsum.map((p) => (
                    <tr key={p.id}>
                      <td>{p.nume}</td>
                      <td className="n">{nf1.format(p.oreLucru)}</td>
                      <td className="n">{nf1.format(p.litri)}</td>
                      <td className="n">{lei(p.valoareMotorina)}</td>
                      <td className="n">{lei(p.valoareSubstante)}</td>
                      <td className="n">{lei(p.valoareMateriiPrime)}</td>
                      <td className="n">
                        <strong>{lei(p.valoareTotala)}</strong>
                      </td>
                      <td className="n">{p.mpRecoltat ? nf0.format(p.mpRecoltat) : '—'}</td>
                    </tr>
                  ))}
                  {(raport.inAfara.length > 0 || t.litriInAfara > 0) && (
                    <tr>
                      <td>
                        <em>În afara parcelelor</em>
                      </td>
                      <td className="n">{nf1.format(raport.inAfara.reduce((s, l) => s + (l.ore ?? 0), 0))}</td>
                      <td className="n">{nf1.format(t.litriInAfara)}</td>
                      <td className="n">{raport.pretMotorina === null ? '—' : lei(t.litriInAfara * raport.pretMotorina)}</td>
                      <td className="n">—</td>
                      <td className="n">—</td>
                      <td className="n">{raport.pretMotorina === null ? '—' : lei(t.litriInAfara * raport.pretMotorina)}</td>
                      <td className="n">—</td>
                    </tr>
                  )}
                  <tr className="tot">
                    <td>TOTAL</td>
                    <td className="n">{nf1.format(t.oreLucru + raport.inAfara.reduce((s, l) => s + (l.ore ?? 0), 0))}</td>
                    <td className="n">{nf1.format(t.litri + t.litriInAfara)}</td>
                    <td className="n">{lei(t.valoareMotorina)}</td>
                    <td className="n">{lei(t.valoareSubstante)}</td>
                    <td className="n">{lei(t.valoareMateriiPrime)}</td>
                    <td className="n">{lei(t.valoareTotala)}</td>
                    <td className="n">{t.mpRecoltat ? nf0.format(t.mpRecoltat) : '—'}</td>
                  </tr>
                </tbody>
              </table>
              {t.litriNeconfirmati > 0 && (
                <p className="gri">
                  + {nf1.format(t.litriNeconfirmati)} L motorină din sesiuni neconfirmate (orientativ, neincluse în total).
                </p>
              )}
              {faraConsum.length > 0 && <p className="gri">Parcele fără consumuri în lună: {faraConsum.map((p) => p.nume).join(', ')}.</p>}

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
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  <strong>{nf1.format(p.oreLucru)} h</strong> de lucru
                  {p.orePeTip.length > 0 && ` (${p.orePeTip.map((x) => `${x.tip} ${nf1.format(x.ore)} h`).join(' · ')})`}
                  {p.mpRecoltat > 0 && (
                    <>
                      {' · '}
                      <strong>{nf0.format(p.mpRecoltat)} mp</strong> recoltați
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
              materiile prime = cantitățile declarate la confirmarea lucrărilor, la prețul mediu din gestiunea fermei.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
