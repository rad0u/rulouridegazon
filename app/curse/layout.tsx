import ProtectedLayout from '../components/ProtectedLayout';

// Fără AdminCentralGuard aici — pagina e comună pentru admin_central și
// sofer, iar controlul de acces per-rol se face în CurseScreen.tsx (și,
// oricum, la nivel de bază de date prin RLS pe tabela curse).
export default function CurseLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
