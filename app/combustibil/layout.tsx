import ProtectedLayout from '../components/ProtectedLayout';
import AdminCentralGuard from '../components/AdminCentralGuard';

export default function CombustibilLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedLayout>
      <AdminCentralGuard>{children}</AdminCentralGuard>
    </ProtectedLayout>
  );
}
