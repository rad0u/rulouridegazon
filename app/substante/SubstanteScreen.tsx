'use client';

import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';

type NomenclatorItem = { id: string; nume: string; unitate_masura: string };
type Ferma = { id: string; nume: string };

type SubstantaStoc = {
  id: string;
  nume: string;
  unitate_masura: string;
  stoc_curent: number;
  pret_unitar: number | null;
  ferma_id: string | null;
  ferme: { nume: string } | null;
};

type Intrare = {
  id: string;
  cantitate: number;
  pret_intrare_unitar: number;
  data: string;
  furnizor: string | null;
  nota: string | null;
  created_at: string;
  substante: { nume: string; unitate_masura: string; ferme: { nume: string } | null } | null;
  utilizatori: { nume: string } | null;
};

function aziLocal(): string {
  const d = new Date();
  const an = d.getFullYear();
  const luna = String(d.getMonth() + 1).padStart(2, '0');
  const zi = String(d.getDate()).padStart(2, '0');
  return `${an}-${luna}-${zi}`;
}

function formatData(data: string): string {
  return new Date(data).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatLei(valoare: number | null): string {
  if (valoare === null || Number.isNaN(valoare)) return '—';
  return valoare.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lei';
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  padding: '0.5rem',
  marginTop: '0.25rem',
  borderRadius: '6px',
  border: '1px solid #ccc',
  minWidth: '160px',
};

const butonStyle: React.CSSProperties = {
  padding: '0.6rem 1.2rem',
  borderRadius: '6px',
  border: '1px solid #ccc',
  background: '#f5f5f5',
  cursor: 'pointer',
};

export default function SubstanteScreen() {
  const { role, loading: roleLoading } = useUserRole();

  if (roleLoading) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Se verifică accesul...</p>
      </main>
    );
  }

  if (role === 'admin_central') return <SubstanteAdminCentral />;
  if (role === 'admin_ferma') return <SubstanteAdminFerma />;

  return (
    <main style={{ padding: '2rem' }}>
      <h1>Acces interzis</h1>
      <p>Această secțiune este disponibilă doar pentru admin general sau administratorul unei ferme.</p>
    </main>
  );
}

const initialNomenclatorForm = { nume: '', unitate_masura: 'kg' };

const initialAlimentareForm = {
  ferma_id: '',
  nomenclator_id: '',
  cantitate: '',
  pret_intrare_unitar: '',
  data: aziLocal(),
  furnizor: '',
  nota: '',
};

