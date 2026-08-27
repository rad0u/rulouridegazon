'use client';

import { useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Polygon, Polyline, CircleMarker, TileLayer, useMapEvents, useMap } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import { supabase } from '../lib/supabaseClient';
import { Parcela, PARCELA_COLORS, polygonLatLngs } from '../lib/parcelaTypes';
import ParcelaPanel from './ParcelaPanel';

interface FarmMapProps {
  fermaId: string;
  centruLat: number | null;
  centruLon: number | null;
  centruZoom: number | null;
  parcele: Parcela[];
  editable: boolean;
  onCentruSaved: (lat: number, lon: number, zoom: number) => void;
  onPolygonSaved: (parcelaId: string, poligon: Parcela['poligon_harta']) => void;
  onParcelaUpdated: (parcela: Parcela) => void;
}

// Centrul aproximativ al României — folosit doar cât timp ferma n-are încă
// un centru implicit setat.
const CENTRU_ROMANIA: [number, number] = [45.9, 24.97];

function MapClickCapture({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function MapRefCapture({ mapRef }: { mapRef: React.MutableRefObject<LeafletMap | null> }) {
  const map = useMap();
  mapRef.current = map;
  return null;
}

export default function FarmMap({
  fermaId,
  centruLat,
  centruLon,
  centruZoom,
  parcele,
  editable,
  onCentruSaved,
  onPolygonSaved,
  onParcelaUpdated,
}: FarmMapProps) {
  const [strat, setStrat] = useState<'strada' | 'satelit'>('satelit');
  const [selectedParcelaId, setSelectedParcelaId] = useState<string | null>(null);
  const [drawingParcelaId, setDrawingParcelaId] = useState<string | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingCentru, setSavingCentru] = useState(false);
  const [centruMsg, setCentruMsg] = useState<string | null>(null);

  const mapRef = useRef<LeafletMap | null>(null);

  const centru: [number, number] =
    centruLat !== null && centruLon !== null ? [centruLat, centruLon] : CENTRU_ROMANIA;
  const zoom = centruZoom ?? (centruLat !== null ? 17 : 7);

  function startDrawing(parcelaId: string) {
    setSelectedParcelaId(null);
    setDrawingParcelaId(parcelaId);
    setDrawingPoints([]);
    setSaveError(null);
  }

  function cancelDrawing() {
    setDrawingParcelaId(null);
    setDrawingPoints([]);
    setSaveError(null);
  }

  function handleMapClick(lat: number, lon: number) {
    if (!drawingParcelaId) return;
    setDrawingPoints((prev) => [...prev, [lat, lon]]);
  }

  function undoLastPoint() {
    setDrawingPoints((prev) => prev.slice(0, -1));
  }

  async function saveDrawing() {
    if (!drawingParcelaId || drawingPoints.length < 3) return;

    setSaving(true);
    setSaveError(null);

    const ring = [...drawingPoints, drawingPoints[0]].map(([lat, lon]) => [lon, lat]);
    const poligon = { type: 'Polygon' as const, coordinates: [ring] };

    const { error } = await supabase
      .from('parcele')
      .update({ poligon_harta: poligon })
      .eq('id', drawingParcelaId);

    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }

    onPolygonSaved(drawingParcelaId, poligon);
    setDrawingParcelaId(null);
    setDrawingPoints([]);
    setSaving(false);
  }

  async function salveazaCentru() {
    const map = mapRef.current;
    if (!map) return;

    setSavingCentru(true);
    setCentruMsg(null);

    const c = map.getCenter();
    const z = map.getZoom();

    const { error } = await supabase
      .from('ferme')
      .update({ centru_lat: c.lat, centru_lon: c.lng, centru_zoom: z })
      .eq('id', fermaId);

    setSavingCentru(false);

    if (error) {
      setCentruMsg(`Eroare: ${error.message}`);
      return;
    }

    onCentruSaved(c.lat, c.lng, z);
    setCentruMsg('Centru salvat.');
    setTimeout(() => setCentruMsg(null), 3000);
  }

  const selectedParcela = parcele.find((p) => p.id === selectedParcelaId) ?? null;
  const parcelaInDrawing = parcele.find((p) => p.id === drawingParcelaId) ?? null;
  const parceleFaraContur = parcele.filter((p) => polygonLatLngs(p).length < 3);

  return (
    <div>
      <div style={{ position: 'relative', height: 'clamp(320px, 60vh, 600px)', width: '100%' }}>
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            zIndex: 1000,
            display: 'flex',
            borderRadius: '6px',
            overflow: 'hidden',
            border: '1px solid #ccc',
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          }}
        >
          <button
            onClick={() => setStrat('strada')}
            style={{
              padding: '0.4rem 0.75rem',
              border: 'none',
              cursor: 'pointer',
              background: strat === 'strada' ? '#2e7d32' : '#fff',
              color: strat === 'strada' ? '#fff' : '#333',
              fontSize: '0.85rem',
            }}
          >
            Stradă
          </button>
          <button
            onClick={() => setStrat('satelit')}
            style={{
              padding: '0.4rem 0.75rem',
              border: 'none',
              cursor: 'pointer',
              background: strat === 'satelit' ? '#2e7d32' : '#fff',
              color: strat === 'satelit' ? '#fff' : '#333',
              fontSize: '0.85rem',
            }}
          >
            Satelit
          </button>
        </div>

        {editable && (
          <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 1000 }}>
            <button
              onClick={() => void salveazaCentru()}
              disabled={savingCentru}
              style={{
                padding: '0.4rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #ccc',
                background: '#fff',
                cursor: 'pointer',
                fontSize: '0.8rem',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
              }}
            >
              📍 {savingCentru ? 'Salvez...' : 'Setează ca centru implicit'}
            </button>
            {centruMsg && (
              <div
                style={{
                  marginTop: '0.3rem',
                  padding: '0.3rem 0.5rem',
                  background: '#fff',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                }}
              >
                {centruMsg}
              </div>
            )}
          </div>
        )}

        <MapContainer center={centru} zoom={zoom} style={{ height: '100%', width: '100%' }}>
          <MapRefCapture mapRef={mapRef} />
          {drawingParcelaId && <MapClickCapture onClick={handleMapClick} />}

          {strat === 'strada' ? (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          ) : (
            <TileLayer
              attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          )}

          {parcele.map((parcela, index) => {
            const latLngs = polygonLatLngs(parcela);
            if (latLngs.length < 3) return null;
            const color = PARCELA_COLORS[index % PARCELA_COLORS.length];
            const isSelected = parcela.id === selectedParcelaId;
            return (
              <Polygon
                key={parcela.id}
                positions={latLngs}
                pathOptions={{
                  color: color.stroke,
                  fillColor: color.fill,
                  fillOpacity: 0.35,
                  weight: isSelected ? 4 : 2,
                }}
                eventHandlers={{
                  click: () => {
                    if (!drawingParcelaId) setSelectedParcelaId(parcela.id);
                  },
                }}
              />
            );
          })}

          {drawingPoints.length > 0 && (
            <>
              <Polyline positions={drawingPoints} pathOptions={{ color: '#d21919', weight: 2 }} />
              {drawingPoints.map((p, i) => (
                <CircleMarker
                  key={i}
                  center={p}
                  radius={6}
                  pathOptions={{ color: '#d21919', fillColor: '#d21919', fillOpacity: 1 }}
                />
              ))}
            </>
          )}
        </MapContainer>
      </div>

      {editable && (
        <div style={{ marginTop: '1rem' }}>
          {!drawingParcelaId ? (
            parceleFaraContur.length > 0 && (
              <div>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  Parcele fără contur desenat încă:
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {parceleFaraContur.map((parcela) => (
                    <button
                      key={parcela.id}
                      onClick={() => startDrawing(parcela.id)}
                      style={{ padding: '0.5rem 0.85rem' }}
                    >
                      Desenează „{parcela.nume}"
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
              <p>
                Desenezi conturul pentru <strong>{parcelaInDrawing?.nume}</strong>. Dă click pe hartă
                ca să adaugi colțuri ({drawingPoints.length} puncte adăugate, minim 3).
              </p>
              {saveError && <p style={{ color: '#b00020' }}>{saveError}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <button onClick={undoLastPoint} disabled={drawingPoints.length === 0}>
                  Șterge ultimul punct
                </button>
                <button onClick={() => void saveDrawing()} disabled={drawingPoints.length < 3 || saving}>
                  {saving ? 'Salvez...' : 'Salvează conturul'}
                </button>
                <button onClick={cancelDrawing}>Renunță</button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedParcela ? (
        <div style={{ marginTop: '1.5rem' }}>
          <ParcelaPanel
            parcela={selectedParcela}
            showRedrawButton={editable}
            onRedraw={() => startDrawing(selectedParcela.id)}
            editable={editable}
            onParcelaUpdated={onParcelaUpdated}
          />
        </div>
      ) : (
        <p style={{ color: '#666', marginTop: '1rem' }}>
          Atinge o parcelă pe hartă ca să înregistrezi ce ai lucrat.
        </p>
      )}
    </div>
  );
}
