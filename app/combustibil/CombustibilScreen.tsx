'use client';

import { Fragment, useState } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';

type Eveniment = { data_ora: string; delta_litri: number };

type RezultatUtilaj = {
  utilaj_id: string;
  nume: string;
  ferma_nume: string | null;
  tanc_capacitate_litri: number;
  nr_citiri: number;
  prima_citire: string | null;
  ultima_citire: string | null;
  consum_normal_litri: number;
  realimentat_litri: number;
  realimentari: Eveniment[];
  scaderi_suspecte: Eveniment[];
  eroare?: string;
};

type UtilajNecalibrat = { utilaj_id: string; nume: string; ferma_nume: string | null };

type Raport = {
  zile: number;
  rezultate: RezultatUtilaj[];
  necalibrate: UtilajNecalibrat[];
};

function formatData(data: string | null) {
  if (!data) return '—';
  return new Date(data).toLocaleString('ro-RO');
}

export default function CombustibilScreen() {
  const [zile, setZile] = useState(7);
  const [raport, setRaport] = useState<Raport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandat, setExpandat] = useState<string | null>(null);

  async function incarca(zileNoi?: number) {
    setLoading(true);
    setError(null);

    const zileDeFolosit = zileNoi ?? zile;

    // supabase-js functions.invoke() nu trece query params ușor pe GET, deci
    // apelăm direct endpointul funcției prin fetch, cu tokenul sesiunii curente.
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/get-combustibil-report?zile=${zileDeFolosit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      setLoading(false);

      if (!res.ok) {
        setError(json?.error ?? 'Eroare la încărcarea raportului.');
        return;
      }

      setRaport(json as Raport);
    } catch (e) {
      setLoading(false);
      setError('Eroare de rețea la încărcarea raportului.');
    }
  }

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: 'clamp(0.75rem, 3vw, 1.5rem)',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Raport combustibil</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            value={zile}
            onChange={(e) => {
              const v = Number(e.target.value);
              setZile(v);
              void incarca(v);
            }}
            style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
          >
            <option value={7}>Ultimele 7 zile</option>
            <option value={14}>Ultimele 14 zile</option>
            <option value={30}>Ultimele 30 zile</option>
          </select>
          <button
            onClick={() => void incarca()}
            disabled={loading}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: loading ? '#eee' : '#f5f5f5',
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading ? 'Se încarcă...' : 'Reîncarcă'}
          </button>
        </div>
      </div>

      {error && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>
          {error}
        </p>
      )}

      {!raport && !loading && !error && (
        <p>Apasă „Reîncarcă” pentru a vedea raportul de consum.</p>
      )}

      {raport && raport.rezultate.length === 0 && (
        <p>Niciun utilaj calibrat încă — vezi nota de mai jos.</p>
      )}

      {raport && raport.rezultate.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '0.4rem' }}>Utilaj</th>
                <th style={{ padding: '0.4rem' }}>Fermă</th>
                <th style={{ padding: '0.4rem' }}>Consum normal</th>
                <th style={{ padding: '0.4rem' }}>Realimentat</th>
                <th style={{ padding: '0.4rem' }}>Scăderi suspecte</th>
                <th style={{ padding: '0.4rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {raport.rezultate.map((r) => {
                const areSuspecte = r.scaderi_suspecte.length > 0;
                const deschis = expandat === r.utilaj_id;

                return (
                  <Fragment key={r.utilaj_id}>
                    <tr
                      style={{ borderBottom: '1px solid #f0f0f0', background: areSuspecte ? '#fdecea' : undefined }}
                    >
                      <td style={{ padding: '0.4rem' }}>{r.nume}</td>
                      <td style={{ padding: '0.4rem' }}>{r.ferma_nume ?? '—'}</td>
                      <td style={{ padding: '0.4rem' }}>{r.consum_normal_litri} L</td>
                      <td style={{ padding: '0.4rem' }}>
                        {r.realimentat_litri} L{r.realimentari.length > 0 ? ` (${r.realimentari.length}x)` : ''}
                      </td>
                      <td style={{ padding: '0.4rem', color: areSuspecte ? '#8a1f13' : undefined, fontWeight: areSuspecte ? 600 : undefined }}>
                        {areSuspecte
                          ? `⚠️ ${r.scaderi_suspecte.length} eveniment(e), ${Math.round(
                              r.scaderi_suspecte.reduce((s, e) => s + Math.abs(e.delta_litri), 0) * 10,
                            ) / 10} L`
                          : '—'}
                      </td>
                      <td style={{ padding: '0.4rem' }}>
                        {(areSuspecte || r.realimentari.length > 0) && (
                          <button
                            onClick={() => setExpandat(deschis ? null : r.utilaj_id)}
                            style={{
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              border: '1px solid #ccc',
                              background: '#fff',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                            }}
                          >
                            {deschis ? 'Ascunde' : 'Detalii'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {deschis && (
                      <tr key={`${r.utilaj_id}-detalii`}>
                        <td colSpan={6} style={{ padding: '0.6rem', background: '#fafafa' }}>
                          {r.scaderi_suspecte.length > 0 && (
                            <div style={{ marginBottom: '0.5rem' }}>
                              <strong style={{ color: '#8a1f13' }}>Scăderi suspecte:</strong>
                              <ul style={{ margin: '0.25rem 0 0 1rem' }}>
                                {r.scaderi_suspecte.map((e, i) => (
                                  <li key={i}>
                                    {formatData(e.data_ora)} — {e.delta_litri} L
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {r.realimentari.length > 0 && (
                            <div>
                              <strong>Realimentări:</strong>
                              <ul style={{ margin: '0.25rem 0 0 1rem' }}>
                                {r.realimentari.map((e, i) => (
                                  <li key={i}>
                                    {formatData(e.data_ora)} — +{e.delta_litri} L
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {raport && raport.necalibrate.length > 0 && (
        <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
          {raport.necalibrate.length} utilaj(e) fără capacitate de tanc completată (necalibrate) nu apar
          în raport: {raport.necalibrate.map((u) => u.nume).join(', ')}. Apar automat, fără nicio
          modificare de cod, imediat ce senzorul e calibrat și capacitatea tancului e completată.
        </p>
      )}
    </main>
  );
}
