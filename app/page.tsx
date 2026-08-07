'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { resolvePostLoginPath } from '../lib/postLoginRedirect';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    async function redirect() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!data.session) {
        router.replace('/auth/login');
        return;
      }

      const path = await resolvePostLoginPath();
      if (!mounted) return;
      router.replace(path);
    }

    void redirect();

    return () => {
      mounted = false;
    };
  }, [router]);

  return (
    <main style={{ padding: '2rem' }}>
      <p>Se încarcă...</p>
    </main>
  );
}
