'use client';

import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';

type Intrare = {
  id: number;
  tabel: string;
  operatie: 'INSERT' | 'UPDATE' | 'DELETE';
  rand_id: string | null;
  utilizator_id: string | null;
  utilizator_nume: string | null;
  utilizator_rol: string | null;
  date_vechi: Record<string, unknown> | null;
  date_noi: Record<string, unknown> | null;
  creat_la: string;
};

type Utilizator = { id: string; nume: string };

const NUME_TABELE: Record<string, string> = {
  ferme: 'Ferme',
  parcele: 'Parcele',
  operatiuni: 'Operațiuni',
  operatiuni_substante: 'Substanțe folosite (operațiuni)',
  substante: 'Stoc substanțe',
  substante_nomenclator: 'Nomenclator substanțe',
  utilaje: 'Utilaje',
  masini: 'Mașini',
  alimentari_utilaje: 'Alimentări utilaje',
  rezervor_alimentari: 'Alimentări rezervor central',
  cheltuieli_indirecte: 'Cheltuieli indirecte',
  curse: 'Curse',
  geofences: 'Zone (geofencing)',
  utilizatori: 'Utilizatori',
};

const NUME_OPERATII: Record<Intrare['operatie'], string> = {
  INSERT: 'Adăugat',
  UPDATE: 'Modificat',
  DELETE: 'Șters',
};

const CULOARE_OPERATII: Record<Intrare['operatie'], string> = {
  INSERT: '#2e7d32',
  UPDATE: '#a15c00',
  DELETE: '#b00020',
};

// Câmpuri prea „zgomotoase" sau irelevante pentru afișarea diferențelor —
// nu ascund datele (rămân în date_vechi/date_noi), doar nu le arătăm ca
// linii separate în lista de schimbări.
const CAMPURI_ASCUNSE = new Set(['id', 'created_at']);

