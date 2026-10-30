'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';

// 2026-10-30 (Radu): „Inventar masă verde” — un buton pentru fiecare fermă.
// Etichetele F1-F5 sunt aceleași ca pe pagina Ferme (doar afișare).
const ETICHETE_FERME: Record<string, { numar: string; nume: string; judet: string }> = {
  Medgidia: { numar: 'F1', nume: 'Medgidia', judet: 'Constanța' },
  'Holboca (Iași)': { numar: 'F2', nume: 'Holboca', judet: 'Iași' },
  'Bobicești (Craiova)': { numar: 'F3', nume: 'Bobicești', judet: 'Olt' },
  Timișoara: { numar: 'F4', nume: 'Sânpetru', judet: 'Timiș' },
  Săbăreni: { numar: 'F5', nume: 'Săbăreni', judet: 'Giurgiu' },
};

type Ferma = { id: string; nume: string; locatie: string | null };

function eticheta(f: Ferma) {
  return ETICHETE_FERME[f.nume] ?? { numar: null, nume: f.nume, judet: f.locatie ?? '' };
}

export default function InventarFermeScreen() {
  const { role, loading: roleLoading } = useUserRole();
  const [ferme, setFerme] = useState<Ferma[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== 'admin_central') return;
    void (async () => {
      const { data, error: err } = await supabase.from('ferme').select('id,nume,locatie').order('nume');
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      const lista = (data as Ferma[]) ?? [];
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
    })();
  }, [role]);

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
    <main style={{ padding: 'clamp(1rem, 4vw, 2rem)', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Inventar masă verde</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Alege ferma pentru a importa măsurătorile din SW Maps (gazonul rămas de recoltat) și pentru rapoartele de inventar.
      </p>

      {loading ? (
        <p>Se încarcă...</p>
      ) : error ? (
        <p style={{ color: '#b00020' }}>{error}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          {ferme.map((ferma) => {
            const et = eticheta(ferma);
            return (
              <Link
                key={ferma.id}
                href={`/inventar-masa-verde/${ferma.id}`}
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
                  minHeight: '130px',
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
                  <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>🌱</span>
                </div>
                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{et.nume}</div>
                  {et.judet && <div style={{ fontSize: '0.85rem', color: '#5a6b5a' }}>Județul {et.judet}</div>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
