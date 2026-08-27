'use client';

import { Fragment, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';
import type { UtilajPozitie } from '../../components/UtilajeMapView';

type ZiIstoric = {
  data: string;
  total_ore_functionare: number;
  parcele: { nume: string; ore: number }[];
};

type IstoricParcele = {
  utilaj_id: string;
  utilaj_nume: string;
  zile: number;
  are_parcele_desenate: boolean;
  zile_istoric: ZiIstoric[];
};

function formatDataZi(data: string): string {
  // `data` e YYYY-MM-DD (fus orar România) — construim data locală direct din
  // componente, ca să nu depindem de fusul orar al browserului la parsare.
  const [an, luna, zi] = data.split('-').map(Number);
  const d = new Date(an, luna - 1, zi);
  return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
}

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

// Cron-ul sincronizează din Traccar la fiecare 15 minute, deci un decalaj de
// până la ~20-30 min e normal. Peste pragul de mai jos, cu utilajul online dar
// fără citire nouă de combustibil, e semn că sonda a fost deconectată (fir
// tăiat/scos) — scenariul clasic „deconectez sonda înainte să fur motorină”.
const FUEL_STALE_MINUTES = 60;

function fuelSignalAgeMinutes(u: UtilajPozitie): number | null {
  if (!u.combustibil_data) return null;
  return (Date.now() - new Date(u.combustibil_data).getTime()) / 60000;
}

function isFuelSignalStale(u: UtilajPozitie): boolean {
  // Alertăm doar dacă utilajul a avut vreodată o citire (deci are sondă montată
  // și funcțională) și utilajul e online — dacă nu are sondă deloc, nu e o
  // anomalie, doar lipsă de echipament.
  if (u.status !== 'online' || u.combustibil_nivel === null) return false;
  const age = fuelSignalAgeMinutes(u);
  return age !== null && age > FUEL_STALE_MINUTES;
}

export default function UtilajeScreen() {
  const [utilaje, setUtilaje] = useState<UtilajPozitie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [utilajExtins, setUtilajExtins] = useState<string | null>(null);
  const [istoricZile, setIstoricZile] = useState(14);
  const [istoric, setIstoric] = useState<IstoricParcele | null>(null);
  const [istoricLoading, setIstoricLoading] = useState(false);
  const [istoricError, setIstoricError] = useState<string | null>(null);

  async function incarcaIstoric(utilajId: string, zileDeFolosit: number) {
    setIstoricLoading(true);
    setIstoricError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/get-utilaj-istoric-parcele?utilaj_id=${utilajId}&zile=${zileDeFolosit}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = await res.json();

      setIstoricLoading(false);

      if (!res.ok) {
        setIstoricError(json?.error ?? 'Eroare la încărcarea istoricului.');
        return;
      }

      setIstoric(json as IstoricParcele);
    } catch (e) {
      setIstoricLoading(false);
      setIstoricError('Eroare de rețea la încărcarea istoricului.');
    }
  }

  function toggleIstoric(utilajId: string) {
    if (utilajExtins === utilajId) {
      setUtilajExtins(null);
      setIstoric(null);
      setIstoricError(null);
      return;
    }
    setUtilajExtins(utilajId);
    setIstoric(null);
    setIstoricError(null);
    void incarcaIstoric(utilajId, istoricZile);
  }

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

      {loadedOnce && !error && utilaje.some((u) => isFuelSignalStale(u)) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            background: '#fdecea',
            border: '1px solid #f5c2c0',
            color: '#8a1f13',
            fontWeight: 600,
          }}
        >
          <span aria-hidden>⚠️</span>
          <span>
            {utilaje.filter((u) => isFuelSignalStale(u)).length === 1
              ? '1 utilaj e online, dar fără citire de combustibil de peste o oră — posibil sondă deconectată. Verifică rândul marcat mai jos.'
              : `${utilaje.filter((u) => isFuelSignalStale(u)).length} utilaje sunt online, dar fără citire de combustibil de peste o oră — posibil sonde deconectate. Verifică rândurile marcate mai jos.`}
          </span>
        </div>
      )}

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
                  <th style={{ padding: '0.4rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {utilaje.map((u) => {
                  const stale = isFuelSignalStale(u);
                  const age = fuelSignalAgeMinutes(u);
                  const extins = utilajExtins === u.utilaj_id;

                  return (
                    <Fragment key={u.utilaj_id}>
                      <tr
                        onClick={() => toggleIstoric(u.utilaj_id)}
                        style={{
                          borderBottom: '1px solid #f0f0f0',
                          background: extins ? '#eef6ff' : stale ? '#fdecea' : undefined,
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ padding: '0.4rem' }}>{u.nume}</td>
                        <td style={{ padding: '0.4rem' }}>{u.ferma_nume ?? '—'}</td>
                        <td style={{ padding: '0.4rem' }}>{u.status === 'online' ? 'online' : 'offline'}</td>
                        <td style={{ padding: '0.4rem' }}>
                          {u.ultima_actualizare ? new Date(u.ultima_actualizare).toLocaleString('ro-RO') : '—'}
                        </td>
                        <td style={{ padding: '0.4rem', color: stale ? '#8a1f13' : undefined, fontWeight: stale ? 600 : undefined }}>
                          {formatCombustibil(u)}
                          {stale && (
                            <div style={{ fontSize: '0.8rem' }}>
                              ⚠️ fără citire de {age !== null ? Math.round(age / 60) : '?'}h — verifică sonda
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '0.4rem', color: '#666', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {extins ? 'Ascunde istoric ▲' : 'Istoric parcele ▼'}
                        </td>
                      </tr>
                      {extins && (
                        <tr key={`${u.utilaj_id}-istoric`}>
                          <td colSpan={6} style={{ padding: '0.75rem', background: '#fafafa' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                              <strong>Istoric ore pe parcele — {u.nume}</strong>
                              <select
                                value={istoricZile}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  setIstoricZile(v);
                                  void incarcaIstoric(u.utilaj_id, v);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid #ccc' }}
                              >
                                <option value={7}>Ultimele 7 zile</option>
                                <option value={14}>Ultimele 14 zile</option>
                                <option value={30}>Ultimele 30 zile</option>
                              </select>
                            </div>

                            {istoricLoading && <p style={{ margin: 0 }}>Se încarcă istoricul...</p>}

                            {istoricError && (
                              <p style={{ color: '#b00020', margin: 0 }}>{istoricError}</p>
                            )}

                            {!istoricLoading && !istoricError && istoric && !istoric.are_parcele_desenate && (
                              <p style={{ margin: 0, color: '#666' }}>
                                Ferma acestui utilaj nu are încă parcele desenate pe hartă — se poate
                                calcula doar totalul orelor de funcționare, fără defalcare pe parcele.
                              </p>
                            )}

                            {!istoricLoading && !istoricError && istoric && istoric.zile_istoric.length === 0 && (
                              <p style={{ margin: 0, color: '#666' }}>
                                Niciun interval de funcționare înregistrat în perioada selectată.
                              </p>
                            )}

                            {!istoricLoading && !istoricError && istoric && istoric.zile_istoric.length > 0 && (
                              <div style={{ overflowX: 'auto' }}>
                                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
                                  <thead>
                                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                                      <th style={{ padding: '0.35rem' }}>Data</th>
                                      <th style={{ padding: '0.35rem' }}>Ore pe parcele</th>
                                      <th style={{ padding: '0.35rem' }}>Total ore funcționare</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {istoric.zile_istoric.map((zi) => (
                                      <tr key={zi.data} style={{ borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '0.35rem', whiteSpace: 'nowrap' }}>
                                          {formatDataZi(zi.data)}
                                        </td>
                                        <td style={{ padding: '0.35rem' }}>
                                          {zi.parcele.length > 0
                                            ? zi.parcele.map((p) => `${p.ore}h ${p.nume}`).join(', ')
                                            : '—'}
                                        </td>
                                        <td style={{ padding: '0.35rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                          {zi.total_ore_functionare}h
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
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
