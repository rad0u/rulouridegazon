import ProtectedLayout from '../components/ProtectedLayout';

export default function FermeLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
