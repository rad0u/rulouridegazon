import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Autentificare - Rulouri de Gazon',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
