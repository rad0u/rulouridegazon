'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

type Ferma = {
  id: string;
  nume: string;
};

type CheltuialaIndirecta = {
  id: string;
  descriere: string;
  valoare: number;
  data: string;
  ferma_id: string | null;
  ferme: { nume: string }[] | null;
};

const initialFormState = {
  id: null as string | null,
  ferma_id: '',
  descriere: '',
  valoare: '',
  data: '',
};

export default function CheltuieliIndirecteManager() {
  const [cheltuieli, setCheltuieli] = useState<CheltuialaIndirecta[]>([]);
  const [ferme, setFerme] = useState<Ferma[]>([]);
  const [form, setForm] = useState(initialFormState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [cheltuieliRes, fermeRes] = await Promise.all([
      supabase
        .from('cheltuieli_indirecte')
        .select('id,descriere,valoare,data,ferma_id,ferme(nume)')
        .order('data', { ascending: false }),
      supabase.from('ferme').select('id,nume').order('nume'),
    ]);

    if (cheltuieliRes.error) {
      setError(cheltuieliRes.error.message);
    } else if (fermeRes.error) {
      setError(fermeRes.error.message);
    } else {
      setCheltuieli(cheltuieliRes.data as CheltuialaIndirecta[]);
      setFerme(fermeRes.data as Ferma[]);
    }

    setLoading(false);
  }

  const total = useMemo(
    () => cheltuieli.reduce((sum, item) => sum + Number(item.valoare), 0),
    [cheltuieli]
  );

  function updateForm(field: keyof typeof initialFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function resetForm() {
    setForm(initialFormState);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    const payload = {
      ferma_id: form.ferma_id || null,
      descriere: form.descriere.trim(),
      valoare: Number(form.valoare),
      data: form.data,
    };

    if (!payload.ferma_id) {
      setError('Alege o fermă.');
      setSaving(false);
      return;
    }

    if (!payload.descriere) {
      setError('Completează descrierea.');
      setSaving(false);
      return;
    }

    if (Number.isNaN(payload.valoare) || payload.valoare <= 0) {
      setError('Valoarea trebuie să fie un număr pozitiv.');
      setSaving(false);
      return;
    }

    if (!payload.data) {
      setError('Alege data cheltuielii.');
      setSaving(false);
      return;
    }

    const response = form.id
      ? await supabase
          .from('cheltuieli_indirecte')
          .update(payload)
          .eq('id', form.id)
      : await supabase.from('cheltuieli_indirecte').insert(payload).select('id');

    if (response.error) {
      setError(response.error.message);
      setSaving(false);
      return;
    }

    setSuccess(form.id ? 'Cheltuiala a fost actualizată.' : 'Cheltuiala a fost adăugată.');
    resetForm();
    await loadData();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    setError(null);
    setSuccess(null);
    setSaving(true);

    const { error: deleteError } = await supabase
      .from('cheltuieli_indirecte')
      .delete()
      .eq('id', id);

    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
      return;
    }

    setSuccess('Cheltuiala a fost ștearsă.');
    await loadData();
    setSaving(false);
  }

  function handleEdit(item: CheltuialaIndirecta) {
    setError(null);
    setSuccess(null);
    setForm({
      id: item.id,
      ferma_id: item.ferma_id ?? '',
      descriere: item.descriere,
      valoare: String(item.valoare),
      data: item.data,
    });
  }

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Cheltuieli indirecte</h1>
      <p>Completează cheltuielile indirecte pentru fiecare fermă. Poți edita sau șterge intrările existente.</p>

      <section style={{ marginTop: '1.5rem', maxWidth: '720px' }}>
        <form onSubmit={handleSubmit}>
          <fieldset style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: '8px' }} disabled={saving || loading}>
            <legend style={{ fontWeight: 'bold', padding: '0 0.5rem' }}>
              {form.id ? 'Editează cheltuiala indirectă' : 'Adaugă cheltuială indirectă'}
            </legend>

            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Fermă
              <select
                value={form.ferma_id}
                onChange={(event) => updateForm('ferma_id', event.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem' }}
              >
                <option value="">Alege fermă</option>
                {ferme.map((ferma) => (
                  <option key={ferma.id} value={ferma.id}>
                    {ferma.nume}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Descriere
              <input
                type="text"
                value={form.descriere}
                onChange={(event) => updateForm('descriere', event.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem' }}
                placeholder="Ex: Consum electricitate, reparații, servicii"
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.75rem' }}>
              <label style={{ display: 'block' }}>
                Valoare (lei)
                <input
                  type="number"
                  value={form.valoare}
                  onChange={(event) => updateForm('valoare', event.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem' }}
                  min="0"
                  step="0.01"
                />
              </label>

              <label style={{ display: 'block' }}>
                Data
                <input
                  type="date"
                  value={form.data}
                  onChange={(event) => updateForm('data', event.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem' }}
                />
              </label>
            </div>

            {error && (
              <div style={{ color: '#b00020', marginBottom: '0.75rem' }}>{error}</div>
            )}
            {success && (
              <div style={{ color: '#0b6623', marginBottom: '0.75rem' }}>{success}</div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button type="submit" style={{ padding: '0.75rem 1.25rem' }}>
                {saving ? 'Salvez...' : form.id ? 'Actualizează' : 'Adaugă'}
              </button>
              <button type="button" onClick={resetForm} style={{ padding: '0.75rem 1.25rem' }}>
                Resetează
              </button>
            </div>
          </fieldset>
        </form>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Listă cheltuieli indirecte</h2>

        {loading ? (
          <p>Se încarcă...</p>
        ) : cheltuieli.length === 0 ? (
          <p>Nu există cheltuieli indirecte înregistrate.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '0.5rem' }}>Fermă</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '0.5rem' }}>Data</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '0.5rem' }}>Descriere</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '0.5rem' }}>Valoare</th>
                <th style={{ textAlign: 'center', borderBottom: '1px solid #ddd', padding: '0.5rem' }}>Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {cheltuieli.map((item) => (
                <tr key={item.id}>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>{item.ferme?.[0]?.nume ?? '—'}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>{item.data}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>{item.descriere}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>{Number(item.valoare).toFixed(2)} lei</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0', textAlign: 'center' }}>
                    <button onClick={() => handleEdit(item)} style={{ marginRight: '0.5rem', padding: '0.35rem 0.75rem' }}>
                      Editează
                    </button>
                    <button onClick={() => void handleDelete(item.id)} style={{ padding: '0.35rem 0.75rem' }}>
                      Șterge
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 'bold' }}>Total</td>
                <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 'bold' }}>{total.toFixed(2)} lei</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </div>
  );
}
