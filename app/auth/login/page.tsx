'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { resolvePostLoginPath } from '../../../lib/postLoginRedirect';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (data.session) {
      const path = await resolvePostLoginPath();
      router.push(path);
    } else {
      setError('Autentificare eșuată. Verifică datele și retează.');
    }
  }

  return (
    <main style={{ padding: 'clamp(1rem, 5vw, 2rem)' }}>
      <h1>Autentificare</h1>
      <form onSubmit={handleSubmit} style={{ maxWidth: '420px', marginTop: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.75rem' }}>
          Email
          <input
            type="email"
            inputMode="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ width: '100%', padding: '0.85rem', marginTop: '0.35rem' }}
            required
          />
        </label>

        <label style={{ display: 'block', marginBottom: '0.75rem' }}>
          Parolă
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: '100%', padding: '0.85rem', marginTop: '0.35rem' }}
            required
          />
        </label>

        {error && <div style={{ color: '#b00020', marginBottom: '0.75rem' }}>{error}</div>}

        <button
          type="submit"
          style={{ width: '100%', padding: '0.9rem 1.25rem', fontWeight: 'bold' }}
          disabled={loading}
        >
          {loading ? 'Se autentifică...' : 'Autentifică-te'}
        </button>
      </form>
    </main>
  );
}
