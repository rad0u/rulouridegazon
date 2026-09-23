'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';

// v2, 2026-09-23 (Radu) -- inspirat de raportul AROBS Track GPS atașat ca
// referință: adaugă (1) o pagină de REZUMAT FLOTĂ (implicit la intrare —
// un rând per mașină activă, cu total km/curse/nevalidate pe lună, apoi
// "Vezi foaia de parcurs" trece la foaia detaliată a mașinii alese) și
// (2) pe foaia detaliată per mașină: coloane Locație pornire/Locație
// sosire (adrese geocodate de sync-traccar-masini) și Km cumulat (sumă
// GPS din tot istoricul mașinii — NU un odometru real, vezi nota din UI).

type Cursa = {
  id: string;
  data_ora_start: string;
  data_ora_stop: string | null;
  km: number | null;
  km_cumulat: number | null;
  scop: string | null;
  status: string;
  note: string | null;
  adresa_pornire: string | null;
  adresa_sosire: string | null;
  sofer_nume: string | null;
};

type Raport = {
  masina: {
    id: string;
    nume: string;
    numar_inmatriculare: string | null;
    marca_model: string | null;
    sofer_implicit_nume: string | null;
  };
  an: number;
  luna: number;
  curse: Cursa[];
  total_km: number;
  numar_curse: number;
  numar_nevalidate: number;
};

type RandRezumat = {
  masina_id: string;
  nume: string;
  numar_inmatriculare: string | null;
  marca_model: string | null;
  total_km: number;
  numar_curse: number;
  numar_nevalidate: number;
};

type Rezumat = {
  an: number;
  luna: number;
  rezultate: RandRezumat[];
};

const LUNI = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
];

