'use client';

import { useState } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';

type Alimentare = { id: string; data_ora: string; cantitate_litri: number; pret_litru: number; note: string | null };

type ZiMiscare = {
  data: string;
  alimentat_litri: number;
  alimentari: Alimentare[];
  iesiri_litri: number;
  diferenta_neta_litri: number;
};

function aziISO() {
  return new Date().toISOString().slice(0, 10);
}
function acumTreizeciDeZileISO() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function formatDataZi(dataZi: string) {
  return new Date(`${dataZi}T12:00:00`).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

type FermaRezervor = {
  ferma_id: string;
  nume: string;
  configurat: boolean;
  capacitate_litri: number | null;
  nivel_initial_litri?: number;
  nivel_initial_data?: string;
  total_alimentat_litri?: number;
  pret_litru_mediu?: number | null;
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

  // Mișcări zilnice (alimentări + ieșiri) pe intervalul ales, pentru ferma expandată
  const [miscariDeLa, setMiscariDeLa] = useState<string>(acumTreizeciDeZileISO());
  const [miscariPanaLa, setMiscariPanaLa] = useState<string>(aziISO());
  const [miscariZile, setMiscariZile] = useState<ZiMiscare[] | null>(null);
  const [miscariUtilajeCalibrate, setMiscariUtilajeCalibrate] = useState<{ incluse: number; total: number } | null>(null);
  const [miscariLoading, setMiscariLoading] = useState(false);
  const [miscariError, setMiscariError] = useState<string | null>(null);

  // Formular alimentare nouă
  const [fermaSelectata, setFermaSelectata] = useState<string>('');
  const [cantitate, setCantitate] = useState('');
  const [pretLitru, setPretLitru] = useState('');
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

  async function incarcaMiscari(fermaId: string, deLa: string, panaLa: string) {
    setMiscariLoading(true);
    setMiscariError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const params = new URLSearchParams({ ferma_id: fermaId, de_la: deLa, pana_la: panaLa });
      const res = await fetch(`${supabaseUrl}/functions/v1/get-rezervor-central-miscari?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      setMiscariLoading(false);

      if (!res.ok) {
        setMiscariError(json?.error ?? 'Eroare la încărcarea mișcărilor de combustibil.');
        setMiscariZile(null);
        return;
      }

      setMiscariZile(json.zile as ZiMiscare[]);
      setMiscariUtilajeCalibrate({ incluse: json.utilaje_calibrate_incluse, total: json.utilaje_total });
    } catch {
      setMiscariLoading(false);
      setMiscariError('Eroare de rețea la încărcarea mișcărilor de combustibil.');
      setMiscariZile(null);
    }
  }

  function toggleMiscari(fermaId: string) {
    if (expandat === fermaId) {
      setExpandat(null);
      return;
    }
    setExpandat(fermaId);
    setMiscariZile(null);
    setMiscariError(null);
    void incarcaMiscari(fermaId, miscariDeLa, miscariPanaLa);
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
    const pret = Number(pretLitru);
    if (!fermaSelectata || !cant || cant <= 0) {
      setSaveError('Alege ferma și o cantitate validă.');
      return;
    }
    // Radu (2026-09-15): prețul motorinei variază mereu, deci se introduce
    // obligatoriu la fiecare alimentare (nu există un preț curent implicit).
    if (!pretLitru || pret < 0) {
      setSaveError('Completează prețul motorinei la această alimentare (poate fi 0, dar nu negativ).');
      return;
    }

    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: insertError } = await supabase.from('rezervor_alimentari').insert({
      ferma_id: fermaSelectata,
      cantitate_litri: cant,
      pret_litru: pret,
      user_id: user?.id ?? null,
    });

    setSaving(false);

    if (insertError) {
      setSaveError(insertError.message);
      return;
    }

    setCantitate('');
    setPretLitru('');
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
                <th style={{ padding: '0.4rem' }}>Preț mediu motorină</th>
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
                        {f.pret_litru_mediu !== null && f.pret_litru_mediu !== undefined
                          ? `${f.pret_litru_mediu.toFixed(2)} lei/L`
                          : '—'}
                      </td>
                      <td style={{ padding: '0.4rem' }}>
                        {f.ultima_alimentare
                          ? `${f.ultima_alimentare.cantitate_litri} L @ ${Number(f.ultima_alimentare.pret_litru).toFixed(2)} lei/L — ${formatData(f.ultima_alimentare.data_ora)}`
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
                          <button
                            onClick={() => toggleMiscari(f.ferma_id)}
                            style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}
                          >
                            {deschis ? 'Ascunde' : 'Mișcări'}
                          </button>
                        )}
                      </td>
                    </tr>

                    {configFerma === f.ferma_id && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0.6rem', background: '#fafafa' }}>
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

                    {deschis && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0.6rem', background: '#fafafa' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.6rem' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                              De la
                              <input
                                type="date"
                                value={miscariDeLa}
                                onChange={(e) => setMiscariDeLa(e.target.value)}
                                style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid #ccc' }}
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                              Până la
                              <input
                                type="date"
                                value={miscariPanaLa}
                                onChange={(e) => setMiscariPanaLa(e.target.value)}
                                style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid #ccc' }}
                              />
                            </label>
                            <button
                              onClick={() => void incarcaMiscari(f.ferma_id, miscariDeLa, miscariPanaLa)}
                              disabled={miscariLoading}
                              style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #ccc', background: miscariLoading ? '#eee' : '#f5f5f5', cursor: miscariLoading ? 'default' : 'pointer' }}
                            >
                              {miscariLoading ? 'Se încarcă...' : 'Generează'}
                            </button>
                          </div>

                          {miscariError && (
                            <p style={{ color: '#b00020', background: '#fdecea', padding: '0.5rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                              {miscariError}
                            </p>
                          )}

                          {miscariZile && miscariUtilajeCalibrate && (
                            <p style={{ fontSize: '0.8rem', color: '#666', margin: '0 0 0.5rem' }}>
                              Ieșirile includ {miscariUtilajeCalibrate.incluse} din {miscariUtilajeCalibrate.total} utilaje ale fermei
                              (doar cele calibrate, cu capacitate de tanc introdusă).
                            </p>
                          )}

                          {miscariZile && miscariZile.length === 0 && !miscariLoading && (
                            <p style={{ fontSize: '0.85rem', color: '#666' }}>Nicio mișcare în intervalul selectat.</p>
                          )}

                          {miscariZile && miscariZile.length > 0 && (
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
                                <thead>
                                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                                    <th style={{ padding: '0.3rem' }}>Zi</th>
                                    <th style={{ padding: '0.3rem' }}>Alimentat</th>
                                    <th style={{ padding: '0.3rem' }}>Ieșiri (consum utilaje)</th>
                                    <th style={{ padding: '0.3rem' }}>Diferență netă</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {miscariZile.map((zi) => (
                                    <tr key={zi.data} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                      <td style={{ padding: '0.3rem' }}>{formatDataZi(zi.data)}</td>
                                      <td style={{ padding: '0.3rem' }}>
                                        {zi.alimentat_litri > 0 ? (
                                          <>
                                            +{zi.alimentat_litri} L
                                            {zi.alimentari.length > 0 && (
                                              <span style={{ color: '#666' }}>
                                                {' '}
                                                (
                                                {zi.alimentari
                                                  .map((a) => `${a.cantitate_litri} L @ ${Number(a.pret_litru).toFixed(2)} lei/L`)
                                                  .join(', ')}
                                                )
                                              </span>
                                            )}
                                          </>
                                        ) : (
                                          '—'
                                        )}
                                      </td>
                                      <td style={{ padding: '0.3rem' }}>{zi.iesiri_litri > 0 ? `−${zi.iesiri_litri} L` : '—'}</td>
                                      <td
                                        style={{
                                          padding: '0.3rem',
                                          fontWeight: 600,
                                          color: zi.diferenta_neta_litri < 0 ? '#b00020' : undefined,
                                        }}
                                      >
                                        {zi.diferenta_neta_litri > 0 ? '+' : ''}
                                        {zi.diferenta_neta_litri} L
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
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
              Preț motorină (lei/L)
              <input
                type="number"
                min="0"
                step="0.01"
                value={pretLitru}
                onChange={(e) => setPretLitru(e.target.value)}
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
