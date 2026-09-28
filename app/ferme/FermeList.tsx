'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

// 2026-09-28 (Radu): "pe pagina de alegere ferme vreau sa faci o
// reprezentare grafica frumoasa, cu butoane pentru cele 5 ferme: F1 —
// Medgidia / F2 — Holboca-Iași / F3 — Bobicești-Olt / F4 — Sânpetru-Timiș /
// F5 — Săbăreni-Giurgiu" — lista simplă cu buline a devenit o grilă de
// carduri mari, numerotate F1-F5, cu denumirea/județul exact așa cum le-a
// dat Radu (unele diferă puțin de `nume`/`locatie` din baza de date — ex.
// "Timișoara" -> "Sânpetru-Timiș", "Bobicești (Craiova)" -> "Bobicești-Olt"
// — aici e doar eticheta de afișare, nu s-au schimbat rândurile din tabela
// `ferme`). Potrivirea card->fermă se face după `nume`-le curent din DB;
// dacă apare o fermă nouă, neregăsită în listă, tot apare în grilă (fără
// eticheta F#, doar cu numele ei din DB), ca nimic să nu dispară din navigare.
const ETICHETE_FERME: Record<string, { numar: string; nume: string; judet: string }> = {
  Medgidia: { numar: 'F1', nume: 'Medgidia', judet: 'Constanța' },
  'Holboca (Iași)': { numar: 'F2', nume: 'Holboca', judet: 'Iași' },
  'Bobicești (Craiova)': { numar: 'F3', nume: 'Bobicești', judet: 'Olt' },
  Timișoara: { numar: 'F4', nume: 'Sânpetru', judet: 'Timiș' },
  Săbăreni: { numar: 'F5', nume: 'Săbăreni', judet: 'Giurgiu' },
};

type Ferma = {
  id: string;
  nume: string;
  locatie: string | null;
};

function eticheta(ferma: Ferma) {
  return ETICHETE_FERME[ferma.nume] ?? { numar: null, nume: ferma.nume, judet: ferma.locatie ?? '' };
}

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

    const lista = (data as Ferma[]) ?? [];
    // Ordinea F1-F5, apoi orice fermă nouă/neregăsită în listă, alfabetic.
    lista.sort((a, b) => {
      const na = eticheta(a).numar;
      const nb = eticheta(b).numar;
      if (na && nb) return na.localeCompare(nb);
      if (na) return -1;
      if (nb) return 1;
      return a.nume.localeCompare(b.nume);
    });
    setFerme(lista);
    setLoading(false);
  }

  return (
    <main style={{ padding: 'clamp(1rem, 4vw, 2rem)', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Ferme</h1>
      <p style={{ color: '#666', marginTop: 0 }}>Alege ferma pentru hartă, parcele și activitate.</p>

      {loading ? (
        <p>Se încarcă...</p>
      ) : error ? (
        <p style={{ color: '#b00020' }}>{error}</p>
      ) : ferme.length === 0 ? (
        <p>Nu ai acces la nicio fermă.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '1rem',
            marginTop: '1rem',
          }}
        >
          {ferme.map((ferma) => {
            const et = eticheta(ferma);
            return (
              <Link
                key={ferma.id}
                href={`/ferme/${ferma.id}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  padding: '1.25rem',
                  borderRadius: '14px',
                  border: '1px solid #dde5dc',
                  background: 'linear-gradient(160deg, #f3faf3 0%, #ffffff 65%)',
                  textDecoration: 'none',
                  color: 'inherit',
                  boxShadow: '0 1px 3px rgba(20, 60, 20, 0.06)',
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  minHeight: '150px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {et.numar && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '2.4rem',
                        height: '2.4rem',
                        borderRadius: '999px',
                        background: '#2e7d32',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: '0.95rem',
                      }}
                    >
                      {et.numar}
                    </span>
                  )}
                  <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>🌾</span>
                </div>

                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{et.nume}</div>
                  {et.judet && <div style={{ fontSize: '0.85rem', color: '#5a6b5a' }}>Județul {et.judet}</div>}
                </div>

                <div style={{ marginTop: 'auto', fontSize: '0.8rem', color: '#2e7d32', fontWeight: 600 }}>
                  Deschide harta →
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
