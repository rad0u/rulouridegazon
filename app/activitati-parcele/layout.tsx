import ProtectedLayout from '../components/ProtectedLayout';

export default function ActivitatiParceleLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
