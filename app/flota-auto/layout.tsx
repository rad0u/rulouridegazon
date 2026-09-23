import ProtectedLayout from '../components/ProtectedLayout';

export default function FlotaAutoLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
