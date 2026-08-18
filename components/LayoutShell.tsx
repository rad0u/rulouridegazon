'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useUserRole } from '../lib/useUserRole';

const navLinkStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderRadius: '6px',
  display: 'inline-flex',
  alignItems: 'center',
};

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { role } = useUserRole();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/auth/login');
  }

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
      }}
    >
      <header style={{ padding: 'clamp(0.5rem, 3vw, 1rem)', borderBottom: '1px solid #ddd', flexShrink: 0 }}>
        <nav
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
            <Link href="/" style={navLinkStyle}>
              Acasă
            </Link>
            <Link href="/dashboard" style={navLinkStyle}>
              Dashboard
            </Link>
            <Link href="/ferme" style={navLinkStyle}>
              Ferme
            </Link>
            <Link href="/substante" style={navLinkStyle}>
              Substanțe
            </Link>
            {role === 'admin_central' && (
              <>
                <Link href="/utilizatori" style={navLinkStyle}>
                  Utilizatori
                </Link>
                <Link href="/utilaje" style={navLinkStyle}>
                  Utilaje
                </Link>
                <a
                  href="http://135.181.45.175/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={navLinkStyle}
                >
                  Tracking
                </a>
              </>
            )}
          </div>
          <button
            onClick={handleLogout}
            style={{
              cursor: 'pointer',
              padding: '0.5rem 1rem',
              border: '1px solid #ccc',
              borderRadius: '6px',
              background: '#f5f5f5',
            }}
          >
            Logout
          </button>
        </nav>
      </header>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {children}
      </main>
    </div>
  );
}
