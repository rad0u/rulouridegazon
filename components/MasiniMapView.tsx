'use client';

import { useState } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polygon } from 'react-leaflet';

// Leaflet caută implicit iconițele de marker în /images relativ la build,
// ceea ce nu funcționează cu bundler-ul Next.js — le înlocuim cu variante
// servite direct de pe CDN (același truc ca UtilajeMapView).
const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export type MasinaPozitie = {
  masina_id: string;
  nume: string;
  numar_inmatriculare: string | null;
  sofer_nume: string | null;
  viteza_limita_kmh: number | null;
  status: string;
  contact: boolean | null;
  lat: number | null;
  lon: number | null;
  viteza_kmh: number | null;
  ultima_actualizare: string | null;
  cursa_activa: { id: string; data_ora_start: string; scop: string | null } | null;
};

export type GeofenceHarta = {
  id: string;
  nume: string;
  ring: [number, number][]; // [lat, lon]
};

function formatOra(data: string | null) {
  if (!data) return 'necunoscută';
  try {
    return new Date(data).toLocaleString('ro-RO');
  } catch {
    return data;
  }
}

export default function MasiniMapView({
  masini,
  geofences = [],
}: {
  masini: MasinaPozitie[];
  geofences?: GeofenceHarta[];
}) {
  const cuPozitie = masini.filter((m) => m.lat !== null && m.lon !== null);
  const [strat, setStrat] = useState<'strada' | 'satelit'>('satelit');

  const centru: [number, number] =
    cuPozitie.length > 0 ? [cuPozitie[0].lat as number, cuPozitie[0].lon as number] : [45.9, 24.97];
  const zoomInitial = cuPozitie.length > 0 ? 12 : 7;

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

      <MapContainer center={centru} zoom={zoomInitial} style={{ height: '100%', width: '100%' }}>
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

        {geofences.map((g) =>
          g.ring.length >= 3 ? (
            <Polygon
              key={g.id}
              positions={g.ring}
              pathOptions={{ color: '#8a3fc4', fillColor: 'rgba(138, 63, 196, 0.15)', fillOpacity: 0.15, weight: 2, dashArray: '6 4' }}
            >
              <Popup>Zonă: {g.nume}</Popup>
            </Polygon>
          ) : null,
        )}

        {cuPozitie.map((m) => (
          <Marker key={m.masina_id} position={[m.lat as number, m.lon as number]} icon={markerIcon}>
            <Popup>
              <strong>{m.nume}</strong> {m.numar_inmatriculare ? `(${m.numar_inmatriculare})` : ''}
              <br />
              {m.sofer_nume && (
                <>
                  Șofer implicit: {m.sofer_nume}
                  <br />
                </>
              )}
              Status: {m.status === 'online' ? 'online' : 'offline'} · Contact:{' '}
              {m.contact === true ? 'pornit' : m.contact === false ? 'oprit' : 'necunoscut'}
              <br />
              Viteză: {m.viteza_kmh ?? '—'} km/h
              {m.viteza_limita_kmh ? ` (limită ${m.viteza_limita_kmh} km/h)` : ''}
              <br />
              Ultima poziție: {formatOra(m.ultima_actualizare)}
              {m.cursa_activa && (
                <>
                  <br />
                  <strong>Cursă activă</strong> din {formatOra(m.cursa_activa.data_ora_start)}
                  {m.cursa_activa.scop ? ` — ${m.cursa_activa.scop}` : ''}
                </>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
