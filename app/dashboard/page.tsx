'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { useUserRole, UserRole } from '../../lib/useUserRole';

// v2, 2026-09-24 (Radu): "trebuie sa refacem Dashboard-ul, sa aiba un design
// functional. Pune pe el principalele butoane pe care le foloseste admin-ul
// cel mai des. Sa se vada bine si pe mobil" — vechiul Dashboard avea doar
// două linkuri text (rapoarte de cost). Acum e o grilă de carduri, grupată
// pe secțiuni, cu acces rapid la ecranele folosite zilnic. Secțiunile /
// cardurile afișate depind de rol — aceleași reguli de vizibilitate ca în
// meniul principal (components/LayoutShell.tsx), ca să nu apară aici
// butoane către ecrane la care rolul respectiv nu are oricum acces.

type CardInfo = {
  href: string;
  icon: string;
  titlu: string;
  descriere: string;
  extern?: boolean;
};

type Sectiune = {
  titlu: string;
  carduri: CardInfo[];
};

function sectiuniPentru(rol: UserRole): Sectiune[] {
  const esteAdminCentral = rol === 'admin_central';
  const esteAdmin = rol === 'admin_central' || rol === 'admin_ferma';
  const sectiuni: Sectiune[] = [];

  if (esteAdmin) {
    sectiuni.push({
      titlu: 'Activitate zilnică',
      carduri: [
        {
          href: '/activitati-parcele',
          icon: '🌾',
          titlu: 'Activități parcele',
          descriere: 'Confirmă sesiunile de lucru detectate din GPS',
        },
        { href: '/substante', icon: '🧪', titlu: 'Substanțe', descriere: 'Stoc și alimentări cu substanțe' },
        {
          href: '/alimentari-utilaje',
          icon: '⛽',
          titlu: 'Alimentări utilaje',
          descriere: 'Înregistrează o alimentare la un utilaj',
        },
      ],
    });

    sectiuni.push({
      titlu: 'Ferme',
      carduri: [{ href: '/ferme', icon: '🚜', titlu: 'Ferme', descriere: 'Hartă, parcele și istoric pe fiecare fermă' }],
    });

    sectiuni.push({
      titlu: 'Flotă & utilaje',
      carduri: [
        {
          href: '/flota-auto',
          icon: '🚗',
          titlu: 'Flotă auto',
          descriere: 'Mașini, curse, foi de parcurs, alerte, zone',
        },
        ...(esteAdminCentral
          ? [
              { href: '/utilaje', icon: '🛠️', titlu: 'Utilaje', descriere: 'Configurare utilaje și senzori' },
              {
                href: '/combustibil-parcele',
                icon: '📊',
                titlu: 'Combustibil pe parcele',
                descriere: 'Consum de motorină alocat pe parcele',
              },
              {
                href: '/realimentari-utilaje',
                icon: '🔧',
                titlu: 'Realimentări utilaje',
                descriere: 'Realimentări detectate automat din senzori',
              },
              {
                href: '/rezervor-central',
                icon: '🛢️',
                titlu: 'Rezervor central',
                descriere: 'Nivel curent și mișcări de combustibil',
              },
            ]
          : []),
      ],
    });
  }

  sectiuni.push({
    titlu: 'Rapoarte',
    carduri: [
      {
        href: '/dashboard/cost-productie',
        icon: '💰',
        titlu: 'Cost de producție',
        descriere: 'Cost per fermă / lună',
      },
      {
        href: '/cheltuieli-indirecte',
        icon: '🧾',
        titlu: 'Cheltuieli indirecte',
        descriere: 'Cheltuieli comune, neatribuite direct',
      },
    ],
  });

  if (esteAdminCentral) {
    sectiuni.push({
      titlu: 'Administrare',
      carduri: [
        { href: '/utilizatori', icon: '👥', titlu: 'Utilizatori', descriere: 'Conturi și roluri' },
        {
          href: '/jurnal-activitate',
          icon: '📋',
          titlu: 'Jurnal de activitate',
          descriere: 'Istoricul acțiunilor din aplicație',
        },
        {
          href: 'http://135.181.45.175/',
          icon: '📍',
          titlu: 'Tracking',
          descriere: 'Platforma de tracking GPS',
          extern: true,
        },
      ],
    });
  }

  return sectiuni;
}

const stilCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  padding: '1rem',
  borderRadius: '10px',
  border: '1px solid #ddd',
  background: '#fff',
  textDecoration: 'none',
  color: 'inherit',
  minHeight: '108px',
};

function Card({ card }: { card: CardInfo }) {
  const continut = (
    <>
      <span style={{ fontSize: '1.7rem', lineHeight: 1 }}>{card.icon}</span>
      <span style={{ fontWeight: 600, fontSize: '1rem' }}>{card.titlu}</span>
      <span style={{ fontSize: '0.8rem', color: '#666' }}>{card.descriere}</span>
    </>
  );

  if (card.extern) {
    return (
      <a href={card.href} target="_blank" rel="noopener noreferrer" style={stilCard}>
        {continut}
      </a>
    );
  }

  return (
    <Link href={card.href} style={stilCard}>
      {continut}
    </Link>
  );
}

export default function DashboardPage() {
  const { role, loading } = useUserRole();

  if (loading) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Se încarcă...</p>
      </main>
    );
  }

  if (role === 'sofer') {
    return (
      <main style={{ padding: '2rem' }}>
        <h1>Dashboard</h1>
        <p>
          Contul tău e de șofer — vezi <Link href="/curse">cursele tale</Link>.
        </p>
      </main>
    );
  }

  const sectiuni = sectiuniPentru(role);

  return (
    <main
      style={{
        padding: 'clamp(1rem, 4vw, 2rem)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.75rem',
      }}
    >
      <div>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <p style={{ color: '#666', margin: '0.35rem 0 0' }}>Acces rapid la ecranele folosite cel mai des.</p>
      </div>

      {sectiuni.map((sectiune) => (
        <section key={sectiune.titlu}>
          <h2
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#888',
              margin: '0 0 0.6rem',
            }}
          >
            {sectiune.titlu}
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '0.75rem',
            }}
          >
            {sectiune.carduri.map((card) => (
              <Card key={card.href} card={card} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
