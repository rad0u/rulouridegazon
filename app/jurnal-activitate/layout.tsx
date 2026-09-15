import ProtectedLayout from '../components/ProtectedLayout';

export default function JurnalActivitateLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
