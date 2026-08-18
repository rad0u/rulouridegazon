'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '../../lib/supabaseClient';
import type { UtilajPozitie } from '../../components/UtilajeMapView';

// react-leaflet foloseşte `window`/`document` la import, deci se încarcă
// doar în browser, nu şi la randare pe server.
const UtilajeMapView = dynamic(() => import('../../components/UtilajeMapView'), {
  ssr: false,
  loading: () => <p>Se încarcă harta...</p>,
});

// Cât timp utilajul nu are `tanc_capacitate_litri` setat în baza de date,
// presupunem că senzorul DUT-E nu e încă (definitiv) calibrat pe rezervorul
// real, deci valoarea e brută ("kvants"), nu litri. Odată setată capacitatea
// (după calibrare pe teren), aceeași valoare e afișată direct ca litri.
function formatCombustibil(u: UtilajPozitie): string {
  if (u.combustibil_nivel === null) return '—';

  if (u.combustibil_capacitate_litri && u.combustibil_capacitate_litri > 0) {
    const procent = Math.round((u.combustibil_nivel / u.combustibil_capacitate_litri) * 100);
    return `${Math.round(u.combustibil_nivel)} L / ${u.combustibil_capacitate_litri} L (${procent}%)`;
  }

  return `${u.combustibil_nivel} (brut, necalibrat)`;
}

export default function UtilajeScreen() {
  const [utilaje, setUtilaje] = useState<UtilajPozitie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  async function reincarca() {
    setLoading(true);
    setError(null);

    const { data, error: invokeError } = await supabase.functions.invoke('get-utilaje-positions');

    setLoading(false);
    setLoadedOnce(true);

    if (invokeError) {
      const message =
        (invokeError as { context?: { error?: string } })?.context?.error ?? invokeError.message;
      setError(message);
      return;
    }

    if (data?.error) {
      setError(data.error);
      return;
    }

    setUtilaje((data?.utilaje as UtilajPozitie[]) ?? []);
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
        <h1 style={{ margin: 0 }}>Hartă utilaje</h1>
        <button
          onClick={() => void reincarca()}
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

      {error && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>
          {error}
        </p>
      )}

      {!loadedOnce && !loading && !error && (
        <p>Apasă „Reîncarcă” pentru a vedea poziția curentă a utilajelor.</p>
      )}

      {loadedOnce && !error && utilaje.length === 0 && <p>Niciun utilaj activ înregistrat.</p>}

      {loadedOnce && !error && utilaje.length > 0 && (
        <>
          <div
            style={{
              height: 'clamp(320px, 60vh, 600px)',
              flexShrink: 0,
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid #ddd',
            }}
          >
            <UtilajeMapView utilaje={utilaje} />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                  <th style={{ padding: '0.4rem' }}>Utilaj</th>
                  <th style={{ padding: '0.4rem' }}>Fermă</th>
                  <th style={{ padding: '0.4rem' }}>Status</th>
                  <th style={{ padding: '0.4rem' }}>Ultima poziție</th>
                  <th style={{ padding: '0.4rem' }}>Combustibil</th>
                </tr>
              </thead>
              <tbody>
                {utilaje.map((u) => (
                  <tr key={u.utilaj_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.4rem' }}>{u.nume}</td>
                    <td style={{ padding: '0.4rem' }}>{u.ferma_nume ?? '—'}</td>
                    <td style={{ padding: '0.4rem' }}>{u.status === 'online' ? 'online' : 'offline'}</td>
                    <td style={{ padding: '0.4rem' }}>
                      {u.ultima_actualizare ? new Date(u.ultima_actualizare).toLocaleString('ro-RO') : '—'}
                    </td>
                    <td style={{ padding: '0.4rem' }}>{formatCombustibil(u)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {utilaje.some((u) => u.combustibil_nivel !== null && !u.combustibil_capacitate_litri) && (
            <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
              Valorile de combustibil marcate „brut, necalibrat” sunt citirea directă a senzorului
              DUT-E, nu litri reali — apar ca litri automat, fără nicio modificare de cod, imediat
              ce senzorul e calibrat pe rezervorul real și capacitatea tancului (L) e completată
              pentru utilajul respectiv.
            </p>
          )}
        </>
      )}
    </main>
  );
}
