import ProtectedLayout from '../components/ProtectedLayout';

export default function MasiniLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
