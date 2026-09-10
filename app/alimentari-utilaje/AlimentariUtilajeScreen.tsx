'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';

type Utilaj = {
  id: string;
  nume: string;
  ferma_id: string;
  ferme: { nume: string } | null;
};

type Alimentare = {
  id: string;
  data_ora: string;
  cantitate_litri: number;
  note: string | null;
  utilaje: { nume: string; ferme: { nume: string } | null } | null;
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

export default function AlimentariUtilajeScreen() {
  const { role, loading: roleLoading } = useUserRole();

  const [utilaje, setUtilaje] = useState<Utilaj[]>([]);
  const [recente, setRecente] = useState<Alimentare[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [utilajSelectat, setUtilajSelectat] = useState('');
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

    const [utilajeRes, recenteRes] = await Promise.all([
      supabase.from('utilaje').select('id, nume, ferma_id, ferme(nume)').eq('activ', true).order('nume'),
      supabase
        .from('alimentari_utilaje')
        .select('id, data_ora, cantitate_litri, note, utilaje(nume, ferme(nume))')
        .order('data_ora', { ascending: false })
        .limit(50),
    ]);

    setLoading(false);
    setLoadedOnce(true);

    if (utilajeRes.error) {
      setLoadError(utilajeRes.error.message);
      return;
    }
    if (recenteRes.error) {
      setLoadError(recenteRes.error.message);
      return;
    }

    setUtilaje((utilajeRes.data as unknown as Utilaj[]) ?? []);
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

    if (!utilajSelectat) {
      setSaveError('Alege utilajul.');
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

    const { error: insertError } = await supabase.from('alimentari_utilaje').insert({
      utilaj_id: utilajSelectat,
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
        <h1 style={{ margin: 0 }}>Alimentări utilaje</h1>
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

      <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Înregistrează o alimentare</h2>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
            Utilaj
            <select
              value={utilajSelectat}
              onChange={(e) => setUtilajSelectat(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '220px' }}
            >
              <option value="">Alege utilajul</option>
              {utilaje.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nume}
                  {role === 'admin_central' && u.ferme?.nume ? ` — ${u.ferme.nume}` : ''}
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
                  <th style={{ padding: '0.4rem' }}>Utilaj</th>
                  {role === 'admin_central' && <th style={{ padding: '0.4rem' }}>Fermă</th>}
                  <th style={{ padding: '0.4rem' }}>Cantitate</th>
                  <th style={{ padding: '0.4rem' }}>Notă</th>
                </tr>
              </thead>
              <tbody>
                {recente.map((a) => (
                  <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.4rem', whiteSpace: 'nowrap' }}>{formatData(a.data_ora)}</td>
                    <td style={{ padding: '0.4rem' }}>{a.utilaje?.nume ?? '—'}</td>
                    {role === 'admin_central' && (
                      <td style={{ padding: '0.4rem' }}>{a.utilaje?.ferme?.nume ?? '—'}</td>
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