function SubstanteAdminCentral() {
  const [nomenclator, setNomenclator] = useState<NomenclatorItem[]>([]);
  const [ferme, setFerme] = useState<Ferma[]>([]);
  const [stocuri, setStocuri] = useState<SubstantaStoc[]>([]);
  const [intrari, setIntrari] = useState<Intrare[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [nomenclatorForm, setNomenclatorForm] = useState(initialNomenclatorForm);
  const [nomenclatorSaving, setNomenclatorSaving] = useState(false);
  const [nomenclatorError, setNomenclatorError] = useState<string | null>(null);

  const [form, setForm] = useState(initialAlimentareForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  async function incarca() {
    setLoading(true);
    setLoadError(null);

    const [nomenclatorRes, fermeRes, stocuriRes, intrariRes] = await Promise.all([
      supabase.from('substante_nomenclator').select('id, nume, unitate_masura').order('nume'),
      supabase.from('ferme').select('id, nume').order('nume'),
      supabase
        .from('substante')
        .select('id, nume, unitate_masura, stoc_curent, pret_unitar, ferma_id, ferme(nume)')
        .order('nume'),
      supabase
        .from('substante_intrari')
        .select(
          'id, cantitate, pret_intrare_unitar, data, furnizor, nota, created_at, substante(nume, unitate_masura, ferme(nume)), utilizatori(nume)',
        )
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    setLoading(false);
    setLoadedOnce(true);

    if (nomenclatorRes.error) {
      setLoadError(nomenclatorRes.error.message);
      return;
    }
    if (fermeRes.error) {
      setLoadError(fermeRes.error.message);
      return;
    }
    if (stocuriRes.error) {
      setLoadError(stocuriRes.error.message);
      return;
    }
    if (intrariRes.error) {
      setLoadError(intrariRes.error.message);
      return;
    }

    setNomenclator((nomenclatorRes.data as NomenclatorItem[]) ?? []);
    setFerme((fermeRes.data as Ferma[]) ?? []);
    setStocuri((stocuriRes.data as unknown as SubstantaStoc[]) ?? []);
    setIntrari((intrariRes.data as unknown as Intrare[]) ?? []);
  }

  useEffect(() => {
    void incarca();
  }, []);

  async function adaugaNomenclator(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNomenclatorError(null);

    if (!nomenclatorForm.nume.trim()) {
      setNomenclatorError('Completează denumirea substanței.');
      return;
    }

    setNomenclatorSaving(true);
    const { error: insertError } = await supabase.from('substante_nomenclator').insert({
      nume: nomenclatorForm.nume.trim(),
      unitate_masura: nomenclatorForm.unitate_masura.trim() || 'kg',
    });
    setNomenclatorSaving(false);

    if (insertError) {
      setNomenclatorError(
        insertError.code === '23505'
          ? 'Există deja o substanță cu această denumire în nomenclator.'
          : insertError.message,
      );
      return;
    }

    setNomenclatorForm(initialNomenclatorForm);
    await incarca();
  }

  function updateForm(field: keyof typeof initialAlimentareForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSaveOk(false);
  }

  const substantaSelectata = nomenclator.find((n) => n.id === form.nomenclator_id) ?? null;
  const cantitateNum = Number(form.cantitate);
  const pretNum = Number(form.pret_intrare_unitar);
  const costTotal =
    form.cantitate && form.pret_intrare_unitar && !Number.isNaN(cantitateNum) && !Number.isNaN(pretNum)
      ? cantitateNum * pretNum
      : null;

  async function salveazaAlimentare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    setSaveOk(false);

    if (!form.ferma_id) {
      setSaveError('Alege ferma căreia îi alimentezi gestiunea.');
      return;
    }
    if (!form.nomenclator_id) {
      setSaveError('Alege substanța din nomenclator.');
      return;
    }
    if (!form.cantitate || cantitateNum <= 0) {
      setSaveError('Completează o cantitate pozitivă.');
      return;
    }
    if (!form.pret_intrare_unitar || pretNum < 0) {
      setSaveError('Completează prețul de intrare (poate fi 0, dar nu negativ).');
      return;
    }

    setSaving(true);
    const { error: rpcError } = await supabase.rpc('alimenteaza_substanta', {
      p_ferma_id: form.ferma_id,
      p_nomenclator_id: form.nomenclator_id,
      p_cantitate: cantitateNum,
      p_pret_intrare_unitar: pretNum,
      p_data: form.data,
      p_furnizor: form.furnizor.trim() || null,
      p_nota: form.nota.trim() || null,
    });
    setSaving(false);

    if (rpcError) {
      setSaveError(rpcError.message);
      return;
    }

    setSaveOk(true);
    setForm((prev) => ({
      ...initialAlimentareForm,
      ferma_id: prev.ferma_id,
      nomenclator_id: prev.nomenclator_id,
    }));
    await incarca();
  }

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: 'clamp(0.75rem, 3vw, 1.5rem)',
        gap: '1.25rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Substanțe</h1>
        <button onClick={() => void incarca()} disabled={loading} style={{ ...butonStyle, background: loading ? '#eee' : '#f5f5f5' }}>
          {loading ? 'Se încarcă...' : 'Reîncarcă'}
        </button>
      </div>

      {loadError && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{loadError}</p>
      )}

      {/* Nomenclator */}
      <section style={{ border: '1px solid #eee', borderRadius: '8px', padding: '1rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Nomenclator substanțe</h2>
        <p style={{ color: '#666', marginTop: '-0.5rem' }}>
          Catalogul comun de substanțe (denumire + unitate de măsură), folosit la alimentarea gestiunilor fermelor.
        </p>
        <form onSubmit={adaugaNomenclator} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          <label>
            Denumire substanță
            <input
              type="text"
              value={nomenclatorForm.nume}
              onChange={(e) => setNomenclatorForm({ ...nomenclatorForm, nume: e.target.value })}
              placeholder="ex. Îngrășământ NPK 20-20-20"
              style={inputStyle}
            />
          </label>
          <label>
            Unitate de măsură
            <select
              value={nomenclatorForm.unitate_masura}
              onChange={(e) => setNomenclatorForm({ ...nomenclatorForm, unitate_masura: e.target.value })}
              style={inputStyle}
            >
              <option value="kg">kg</option>
              <option value="l">l</option>
              <option value="buc">buc</option>
              <option value="t">t</option>
            </select>
          </label>
          <button type="submit" disabled={nomenclatorSaving} style={butonStyle}>
            {nomenclatorSaving ? 'Se adaugă...' : 'Adaugă în nomenclator'}
          </button>
        </form>
        {nomenclatorError && <p style={{ color: '#b00020', marginBottom: 0 }}>{nomenclatorError}</p>}

        {nomenclator.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.75rem' }}>
            {nomenclator.map((n) => (
              <span
                key={n.id}
                style={{ background: '#f0f4f8', borderRadius: '999px', padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
              >
                {n.nume} <span style={{ color: '#888' }}>({n.unitate_masura})</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Alimentare gestiune */}
      <section style={{ border: '1px solid #eee', borderRadius: '8px', padding: '1rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Alimentare gestiune fermă</h2>
        <p style={{ color: '#666', marginTop: '-0.5rem' }}>
          Adaugă stoc dintr-o substanță din nomenclator la gestiunea unei ferme, cu prețul de intrare — necesar pentru
          calculul exact al costului de producție. Prețul mediu al substanței se recalculează automat (medie ponderată
          cu stocul existent).
        </p>
        <form onSubmit={salveazaAlimentare} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          <label>
            Fermă
            <select value={form.ferma_id} onChange={(e) => updateForm('ferma_id', e.target.value)} style={inputStyle}>
              <option value="">— alege ferma —</option>
              {ferme.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nume}
                </option>
              ))}
            </select>
          </label>
          <label>
            Substanță (din nomenclator)
            <select value={form.nomenclator_id} onChange={(e) => updateForm('nomenclator_id', e.target.value)} style={inputStyle}>
              <option value="">— alege substanța —</option>
              {nomenclator.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nume} ({n.unitate_masura})
                </option>
              ))}
            </select>
          </label>
          <label>
            Cantitate {substantaSelectata ? `(${substantaSelectata.unitate_masura})` : ''}
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.cantitate}
              onChange={(e) => updateForm('cantitate', e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            Preț intrare (lei/{substantaSelectata ? substantaSelectata.unitate_masura : 'u.m.'})
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.pret_intrare_unitar}
              onChange={(e) => updateForm('pret_intrare_unitar', e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            Dată
            <input type="date" value={form.data} onChange={(e) => updateForm('data', e.target.value)} style={inputStyle} />
          </label>
          <label>
            Furnizor (opțional)
            <input type="text" value={form.furnizor} onChange={(e) => updateForm('furnizor', e.target.value)} style={inputStyle} />
          </label>
          <label>
            Notă (opțional)
            <input type="text" value={form.nota} onChange={(e) => updateForm('nota', e.target.value)} style={inputStyle} />
          </label>
          <button type="submit" disabled={saving} style={{ ...butonStyle, background: saving ? '#eee' : '#e8f5e9' }}>
            {saving ? 'Se salvează...' : 'Alimentează gestiunea'}
          </button>
        </form>
        {costTotal !== null && (
          <p style={{ color: '#666', marginBottom: 0 }}>Cost total intrare: {formatLei(costTotal)}</p>
        )}
        {saveError && <p style={{ color: '#b00020', marginBottom: 0 }}>{saveError}</p>}
        {saveOk && <p style={{ color: '#2e7d32', marginBottom: 0 }}>Gestiunea a fost alimentată cu succes.</p>}
      </section>

      {/* Stoc curent */}
      <section style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Stoc curent pe ferme</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '0.4rem' }}>Fermă</th>
              <th style={{ padding: '0.4rem' }}>Substanță</th>
              <th style={{ padding: '0.4rem' }}>Stoc curent</th>
              <th style={{ padding: '0.4rem' }}>Preț mediu</th>
              <th style={{ padding: '0.4rem' }}>Valoare stoc</th>
            </tr>
          </thead>
          <tbody>
            {loadedOnce && stocuri.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '0.75rem', color: '#666' }}>
                  Nicio substanță în gestiune încă — alimentează prima din formularul de mai sus.
                </td>
              </tr>
            )}
            {stocuri.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '0.4rem' }}>{s.ferme?.nume ?? '—'}</td>
                <td style={{ padding: '0.4rem' }}>{s.nume}</td>
                <td style={{ padding: '0.4rem' }}>
                  {s.stoc_curent} {s.unitate_masura}
                </td>
                <td style={{ padding: '0.4rem' }}>
                  {s.pret_unitar !== null ? `${formatLei(s.pret_unitar)}/${s.unitate_masura}` : '—'}
                </td>
                <td style={{ padding: '0.4rem' }}>{formatLei(s.pret_unitar !== null ? s.pret_unitar * s.stoc_curent : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Istoric intrări */}
      <section style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Istoric alimentări (ultimele 50)</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '0.4rem' }}>Dată</th>
              <th style={{ padding: '0.4rem' }}>Fermă</th>
              <th style={{ padding: '0.4rem' }}>Substanță</th>
              <th style={{ padding: '0.4rem' }}>Cantitate</th>
              <th style={{ padding: '0.4rem' }}>Preț intrare</th>
              <th style={{ padding: '0.4rem' }}>Furnizor</th>
              <th style={{ padding: '0.4rem' }}>Introdus de</th>
            </tr>
          </thead>
          <tbody>
            {loadedOnce && intrari.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '0.75rem', color: '#666' }}>
                  Niciun istoric încă.
                </td>
              </tr>
            )}
            {intrari.map((i) => (
              <Fragment key={i.id}>
                <tr style={{ borderBottom: i.nota ? 'none' : '1px solid #f0f0f0' }}>
                  <td style={{ padding: '0.4rem' }}>{formatData(i.data)}</td>
                  <td style={{ padding: '0.4rem' }}>{i.substante?.ferme?.nume ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{i.substante?.nume ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>
                    {i.cantitate} {i.substante?.unitate_masura ?? ''}
                  </td>
                  <td style={{ padding: '0.4rem' }}>
                    {formatLei(i.pret_intrare_unitar)}/{i.substante?.unitate_masura ?? ''}
                  </td>
                  <td style={{ padding: '0.4rem' }}>{i.furnizor ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{i.utilizatori?.nume ?? '—'}</td>
                </tr>
                {i.nota && (
                  <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td colSpan={7} style={{ padding: '0 0.4rem 0.5rem', color: '#666', fontSize: '0.85rem' }}>
                      {i.nota}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function SubstanteAdminFerma() {
  const [stocuri, setStocuri] = useState<SubstantaStoc[]>([]);
  const [intrari, setIntrari] = useState<Intrare[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  async function incarca() {
    setLoading(true);
    setLoadError(null);

    const [stocuriRes, intrariRes] = await Promise.all([
      supabase
        .from('substante')
        .select('id, nume, unitate_masura, stoc_curent, pret_unitar, ferma_id, ferme(nume)')
        .order('nume'),
      supabase
        .from('substante_intrari')
        .select('id, cantitate, pret_intrare_unitar, data, furnizor, nota, created_at, substante(nume, unitate_masura, ferme(nume)), utilizatori(nume)')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    setLoading(false);
    setLoadedOnce(true);

    if (stocuriRes.error) {
      setLoadError(stocuriRes.error.message);
      return;
    }
    if (intrariRes.error) {
      setLoadError(intrariRes.error.message);
      return;
    }

    setStocuri((stocuriRes.data as unknown as SubstantaStoc[]) ?? []);
    setIntrari((intrariRes.data as unknown as Intrare[]) ?? []);
  }

  useEffect(() => {
    void incarca();
  }, []);

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: 'clamp(0.75rem, 3vw, 1.5rem)',
        gap: '1.25rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Substanțe</h1>
        <button onClick={() => void incarca()} disabled={loading} style={{ ...butonStyle, background: loading ? '#eee' : '#f5f5f5' }}>
          {loading ? 'Se încarcă...' : 'Reîncarcă'}
        </button>
      </div>
      <p style={{ color: '#666', marginTop: '-0.75rem' }}>
        Alimentarea gestiunii se face de către admin general. Aici vezi stocul curent și istoricul intrărilor pentru
        ferma ta.
      </p>

      {loadError && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{loadError}</p>
      )}

      <section style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Stoc curent</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '0.4rem' }}>Substanță</th>
              <th style={{ padding: '0.4rem' }}>Stoc curent</th>
              <th style={{ padding: '0.4rem' }}>Preț mediu</th>
              <th style={{ padding: '0.4rem' }}>Valoare stoc</th>
            </tr>
          </thead>
          <tbody>
            {loadedOnce && stocuri.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '0.75rem', color: '#666' }}>
                  Nicio substanță în gestiune încă.
                </td>
              </tr>
            )}
            {stocuri.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '0.4rem' }}>{s.nume}</td>
                <td style={{ padding: '0.4rem' }}>
                  {s.stoc_curent} {s.unitate_masura}
                </td>
                <td style={{ padding: '0.4rem' }}>
                  {s.pret_unitar !== null ? `${formatLei(s.pret_unitar)}/${s.unitate_masura}` : '—'}
                </td>
                <td style={{ padding: '0.4rem' }}>{formatLei(s.pret_unitar !== null ? s.pret_unitar * s.stoc_curent : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Istoric alimentări (ultimele 50)</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '0.4rem' }}>Dată</th>
              <th style={{ padding: '0.4rem' }}>Substanță</th>
              <th style={{ padding: '0.4rem' }}>Cantitate</th>
              <th style={{ padding: '0.4rem' }}>Preț intrare</th>
              <th style={{ padding: '0.4rem' }}>Furnizor</th>
            </tr>
          </thead>
          <tbody>
            {loadedOnce && intrari.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '0.75rem', color: '#666' }}>
                  Niciun istoric încă.
                </td>
              </tr>
            )}
            {intrari.map((i) => (
              <tr key={i.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '0.4rem' }}>{formatData(i.data)}</td>
                <td style={{ padding: '0.4rem' }}>{i.substante?.nume ?? '—'}</td>
                <td style={{ padding: '0.4rem' }}>
                  {i.cantitate} {i.substante?.unitate_masura ?? ''}
                </td>
                <td style={{ padding: '0.4rem' }}>
                  {formatLei(i.pret_intrare_unitar)}/{i.substante?.unitate_masura ?? ''}
                </td>
                <td style={{ padding: '0.4rem' }}>{i.furnizor ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
