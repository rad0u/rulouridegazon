import { supabase } from './supabaseClient';

// Calculează unde trebuie dus utilizatorul după autentificare:
// - sofer -> direct pe /curse (lista lui de curse, mobil-first)
// - orice admin (central sau de fermă) -> /dashboard
//
// 2026-09-24 (Radu): "la pornirea aplicatiei vreau sa ma duca direct in
// dashboard" — până acum admin_ferma cu ferma_id setat ateriza direct pe
// tarlaua fermei lui (/ferme/{fermaId}), nu pe Dashboard; asta se aplica și
// lui Radu, care e admin_ferma. Acum orice admin ajunge pe Dashboard, care
// oricum are un card către Ferme la un click distanță.
export async function resolvePostLoginPath(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return '/auth/login';

  const { data } = await supabase
    .from('utilizatori')
    .select('rol, ferma_id')
    .eq('id', user.id)
    .maybeSingle();

  if (data?.rol === 'sofer') {
    return '/curse';
  }

  return '/dashboard';
}
