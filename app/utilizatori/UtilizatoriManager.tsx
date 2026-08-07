'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

type Ferma = { id: string; nume: string };

type Utilizator = {
  id: string;
  nume: string;
  email: string | null;
  rol: 'admin_central' | 'admin_ferma';
  ferma_id: string | null;
  ferme: { nume: string } | null;
};

const initialForm = {
  nume: '',
  email: '',
  parola: '',
  rol: 'admin_ferma' as 'admin_central' | 'admin_ferma',
  ferma_id: '',
};

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export default function UtilizatoriManager() {
  const [ferme, setFerme] = useState<Ferma[]>([]);
  const [utilizatori, setUtilizatori] = useState<Utilizator[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void loadFerme();
    void loadUtilizatori();
  }, []);

  async function loadFerme() {
    const { data } = await supabase.from('ferme').select('id,nume').order('nume');
    setFerme((data as Ferma[]) ?? []);
  }

  async function loadUtilizatori() {
    setLoadingList(true);
    const { data } = await supabase
      .from('utilizatori')
      .select('id,nume,email,rol,ferma_id,ferme(nume)')
      .order('rol')
      .order('nume');
    setUtilizatori((data as unknown as Utilizator[]) ?? []);
    setLoadingList(false);
  }

  function updateForm(field: keyof typeof initialForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!form.email.trim()) {
      setError('Completează email-ul.');
      return;
    }
    if (!form.parola || form.parola.length < 6) {
      setError('Parola trebuie să aibă minim 6 caractere.');
      return;
    }
    if (form.rol === 'admin_ferma' && !form.ferma_id) {
      setError('Alege ferma pentru admin de fermă.');
      return;
    }

    setSaving(true);

    const { data, error: invokeError } = await supabase.functions.invoke('admin-create-user', {
      body: {
        email: form.email.trim(),
        parola: form.parola,
        nume: form.nume.trim() || undefined,
        rol: form.rol,
        ferma_id: form.rol === 'admin_ferma' ? form.ferma_id : null,
      },
    });

    setSaving(false);

    if (invokeError) {
      const message =
        (invokeError as { context?: { error?: string } })?.context?.error ?? invokeError.message;
      setError(message);
      return;
    }

    if (data?.error) {
      setError(data.error);
      return;
    }

    setSuccess(`Cont creat: ${data?.email ?? form.email}`);
    setForm(initialForm);
    await loadUtilizatori();
  }

  return (
    <main style={{ padding: 'clamp(0.75rem, 4vw, 2rem)' }}>
      <h1>Utilizatori</h1>
      <p>Creează conturi noi și vezi cine are acces, cu ce rol.</p>

      <section style={{ marginTop: '1.5rem', maxWidth: '480px' }}>
        <form onSubmit={handleSubmit}>
          <fieldset
            style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: '8px' }}
            disabled={saving}
          >
            <legend style={{ fontWeight: 'bold', padding: '0 0.5rem' }}>Cont nou</legend>

            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Nume (opțional)
              <input
                type="text"
                value={form.nume}
                onChange={(e) => updateForm('nume', e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.6rem' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Email
              <input
                type="email"
                inputMode="email"
                value={form.email}
                onChange={(e) => updateForm('email', e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.6rem' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Parolă
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                <input
                  type="text"
                  value={form.parola}
                  onChange={(e) => updateForm('parola', e.target.value)}
                  style={{ flex: '1 1 auto', padding: '0.6rem' }}
                />
                <button type="button" onClick={() => updateForm('parola', generatePassword())}>
                  Generează
                </button>
              </div>
            </label>

            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Rol
              <select
                value={form.rol}
                onChange={(e) => updateForm('rol', e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.6rem' }}
              >
                <option value="admin_ferma">Admin de fermă</option>
                <option value="admin_central">Admin general</option>
              </select>
            </label>

            {form.rol === 'admin_ferma' && (
              <label style={{ display: 'block', marginBottom: '0.75rem' }}>
                Fermă
                <select
                  value={form.ferma_id}
                  onChange={(e) => updateForm('ferma_id', e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.6rem' }}
                >
                  <option value="">Alege fermă</option>
                  {ferme.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nume}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {error && <div style={{ color: '#b00020', marginBottom: '0.75rem' }}>{error}</div>}
            {success && <div style={{ color: '#0b6623', marginBottom: '0.75rem' }}>{success}</div>}

            <button type="submit" style={{ width: '100%', padding: '0.85rem', fontWeight: 'bold' }}>
              {saving ? 'Creez...' : 'Creează cont'}
            </button>
          </fieldset>
        </form>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Conturi existente</h2>
        {loadingList ? (
          <p>Se încarcă...</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: '640px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '0.5rem' }}>Email</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '0.5rem' }}>Rol</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '0.5rem' }}>Fermă</th>
              </tr>
            </thead>
            <tbody>
              {utilizatori.map((u) => (
                <tr key={u.id}>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>{u.email}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>
                    {u.rol === 'admin_central' ? 'Admin general' : 'Admin de fermă'}
                  </td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0' }}>
                    {u.ferme?.nume ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
