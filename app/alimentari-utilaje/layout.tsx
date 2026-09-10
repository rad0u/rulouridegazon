import ProtectedLayout from '../components/ProtectedLayout';

export default function AlimentariUtilajeLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
