'use client';

import { useUserRole } from '../../lib/useUserRole';

export default function AdminCentralGuard({ children }: { children: React.ReactNode }) {
  const { role, loading } = useUserRole();

  if (loading) {
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

  return <>{children}</>;
}
