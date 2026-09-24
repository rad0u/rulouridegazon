'use client';

// app/combustibil-parcele/CombustibilParceleScreen.tsx
//
// Raport NOU (2026-09-24, cerere Radu): consum de motorină alocat pe
// PARCELĂ, per utilaj, pentru un interval ales — vezi get-combustibil-parcele
// pentru explicația completă a calculului (sesiuni GPS confirmate din
// /activitati-parcele + bilanț de masă pe fiecare sesiune). Înlocuiește
// vechiul /combustibil ca raport principal de combustibil (Radu: "pagina
// veche nu mă mai interesează") — link-ul din meniu duce acum aici.

import { useEffect, useState } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';

type ParcelaLinie = {
  parcela_id: string;
  parcela_nume: string;
  ore_total: number;
  litri_total: number | null;
  numar_sesiuni: number;
};

type ZiConsum = {
  data: string;
  consum_litri: number;
  ore_functionare: number;
};

type RezultatUtilaj = {
  utilaj_id: string;
  nume: string;
  ferma_nume: string | null;
  calibrat: boolean;
  parcele: ParcelaLinie[];
  consum_zilnic: ZiConsum[];
  eroare?: string;
};

type Raport = {
  de_la: string;
  pana_la: string | null;
  rezultate: RezultatUtilaj[];
};

type Ferma = { id: string; nume: string };

