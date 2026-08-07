import ProtectedLayout from '../components/ProtectedLayout';

export default function SubstanteLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
