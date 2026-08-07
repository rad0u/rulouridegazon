'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { resolvePostLoginPath } from '../../../lib/postLoginRedirect';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleRedirect = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        router.replace('/auth/login');
        return;
      }
      const path = await resolvePostLoginPath();
      router.replace(path);
    };

    void handleRedirect();
  }, [router]);

  return (
    <main style={{ padding: '2rem' }}>
      <h1>Callback autentificare</h1>
      <p>Se procesează autentificarea...</p>
    </main>
  );
}
