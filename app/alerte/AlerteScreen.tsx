'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

type Alerta = {
  id: string;
  masina_id: string;
  tip: string;
  viteza_masurata: number | null;
  viteza_limita: number | null;
  data_ora: string;
  vazuta: boolean;
  masini: { nume: string; numar_inmatriculare: string | null } | null;
  geofences: { nume: string } | null;
};

const TIP_LABEL: Record<string, string> = {
  viteza: '⚡ Depășire viteză',
  intrare_zona: '➡️ Intrare în zonă',
  iesire_zona: '⬅️ Ieșire din zonă',
};

export default function AlerteScreen() {
  const [alerte, setAlerte] = useState<Alerta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doarNecitite, setDoarNecitite] = useState(true);

  async function incarca() {
    setLoading(true);
    setError(null);
    let query = supabase
      .from('alerte')
      .select('id, masina_id, tip, viteza_masurata, viteza_limita, data_ora, vazuta, masini(nume, numar_inmatriculare), geofences(nume)')
      .order('data_ora', { ascending: false })
      .limit(200);

    if (doarNecitite) query = query.eq('vazuta', false);

    const { data, error: err } = await query;
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setAlerte((data as unknown as Alerta[]) ?? []);
  }

  useEffect(() => {
    void incarca();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doarNecitite]);

  async function marcheazaVazuta(id: string) {
    await supabase.from('alerte').update({ vazuta: true }).eq('id', id);
    setAlerte((prev) => (doarNecitite ? prev.filter((a) => a.id !== id) : prev.map((a) => (a.id === id ? { ...a, vazuta: true } : a))));
  }

  async function marcheazaToateVazute() {
    const ids = alerte.filter((a) => !a.vazuta).map((a) => a.id);
    if (ids.length === 0) return;
    await supabase.from('alerte').update({ vazuta: true }).in('id', ids);
    await incarca();
  }

  return (
    <main style={{ padding: 'clamp(0.75rem, 3vw, 1.5rem)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Alerte</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
            <input type="checkbox" checked={doarNecitite} onChange={(e) => setDoarNecitite(e.target.checked)} />
            Doar necitite
          </label>
          <button onClick={() => void marcheazaToateVazute()} style={{ padding: '0.5rem 0.9rem', borderRadius: '6px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}>
            Marchează toate ca citite
          </button>
        </div>
      </div>

      {error && <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>}
      {loading && <p>Se încarcă...</p>}
      {!loading && alerte.length === 0 && <p style={{ color: '#666' }}>Nicio alertă{doarNecitite ? ' necitită' : ''}.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
        {alerte.map((a) => (
          <div
            key={a.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem',
              border: '1px solid #eee',
              borderRadius: '8px',
              background: a.vazuta ? '#fff' : '#fff8ea',
            }}
          >
            <div>
              <strong>{TIP_LABEL[a.tip] ?? a.tip}</strong> — {a.masini?.nume ?? 'Mașină'}
              {a.masini?.numar_inmatriculare ? ` (${a.masini.numar_inmatriculare})` : ''}
              {a.tip === 'viteza' && (
                <div style={{ fontSize: '0.85rem', color: '#555' }}>
                  {a.viteza_masurata} km/h (limită {a.viteza_limita} km/h)
                </div>
              )}
              {a.geofences?.nume && <div style={{ fontSize: '0.85rem', color: '#555' }}>Zonă: {a.geofences.nume}</div>}
              <div style={{ fontSize: '0.8rem', color: '#888' }}>{new Date(a.data_ora).toLocaleString('ro-RO')}</div>
            </div>
            {!a.vazuta && (
              <button
                onClick={() => void marcheazaVazuta(a.id)}
                style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #1a4b8a', background: '#e8f0fe', color: '#1a4b8a', cursor: 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
              >
                Marchează citită
              </button>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
