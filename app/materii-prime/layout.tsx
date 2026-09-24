import ProtectedLayout from '../components/ProtectedLayout';

export default function MateriiPrimeLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