function formatOra(data: string | null) {
  if (!data) return '—';
  return new Date(data).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

function formatData(data: string) {
  return new Date(data).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function FoiParcursScreen() {
  const now = new Date();
  const [an, setAn] = useState(now.getFullYear());
  const [luna, setLuna] = useState(now.getMonth() + 1);

  const [vizualizare, setVizualizare] = useState<'rezumat' | 'detaliu'>('rezumat');

  const [rezumat, setRezumat] = useState<Rezumat | null>(null);
  const [loadingRezumat, setLoadingRezumat] = useState(false);
  const [errorRezumat, setErrorRezumat] = useState<string | null>(null);

  const [raport, setRaport] = useState<Raport | null>(null);
  const [loadingRaport, setLoadingRaport] = useState(false);
  const [errorRaport, setErrorRaport] = useState<string | null>(null);

  async function incarcaRezumat() {
    setLoadingRezumat(true);
    setErrorRezumat(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/get-rezumat-flota?an=${an}&luna=${luna}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setLoadingRezumat(false);

      if (!res.ok) {
        setErrorRezumat(json?.error ?? 'Eroare la încărcarea rezumatului.');
        return;
      }
      setRezumat(json as Rezumat);
    } catch {
      setLoadingRezumat(false);
      setErrorRezumat('Eroare de rețea la încărcarea rezumatului.');
    }
  }

  useEffect(() => {
    if (vizualizare === 'rezumat') void incarcaRezumat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [an, luna, vizualizare]);

  async function deschideFoaie(idMasina: string) {
    setVizualizare('detaliu');
    setRaport(null);
    setLoadingRaport(true);
    setErrorRaport(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/get-foaie-parcurs?masina_id=${idMasina}&an=${an}&luna=${luna}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = await res.json();
      setLoadingRaport(false);

      if (!res.ok) {
        setErrorRaport(json?.error ?? 'Eroare la generare.');
        return;
      }
      setRaport(json as Raport);
    } catch {
      setLoadingRaport(false);
      setErrorRaport('Eroare de rețea la generare.');
    }
  }

  function inapoiLaRezumat() {
    setVizualizare('rezumat');
    setRaport(null);
    setErrorRaport(null);
  }

  return (
    <main style={{ padding: 'clamp(0.75rem, 3vw, 1.5rem)' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          main { padding: 0 !important; }
          table { font-size: 11px; }
        }
      `}</style>

      <div className="no-print">
        <p style={{ marginBottom: '0.25rem' }}>
          <Link href="/flota-auto">← Flotă auto</Link>
        </p>
        <h1>Foi de parcurs</h1>
        <p>
          Rezumatul de mai jos arată kilometrii și numărul de curse pe lună pentru fiecare mașină activă. Alege
          „Vezi foaia de parcurs” pentru detaliul unei mașini — cursele nevalidate apar marcate acolo, validează-le
          din /curse înainte de a printa raportul final.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <label>
            Luna
            <select value={luna} onChange={(e) => setLuna(Number(e.target.value))} style={{ display: 'block', padding: '0.55rem', marginTop: '0.3rem' }}>
              {LUNI.map((l, i) => (
                <option key={l} value={i + 1}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            An
            <input
              type="number"
              value={an}
              onChange={(e) => setAn(Number(e.target.value))}
              style={{ display: 'block', padding: '0.55rem', marginTop: '0.3rem', width: '100px' }}
            />
          </label>
          {vizualizare === 'detaliu' && (
            <button
              onClick={inapoiLaRezumat}
              style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}
            >
              ← Înapoi la rezumat
            </button>
          )}
          {vizualizare === 'detaliu' && raport && (
            <button onClick={() => window.print()} style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}>
              Printează / Salvează PDF
            </button>
          )}
        </div>

        {vizualizare === 'rezumat' && errorRezumat && (
          <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{errorRezumat}</p>
        )}
        {vizualizare === 'detaliu' && errorRaport && (
          <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{errorRaport}</p>
        )}

        {vizualizare === 'detaliu' && raport && raport.numar_nevalidate > 0 && (
          <p style={{ background: '#fff4e0', color: '#8a5a00', padding: '0.75rem', borderRadius: '6px' }}>
            ⚠️ {raport.numar_nevalidate} curse din această lună nu sunt încă validate (vezi /curse).
          </p>
        )}
      </div>

      {vizualizare === 'rezumat' && (
        <section className="no-print" style={{ maxWidth: '900px' }}>
          {loadingRezumat && <p>Se încarcă...</p>}
          {!loadingRezumat && rezumat && (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
                  <th style={{ padding: '0.5rem' }}>Mașină</th>
                  <th style={{ padding: '0.5rem' }}>Nr. înmatriculare</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right' }}>Total km</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right' }}>Curse</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right' }}>Nevalidate</th>
                  <th style={{ padding: '0.5rem' }} />
                </tr>
              </thead>
              <tbody>
                {rezumat.rezultate.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '0.75rem', color: '#666', textAlign: 'center' }}>
                      Nicio mașină activă înregistrată.
                    </td>
                  </tr>
                )}
                {rezumat.rezultate.map((r) => (
                  <tr key={r.masina_id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.5rem' }}>
                      {r.nume}
                      {r.marca_model ? <span style={{ color: '#888' }}> — {r.marca_model}</span> : null}
                    </td>
                    <td style={{ padding: '0.5rem' }}>{r.numar_inmatriculare ?? '—'}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.total_km}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.numar_curse}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                      {r.numar_nevalidate > 0 ? <span style={{ color: '#8a5a00' }}>⚠ {r.numar_nevalidate}</span> : '0'}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                      <button
                        onClick={() => void deschideFoaie(r.masina_id)}
                        style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #2e7d32', background: '#2e7d32', color: '#fff', cursor: 'pointer' }}
                      >
                        Vezi foaia de parcurs
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {rezumat.rezultate.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid #333', fontWeight: 700 }}>
                    <td colSpan={2} style={{ padding: '0.5rem' }}>
                      Total flotă:
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                      {Math.round(rezumat.rezultate.reduce((s, r) => s + r.total_km, 0) * 100) / 100}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                      {rezumat.rezultate.reduce((s, r) => s + r.numar_curse, 0)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </section>
      )}

      {vizualizare === 'detaliu' && loadingRaport && <p className="no-print">Se generează...</p>}

      {vizualizare === 'detaliu' && raport && (
        <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>FOAIE DE PARCURS</h2>
            <p style={{ margin: '0.25rem 0', color: '#555' }}>SC Rulouri de Gazon SRL</p>
            <p style={{ margin: 0, fontWeight: 600 }}>
              {LUNI[raport.luna - 1]} {raport.an}
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.95rem' }}>
            <div>
              <strong>Mașină:</strong> {raport.masina.nume}
              {raport.masina.marca_model ? ` — ${raport.masina.marca_model}` : ''}
              {raport.masina.numar_inmatriculare ? ` (${raport.masina.numar_inmatriculare})` : ''}
            </div>
            <div>
              <strong>Șofer implicit:</strong> {raport.masina.sofer_implicit_nume ?? '—'}
            </div>
          </div>

          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
                <th style={{ padding: '0.4rem' }}>Data</th>
                <th style={{ padding: '0.4rem' }}>Plecare</th>
                <th style={{ padding: '0.4rem' }}>Locație pornire</th>
                <th style={{ padding: '0.4rem' }}>Sosire</th>
                <th style={{ padding: '0.4rem' }}>Locație sosire</th>
                <th style={{ padding: '0.4rem' }}>Șofer</th>
                <th style={{ padding: '0.4rem' }}>Scop deplasare</th>
                <th style={{ padding: '0.4rem', textAlign: 'right' }}>Km</th>
                <th style={{ padding: '0.4rem', textAlign: 'right' }}>Km cumulat</th>
                <th style={{ padding: '0.4rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {raport.curse.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: '0.75rem', color: '#666', textAlign: 'center' }}>
                    Nicio cursă înregistrată în această lună.
                  </td>
                </tr>
              )}
              {raport.curse.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.4rem' }}>{formatData(c.data_ora_start)}</td>
                  <td style={{ padding: '0.4rem' }}>{formatOra(c.data_ora_start)}</td>
                  <td style={{ padding: '0.4rem', color: '#555' }}>{c.adresa_pornire ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{formatOra(c.data_ora_stop)}</td>
                  <td style={{ padding: '0.4rem', color: '#555' }}>{c.adresa_sosire ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{c.sofer_nume ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{c.scop ?? '—'}</td>
                  <td style={{ padding: '0.4rem', textAlign: 'right' }}>{c.km ?? '—'}</td>
                  <td style={{ padding: '0.4rem', textAlign: 'right' }}>{c.km_cumulat ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{c.status !== 'validata' ? '⚠ nevalidată' : 'validată'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #333', fontWeight: 700 }}>
                <td colSpan={7} style={{ padding: '0.5rem', textAlign: 'right' }}>
                  Total km parcurși:
                </td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{raport.total_km}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>

          <p className="no-print" style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.5rem' }}>
            Locațiile de pornire/sosire sunt estimate automat din coordonatele GPS (OpenStreetMap). Km cumulat e suma
            GPS a curselor mașinii de la începutul monitorizării — nu e un odometru oficial al mașinii.
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3rem', fontSize: '0.9rem' }}>
            <div>Șofer: ______________________</div>
            <div>Verificat de: ______________________</div>
          </div>
        </section>
      )}
    </main>
  );
}
