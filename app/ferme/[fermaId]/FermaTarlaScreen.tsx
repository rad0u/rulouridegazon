'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useUserRole } from '../../../lib/useUserRole';
import FarmMap from '../../../components/FarmMap';
import { Parcela } from '../../../lib/parcelaTypes';

type Ferma = {
  id: string;
  nume: string;
  locatie: string | null;
  harta_url: string | null;
};

interface FermaTarlaScreenProps {
  fermaId: string;
}

export default function FermaTarlaScreen({ fermaId }: FermaTarlaScreenProps) {
  const { role, loading: roleLoading } = useUserRole();
  const [ferma, setFerma] = useState<Ferma | null>(null);
  const [parcele, setParcele] = useState<Parcela[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, [fermaId]);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [fermaRes, parceleRes] = await Promise.all([
      supabase.from('ferme').select('id,nume,locatie,harta_url').eq('id', fermaId).maybeSingle(),
      supabase
        .from('parcele')
        .select('id,ferma_id,nume,tip_gazon,stadiu,suprafata_mp,poligon_harta')
        .eq('ferma_id', fermaId)
        .order('nume'),
    ]);

    if (fermaRes.error) {
      setError(fermaRes.error.message);
      setLoading(false);
      return;
    }

    if (parceleRes.error) {
      setError(parceleRes.error.message);
      setLoading(false);
      return;
    }

    setFerma(fermaRes.data as Ferma | null);
    setParcele((parceleRes.data as Parcela[]) ?? []);
    setLoading(false);
  }

  if (loading || roleLoading) {
    return (
      <main style={{ padding: 'clamp(0.75rem, 4vw, 2rem)' }}>
        <p>Se încarcă...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ padding: 'clamp(0.75rem, 4vw, 2rem)' }}>
        <p style={{ color: '#b00020' }}>{error}</p>
      </main>
    );
  }

  if (!ferma) {
    return (
      <main style={{ padding: 'clamp(0.75rem, 4vw, 2rem)' }}>
        <h1>Nu ai acces la această fermă</h1>
        <p>
          Fie ferma nu există, fie contul tău nu are permisiuni pentru ea.{' '}
          <Link href="/dashboard">Înapoi la dashboard</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: 'clamp(1.3rem, 5vw, 2rem)', marginBottom: '0.25rem' }}>{ferma.nume}</h1>
      {ferma.locatie && <p style={{ color: '#666', marginTop: 0 }}>{ferma.locatie}</p>}

      <div style={{ marginTop: '1rem' }}>
        <FarmMap
          fermaId={ferma.id}
          hartaUrl={ferma.harta_url}
          parcele={parcele}
          editable={role === 'admin_central'}
          onHartaUploaded={(url) => setFerma((prev) => (prev ? { ...prev, harta_url: url } : prev))}
          onPolygonSaved={(parcelaId, poligon) =>
            setParcele((prev) =>
              prev.map((p) => (p.id === parcelaId ? { ...p, poligon_harta: poligon } : p))
            )
          }
          onParcelaUpdated={(updated) =>
            setParcele((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
          }
        />
      </div>
    </main>
  );
}
