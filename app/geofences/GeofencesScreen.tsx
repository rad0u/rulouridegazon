'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '../../lib/supabaseClient';
import { distantaMetri, generateCirclePolygon } from '../../lib/geo';
import type { GeofenceExistent } from '../../components/GeofenceMapEditor';

const GeofenceMapEditor = dynamic(() => import('../../components/GeofenceMapEditor'), {
  ssr: false,
  loading: () => <p>Se încarcă harta...</p>,
});

const RO_LAT_MIN = 42;
const RO_LAT_MAX = 50;
const RO_LON_MIN = 18;
const RO_LON_MAX = 32;

function ringLatLng(poligon: { coordinates?: number[][][] } | null): [number, number][] {
  const ring = poligon?.coordinates?.[0];
  if (!ring || ring.length < 3) return [];
  const latLngs: [number, number][] = ring.map(([lon, lat]) => [lat, lon]);
  const plauzibil = latLngs.every(([lat, lon]) => lat >= RO_LAT_MIN && lat <= RO_LAT_MAX && lon >= RO_LON_MIN && lon <= RO_LON_MAX);
  return plauzibil ? latLngs : [];
}

type Geofence = {
  id: string;
  nume: string;
  tip_alerta: string;
  activ: boolean;
  poligon: { coordinates?: number[][][] } | null;
};

const TIP_ALERTA_LABEL: Record<string, string> = {
  intrare: 'La intrare în zonă',
  iesire: 'La ieșire din zonă',
  ambele: 'La intrare și ieșire',
};

