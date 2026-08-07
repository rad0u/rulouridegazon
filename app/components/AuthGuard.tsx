'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    async function verifySession() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!data.session) {
        router.replace('/auth/login');
        return;
      }

      setLoading(false);
    }

    void verifySession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (!session) {
        router.replace('/auth/login');
      }
    });

    return () => {
      mounted = false;
      listener.subscription?.unsubscribe();
    };
  }, [router]);

  if (loading) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Se verifică autentificarea...</p>
      </main>
    );
  }

  return <>{children}</>;
}
