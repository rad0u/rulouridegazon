import ProtectedLayout from '../components/ProtectedLayout';

export default function RecoltariLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
