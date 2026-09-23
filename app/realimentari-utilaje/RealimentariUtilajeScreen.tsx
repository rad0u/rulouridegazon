'use client';

import { useState } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';

// Raport pe o singură zi (aleasă de admin), gândit ca instrument de
// comparație rapidă: ce a detectat SONDA ca realimentare (din
// get-combustibil-report, v14 — interval custom de_la=pana_la=ziua aleasă)
// versus ce a înregistrat MANUAL operatoarea în /alimentari-utilaje, pentru
// aceeași zi. Radu, 2026-09-23: „ca sa pot compara cu ce are operatoarea" —
// nu mai afișăm o diferență calculată automat (am scos comparația din
// /combustibil la cererea lui) — aici e vorba de o verificare vizuală,
// manuală, punctuală, pe o zi anume, nu de un steag automat.

type RealimentareSonda = {
  utilaj: string;
  ferma: string | null;
  data_ora: string;
  litri: number;
};

type AlimentareManuala = {
  id: string;
  data_ora: string;
  litri: number;
  nota: string | null;
  utilaj: string;
  ferma: string | null;
};

type RezultatUtilajParcial = {
  utilaj_id: string;
  nume: string;
  ferma_nume: string | null;
  realimentari?: { data_ora: string; delta_litri: number }[];
  eroare?: string;
};

type RaportCombustibilParcial = {
  rezultate: RezultatUtilajParcial[];
};

function aziLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatOra(dataOra: string): string {
  return new Date(dataOra).toLocaleString('ro-RO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDataAfisata(data: string): string {
  return new Date(`${data}T12:00:00`).toLocaleDateString('ro-RO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function RealimentariUtilajeScreen() {
  const [data, setData] = useState(aziLocal());
  const [dataGenerata, setDataGenerata] = useState<string | null>(null);
  const [sonda, setSonda] = useState<RealimentareSonda[] | null>(null);
  const [manual, setManual] = useState<AlimentareManuala[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function genereaza() {
    if (!data) return;
    setLoading(true);
    setError(null);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      // Limitele zilei alese, interpretate în fusul orar al browserului (la
      // fel ca la înregistrarea manuală în /alimentari-utilaje) — suficient
      // de precis pentru un instrument de verificare punctuală.
      const inceputZi = new Date(`${data}T00:00:00`);
      const sfarsitZi = new Date(inceputZi.getTime() + 24 * 60 * 60 * 1000);

      const [resSonda, resManual] = await Promise.all([
        fetch(`${supabaseUrl}/functions/v1/get-combustibil-report?de_la=${data}&pana_la=${data}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        supabase
          .from('alimentari_utilaje')
          .select('id, data_ora, cantitate_litri, note, utilaje(nume, ferme(nume))')
          .gte('data_ora', inceputZi.toISOString())
          .lt('data_ora', sfarsitZi.toISOString())
          .order('data_ora', { ascending: true }),
      ]);

      const jsonSonda = await resSonda.json();

      if (!resSonda.ok) {
        setLoading(false);
        setError(jsonSonda?.error ?? 'Eroare la citirea realimentărilor detectate de sondă.');
        return;
      }
      if (resManual.error) {
        setLoading(false);
        setError(resManual.error.message);
        return;
      }

      const raportSonda = jsonSonda as RaportCombustibilParcial;
      const listaSonda: RealimentareSonda[] = [];
      for (const r of raportSonda.rezultate ?? []) {
        if (r.eroare) continue;
        for (const e of r.realimentari ?? []) {
          listaSonda.push({ utilaj: r.nume, ferma: r.ferma_nume, data_ora: e.data_ora, litri: e.delta_litri });
        }
      }
      listaSonda.sort((a, b) => (a.data_ora < b.data_ora ? -1 : 1));

      const randuriManuale = (resManual.data ?? []) as unknown as Array<{
        id: string;
        data_ora: string;
        cantitate_litri: number;
        note: string | null;
        utilaje: { nume: string; ferme: { nume: string } | null } | null;
      }>;
      const listaManuala: AlimentareManuala[] = randuriManuale.map((a) => ({
        id: a.id,
        data_ora: a.data_ora,
        litri: a.cantitate_litri,
        nota: a.note,
        utilaj: a.utilaje?.nume ?? '—',
        ferma: a.utilaje?.ferme?.nume ?? null,
      }));

      setSonda(listaSonda);
      setManual(listaManuala);
      setDataGenerata(data);
      setLoading(false);
    } catch (e) {
      setLoading(false);
      setError('Eroare de rețea la generarea raportului.');
    }
  }

  const totalSonda = sonda ? Math.round(sonda.reduce((s, e) => s + e.litri, 0) * 10) / 10 : 0;
  const totalManual = manual ? Math.round(manual.reduce((s, e) => s + e.litri, 0) * 10) / 10 : 0;

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
        <h1 style={{ margin: 0 }}>Realimentări utilaje</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
          />
          <button
            onClick={() => void genereaza()}
            disabled={loading || !data}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: loading ? '#eee' : '#f5f5f5',
              cursor: loading || !data ? 'default' : 'pointer',
            }}
          >
            {loading ? 'Se generează...' : 'Generează raport'}
          </button>
        </div>
      </div>

      <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
        Alege o zi și compară ce a detectat sonda ca realimentare (stânga) cu ce a înregistrat manual
        operatoarea în /alimentari-utilaje pentru aceeași zi (dreapta). E o verificare punctuală, vizuală —
        nu un steag automat; poate exista un decalaj de câteva ore între momentul real al alimentării și
        momentul în care sonda confirmă nivelul nou.
      </p>

      {error && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>
          {error}
        </p>
      )}

      {!dataGenerata && !loading && !error && (
        <p>Alege o dată și apasă „Generează raport".</p>
      )}

      {dataGenerata && (
        <>
          <h2 style={{ fontSize: '1.05rem', margin: '0.25rem 0 0' }}>{formatDataAfisata(dataGenerata)}</h2>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.4rem' }}>
                Detectate de sondă — {sonda?.length ?? 0} eveniment(e), {totalSonda} L
              </h3>
              {sonda && sonda.length === 0 ? (
                <p style={{ color: '#666', fontSize: '0.85rem' }}>Nicio realimentare detectată de sondă în această zi.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                        <th style={{ padding: '0.3rem' }}>Ora</th>
                        <th style={{ padding: '0.3rem' }}>Utilaj</th>
                        <th style={{ padding: '0.3rem' }}>Fermă</th>
                        <th style={{ padding: '0.3rem' }}>Litri</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sonda?.map((e, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '0.3rem', whiteSpace: 'nowrap' }}>{formatOra(e.data_ora)}</td>
                          <td style={{ padding: '0.3rem' }}>{e.utilaj}</td>
                          <td style={{ padding: '0.3rem' }}>{e.ferma ?? '—'}</td>
                          <td style={{ padding: '0.3rem', fontWeight: 600 }}>+{e.litri} L</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.4rem' }}>
                Înregistrate manual (operator) — {manual?.length ?? 0} înregistrare/ări, {totalManual} L
              </h3>
              {manual && manual.length === 0 ? (
                <p style={{ color: '#666', fontSize: '0.85rem' }}>Nicio alimentare înregistrată manual în această zi.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                        <th style={{ padding: '0.3rem' }}>Ora</th>
                        <th style={{ padding: '0.3rem' }}>Utilaj</th>
                        <th style={{ padding: '0.3rem' }}>Fermă</th>
                        <th style={{ padding: '0.3rem' }}>Litri</th>
                        <th style={{ padding: '0.3rem' }}>Notă</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manual?.map((a) => (
                        <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '0.3rem', whiteSpace: 'nowrap' }}>{formatOra(a.data_ora)}</td>
                          <td style={{ padding: '0.3rem' }}>{a.utilaj}</td>
                          <td style={{ padding: '0.3rem' }}>{a.ferma ?? '—'}</td>
                          <td style={{ padding: '0.3rem', fontWeight: 600 }}>+{a.litri} L</td>
                          <td style={{ padding: '0.3rem', color: '#666' }}>{a.nota ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
