'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { useUserRole } from '../lib/useUserRole';

const navLinkStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  borderRadius: '6px',
  display: 'block',
  fontSize: '1.05rem',
};

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { role } = useUserRole();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/auth/login');
  }

  function closeMenu() {
    setMenuOpen(false);
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
      <header
        style={{
          borderBottom: '1px solid #ddd',
          flexShrink: 0,
          position: 'relative',
          // Trebuie să stea deasupra hărților Leaflet din pagini (butoanele
          // Stradă/Satelit și controalele proprii Leaflet folosesc z-index
          // 800-1000) — altfel meniul deschis apărea sub hartă pe paginile cu
          // hartă (ex. /ferme/[fermaId], /utilaje).
          zIndex: 2000,
          background: '#fff',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            padding: 'clamp(0.5rem, 3vw, 0.75rem) clamp(0.75rem, 3vw, 1.25rem)',
          }}
        >
          <button
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            style={{
              justifySelf: 'start',
              cursor: 'pointer',
              padding: '0.5rem 0.9rem',
              border: '1px solid #ccc',
              borderRadius: '6px',
              background: '#f5f5f5',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.95rem',
            }}
          >
            <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>☰</span>
            Meniu
          </button>

          <Link href="/" style={{ justifySelf: 'center', display: 'flex' }} onClick={closeMenu}>
            <Image
              src="/logo.png"
              alt="Rulouri de Gazon"
              width={994}
              height={247}
              priority
              style={{ height: 'clamp(28px, 6vw, 40px)', width: 'auto' }}
            />
          </Link>

          <div />
        </div>

        {menuOpen && (
          <>
            <div
              onClick={closeMenu}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.15)',
                zIndex: 10,
              }}
            />
            <nav
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                width: 'min(320px, 90vw)',
                background: '#fff',
                borderRight: '1px solid #ddd',
                borderBottom: '1px solid #ddd',
                borderBottomRightRadius: '10px',
                boxShadow: '2px 4px 12px rgba(0,0,0,0.12)',
                padding: '0.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.15rem',
                zIndex: 20,
              }}
            >
              {role === 'sofer' ? (
                <Link href="/curse" style={navLinkStyle} onClick={closeMenu}>
                  Cursele mele
                </Link>
              ) : (
                <>
                  <Link href="/" style={navLinkStyle} onClick={closeMenu}>
                    Acasă
                  </Link>
                  <Link href="/dashboard" style={navLinkStyle} onClick={closeMenu}>
                    Dashboard
                  </Link>
                  <Link href="/ferme" style={navLinkStyle} onClick={closeMenu}>
                    Ferme
                  </Link>
                  <Link href="/substante" style={navLinkStyle} onClick={closeMenu}>
                    Substanțe
                  </Link>
                  {role === 'admin_central' && (
                    <>
                      <Link href="/utilizatori" style={navLinkStyle} onClick={closeMenu}>
                        Utilizatori
                      </Link>
                      <Link href="/utilaje" style={navLinkStyle} onClick={closeMenu}>
                        Utilaje
                      </Link>
                      <Link href="/combustibil" style={navLinkStyle} onClick={closeMenu}>
                        Combustibil
                      </Link>
                      <Link href="/rezervor-central" style={navLinkStyle} onClick={closeMenu}>
                        Rezervor central
                      </Link>
                      <Link href="/masini" style={navLinkStyle} onClick={closeMenu}>
                        Mașini
                      </Link>
                      <Link href="/curse" style={navLinkStyle} onClick={closeMenu}>
                        Curse
                      </Link>
                      <Link href="/foi-parcurs" style={navLinkStyle} onClick={closeMenu}>
                        Foi de parcurs
                      </Link>
                      <Link href="/geofences" style={navLinkStyle} onClick={closeMenu}>
                        Zone
                      </Link>
                      <Link href="/alerte" style={navLinkStyle} onClick={closeMenu}>
                        Alerte
                      </Link>
                      <a
                        href="http://135.181.45.175/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={navLinkStyle}
                        onClick={closeMenu}
                      >
                        Tracking
                      </a>
                    </>
                  )}
                </>
              )}
              <div style={{ borderTop: '1px solid #eee', marginTop: '0.4rem', paddingTop: '0.5rem' }}>
                <button
                  onClick={() => {
                    closeMenu();
                    void handleLogout();
                  }}
                  style={{
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.75rem 1rem',
                    border: 'none',
                    borderRadius: '6px',
                    background: 'transparent',
                    fontSize: '1.05rem',
                  }}
                >
                  Logout
                </button>
              </div>
            </nav>
          </>
        )}
      </header>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {children}
      </main>
    </div>
  );
}
