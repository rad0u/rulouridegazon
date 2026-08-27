'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export type UserRole = 'admin_central' | 'admin_ferma' | 'sofer' | null;

export function useUserRole() {
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (mounted) {
          setRole(null);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase
        .from('utilizatori')
        .select('rol')
        .eq('id', user.id)
        .single();

      if (!mounted) return;
      setRole((data?.rol as UserRole) ?? null);
      setLoading(false);
    }

    void load();

    return () => {
      mounted = false;
    };
  }, []);

  return { role, loading };
}
