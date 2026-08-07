'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

type Ferma = {
  id: string;
  nume: string;
  locatie: string | null;
};

export default function FermeList() {
  const [ferme, setFerme] = useState<Ferma[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadFerme();
  }, []);

  async function loadFerme() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('ferme')
      .select('id,nume,locatie')
      .order('nume');

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setFerme((data as Ferma[]) ?? []);
    setLoading(false);
  }

  return (
    <main style={{ padding: '2rem' }}>
      <h1>Ferme</h1>
      <p>Listă ferme și acces la hărți.</p>

      {loading ? (
        <p>Se încarcă...</p>
      ) : error ? (
        <p style={{ color: '#b00020' }}>{error}</p>
      ) : ferme.length === 0 ? (
        <p>Nu ai acces la nicio fermă.</p>
      ) : (
        <ul>
          {ferme.map((ferma) => (
            <li key={ferma.id}>
              <Link href={`/ferme/${ferma.id}`}>{ferma.nume}</Link>
              {ferma.locatie && <span style={{ color: '#666' }}> — {ferma.locatie}</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