function formatValoare(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function diferente(vechi: Record<string, unknown> | null, nou: Record<string, unknown> | null) {
  const chei = new Set([...(vechi ? Object.keys(vechi) : []), ...(nou ? Object.keys(nou) : [])]);
  const rezultat: { camp: string; vechi: unknown; nou: unknown }[] = [];
  for (const camp of chei) {
    if (CAMPURI_ASCUNSE.has(camp)) continue;
    const v = vechi ? vechi[camp] : undefined;
    const n = nou ? nou[camp] : undefined;
    if (vechi && nou && JSON.stringify(v) === JSON.stringify(n)) continue;
    rezultat.push({ camp, vechi: v, nou: n });
  }
  return rezultat.sort((a, b) => a.camp.localeCompare(b.camp));
}

function formatData(data: string): string {
  return new Date(data).toLocaleString('ro-RO');
}

const PAGE_SIZE = 50;

export default function JurnalActivitateScreen() {
  const { role, loading: roleLoading } = useUserRole();

  const [intrari, setIntrari] = useState<Intrare[]>([]);
  const [utilizatori, setUtilizatori] = useState<Utilizator[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maiSuntRanduri, setMaiSuntRanduri] = useState(true);
  const [extins, setExtins] = useState<number | null>(null);

  const [filtruTabel, setFiltruTabel] = useState('');
  const [filtruUtilizator, setFiltruUtilizator] = useState('');
  const [filtruDataStart, setFiltruDataStart] = useState('');
  const [filtruDataStop, setFiltruDataStop] = useState('');

  useEffect(() => {
    void supabase
      .from('utilizatori')
      .select('id, nume')
      .order('nume')
      .then(({ data }) => setUtilizatori((data as Utilizator[]) ?? []));
  }, []);

  async function incarca(reset: boolean) {
    setLoading(true);
    setError(null);

    const offset = reset ? 0 : intrari.length;

    let query = supabase
      .from('jurnal_activitate')
      .select('id, tabel, operatie, rand_id, utilizator_id, utilizator_nume, utilizator_rol, date_vechi, date_noi, creat_la')
      .order('creat_la', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (filtruTabel) query = query.eq('tabel', filtruTabel);
    if (filtruUtilizator) query = query.eq('utilizator_id', filtruUtilizator);
    if (filtruDataStart) query = query.gte('creat_la', `${filtruDataStart}T00:00:00`);
    if (filtruDataStop) query = query.lte('creat_la', `${filtruDataStop}T23:59:59`);

    const { data, error: queryError } = await query;

    setLoading(false);
    setLoadedOnce(true);

    if (queryError) {
      setError(queryError.message);
      return;
    }

    const pagina = (data as Intrare[]) ?? [];
    setMaiSuntRanduri(pagina.length === PAGE_SIZE);
    setIntrari(reset ? pagina : [...intrari, ...pagina]);
  }

  useEffect(() => {
    if (role === 'admin_central') void incarca(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  function aplicaFiltre() {
    setExtins(null);
    void incarca(true);
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
        <h1 style={{ margin: 0 }}>Jurnal de activitate</h1>
        <button
          onClick={() => void incarca(true)}
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
        Cine a adăugat, modificat sau șters date în aplicație — admin general și admin de fermă
        deopotrivă. Nu include sincronizările automate (ex. citirile de la sonde).
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          Tabel
          <select
            value={filtruTabel}
            onChange={(e) => setFiltruTabel(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '180px' }}
          >
            <option value="">Toate</option>
            {Object.entries(NUME_TABELE).map(([tabel, nume]) => (
              <option key={tabel} value={tabel}>
                {nume}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          Utilizator
          <select
            value={filtruUtilizator}
            onChange={(e) => setFiltruUtilizator(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '160px' }}
          >
            <option value="">Toți</option>
            {utilizatori.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nume}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          De la data
          <input
            type="date"
            value={filtruDataStart}
            onChange={(e) => setFiltruDataStart(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
          Până la data
          <input
            type="date"
            value={filtruDataStop}
            onChange={(e) => setFiltruDataStop(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
          />
        </label>
        <button
          onClick={aplicaFiltre}
          disabled={loading}
          style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}
        >
          Filtrează
        </button>
      </div>

      {error && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '0.4rem' }}>Data/ora</th>
              <th style={{ padding: '0.4rem' }}>Utilizator</th>
              <th style={{ padding: '0.4rem' }}>Tabel</th>
              <th style={{ padding: '0.4rem' }}>Operație</th>
              <th style={{ padding: '0.4rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {loadedOnce && intrari.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '0.75rem', color: '#666' }}>
                  Nicio activitate înregistrată pentru filtrele alese.
                </td>
              </tr>
            )}
            {intrari.map((i) => {
              const deschis = extins === i.id;
              const diffs = diferente(i.date_vechi, i.date_noi);
              return (
                <Fragment key={i.id}>
                  <tr
                    onClick={() => setExtins(deschis ? null : i.id)}
                    style={{ borderBottom: '1px solid #f0f0f0', background: deschis ? '#eef6ff' : undefined, cursor: 'pointer' }}
                  >
                    <td style={{ padding: '0.4rem', whiteSpace: 'nowrap' }}>{formatData(i.creat_la)}</td>
                    <td style={{ padding: '0.4rem' }}>
                      {i.utilizator_nume ?? 'sistem'}
                      {i.utilizator_rol && (
                        <span style={{ color: '#888' }}> ({i.utilizator_rol === 'admin_central' ? 'admin general' : i.utilizator_rol === 'admin_ferma' ? 'admin fermă' : i.utilizator_rol})</span>
                      )}
                    </td>
                    <td style={{ padding: '0.4rem' }}>{NUME_TABELE[i.tabel] ?? i.tabel}</td>
                    <td style={{ padding: '0.4rem', color: CULOARE_OPERATII[i.operatie], fontWeight: 600 }}>
                      {NUME_OPERATII[i.operatie]}
                    </td>
                    <td style={{ padding: '0.4rem', color: '#666', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {deschis ? 'Ascunde ▲' : 'Detalii ▼'}
                    </td>
                  </tr>
                  {deschis && (
                    <tr>
                      <td colSpan={5} style={{ padding: '0.6rem 0.75rem', background: '#fafafa' }}>
                        {diffs.length === 0 ? (
                          <span style={{ color: '#666' }}>Fără câmpuri de afișat.</span>
                        ) : (
                          <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <tbody>
                              {diffs.map((d) => (
                                <tr key={d.camp}>
                                  <td style={{ padding: '0.15rem 0.75rem 0.15rem 0', color: '#666', verticalAlign: 'top' }}>{d.camp}</td>
                                  {i.operatie === 'UPDATE' ? (
                                    <td style={{ padding: '0.15rem 0' }}>
                                      <span style={{ color: '#b00020', textDecoration: 'line-through' }}>{formatValoare(d.vechi)}</span>
                                      {' → '}
                                      <span style={{ color: '#2e7d32' }}>{formatValoare(d.nou)}</span>
                                    </td>
                                  ) : (
                                    <td style={{ padding: '0.15rem 0' }}>{formatValoare(i.operatie === 'DELETE' ? d.vechi : d.nou)}</td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
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

      {maiSuntRanduri && intrari.length > 0 && (
        <button
          onClick={() => void incarca(false)}
          disabled={loading}
          style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer', alignSelf: 'center' }}
        >
          {loading ? 'Se încarcă...' : 'Încarcă mai multe'}
        </button>
      )}
    </main>
  );
}
