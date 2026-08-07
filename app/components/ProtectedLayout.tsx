import AuthGuard from './AuthGuard';
import { LayoutShell } from '../../components/LayoutShell';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <LayoutShell>{children}</LayoutShell>
    </AuthGuard>
  );
}
