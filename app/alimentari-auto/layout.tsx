import ProtectedLayout from '../components/ProtectedLayout';

export default function AlimentariAutoLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
