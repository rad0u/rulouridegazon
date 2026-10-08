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
//
// v2, 2026-10-08 (Radu): "in anumite situatii, se alimenteaza camioane din
// rezervorul central Sabareni, care nu apartin Fermei. Vreau sa avem
// posibilitatea de alimentare auto din rezervor ferma, fara ca auto sa fie in
// baza noastra de date" -- formularul permite acum "Auto extern": în loc să
// alegi o mașină din flotă, introduci numărul auto (obligatoriu) + beneficiar
// și șofer (opționale), ca text liber, și alegi ferma al cărei rezervor a fost
// folosit. Se salvează în `alimentari_masini` cu `masina_id` NULL și
// `ferma_id` + `auto_extern_*` (vezi supabase/schema-alimentari-auto-extern.sql)
// și se scade din rezervorul central ca orice altă alimentare auto.

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
  auto_extern_numar: string | null;
  auto_extern_beneficiar: string | null;
  auto_extern_sofer: string | null;
  masini: { nume: string; ferme: { nume: string } | null } | null;
  ferme: { nume: string } | null;
};

type FermaOpt = { id: string; nume: string };

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

  const [tipAuto, setTipAuto] = useState<'flota' | 'extern'>('flota');
  const [fermeOptiuni, setFermeOptiuni] = useState<FermaOpt[]>([]);
  const [fermaProprie, setFermaProprie] = useState<string | null>(null);
  const [fermaExtern, setFermaExtern] = useState('');
  const [externNumar, setExternNumar] = useState('');
  const [externBeneficiar, setExternBeneficiar] = useState('');
  const [externSofer, setExternSofer] = useState('');

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

    const [masiniRes, recenteRes, fermeRes] = await Promise.all([
      supabase.from('masini').select('id, nume, ferma_id, ferme(nume)').eq('activ', true).order('nume'),
      supabase
        .from('alimentari_masini')
        .select(
          'id, data_ora, cantitate_litri, note, auto_extern_numar, auto_extern_beneficiar, auto_extern_sofer, masini(nume, ferme(nume)), ferme(nume)',
        )
        .order('data_ora', { ascending: false })
        .limit(50),
      // admin_central: toate fermele; admin_ferma: RLS întoarce doar ferma lui.
      supabase.from('ferme').select('id, nume').order('nume'),
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

    const fermeLista = (fermeRes.data as FermaOpt[]) ?? [];
    setFermeOptiuni(fermeLista);
    if (role === 'admin_ferma') {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase.from('utilizatori').select('ferma_id').eq('id', user.id).single();
        setFermaProprie((prof?.ferma_id as string) ?? null);
      }
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

    const fermaDeFolosit = role === 'admin_ferma' ? fermaProprie : fermaExtern;

    if (tipAuto === 'flota' && !masinaSelectata) {
      setSaveError('Alege mașina.');
      return;
    }
    if (tipAuto === 'extern') {
      if (!externNumar.trim()) {
        setSaveError('Introdu numărul de înmatriculare al autovehiculului extern.');
        return;
      }
      if (!fermaDeFolosit) {
        setSaveError('Alege ferma din al cărei rezervor s-a alimentat.');
        return;
      }
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
      masina_id: tipAuto === 'flota' ? masinaSelectata : null,
      ferma_id: tipAuto === 'extern' ? fermaDeFolosit : null,
      auto_extern_numar: tipAuto === 'extern' ? externNumar.trim().toUpperCase() : null,
      auto_extern_beneficiar: tipAuto === 'extern' ? externBeneficiar.trim() || null : null,
      auto_extern_sofer: tipAuto === 'extern' ? externSofer.trim() || null : null,
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
    setExternNumar('');
    setExternBeneficiar('');
    setExternSofer('');
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
        Pentru autovehiculele care se alimentează direct din rezervorul central al fermei (nu la pompă) — nu pentru
        utilaje. Mașinile din flotă se aleg din listă; camioanele sau alte autovehicule care nu aparțin fermei se
        înregistrează ca „Auto extern”, doar cu număr (și, opțional, beneficiar/șofer). Cantitatea introdusă aici e
        scăzută automat din nivelul rezervorului central la raportul de mișcări.
      </p>

      <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Înregistrează o alimentare</h2>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem', flex: '1 1 100%' }}>
            <span>Tip autovehicul</span>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem' }}>
                <input type="radio" name="tipAuto" checked={tipAuto === 'flota'} onChange={() => setTipAuto('flota')} />
                Auto din flotă
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem' }}>
                <input type="radio" name="tipAuto" checked={tipAuto === 'extern'} onChange={() => setTipAuto('extern')} />
                Auto extern (nu e în baza de date)
              </label>
            </div>
          </div>

          {tipAuto === 'flota' ? (
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
          ) : (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                Număr auto *
                <input
                  type="text"
                  value={externNumar}
                  onChange={(e) => setExternNumar(e.target.value)}
                  placeholder="ex. B 123 ABC"
                  style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', width: '150px' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                Beneficiar / firmă
                <input
                  type="text"
                  value={externBeneficiar}
                  onChange={(e) => setExternBeneficiar(e.target.value)}
                  placeholder="opțional"
                  style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', width: '180px' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                Șofer
                <input
                  type="text"
                  value={externSofer}
                  onChange={(e) => setExternSofer(e.target.value)}
                  placeholder="opțional"
                  style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', width: '150px' }}
                />
              </label>
              {role === 'admin_central' && (
                <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                  Rezervor fermă *
                  <select
                    value={fermaExtern}
                    onChange={(e) => setFermaExtern(e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '180px' }}
                  >
                    <option value="">Alege ferma</option>
                    {fermeOptiuni.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nume}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

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
                    <td style={{ padding: '0.4rem' }}>
                      {a.masini?.nume ?? (
                        <>
                          <strong>{a.auto_extern_numar ?? '—'}</strong>{' '}
                          <span style={{ fontSize: '0.75rem', color: '#8a5a00' }}>extern</span>
                          {(a.auto_extern_beneficiar || a.auto_extern_sofer) && (
                            <div style={{ fontSize: '0.8rem', color: '#666' }}>
                              {[a.auto_extern_beneficiar, a.auto_extern_sofer].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    {role === 'admin_central' && (
                      <td style={{ padding: '0.4rem' }}>{a.masini?.ferme?.nume ?? a.ferme?.nume ?? '—'}</td>
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
