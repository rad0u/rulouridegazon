'use client';

import { useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Circle, useMapEvents } from 'react-leaflet';

export type GeofenceExistent = { id: string; nume: string; ring: [number, number][] };

function MapClickCapture({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function GeofenceMapEditor({
  geofences,
  drawMode,
  drawingPoints,
  cercCentru,
  cercMargine,
  razaCerc,
  onMapClick,
}: {
  geofences: GeofenceExistent[];
  drawMode: 'poligon' | 'cerc';
  drawingPoints: [number, number][];
  cercCentru: [number, number] | null;
  cercMargine: [number, number] | null;
  razaCerc: number | null;
  onMapClick: (lat: number, lon: number) => void;
}) {
  const [strat, setStrat] = useState<'strada' | 'satelit'>('satelit');
  const centru: [number, number] = geofences[0]?.ring[0] ?? [45.9, 24.97];

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
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
          style={{ padding: '0.4rem 0.75rem', border: 'none', cursor: 'pointer', background: strat === 'strada' ? '#2e7d32' : '#fff', color: strat === 'strada' ? '#fff' : '#333', fontSize: '0.85rem' }}
        >
          Stradă
        </button>
        <button
          onClick={() => setStrat('satelit')}
          style={{ padding: '0.4rem 0.75rem', border: 'none', cursor: 'pointer', background: strat === 'satelit' ? '#2e7d32' : '#fff', color: strat === 'satelit' ? '#fff' : '#333', fontSize: '0.85rem' }}
        >
          Satelit
        </button>
      </div>

      <MapContainer center={centru} zoom={11} style={{ height: '100%', width: '100%' }}>
        <MapClickCapture onClick={onMapClick} />
        {strat === 'strada' ? (
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        ) : (
          <TileLayer
            attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        )}

        {geofences.map((g) => (
          <Polygon key={g.id} positions={g.ring} pathOptions={{ color: '#8a3fc4', fillColor: 'rgba(138, 63, 196, 0.15)', fillOpacity: 0.15, weight: 2 }} />
        ))}

        {drawMode === 'poligon' && drawingPoints.length > 0 && (
          <>
            <Polyline positions={drawingPoints} pathOptions={{ color: '#d21919', weight: 2 }} />
            {drawingPoints.map((p, i) => (
              <CircleMarker key={i} center={p} radius={5} pathOptions={{ color: '#d21919' }} />
            ))}
            {drawingPoints.length >= 3 && (
              <Polygon positions={drawingPoints} pathOptions={{ color: '#d21919', fillColor: 'rgba(210, 25, 25, 0.15)', fillOpacity: 0.15, dashArray: '4 4' }} />
            )}
          </>
        )}

        {drawMode === 'cerc' && cercCentru && <CircleMarker center={cercCentru} radius={6} pathOptions={{ color: '#d21919' }} />}
        {drawMode === 'cerc' && cercCentru && cercMargine && razaCerc !== null && (
          <Circle center={cercCentru} radius={razaCerc} pathOptions={{ color: '#d21919', fillColor: 'rgba(210, 25, 25, 0.15)', fillOpacity: 0.15, dashArray: '4 4' }} />
        )}
      </MapContainer>
    </div>
  );
}
