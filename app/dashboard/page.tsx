import Link from 'next/link';

export default function DashboardPage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Dashboard</h1>
      <p>Vizualizare centrală și rapoarte pentru ferme.</p>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>Rapoarte de cost</h2>
        <ul>
          <li><Link href="/dashboard/cost-productie">Cost de producție per fermă / lună</Link></li>
          <li><Link href="/cheltuieli-indirecte">Cheltuieli indirecte</Link></li>
        </ul>
      </section>
    </main>
  );
}