function formatData(data: string): string {
  return new Date(`${data}T12:00:00`).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function primaZiLuniiCurente(): string {
  const acum = new Date();
  return `${acum.getFullYear()}-${String(acum.getMonth() + 1).padStart(2, '0')}-01`;
}

function aziStr(): string {
  const acum = new Date();
  return `${acum.getFullYear()}-${String(acum.getMonth() + 1).padStart(2, '0')}-${String(acum.getDate()).padStart(2, '0')}`;
}

export default function CombustibilParceleScreen() {
  const [deLa, setDeLa] = useState(primaZiLuniiCurente());
  const [panaLa, setPanaLa] = useState(aziStr());
  const [fermaId, setFermaId] = useState('');
  const [ferme, setFerme] = useState<Ferma[]>([]);

  const [raport, setRaport] = useState<Raport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandatZilnic, setExpandatZilnic] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('ferme').select('id, nume').order('nume');
      setFerme((data as Ferma[]) ?? []);
    })();
  }, []);

  async function incarca() {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (deLa) params.set('de_la', deLa);
    if (panaLa) params.set('pana_la', panaLa);
    if (fermaId) params.set('ferma_id', fermaId);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/get-combustibil-parcele?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setLoading(false);

      if (!res.ok) {
        setError(json?.error ?? 'Eroare la încărcarea raportului.');
        return;
      }
      setRaport(json as Raport);
    } catch {
      setLoading(false);
      setError('Eroare de rețea la încărcarea raportului.');
    }
  }

  useEffect(() => {
    void incarca();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cuActivitate = (raport?.rezultate ?? []).filter((u) => u.parcele.length > 0 || (u.eroare != null));
  const faraActivitate = (raport?.rezultate ?? []).filter((u) => u.parcele.length === 0 && u.eroare == null);

  return (
    <main style={{ padding: 'clamp(0.75rem, 3vw, 1.5rem)' }}>
      <h1>Combustibil pe parcele</h1>
      <p style={{ color: '#555', maxWidth: '760px' }}>
        Pentru fiecare utilaj, orele lucrate și motorina consumată pe fiecare parcelă în intervalul ales — calculate
        din sesiunile GPS confirmate în /activitati-parcele (dacă un utilaj a lucrat fragmentat pe aceeași parcelă,
        sesiunile se însumează). Alături, consumul total cumulat pe zi, ca reper — diferența față de suma alocată pe
        parcele e timp/motorină nealocat(ă) unei sesiuni confirmate (deplasare, staționare, sesiuni neconfirmate
        încă).
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <label>
          De la
          <input
            type="date"
            value={deLa}
            onChange={(e) => setDeLa(e.target.value)}
            style={{ display: 'block', padding: '0.55rem', marginTop: '0.3rem' }}
          />
        </label>
        <label>
          Până la
          <input
            type="date"
            value={panaLa}
            onChange={(e) => setPanaLa(e.target.value)}
            style={{ display: 'block', padding: '0.55rem', marginTop: '0.3rem' }}
          />
        </label>
        <label>
          Fermă
          <select
            value={fermaId}
            onChange={(e) => setFermaId(e.target.value)}
            style={{ display: 'block', padding: '0.55rem', marginTop: '0.3rem', minWidth: '180px' }}
          >
            <option value="">Toate fermele</option>
            {ferme.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nume}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void incarca()}
          disabled={loading}
          style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #2e7d32', background: '#2e7d32', color: '#fff', cursor: 'pointer' }}
        >
          {loading ? 'Se încarcă...' : 'Generează'}
        </button>
      </div>

      {error && <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>}

      {raport && cuActivitate.length === 0 && faraActivitate.length === 0 && (
        <p style={{ color: '#666' }}>Niciun utilaj activ.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {cuActivitate.map((u) => (
          <section key={u.utilaj_id} style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div>
                <strong>{u.nume}</strong>
                {u.ferma_nume ? <span style={{ color: '#888' }}> — {u.ferma_nume}</span> : null}
                {!u.calibrat && (
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: '#8a5a00' }}>
                    (fără senzor de combustibil — doar ore)
                  </span>
                )}
              </div>
              {u.consum_zilnic.length > 0 && (
                <button
                  onClick={() => setExpandatZilnic(expandatZilnic === u.utilaj_id ? null : u.utilaj_id)}
                  style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  {expandatZilnic === u.utilaj_id ? 'Ascunde consumul zilnic total' : 'Vezi consumul zilnic total'}
                </button>
              )}
            </div>

            {u.eroare && <p style={{ color: '#b00020' }}>{u.eroare}</p>}

            {u.parcele.length > 0 && (
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #333' }}>
                    <th style={{ padding: '0.4rem' }}>Parcelă</th>
                    <th style={{ padding: '0.4rem', textAlign: 'right' }}>Ore lucrate</th>
                    <th style={{ padding: '0.4rem', textAlign: 'right' }}>Litri consumați</th>
                    <th style={{ padding: '0.4rem', textAlign: 'right' }}>Sesiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {u.parcele.map((p) => (
                    <tr key={p.parcela_id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '0.4rem' }}>{p.parcela_nume}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'right' }}>{p.ore_total}h</td>
                      <td style={{ padding: '0.4rem', textAlign: 'right' }}>{p.litri_total ?? '—'}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'right' }}>{p.numar_sesiuni}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #333', fontWeight: 700 }}>
                    <td style={{ padding: '0.4rem' }}>Total alocat pe parcele:</td>
                    <td style={{ padding: '0.4rem', textAlign: 'right' }}>
                      {Math.round(u.parcele.reduce((s, p) => s + p.ore_total, 0) * 10) / 10}h
                    </td>
                    <td style={{ padding: '0.4rem', textAlign: 'right' }}>
                      {u.calibrat ? Math.round(u.parcele.reduce((s, p) => s + (p.litri_total ?? 0), 0) * 10) / 10 : '—'}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}

            {expandatZilnic === u.utilaj_id && u.consum_zilnic.length > 0 && (
              <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dashed #ccc' }}>
                <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 0.4rem' }}>
                  Consum total cumulat pe zi (bilanț de masă complet, indiferent de parcelă) — reper pentru cât din
                  total a rămas nealocat unei parcele confirmate.
                </p>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                      <th style={{ padding: '0.3rem' }}>Zi</th>
                      <th style={{ padding: '0.3rem', textAlign: 'right' }}>Ore funcționare</th>
                      <th style={{ padding: '0.3rem', textAlign: 'right' }}>Consum total (L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.consum_zilnic.map((z) => (
                      <tr key={z.data}>
                        <td style={{ padding: '0.3rem' }}>{formatData(z.data)}</td>
                        <td style={{ padding: '0.3rem', textAlign: 'right' }}>{z.ore_functionare}h</td>
                        <td style={{ padding: '0.3rem', textAlign: 'right' }}>{z.consum_litri}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>

      {faraActivitate.length > 0 && (
        <p style={{ color: '#888', fontSize: '0.85rem', marginTop: '1rem' }}>
          Fără activitate confirmată pe nicio parcelă în interval: {faraActivitate.map((u) => u.nume).join(', ')}. (Vezi
          /activitati-parcele — sesiunile detectate trebuie confirmate acolo înainte să apară aici.)
        </p>
      )}
    </main>
  );
}
