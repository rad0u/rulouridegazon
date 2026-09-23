'use client';

// app/flota-auto/page.tsx
//
// Pagină de start dedicată flotei de mașini de pasageri — creată 2026-09-23
// la cererea lui Radu, ca să separe clar (navigare + vizual) flota de
// mașini de modulul de utilaje. Carduri, nu meniu expandat — un singur
// click din meniul principal ("Flotă auto") ajunge aici, apoi de aici mai
// departe la fiecare ecran. Cardurile vizibile depind de rol: admin_ferma
// vede doar Mașini + Curse (ca și în meniul principal până acum),
// admin_central vede tot.

import Link from 'next/link';
import { useUserRole } from '../../lib/useUserRole';

type Card = {
  href: string;
  titlu: string;
  descriere: string;
  icon: string;
};

const CARDURI_TOATE: Card[] = [
  { href: '/masini', titlu: 'Mașini', descriere: 'Flota de mașini, poziții live pe hartă, alocare pe fermă.', icon: '🚗' },
  { href: '/curse', titlu: 'Curse', descriere: 'Traseele detectate automat — completează scopul și validează.', icon: '🛣️' },
  { href: '/foi-parcurs', titlu: 'Foi de parcurs', descriere: 'Rezumat lunar al flotei + foaia de parcurs detaliată per mașină.', icon: '📋' },
  { href: '/alerte', titlu: 'Alerte', descriere: 'Depășiri de viteză și intrări/ieșiri din zonele definite.', icon: '⚠️' },
  { href: '/geofences', titlu: 'Zone', descriere: 'Definește zonele geografice folosite pentru alerte.', icon: '📍' },
];

const CARDURI_DOAR_ADMIN_CENTRAL = new Set(['/foi-parcurs', '/alerte', '/geofences']);

export default function FlotaAutoPage() {
  const { role, loading } = useUserRole();

  if (loading) {
    return (
      <main style={{ padding: 'clamp(1rem, 4vw, 2rem)' }}>
        <p>Se verifică accesul...</p>
      </main>
    );
  }

  if (role === 'sofer') {
    return (
      <main style={{ padding: 'clamp(1rem, 4vw, 2rem)' }}>
        <h1>Flotă auto</h1>
        <p>
          Această pagină e pentru administratori. Cursele tale sunt aici: <Link href="/curse">Cursele mele</Link>.
        </p>
      </main>
    );
  }

  if (role !== 'admin_central' && role !== 'admin_ferma') {
    return (
      <main style={{ padding: 'clamp(1rem, 4vw, 2rem)' }}>
        <h1>Acces interzis</h1>
        <p>Contul tău nu are acces la modulul de flotă auto.</p>
      </main>
    );
  }

  const carduri = role === 'admin_central' ? CARDURI_TOATE : CARDURI_TOATE.filter((c) => !CARDURI_DOAR_ADMIN_CENTRAL.has(c.href));

  return (
    <main style={{ padding: 'clamp(1rem, 4vw, 2rem)' }}>
      <h1>Flotă auto</h1>
      <p style={{ color: '#555', marginBottom: '1.5rem' }}>
        Modulul mașinilor de pasageri — separat de utilaje. Aici găsești mașinile, cursele lor și foile de parcurs.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '1rem',
          maxWidth: '900px',
        }}
      >
        {carduri.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            style={{
              display: 'block',
              padding: '1.25rem',
              borderRadius: '10px',
              border: '1px solid #ddd',
              background: '#fff',
              color: 'inherit',
              textDecoration: 'none',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>{c.icon}</div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.3rem' }}>{c.titlu}</div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>{c.descriere}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
