import ProtectedLayout from '../components/ProtectedLayout';

export default function LivrariLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
