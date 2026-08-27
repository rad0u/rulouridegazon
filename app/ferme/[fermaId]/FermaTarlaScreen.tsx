'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { supabase } from '../../../lib/supabaseClient';
import { useUserRole } from '../../../lib/useUserRole';
import { Parcela } from '../../../lib/parcelaTypes';

// react-leaflet foloseşte `window`/`document` la import, deci se încarcă
// doar în browser, nu şi la randare pe server.
const FarmMap = dynamic(() => import('../../../components/FarmMap'), {
  ssr: false,
  loading: () => <p>Se încarcă harta...</p>,
});

type Ferma = {
  id: string;
  nume: string;
  locatie: string | null;
  centru_lat: number | null;
  centru_lon: number | null;
  centru_zoom: number | null;
  harta_url: string | null;
  imagine_colt_ss_lat: number | null;
  imagine_colt_ss_lon: number | null;
  imagine_colt_ds_lat: number | null;
  imagine_colt_ds_lon: number | null;
  imagine_colt_sj_lat: number | null;
  imagine_colt_sj_lon: number | null;
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
      supabase
        .from('ferme')
        .select(
          'id,nume,locatie,centru_lat,centru_lon,centru_zoom,harta_url,imagine_colt_ss_lat,imagine_colt_ss_lon,imagine_colt_ds_lat,imagine_colt_ds_lon,imagine_colt_sj_lat,imagine_colt_sj_lon',
        )
        .eq('id', fermaId)
        .maybeSingle(),
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

      {role === 'admin_central' && ferma.centru_lat === null && (
        <p style={{ color: '#8a5a00', background: '#fff7e6', padding: '0.6rem 0.9rem', borderRadius: '6px' }}>
          Harta se deschide deocamdată pe centrul aproximativ al României. Navighează pe satelit
          până la fermă și apasă „📍 Setează ca centru implicit" ca s-o salvezi.
        </p>
      )}

      <div style={{ marginTop: '1rem' }}>
        <FarmMap
          fermaId={ferma.id}
          centruLat={ferma.centru_lat}
          centruLon={ferma.centru_lon}
          centruZoom={ferma.centru_zoom}
          imagineUrl={ferma.harta_url}
          imagineColtSS={
            ferma.imagine_colt_ss_lat !== null && ferma.imagine_colt_ss_lon !== null
              ? [ferma.imagine_colt_ss_lat, ferma.imagine_colt_ss_lon]
              : null
          }
          imagineColtDS={
            ferma.imagine_colt_ds_lat !== null && ferma.imagine_colt_ds_lon !== null
              ? [ferma.imagine_colt_ds_lat, ferma.imagine_colt_ds_lon]
              : null
          }
          imagineColtSJ={
            ferma.imagine_colt_sj_lat !== null && ferma.imagine_colt_sj_lon !== null
              ? [ferma.imagine_colt_sj_lat, ferma.imagine_colt_sj_lon]
              : null
          }
          parcele={parcele}
          editable={role === 'admin_central'}
          onCentruSaved={(lat, lon, zoom) =>
            setFerma((prev) => (prev ? { ...prev, centru_lat: lat, centru_lon: lon, centru_zoom: zoom } : prev))
          }
          onImagineSaved={(url, coltSS, coltDS, coltSJ) =>
            setFerma((prev) =>
              prev
                ? {
                    ...prev,
                    harta_url: url,
                    imagine_colt_ss_lat: coltSS?.[0] ?? null,
                    imagine_colt_ss_lon: coltSS?.[1] ?? null,
                    imagine_colt_ds_lat: coltDS?.[0] ?? null,
                    imagine_colt_ds_lon: coltDS?.[1] ?? null,
                    imagine_colt_sj_lat: coltSJ?.[0] ?? null,
                    imagine_colt_sj_lon: coltSJ?.[1] ?? null,
                  }
                : prev,
            )
          }
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
