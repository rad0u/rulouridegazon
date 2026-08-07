import { supabase } from './supabaseClient';

// Calculează unde trebuie dus utilizatorul după autentificare:
// - admin_ferma cu ferma_id setat -> direct pe tarlaua fermei lui
// - admin_central (sau admin_ferma fără fermă atribuită) -> /dashboard
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

  if (data?.rol === 'admin_ferma' && data.ferma_id) {
    return `/ferme/${data.ferma_id}`;
  }

  return '/dashboard';
}
