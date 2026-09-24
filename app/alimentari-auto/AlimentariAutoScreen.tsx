'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';

// app/alimentari-auto/AlimentariAutoScreen.tsx
//
// Radu, 2026-09-24: "La unele ferme autoturismele se alimenteaza din tancul
// de motorina" — pagină nouă pentru înregistrarea alimentărilor mașinilor
// de pasageri (flota auto) direct din rezervorul central al fermei. Înlocuiește
// vechea "Alimentări utilaje" (ascunsă din meniu — Radu: "Utilajele nu vor
// mai fi alimentate manual, vom folosi doar citirile de la sonde, deci
// pagina e inutila"), dar e o tabelă separată (`alimentari_masini`, nu
// `alimentari_utilaje`) — utilajele au senzori proprii de nivel, mașinile nu.
//
// Cantitatea introdusă aici e scăzută automat ca ieșire din rezervorul
// central în raportul "Mișcări rezervor central"
// (get-rezervor-central-miscari v2), alături de consumul utilajelor.

type Masina = {
  id: string;
  nume: string;
  ferma_id: string | null;
  ferme: { nume: string } | null;
};

type Alimentare = {
  id: string;
  data_ora: string;
  cantitate_litri: number;
  note: string | null;
  masini: { nume: string; ferme: { nume: string } | null } | null;
};

function aziLocal(): string {
  const d = new Date();
  const an = d.getFullYear();
  const luna = String(d.getMonth() + 1).padStart(2, '0');
  const zi = String(d.getDate()).padStart(2, '0');
  return `${an}-${luna}-${zi}`;
}

function formatData(dataOra: string): string {
  return new Date(dataOra).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function AlimentariAutoScreen() {
  const { role, loading: roleLoading } = useUserRole();

  const [masini, setMasini] = useState<Masina[]>([]);
  const [recente, setRecente] = useState<Alimentare[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [masinaSelectata, setMasinaSelectata] = useState('');
  const [data, setData] = useState(aziLocal());
  const [cantitate, setCantitate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const poateCompleta = role === 'admin_central' || role === 'admin_ferma';

  async function incarca() {
    setLoading(true);
    setLoadError(null);

    const [masiniRes, recenteRes] = await Promise.all([
      supabase.from('masini').select('id, nume, ferma_id, ferme(nume)').eq('activ', true).order('nume'),
      supabase
        .from('alimentari_masini')
        .select('id, data_ora, cantitate_litri, note, masini(nume, ferme(nume))')
        .order('data_ora', { ascending: false })
        .limit(50),
    ]);

    setLoading(false);
    setLoadedOnce(true);

    if (masiniRes.error) {
      setLoadError(masiniRes.error.message);
      return;
    }
    if (recenteRes.error) {
      setLoadError(recenteRes.error.message);
      return;
    }

    setMasini((masiniRes.data as unknown as Masina[]) ?? []);
    setRecente((recenteRes.data as unknown as Alimentare[]) ?? []);
  }

  useEffect(() => {
    if (poateCompleta) void incarca();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poateCompleta]);

  async function salveaza() {
    setSaveError(null);
    setSaveOk(false);

    const cant = Number(cantitate.replace(',', '.'));

    if (!masinaSelectata) {
      setSaveError('Alege mașina.');
      return;
    }
    if (!data) {
      setSaveError('Alege data.');
      return;
    }
    if (!cantitate.trim() || !Number.isFinite(cant) || cant <= 0) {
      setSaveError('Introdu o cantitate validă (litri).');
      return;
    }

    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const dataOra = new Date(`${data}T12:00:00`).toISOString();

    const { error: insertError } = await supabase.from('alimentari_masini').insert({
      masina_id: masinaSelectata,
      data_ora: dataOra,
      cantitate_litri: cant,
      note: note.trim() || null,
      user_id: user?.id ?? null,
    });

    setSaving(false);

    if (insertError) {
      setSaveError(insertError.message);
      return;
    }

    setSaveOk(true);
    setCantitate('');
    setNote('');
    void incarca();
  }

  if (roleLoading) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Se verifică accesul...</p>
      </main>
    );
  }

  if (!poateCompleta) {
    return (
      <main style={{ padding: '2rem' }}>
        <h1>Acces interzis</h1>
        <p>Această secțiune este disponibilă doar pentru administratori.</p>
      </main>
    );
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
        <h1 style={{ margin: 0 }}>Alimentări auto din rezervor fermă</h1>
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
        Pentru mașinile de pasageri care se alimentează direct din rezervorul central al fermei (nu la pompă) — nu
        pentru utilaje. Cantitatea introdusă aici e scăzută automat din nivelul rezervorului central la raportul de
        mișcări.
      </p>

      <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Înregistrează o alimentare</h2>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
            Mașină
            <select
              value={masinaSelectata}
              onChange={(e) => setMasinaSelectata(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '220px' }}
            >
              <option value="">Alege mașina</option>
              {masini.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nume}
                  {role === 'admin_central' && m.ferme?.nume ? ` — ${m.ferme.nume}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
            Data
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
            Cantitate (L)
            <input
              type="number"
              min="0"
              step="0.1"
              value={cantitate}
              onChange={(e) => setCantitate(e.target.value)}
              placeholder="litri"
              style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', width: '120px' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem', flex: '1 1 160px' }}>
            Notă (opțional)
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ex. bon nr. ..."
              style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
            />
          </label>

          <button
            onClick={() => void salveaza()}
            disabled={saving}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: saving ? '#eee' : '#f5f5f5',
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Se salvează...' : 'Salvează alimentare'}
          </button>
        </div>

        {saveError && <p style={{ color: '#b00020', margin: '0.6rem 0 0' }}>{saveError}</p>}
        {saveOk && !saveError && <p style={{ color: '#1a7a1a', margin: '0.6rem 0 0' }}>Alimentare înregistrată.</p>}
      </div>

      {loadError && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>
          {loadError}
        </p>
      )}

      {!loadedOnce && loading && <p>Se încarcă...</p>}

      {loadedOnce && !loadError && (
        <div style={{ overflowX: 'auto' }}>
          <h2 style={{ fontSize: '1.05rem' }}>Ultimele alimentări</h2>
          {recente.length === 0 ? (
            <p style={{ color: '#666' }}>Nicio alimentare înregistrată încă.</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                  <th style={{ padding: '0.4rem' }}>Data</th>
                  <th style={{ padding: '0.4rem' }}>Mașină</th>
                  {role === 'admin_central' && <th style={{ padding: '0.4rem' }}>Fermă</th>}
                  <th style={{ padding: '0.4rem' }}>Cantitate</th>
                  <th style={{ padding: '0.4rem' }}>Notă</th>
                </tr>
              </thead>
              <tbody>
                {recente.map((a) => (
                  <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.4rem', whiteSpace: 'nowrap' }}>{formatData(a.data_ora)}</td>
                    <td style={{ padding: '0.4rem' }}>{a.masini?.nume ?? '—'}</td>
                    {role === 'admin_central' && (
                      <td style={{ padding: '0.4rem' }}>{a.masini?.ferme?.nume ?? '—'}</td>
                    )}
                    <td style={{ padding: '0.4rem', fontWeight: 600 }}>{a.cantitate_litri} L</td>
                    <td style={{ padding: '0.4rem', color: '#666' }}>{a.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </main>
  );
}
