'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';

type Masina = { id: string; nume: string; numar_inmatriculare: string | null };

type Cursa = {
  id: string;
  masina_id: string;
  sofer_id: string | null;
  data_ora_start: string;
  data_ora_stop: string | null;
  km: number | null;
  scop: string | null;
  status: string;
  note: string | null;
  masini: { nume: string; numar_inmatriculare: string | null } | null;
  utilizatori: { nume: string } | null;
};

const SCOPURI = [
  'Livrare / distribuție',
  'Aprovizionare',
  'Întâlnire client / partener',
  'Deplasare între ferme / sediu',
  'Altele',
];

function formatInterval(start: string, stop: string | null) {
  const d1 = new Date(start);
  const dataStr = d1.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
  const oraStart = d1.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  const oraStop = stop
    ? new Date(stop).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
    : 'în desfășurare';
  return `${dataStr}, ${oraStart} → ${oraStop}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; bg: string; color: string }> = {
    detectata: { text: 'De completat', bg: '#fff4e0', color: '#8a5a00' },
    completata: { text: 'Completată', bg: '#e6f4ea', color: '#1a6b34' },
    validata: { text: 'Validată', bg: '#e8f0fe', color: '#1a4b8a' },
  };
  const s = map[status] ?? { text: status, bg: '#eee', color: '#333' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '0.2rem 0.55rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 600 }}>
      {s.text}
    </span>
  );
}

// Formular scop, folosit atât în cardurile mobile (șofer), cât și în tabelul
// admin — un singur cod, două randări.
function FormularScop({
  cursa,
  onSalveaza,
}: {
  cursa: Cursa;
  onSalveaza: (id: string, scop: string, note: string | null) => Promise<void>;
}) {
  const scopInitial = cursa.scop && SCOPURI.includes(cursa.scop) ? cursa.scop : cursa.scop ? 'Altele' : '';
  const [scop, setScop] = useState(scopInitial);
  const [altText, setAltText] = useState(scopInitial === 'Altele' ? cursa.scop ?? '' : '');
  const [note, setNote] = useState(cursa.note ?? '');
  const [saving, setSaving] = useState(false);

  async function salveaza() {
    const scopFinal = scop === 'Altele' ? altText.trim() : scop;
    if (!scopFinal) return;
    setSaving(true);
    await onSalveaza(cursa.id, scopFinal, note.trim() || null);
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
      <select
        value={scop}
        onChange={(e) => setScop(e.target.value)}
        style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '1rem' }}
      >
        <option value="">Alege scopul cursei…</option>
        {SCOPURI.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {scop === 'Altele' && (
        <input
          type="text"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          placeholder="Descrie scopul cursei"
          style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '1rem' }}
        />
      )}
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notă opțională"
        style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #ccc', fontSize: '1rem' }}
      />
      <button
        onClick={() => void salveaza()}
        disabled={saving || (!scop || (scop === 'Altele' && !altText.trim()))}
        style={{ padding: '0.7rem', borderRadius: '6px', border: 'none', background: '#2e7d32', color: '#fff', fontWeight: 600, fontSize: '1rem' }}
      >
        {saving ? 'Salvez...' : 'Salvează'}
      </button>
    </div>
  );
}

export default function CurseScreen() {
  const { role, loading: roleLoading } = useUserRole();
  const [curse, setCurse] = useState<Cursa[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [masini, setMasini] = useState<Masina[]>([]);
  const [masinaId, setMasinaId] = useState<string>('');
  const [editRow, setEditRow] = useState<string | null>(null);

  async function incarcaCurseleSofer() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('curse')
      .select('id, masina_id, sofer_id, data_ora_start, data_ora_stop, km, scop, status, note, masini(nume, numar_inmatriculare)')
      .order('data_ora_start', { ascending: false })
      .limit(60);
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setCurse((data as unknown as Cursa[]) ?? []);
  }

  async function incarcaMasini() {
    const { data } = await supabase.from('masini').select('id, nume, numar_inmatriculare').eq('activ', true).order('nume');
    setMasini((data as Masina[]) ?? []);
  }

  async function incarcaCurseleMasina(id: string) {
    if (!id) {
      setCurse([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('curse')
      .select('id, masina_id, sofer_id, data_ora_start, data_ora_stop, km, scop, status, note, utilizatori(nume)')
      .eq('masina_id', id)
      .order('data_ora_start', { ascending: false })
      .limit(200);
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setCurse((data as unknown as Cursa[]) ?? []);
  }

  useEffect(() => {
    if (role === 'sofer') void incarcaCurseleSofer();
    if (role === 'admin_central') void incarcaMasini();
  }, [role]);

  async function salveazaScop(id: string, scop: string, note: string | null) {
    const cursaVeche = curse.find((c) => c.id === id);
    const statusNou = cursaVeche?.status === 'validata' ? 'validata' : 'completata';
    const { error: err } = await supabase.from('curse').update({ scop, note, status: statusNou }).eq('id', id);
    if (err) {
      setError(err.message);
      return;
    }
    if (role === 'sofer') await incarcaCurseleSofer();
    else await incarcaCurseleMasina(masinaId);
    setEditRow(null);
  }

  async function valideaza(id: string) {
    const { error: err } = await supabase.from('curse').update({ status: 'validata' }).eq('id', id);
    if (err) {
      setError(err.message);
      return;
    }
    await incarcaCurseleMasina(masinaId);
  }

  if (roleLoading) {
    return (
      <main style={{ padding: '1.5rem' }}>
        <p>Se verifică accesul...</p>
      </main>
    );
  }

  if (role !== 'sofer' && role !== 'admin_central') {
    return (
      <main style={{ padding: '1.5rem' }}>
        <h1>Acces interzis</h1>
        <p>Această secțiune este disponibilă doar pentru șoferi și admin general.</p>
      </main>
    );
  }

  // --- Vedere șofer: carduri, mobil-first ---
  if (role === 'sofer') {
    return (
      <main style={{ padding: 'clamp(0.75rem, 4vw, 1.5rem)', maxWidth: '640px', margin: '0 auto' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Cursele mele</h1>
        <p style={{ marginTop: 0, color: '#666' }}>
          Traseul se înregistrează automat din GPS. Completează doar scopul fiecărei curse.
        </p>

        {error && <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>}
        {loading && <p>Se încarcă...</p>}
        {!loading && curse.length === 0 && <p>Nicio cursă înregistrată încă.</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {curse.map((c) => (
            <div key={c.id} style={{ border: '1px solid #ddd', borderRadius: '10px', padding: '0.9rem', background: c.status === 'detectata' ? '#fffdf5' : '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                <div>
                  <strong>{c.masini?.nume ?? 'Mașină'}</strong>
                  {c.masini?.numar_inmatriculare ? ` (${c.masini.numar_inmatriculare})` : ''}
                  <div style={{ color: '#666', fontSize: '0.9rem' }}>{formatInterval(c.data_ora_start, c.data_ora_stop)}</div>
                </div>
                <StatusBadge status={c.status} />
              </div>

              <div style={{ marginTop: '0.4rem', fontSize: '0.95rem' }}>
                <strong>{c.km !== null ? `${c.km} km` : '— km'}</strong>
                {c.scop && <span style={{ color: '#444' }}> · {c.scop}</span>}
              </div>

              {c.status !== 'validata' && (
                <FormularScop cursa={c} onSalveaza={salveazaScop} />
              )}
            </div>
          ))}
        </div>
      </main>
    );
  }

  // --- Vedere admin: tabel per mașină, cu validare ---
  return (
    <main style={{ padding: 'clamp(0.75rem, 3vw, 1.5rem)' }}>
      <h1>Curse</h1>
      <p>Alege o mașină pentru a vedea și valida cursele detectate.</p>

      <label style={{ display: 'block', maxWidth: '360px', marginBottom: '1rem' }}>
        Mașină
        <select
          value={masinaId}
          onChange={(e) => {
            setMasinaId(e.target.value);
            void incarcaCurseleMasina(e.target.value);
          }}
          style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.6rem' }}
        >
          <option value="">Alege mașină</option>
          {masini.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nume} {m.numar_inmatriculare ? `(${m.numar_inmatriculare})` : ''}
            </option>
          ))}
        </select>
      </label>

      {error && <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>}
      {loading && <p>Se încarcă...</p>}

      {!loading && masinaId && curse.length === 0 && <p>Nicio cursă înregistrată pentru această mașină.</p>}

      {!loading && curse.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '0.4rem' }}>Interval</th>
                <th style={{ padding: '0.4rem' }}>Șofer</th>
                <th style={{ padding: '0.4rem' }}>Km</th>
                <th style={{ padding: '0.4rem' }}>Scop</th>
                <th style={{ padding: '0.4rem' }}>Status</th>
                <th style={{ padding: '0.4rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {curse.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' }}>
                  <td style={{ padding: '0.4rem', whiteSpace: 'nowrap' }}>{formatInterval(c.data_ora_start, c.data_ora_stop)}</td>
                  <td style={{ padding: '0.4rem' }}>{c.utilizatori?.nume ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{c.km ?? '—'}</td>
                  <td style={{ padding: '0.4rem', minWidth: '220px' }}>
                    {editRow === c.id ? (
                      <FormularScop cursa={c} onSalveaza={salveazaScop} />
                    ) : (
                      <span onClick={() => setEditRow(c.id)} style={{ cursor: 'pointer' }}>
                        {c.scop ?? <em style={{ color: '#999' }}>— completează —</em>}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.4rem' }}>
                    <StatusBadge status={c.status} />
                  </td>
                  <td style={{ padding: '0.4rem' }}>
                    {c.status === 'completata' && (
                      <button
                        onClick={() => void valideaza(c.id)}
                        style={{ padding: '0.4rem 0.7rem', borderRadius: '6px', border: '1px solid #1a4b8a', background: '#e8f0fe', color: '#1a4b8a', cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        Validează
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
