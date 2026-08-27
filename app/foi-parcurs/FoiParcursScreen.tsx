'use client';

import { useEffect, useState } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';

type Cursa = {
  id: string;
  data_ora_start: string;
  data_ora_stop: string | null;
  km: number | null;
  scop: string | null;
  status: string;
  note: string | null;
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

type Masina = { id: string; nume: string; numar_inmatriculare: string | null };

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
  const [masini, setMasini] = useState<Masina[]>([]);
  const [masinaId, setMasinaId] = useState('');
  const now = new Date();
  const [an, setAn] = useState(now.getFullYear());
  const [luna, setLuna] = useState(now.getMonth() + 1);

  const [raport, setRaport] = useState<Raport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function incarcaMasini() {
      const { data } = await supabase.from('masini').select('id, nume, numar_inmatriculare').eq('activ', true).order('nume');
      setMasini((data as Masina[]) ?? []);
    }
    void incarcaMasini();
  }, []);

  async function genereaza() {
    if (!masinaId) {
      setError('Alege o mașină.');
      return;
    }
    setLoading(true);
    setError(null);
    setRaport(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/get-foaie-parcurs?masina_id=${masinaId}&an=${an}&luna=${luna}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = await res.json();
      setLoading(false);

      if (!res.ok) {
        setError(json?.error ?? 'Eroare la generare.');
        return;
      }

      setRaport(json as Raport);
    } catch {
      setLoading(false);
      setError('Eroare de rețea la generare.');
    }
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
        <h1>Foi de parcurs</h1>
        <p>Alege mașina și luna, apoi generează. Cursele nevalidate apar marcate — validează-le din /curse înainte de a printa raportul final.</p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <label>
            Mașină
            <select value={masinaId} onChange={(e) => setMasinaId(e.target.value)} style={{ display: 'block', padding: '0.55rem', marginTop: '0.3rem', minWidth: '220px' }}>
              <option value="">Alege mașină</option>
              {masini.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nume} {m.numar_inmatriculare ? `(${m.numar_inmatriculare})` : ''}
                </option>
              ))}
            </select>
          </label>
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
          <button onClick={() => void genereaza()} disabled={loading} style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #2e7d32', background: '#2e7d32', color: '#fff', cursor: 'pointer' }}>
            {loading ? 'Generez...' : 'Generează'}
          </button>
          {raport && (
            <button onClick={() => window.print()} style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}>
              Printează / Salvează PDF
            </button>
          )}
        </div>

        {error && <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>}

        {raport && raport.numar_nevalidate > 0 && (
          <p style={{ background: '#fff4e0', color: '#8a5a00', padding: '0.75rem', borderRadius: '6px' }}>
            ⚠️ {raport.numar_nevalidate} curse din această lună nu sunt încă validate (vezi /curse).
          </p>
        )}
      </div>

      {raport && (
        <section style={{ maxWidth: '900px', margin: '0 auto', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
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

          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
                <th style={{ padding: '0.4rem' }}>Data</th>
                <th style={{ padding: '0.4rem' }}>Plecare</th>
                <th style={{ padding: '0.4rem' }}>Sosire</th>
                <th style={{ padding: '0.4rem' }}>Șofer</th>
                <th style={{ padding: '0.4rem' }}>Scop deplasare</th>
                <th style={{ padding: '0.4rem', textAlign: 'right' }}>Km</th>
                <th style={{ padding: '0.4rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {raport.curse.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '0.75rem', color: '#666', textAlign: 'center' }}>
                    Nicio cursă înregistrată în această lună.
                  </td>
                </tr>
              )}
              {raport.curse.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.4rem' }}>{formatData(c.data_ora_start)}</td>
                  <td style={{ padding: '0.4rem' }}>{formatOra(c.data_ora_start)}</td>
                  <td style={{ padding: '0.4rem' }}>{formatOra(c.data_ora_stop)}</td>
                  <td style={{ padding: '0.4rem' }}>{c.sofer_nume ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{c.scop ?? '—'}</td>
                  <td style={{ padding: '0.4rem', textAlign: 'right' }}>{c.km ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{c.status !== 'validata' ? '⚠ nevalidată' : 'validată'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #333', fontWeight: 700 }}>
                <td colSpan={5} style={{ padding: '0.5rem', textAlign: 'right' }}>
                  Total km parcurși:
                </td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{raport.total_km}</td>
                <td />
              </tr>
            </tfoot>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3rem', fontSize: '0.9rem' }}>
            <div>Șofer: ______________________</div>
            <div>Verificat de: ______________________</div>
          </div>
        </section>
      )}
    </main>
  );
}
