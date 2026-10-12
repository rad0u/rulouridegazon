'use client';

// 2026-10-12 (Radu): vezi nota din ConsumuriOperatiune.tsx. Listă a
// operațiunilor deja confirmate (din perioada aleasă, pe ferma curentă) care au
// consumuri de substanțe / materii prime, cu buton de modificare a cantităților.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { LABEL_OPERATIUNE, TipOperatiune } from '../lib/operatiuniTypes';
import ConsumuriOperatiune, { LinieConsum } from './ConsumuriOperatiune';

interface Props {
  fermaId: string | null;
  deLa: string;
  panaLa: string;
  onModificat?: () => void | Promise<void>;
}

type Rand = {
  id: string;
  tip: TipOperatiune;
  data: string;
  parcele: { nume: string } | null;
  operatiuni_substante: { id: string; cantitate: number; substante: { nume: string; unitate_masura: string } | null }[] | null;
  operatiuni_materii_prime:
    | { id: string; cantitate: number; materii_prime: { nume: string; unitate_masura: string } | null }[]
    | null;
};

export default function ConsumuriInregistrate({ fermaId, deLa, panaLa, onModificat }: Props) {
  const [deschis, setDeschis] = useState(false);
  const [randuri, setRanduri] = useState<Rand[]>([]);
  const [loading, setLoading] = useState(false);
  const [eroare, setEroare] = useState<string | null>(null);

  const incarca = useCallback(async () => {
    if (!fermaId) return;
    setLoading(true);
    setEroare(null);
    const { data, error } = await supabase
      .from('operatiuni')
      .select(
        'id,tip,data,parcele!inner(nume,ferma_id),operatiuni_substante(id,cantitate,substante(nume,unitate_masura)),operatiuni_materii_prime(id,cantitate,materii_prime(nume,unitate_masura))',
      )
      .eq('parcele.ferma_id', fermaId)
      .gte('data', deLa)
      .lte('data', panaLa)
      .order('data', { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      setEroare(error.message);
      return;
    }
    const lista = ((data as unknown as Rand[]) ?? []).filter(
      (r) => (r.operatiuni_substante?.length ?? 0) > 0 || (r.operatiuni_materii_prime?.length ?? 0) > 0,
    );
    setRanduri(lista);
  }, [fermaId, deLa, panaLa]);

  useEffect(() => {
    if (deschis) void incarca();
  }, [deschis, incarca]);

  if (!fermaId) return null;

  return (
    <details
      open={deschis}
      onToggle={(e) => setDeschis((e.currentTarget as HTMLDetailsElement).open)}
      style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '0.75rem 1rem' }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        Consumuri deja confirmate — corectează cantitățile ({deLa} → {panaLa})
      </summary>
      <p style={{ fontSize: '0.8rem', color: '#666' }}>
        Operațiunile din perioada aleasă mai sus, cu substanțe sau materii prime. Dacă o cantitate a fost trecută greșit
        (de ex. un bidon în loc de un litru), apasă „Modifică cantitățile”; stocul se recalculează automat. Pentru
        operațiuni mai vechi, mărește perioada (De la / Până la).
      </p>
      {loading && <p>Se încarcă...</p>}
      {eroare && <p style={{ color: '#b00020' }}>{eroare}</p>}
      {!loading && !eroare && randuri.length === 0 && (
        <p style={{ color: '#666' }}>Nicio operațiune cu consumuri în perioada aleasă.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {randuri.map((r) => {
          const substante: LinieConsum[] = (r.operatiuni_substante ?? []).map((s) => ({
            id: s.id,
            nume: s.substante?.nume ?? '—',
            um: s.substante?.unitate_masura ?? '',
            cantitate: Number(s.cantitate),
          }));
          const materii: LinieConsum[] = (r.operatiuni_materii_prime ?? []).map((m) => ({
            id: m.id,
            nume: m.materii_prime?.nume ?? '—',
            um: m.materii_prime?.unitate_masura ?? '',
            cantitate: Number(m.cantitate),
          }));
          return (
            <div key={r.id} style={{ borderTop: '1px solid #eee', paddingTop: '0.5rem' }}>
              <strong>{r.data}</strong> — parcela <strong>{r.parcele?.nume ?? '—'}</strong> ·{' '}
              {LABEL_OPERATIUNE[r.tip] ?? r.tip}
              <ConsumuriOperatiune
                substante={substante}
                materii={materii}
                onSaved={async () => {
                  await incarca();
                  await onModificat?.();
                }}
              />
            </div>
          );
        })}
      </div>
    </details>
  );
}
