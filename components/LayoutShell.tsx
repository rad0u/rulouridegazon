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

// Etichetă de secțiune în meniu (Flotă auto / Utilaje / Administrare) — doar
// grupare vizuală, nu e link și nu se pliază, ca navigarea să rămână un
// singur click, la fel ca înainte de reorganizare (2026-09-10).
const sectionHeaderStyle: React.CSSProperties = {
  padding: '0.9rem 1rem 0.25rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: '#888',
  borderTop: '1px solid #eee',
  marginTop: '0.3rem',
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
                maxHeight: '80vh',
                overflowY: 'auto',
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

                  {(role === 'admin_central' || role === 'admin_ferma') && (
                    <Link href="/activitati-parcele" style={navLinkStyle} onClick={closeMenu}>
                      Activități parcele
                    </Link>
                  )}

                  {(role === 'admin_central' || role === 'admin_ferma') && (
                    // 2026-09-23: legăturile individuale (Mașini/Curse/Foi de
                    // parcurs/Alerte/Zone) s-au mutat pe pagina de start
                    // dedicată /flota-auto (carduri) — cerința lui Radu de a
                    // separa clar flota de mașini de utilaje în navigare.
                    <Link href="/flota-auto" style={navLinkStyle} onClick={closeMenu}>
                      Flotă auto
                    </Link>
                  )}

                  {(role === 'admin_central' || role === 'admin_ferma') && (
                    <>
                      <div style={sectionHeaderStyle}>Utilaje</div>
                      {role === 'admin_central' && (
                        <Link href="/utilaje" style={navLinkStyle} onClick={closeMenu}>
                          Utilaje
                        </Link>
                      )}
                      <Link href="/alimentari-utilaje" style={navLinkStyle} onClick={closeMenu}>
                        Alimentări utilaje
                      </Link>
                      {role === 'admin_central' && (
                        <>
                          <Link href="/combustibil-parcele" style={navLinkStyle} onClick={closeMenu}>
                            Combustibil pe parcele
                          </Link>
                          <Link href="/realimentari-utilaje" style={navLinkStyle} onClick={closeMenu}>
                            Realimentări utilaje
                          </Link>
                          <Link href="/rezervor-central" style={navLinkStyle} onClick={closeMenu}>
                            Rezervor central
                          </Link>
                        </>
                      )}
                    </>
                  )}

                  {role === 'admin_central' && (
                    <>
                      <div style={sectionHeaderStyle}>Administrare</div>
                      <Link href="/utilizatori" style={navLinkStyle} onClick={closeMenu}>
                        Utilizatori
                      </Link>
                      <Link href="/jurnal-activitate" style={navLinkStyle} onClick={closeMenu}>
                        Jurnal de activitate
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
