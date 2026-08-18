'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

// Leaflet caută implicit iconițele de marker în /images relativ la build,
// ceea ce nu funcționează cu bundler-ul Next.js. Le înlocuim cu variante
// servite direct de pe CDN.
const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export type UtilajPozitie = {
  utilaj_id: string;
  nume: string;
  tip: string | null;
  ferma_nume: string | null;
  status: string;
  lat: number | null;
  lon: number | null;
  ultima_actualizare: string | null;
  combustibil_nivel: number | null;
  combustibil_data: string | null;
  combustibil_capacitate_litri: number | null;
};

function formatOra(data: string | null) {
  if (!data) return 'necunoscută';
  try {
    return new Date(data).toLocaleString('ro-RO');
  } catch {
    return data;
  }
}

export default function UtilajeMapView({ utilaje }: { utilaje: UtilajPozitie[] }) {
  const cuPozitie = utilaje.filter((u) => u.lat !== null && u.lon !== null);

  // Centru implicit aproximativ pe România.
  const centru: [number, number] = [45.9, 24.97];

  return (
    <MapContainer center={centru} zoom={7} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {cuPozitie.map((u) => (
        <Marker key={u.utilaj_id} position={[u.lat as number, u.lon as number]} icon={markerIcon}>
          <Popup>
            <strong>{u.nume}</strong>
            <br />
            {u.ferma_nume && (
              <>
                Fermă: {u.ferma_nume}
                <br />
              </>
            )}
            Status: {u.status === 'online' ? 'online' : 'offline'}
            <br />
            Ultima poziție: {formatOra(u.ultima_actualizare)}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