export default function GeofencesScreen() {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nume, setNume] = useState('');
  const [tipAlerta, setTipAlerta] = useState<'intrare' | 'iesire' | 'ambele'>('ambele');
  const [drawMode, setDrawMode] = useState<'poligon' | 'cerc'>('poligon');
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [cercCentru, setCercCentru] = useState<[number, number] | null>(null);
  const [cercMargine, setCercMargine] = useState<[number, number] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function incarca() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.from('geofences').select('id, nume, tip_alerta, activ, poligon').order('nume');
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setGeofences((data as Geofence[]) ?? []);
  }

  useEffect(() => {
    void incarca();
  }, []);

  function resetDesen() {
    setDrawingPoints([]);
    setCercCentru(null);
    setCercMargine(null);
  }

  function schimbaModDesenare(mod: 'poligon' | 'cerc') {
    setDrawMode(mod);
    resetDesen();
  }

  function handleMapClick(lat: number, lon: number) {
    if (drawMode === 'cerc') {
      if (!cercCentru) setCercCentru([lat, lon]);
      else setCercMargine([lat, lon]);
      return;
    }
    setDrawingPoints((prev) => [...prev, [lat, lon]]);
  }

  function undoLastPoint() {
    setDrawingPoints((prev) => prev.slice(0, -1));
  }

  function undoCerc() {
    if (cercMargine) setCercMargine(null);
    else setCercCentru(null);
  }

  const razaCerc = cercCentru && cercMargine ? distantaMetri(cercCentru, cercMargine) : null;

  async function salveazaZona() {
    if (!nume.trim()) {
      setSaveError('Completează un nume pentru zonă.');
      return;
    }

    let ring: [number, number][];
    if (drawMode === 'cerc') {
      if (!cercCentru || !cercMargine) {
        setSaveError('Marchează centrul și un punct pe margine pentru cerc.');
        return;
      }
      ring = generateCirclePolygon(cercCentru, distantaMetri(cercCentru, cercMargine), 64);
    } else {
      if (drawingPoints.length < 3) {
        setSaveError('Adaugă cel puțin 3 puncte pentru poligon.');
        return;
      }
      ring = drawingPoints;
    }

    setSaving(true);
    setSaveError(null);

    const geoJsonRing = [...ring, ring[0]].map(([lat, lon]) => [lon, lat]);
    const poligon = { type: 'Polygon' as const, coordinates: [geoJsonRing] };

    const { error: err } = await supabase.from('geofences').insert({
      nume: nume.trim(),
      poligon,
      tip_alerta: tipAlerta,
    });

    setSaving(false);

    if (err) {
      setSaveError(err.message);
      return;
    }

    setNume('');
    resetDesen();
    await incarca();
  }

  async function toggleActiv(g: Geofence) {
    await supabase.from('geofences').update({ activ: !g.activ }).eq('id', g.id);
    await incarca();
  }

  async function sterge(g: Geofence) {
    await supabase.from('geofences').delete().eq('id', g.id);
    await incarca();
  }

  const geofenceMapItems: GeofenceExistent[] = geofences
    .map((g) => ({ id: g.id, nume: g.nume, ring: ringLatLng(g.poligon) }))
    .filter((g) => g.ring.length >= 3);

  return (
    <main style={{ padding: 'clamp(0.75rem, 3vw, 1.5rem)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h1 style={{ margin: 0 }}>Zone (geofencing)</h1>
        <p style={{ color: '#666' }}>
          Definește zone pe hartă pentru alerte automate de intrare/ieșire (ex. sediu, zonă de operare permisă).
        </p>
      </div>

      {error && <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>}

      <div style={{ height: 'clamp(320px, 50vh, 520px)', borderRadius: '8px', overflow: 'hidden', border: '1px solid #ddd' }}>
        <GeofenceMapEditor
          geofences={geofenceMapItems}
          drawMode={drawMode}
          drawingPoints={drawingPoints}
          cercCentru={cercCentru}
          cercMargine={cercMargine}
          razaCerc={razaCerc}
          onMapClick={handleMapClick}
        />
      </div>

      <section style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem', maxWidth: '520px' }}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>Desenează zonă nouă</h2>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <button onClick={() => schimbaModDesenare('poligon')} style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #ccc', background: drawMode === 'poligon' ? '#2e7d32' : '#f5f5f5', color: drawMode === 'poligon' ? '#fff' : '#333', cursor: 'pointer' }}>
            Poligon
          </button>
          <button onClick={() => schimbaModDesenare('cerc')} style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #ccc', background: drawMode === 'cerc' ? '#2e7d32' : '#f5f5f5', color: drawMode === 'cerc' ? '#fff' : '#333', cursor: 'pointer' }}>
            Cerc
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 0.75rem' }}>
          {drawMode === 'poligon'
            ? `Dă click pe hartă ca să adaugi colțuri (${drawingPoints.length} puncte adăugate, minim 3).`
            : `Primul click = centru, al doilea = un punct pe margine.${razaCerc !== null ? ` (~${Math.round(razaCerc)} m)` : ''}`}
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          {drawMode === 'poligon' ? (
            <button onClick={undoLastPoint} disabled={drawingPoints.length === 0} style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>
              ↩ Anulează ultimul punct
            </button>
          ) : (
            <button onClick={undoCerc} disabled={!cercCentru} style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>
              ↩ Anulează
            </button>
          )}
          <button onClick={resetDesen} style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>
            Șterge tot desenul
          </button>
        </div>

        <label style={{ display: 'block', marginBottom: '0.6rem' }}>
          Nume zonă
          <input type="text" value={nume} onChange={(e) => setNume(e.target.value)} placeholder="ex. Sediu Săbăreni" style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }} />
        </label>

        <label style={{ display: 'block', marginBottom: '0.75rem' }}>
          Alertă
          <select value={tipAlerta} onChange={(e) => setTipAlerta(e.target.value as any)} style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}>
            <option value="ambele">La intrare și ieșire</option>
            <option value="intrare">Doar la intrare</option>
            <option value="iesire">Doar la ieșire</option>
          </select>
        </label>

        {saveError && <p style={{ color: '#b00020', marginBottom: '0.6rem' }}>{saveError}</p>}

        <button onClick={() => void salveazaZona()} disabled={saving} style={{ width: '100%', padding: '0.75rem', fontWeight: 'bold', borderRadius: '6px', border: '1px solid #2e7d32', background: '#2e7d32', color: '#fff', cursor: 'pointer' }}>
          {saving ? 'Salvez...' : 'Salvează zonă'}
        </button>
      </section>

      <section>
        <h2 style={{ fontSize: '1.05rem' }}>Zone existente</h2>
        {loading && <p>Se încarcă...</p>}
        {!loading && geofences.length === 0 && <p style={{ color: '#666' }}>Nicio zonă definită încă.</p>}
        {!loading && geofences.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem', maxWidth: '640px' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                  <th style={{ padding: '0.4rem' }}>Nume</th>
                  <th style={{ padding: '0.4rem' }}>Alertă</th>
                  <th style={{ padding: '0.4rem' }}>Activă</th>
                  <th style={{ padding: '0.4rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {geofences.map((g) => (
                  <tr key={g.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.4rem' }}>{g.nume}</td>
                    <td style={{ padding: '0.4rem' }}>{TIP_ALERTA_LABEL[g.tip_alerta] ?? g.tip_alerta}</td>
                    <td style={{ padding: '0.4rem' }}>
                      <input type="checkbox" checked={g.activ} onChange={() => void toggleActiv(g)} />
                    </td>
                    <td style={{ padding: '0.4rem' }}>
                      <button onClick={() => void sterge(g)} style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #b00020', background: '#fff', color: '#b00020', cursor: 'pointer', fontSize: '0.8rem' }}>
                        Șterge
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
