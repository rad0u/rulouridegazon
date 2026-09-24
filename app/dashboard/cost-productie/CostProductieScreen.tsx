'use client';

import { Fragment, useState } from 'react';
import { supabase, supabaseUrl } from '../../../lib/supabaseClient';
import { useUserRole } from '../../../lib/useUserRole';

type RandParcela = {
  parcela_id: string;
  parcela_nume: string;
  labor: number;
  material: number;
  combustibil_litri: number;
  combustibil_cost: number | null;
  total: number;
};

type RandCost = {
  ferma_id: string;
  ferma: string;
  period: string;
  labor: number;
  material: number;
  indirect: number;
  combustibil_litri: number;
  combustibil_cost: number | null;
  combustibil_nealocat_litri: number;
  total: number;
  area: number;
  costPerMp: number;
  parcele: RandParcela[];
};

function formatLei(valoare: number): string {
  return valoare.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lei';
}

function formatPeriod(period: string): string {
  const [an, luna] = period.split('-');
  const nume = [
    'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
    'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
  ];
  const idx = Number(luna) - 1;
  return idx >= 0 && idx < 12 ? `${nume[idx]} ${an}` : period;
}

function cheie(r: RandCost): string {
  return `${r.ferma_id}-${r.period}`;
}

export default function CostProductieScreen() {
  const { role, loading: roleLoading } = useUserRole();

  const [rows, setRows] = useState<RandCost[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandat, setExpandat] = useState<Record<string, boolean>>({});

  async function incarca() {
    setLoading(true);
    setError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/get-cost-productie`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      setLoading(false);

      if (!res.ok) {
        setError(json?.error ?? 'Eroare la calculul costului de producție.');
        return;
      }

      setRows(json.rows as RandCost[]);
    } catch {
      setLoading(false);
      setError('Eroare de rețea la calculul costului de producție.');
    }
  }

  if (roleLoading) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Se verifică accesul...</p>
      </main>
    );
  }

  if (role !== 'admin_central') {
    return (
      <main style={{ padding: '2rem' }}>
        <h1>Acces interzis</h1>
        <p>Această secțiune este disponibilă doar pentru admin general.</p>
      </main>
    );
  }

  const totalGeneral = (rows ?? []).reduce((s, r) => s + r.total, 0);

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
        <h1 style={{ margin: 0 }}>Cost de producție</h1>
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
          {loading ? 'Se calculează...' : 'Reîncarcă'}
        </button>
      </div>

      <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
        Costuri directe (manoperă din operațiuni, substanțe consumate, motorină din citirile de sondă
        × prețul mediu al fiecărei alimentări a rezervorului) + costuri indirecte (facturi, salarii,
        chirii etc. de pe /cheltuieli-indirecte), pe fermă și lună calendaristică. Combustibilul apare
        cu cost doar din lunile de după prima alimentare a rezervorului cu preț înregistrat — pentru
        lunile mai vechi arată litrii consumați, dar fără cost (preț necunoscut). Apasă pe un rând
        pentru defalcarea pe parcele (manoperă, substanțe și motorina alocată din sesiunile GPS
        confirmate în /activitati-parcele — vezi și raportul dedicat „Combustibil pe parcele”).
      </p>

      {error && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>
      )}

      {!rows && !loading && !error && <p>Apasă „Reîncarcă” pentru a calcula costul de producție.</p>}

      {rows && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '0.4rem' }} />
                <th style={{ padding: '0.4rem' }}>Fermă</th>
                <th style={{ padding: '0.4rem' }}>Lună</th>
                <th style={{ padding: '0.4rem', textAlign: 'right' }}>Manoperă</th>
                <th style={{ padding: '0.4rem', textAlign: 'right' }}>Substanțe</th>
                <th style={{ padding: '0.4rem', textAlign: 'right' }}>Indirecte</th>
                <th style={{ padding: '0.4rem', textAlign: 'right' }}>Motorină</th>
                <th style={{ padding: '0.4rem', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '0.4rem', textAlign: 'right' }}>Suprafață</th>
                <th style={{ padding: '0.4rem', textAlign: 'right' }}>Cost / mp</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: '0.75rem', color: '#666' }}>
                    Niciun cost înregistrat încă (nici operațiuni, nici cheltuieli indirecte, nici consum de motorină).
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const k = cheie(r);
                const deschis = !!expandat[k];
                const areParcele = r.parcele.length > 0;
                return (
                  <Fragment key={k}>
                    <tr
                      onClick={() => areParcele && setExpandat((prev) => ({ ...prev, [k]: !prev[k] }))}
                      style={{ borderBottom: '1px solid #f0f0f0', cursor: areParcele ? 'pointer' : 'default' }}
                    >
                      <td style={{ padding: '0.4rem', color: '#999', width: '1.5rem' }}>
                        {areParcele ? (deschis ? '▾' : '▸') : ''}
                      </td>
                      <td style={{ padding: '0.4rem' }}>{r.ferma}</td>
                      <td style={{ padding: '0.4rem' }}>{formatPeriod(r.period)}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'right' }}>{formatLei(r.labor)}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'right' }}>{formatLei(r.material)}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'right' }}>{formatLei(r.indirect)}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'right' }}>
                        {r.combustibil_litri > 0 ? (
                          <>
                            {r.combustibil_litri} L
                            {r.combustibil_cost !== null ? ` — ${formatLei(r.combustibil_cost)}` : ' — preț necunoscut'}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '0.4rem', textAlign: 'right', fontWeight: 600 }}>{formatLei(r.total)}</td>
                      <td style={{ padding: '0.4rem', textAlign: 'right' }}>{r.area.toLocaleString('ro-RO')} mp</td>
                      <td style={{ padding: '0.4rem', textAlign: 'right' }}>{r.costPerMp.toFixed(2)} lei/mp</td>
                    </tr>
                    {deschis && areParcele && (
                      <tr key={`${k}-detaliu`}>
                        <td />
                        <td colSpan={9} style={{ padding: '0.5rem 0.4rem 1rem' }}>
                          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem', background: '#fafafa' }}>
                            <thead>
                              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                                <th style={{ padding: '0.3rem 0.5rem' }}>Parcelă</th>
                                <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>Manoperă</th>
                                <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>Substanțe</th>
                                <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>Motorină</th>
                                <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.parcele.map((p) => (
                                <tr key={p.parcela_id} style={{ borderBottom: '1px solid #eee' }}>
                                  <td style={{ padding: '0.3rem 0.5rem' }}>{p.parcela_nume}</td>
                                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{formatLei(p.labor)}</td>
                                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{formatLei(p.material)}</td>
                                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>
                                    {p.combustibil_litri > 0 ? (
                                      <>
                                        {p.combustibil_litri} L
                                        {p.combustibil_cost !== null ? ` — ${formatLei(p.combustibil_cost)}` : ''}
                                      </>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>{formatLei(p.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {r.combustibil_nealocat_litri > 0 && (
                            <p style={{ fontSize: '0.8rem', color: '#8a5a00', margin: '0.5rem 0 0' }}>
                              Motorină nealocată unei parcele (deplasare, staționare sau sesiuni neconfirmate încă în
                              /activitati-parcele): {r.combustibil_nealocat_litri} L.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={7} style={{ padding: '0.4rem', textAlign: 'right', fontWeight: 700 }}>
                    Total general
                  </td>
                  <td style={{ padding: '0.4rem', textAlign: 'right', fontWeight: 700 }}>{formatLei(totalGeneral)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </main>
  );
}
