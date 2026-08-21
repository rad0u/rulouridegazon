'use client';

import { useState } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';

type Alimentare = { id: string; data_ora: string; cantitate_litri: number; note: string | null };

type FermaRezervor = {
  ferma_id: string;
  nume: string;
  configurat: boolean;
  capacitate_litri: number | null;
  nivel_initial_litri?: number;
  nivel_initial_data?: string;
  total_alimentat_litri?: number;
  total_consumat_litri?: number;
  nivel_curent_litri?: number;
  utilaje_calibrate_incluse?: number;
  utilaje_total?: number;
  ultima_alimentare?: Alimentare | null;
  alimentari?: Alimentare[];
  eroare?: string;
};

function formatData(data: string | null | undefined) {
  if (!data) return '—';
  return new Date(data).toLocaleString('ro-RO');
}

export default function RezervorCentralScreen() {
  const [ferme, setFerme] = useState<FermaRezervor[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandat, setExpandat] = useState<string | null>(null);

  // Formular alimentare nouă
  const [fermaSelectata, setFermaSelectata] = useState<string>('');
  const [cantitate, setCantitate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Formular configurare inițială (per fermă necofigurată)
  const [configFerma, setConfigFerma] = useState<string | null>(null);
  const [configCapacitate, setConfigCapacitate] = useState('');
  const [configNivelInitial, setConfigNivelInitial] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  async function incarca() {
    setLoading(true);
    setError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/get-rezervor-central`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      setLoading(false);

      if (!res.ok) {
        setError(json?.error ?? 'Eroare la încărcarea rezervoarelor.');
        return;
      }

      setFerme(json.ferme as FermaRezervor[]);
    } catch {
      setLoading(false);
      setError('Eroare de rețea la încărcarea rezervoarelor.');
    }
  }

  async function salveazaConfigurare(fermaId: string) {
    setConfigSaving(true);
    setConfigError(null);

    const capacitate = Number(configCapacitate);
    const nivelInitial = Number(configNivelInitial);

    if (!capacitate || capacitate <= 0 || Number.isNaN(nivelInitial) || nivelInitial < 0) {
      setConfigError('Completează capacitatea și nivelul curent (numere valide).');
      setConfigSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from('ferme')
      .update({
        rezervor_capacitate_litri: capacitate,
        rezervor_nivel_initial_litri: nivelInitial,
        rezervor_nivel_initial_data: new Date().toISOString(),
      })
      .eq('id', fermaId);

    setConfigSaving(false);

    if (updateError) {
      setConfigError(updateError.message);
      return;
    }

    setConfigFerma(null);
    setConfigCapacitate('');
    setConfigNivelInitial('');
    void incarca();
  }

  async function salveazaAlimentare() {
    setSaveError(null);

    const cant = Number(cantitate);
    if (!fermaSelectata || !cant || cant <= 0) {
      setSaveError('Alege ferma și o cantitate validă.');
      return;
    }

    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: insertError } = await supabase.from('rezervor_alimentari').insert({
      ferma_id: fermaSelectata,
      cantitate_litri: cant,
      user_id: user?.id ?? null,
    });

    setSaving(false);

    if (insertError) {
      setSaveError(insertError.message);
      return;
    }

    setCantitate('');
    void incarca();
  }

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: 'clamp(0.75rem, 3vw, 1.5rem)',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Rezervor central pe fermă</h1>
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

      <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
        Nivelul curent se calculează automat: nivel inițial + alimentări înregistrate − consumul
        măsurat al utilajelor calibrate ale fermei. E o aproximare bazată pe consumul de motor, nu
        pe evenimente exacte de realimentare a utilajelor — de urmărit dacă se potrivește cu
        realitatea.
      </p>

      {error && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>
          {error}
        </p>
      )}

      {!ferme && !loading && !error && <p>Apasă „Reîncarcă” pentru a vedea situația rezervoarelor.</p>}

      {ferme && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '0.4rem' }}>Fermă</th>
                <th style={{ padding: '0.4rem' }}>Capacitate</th>
                <th style={{ padding: '0.4rem' }}>Nivel curent</th>
                <th style={{ padding: '0.4rem' }}>Ultima alimentare</th>
                <th style={{ padding: '0.4rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {ferme.map((f) => {
                const procent =
                  f.configurat && f.capacitate_litri && f.nivel_curent_litri !== undefined
                    ? Math.round((f.nivel_curent_litri / f.capacitate_litri) * 100)
                    : null;
                const scazut = procent !== null && procent < 15;
                const deschis = expandat === f.ferma_id;

                return (
                  <>
                    <tr key={f.ferma_id} style={{ borderBottom: '1px solid #f0f0f0', background: scazut ? '#fdecea' : undefined }}>
                      <td style={{ padding: '0.4rem' }}>{f.nume}</td>
                      <td style={{ padding: '0.4rem' }}>{f.capacitate_litri ? `${f.capacitate_litri} L` : '—'}</td>
                      <td style={{ padding: '0.4rem', color: scazut ? '#8a1f13' : undefined, fontWeight: scazut ? 600 : undefined }}>
                        {!f.configurat
                          ? 'neconfigurat'
                          : `${f.nivel_curent_litri} L${procent !== null ? ` (${procent}%)` : ''}${scazut ? ' ⚠️ nivel scăzut' : ''}`}
                      </td>
                      <td style={{ padding: '0.4rem' }}>
                        {f.ultima_alimentare
                          ? `${f.ultima_alimentare.cantitate_litri} L — ${formatData(f.ultima_alimentare.data_ora)}`
                          : '—'}
                      </td>
                      <td style={{ padding: '0.4rem' }}>
                        {!f.configurat ? (
                          <button
                            onClick={() => setConfigFerma(configFerma === f.ferma_id ? null : f.ferma_id)}
                            style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}
                          >
                            Configurează
                          </button>
                        ) : (
                          (f.alimentari?.length ?? 0) > 0 && (
                            <button
                              onClick={() => setExpandat(deschis ? null : f.ferma_id)}
                              style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                              {deschis ? 'Ascunde' : 'Istoric'}
                            </button>
                          )
                        )}
                      </td>
                    </tr>

                    {configFerma === f.ferma_id && (
                      <tr>
                        <td colSpan={5} style={{ padding: '0.6rem', background: '#fafafa' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                              Capacitate rezervor (L)
                              <input
                                type="number"
                                value={configCapacitate}
                                onChange={(e) => setConfigCapacitate(e.target.value)}
                                style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid #ccc', width: '140px' }}
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                              Nivel curent acum (L)
                              <input
                                type="number"
                                value={configNivelInitial}
                                onChange={(e) => setConfigNivelInitial(e.target.value)}
                                style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid #ccc', width: '140px' }}
                              />
                            </label>
                            <button
                              onClick={() => void salveazaConfigurare(f.ferma_id)}
                              disabled={configSaving}
                              style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}
                            >
                              {configSaving ? 'Se salvează...' : 'Salvează'}
                            </button>
                          </div>
                          {configError && <p style={{ color: '#b00020', margin: '0.5rem 0 0' }}>{configError}</p>}
                        </td>
                      </tr>
                    )}

                    {deschis && f.alimentari && (
                      <tr>
                        <td colSpan={5} style={{ padding: '0.6rem', background: '#fafafa' }}>
                          <strong>Istoric alimentări:</strong>
                          <ul style={{ margin: '0.25rem 0 0 1rem' }}>
                            {f.alimentari.map((a) => (
                              <li key={a.id}>
                                {formatData(a.data_ora)} — {a.cantitate_litri} L
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ferme && (
        <div style={{ borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem' }}>Înregistrează o alimentare</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
              Fermă
              <select
                value={fermaSelectata}
                onChange={(e) => setFermaSelectata(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '160px' }}
              >
                <option value="">Alege ferma</option>
                {ferme.filter((f) => f.configurat).map((f) => (
                  <option key={f.ferma_id} value={f.ferma_id}>
                    {f.nume}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
              Cantitate (L)
              <input
                type="number"
                value={cantitate}
                onChange={(e) => setCantitate(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', width: '140px' }}
              />
            </label>
            <button
              onClick={() => void salveazaAlimentare()}
              disabled={saving}
              style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #ccc', background: saving ? '#eee' : '#f5f5f5', cursor: saving ? 'default' : 'pointer' }}
            >
              {saving ? 'Se salvează...' : 'Salvează alimentare'}
            </button>
          </div>
          {saveError && <p style={{ color: '#b00020', margin: '0.5rem 0 0' }}>{saveError}</p>}
        </div>
      )}
    </main>
  );
}
