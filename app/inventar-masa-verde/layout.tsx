import ProtectedLayout from '../components/ProtectedLayout';

export default function InventarMasaVerdeLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
