'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Polygon, Polyline, Circle, CircleMarker, Marker, TileLayer, useMapEvents, useMap } from 'react-leaflet';
import L, { type Map as LeafletMap } from 'leaflet';
import { supabase } from '../lib/supabaseClient';
import { Parcela, PARCELA_COLORS, polygonLatLngs, centroidLatLng } from '../lib/parcelaTypes';
import { distantaMetri, generateCirclePolygon, zoomForResolution } from '../lib/geo';
import ParcelaPanel from './ParcelaPanel';
import RotatedImageOverlay from './RotatedImageOverlay';

// Zoom maxim implicit cât timp nu e nicio imagine suprapusă calibrată (sau
// încă nu s-a calculat rezoluția ei).
const MAX_ZOOM_IMPLICIT = 20;

interface FarmMapProps {
  fermaId: string;
  centruLat: number | null;
  centruLon: number | null;
  centruZoom: number | null;
  imagineUrl: string | null;
  imagineColtSS: [number, number] | null;
  imagineColtDS: [number, number] | null;
  imagineColtSJ: [number, number] | null;
  parcele: Parcela[];
  tipuriGazon: { id: string; nume: string }[];
  editable: boolean;
  onCentruSaved: (lat: number, lon: number, zoom: number) => void;
  onTipuriGazonSchimbate: () => void;
  onImagineSaved: (
    url: string | null,
    coltSS: [number, number] | null,
    coltDS: [number, number] | null,
    coltSJ: [number, number] | null,
  ) => void;
  onPolygonSaved: (parcelaId: string, poligon: Parcela['poligon_harta']) => void;
  onParcelaUpdated: (parcela: Parcela) => void;
  onParcelaAdaugata: (parcela: Parcela) => void;
  onParcelaStearsa: (parcelaId: string) => void;
}

// Centrul aproximativ al României — folosit doar cât timp ferma n-are încă
// un centru implicit setat.
const CENTRU_ROMANIA: [number, number] = [45.9, 24.97];

const PASI_CALIBRARE = [
  'Click pe hartă unde este colțul STÂNGA-SUS al imaginii',
  'Click pe hartă unde este colțul DREAPTA-SUS al imaginii',
  'Click pe hartă unde este colțul STÂNGA-JOS al imaginii',
];

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// Etichetă text (numele parcelei) afișată în centrul poligonului ei, ca
// admin-ul fermei să știe ce selectează pe hartă. Non-interactivă — click-ul
// trece prin ea direct la poligonul de dedesubt.
function parcelaLabelIcon(text: string) {
  return L.divIcon({
    className: '',
    html: `<div style="
      transform: translate(-50%, -50%);
      white-space: nowrap;
      font-weight: 700;
      font-size: 13px;
      color: #fff;
      text-shadow: 0 0 3px #000, 0 0 3px #000, 0 1px 2px #000;
      pointer-events: none;
    ">${escapeHtml(text)}</div>`,
    iconSize: [0, 0],
  });
}

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
  imagineUrl,
  imagineColtSS,
  imagineColtDS,
  imagineColtSJ,
  parcele,
  tipuriGazon,
  editable,
  onCentruSaved,
  onTipuriGazonSchimbate,
  onImagineSaved,
  onPolygonSaved,
  onParcelaUpdated,
  onParcelaAdaugata,
  onParcelaStearsa,
}: FarmMapProps) {
  const [strat, setStrat] = useState<'strada' | 'satelit'>('satelit');
  const [selectedParcelaId, setSelectedParcelaId] = useState<string | null>(null);
  const [drawingParcelaId, setDrawingParcelaId] = useState<string | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [drawMode, setDrawMode] = useState<'poligon' | 'cerc'>('poligon');
  const [cercCentru, setCercCentru] = useState<[number, number] | null>(null);
  const [cercMargine, setCercMargine] = useState<[number, number] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingCentru, setSavingCentru] = useState(false);
  const [centruMsg, setCentruMsg] = useState<string | null>(null);

  // Imagine suprapusă (ex. captură Google Earth) ancorată prin 3 puncte GPS.
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationUrl, setCalibrationUrl] = useState<string | null>(null);
  const [calibrationPoints, setCalibrationPoints] = useState<[number, number][]>([]);
  const [savingCalibrare, setSavingCalibrare] = useState(false);
  const [calibrareError, setCalibrareError] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0.85);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [imgMaxZoom, setImgMaxZoom] = useState<number | null>(null);

  // Adăugare parcelă nouă (nume + număr definite liber de admin central).
  const [adaugaParcelaOpen, setAdaugaParcelaOpen] = useState(false);
  const [nouaParcelaNume, setNouaParcelaNume] = useState('');
  const [nouaParcelaTipGazon, setNouaParcelaTipGazon] = useState('');
  const [nouaParcelaSuprafata, setNouaParcelaSuprafata] = useState('');
  const [adaugaParcelaSaving, setAdaugaParcelaSaving] = useState(false);
  const [adaugaParcelaError, setAdaugaParcelaError] = useState<string | null>(null);

  // Gestiune tipuri de gazon (listă editabilă, nu mai e hardcodată în cod).
  const [tipuriGazonOpen, setTipuriGazonOpen] = useState(false);
  const [nouTipGazonNume, setNouTipGazonNume] = useState('');
  const [tipuriGazonSaving, setTipuriGazonSaving] = useState(false);
  const [tipuriGazonError, setTipuriGazonError] = useState<string | null>(null);

  const mapRef = useRef<LeafletMap | null>(null);

  const centru: [number, number] =
    centruLat !== null && centruLon !== null ? [centruLat, centruLon] : CENTRU_ROMANIA;
  const zoom = centruZoom ?? (centruLat !== null ? 17 : 7);

  const areOverlayCalibrat = !!(imagineUrl && imagineColtSS && imagineColtDS && imagineColtSJ);

  // Limitează zoom-ul maxim la rezoluția reală a imaginii suprapuse — dincolo
  // de acel nivel, harta doar mărește pixelii, fără detalii noi.
  function handleOverlayNaturalSize(width: number, height: number) {
    if (!imagineColtSS || !imagineColtDS || !imagineColtSJ) return;

    const latimeMetri = distantaMetri(imagineColtSS, imagineColtDS);
    const inaltimeMetri = distantaMetri(imagineColtSS, imagineColtSJ);
    const metriPerPixel = (latimeMetri / width + inaltimeMetri / height) / 2;

    if (!Number.isFinite(metriPerPixel) || metriPerPixel <= 0) return;

    const zoomCalculat = zoomForResolution(metriPerPixel, imagineColtSS[0]);
    const zoomLimitat = Math.min(22, Math.max(14, Math.floor(zoomCalculat)));
    setImgMaxZoom(zoomLimitat);
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setMaxZoom(areOverlayCalibrat && imgMaxZoom !== null ? imgMaxZoom : MAX_ZOOM_IMPLICIT);
  }, [imgMaxZoom, areOverlayCalibrat]);

  function startDrawing(parcelaId: string) {
    setCalibrating(false);
    setSelectedParcelaId(null);
    setDrawingParcelaId(parcelaId);
    setDrawingPoints([]);
    setDrawMode('poligon');
    setCercCentru(null);
    setCercMargine(null);
    setSaveError(null);
  }

  function cancelDrawing() {
    setDrawingParcelaId(null);
    setDrawingPoints([]);
    setCercCentru(null);
    setCercMargine(null);
    setSaveError(null);
  }

  function schimbaModDesenare(mod: 'poligon' | 'cerc') {
    setDrawMode(mod);
    setDrawingPoints([]);
    setCercCentru(null);
    setCercMargine(null);
    setSaveError(null);
  }

  function startCalibrare(url: string) {
    setDrawingParcelaId(null);
    setSelectedParcelaId(null);
    setCalibrationUrl(url);
    setCalibrationPoints([]);
    setCalibrareError(null);
    setCalibrating(true);
  }

  function cancelCalibrare() {
    setCalibrating(false);
    setCalibrationUrl(null);
    setCalibrationPoints([]);
    setCalibrareError(null);
  }

  function handleMapClick(lat: number, lon: number) {
    if (calibrating) {
      setCalibrationPoints((prev) => (prev.length < 3 ? [...prev, [lat, lon]] : prev));
      return;
    }
    if (!drawingParcelaId) return;

    if (drawMode === 'cerc') {
      if (!cercCentru) {
        setCercCentru([lat, lon]);
      } else {
        setCercMargine([lat, lon]);
      }
      return;
    }

    setDrawingPoints((prev) => [...prev, [lat, lon]]);
  }

  function undoLastPoint() {
    setDrawingPoints((prev) => prev.slice(0, -1));
  }

  function undoCerc() {
    if (cercMargine) {
      setCercMargine(null);
    } else {
      setCercCentru(null);
    }
  }

  function undoLastCalibrationPoint() {
    setCalibrationPoints((prev) => prev.slice(0, -1));
  }

  const razaCerc = cercCentru && cercMargine ? distantaMetri(cercCentru, cercMargine) : null;

  async function saveDrawing() {
    if (!drawingParcelaId) return;

    let ringLatLng: [number, number][];

    if (drawMode === 'cerc') {
      if (!cercCentru || !cercMargine) return;
      ringLatLng = generateCirclePolygon(cercCentru, distantaMetri(cercCentru, cercMargine), 64);
    } else {
      if (drawingPoints.length < 3) return;
      ringLatLng = drawingPoints;
    }

    setSaving(true);
    setSaveError(null);

    const ring = [...ringLatLng, ringLatLng[0]].map(([lat, lon]) => [lon, lat]);
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
    setCercCentru(null);
    setCercMargine(null);
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

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    const path = `${fermaId}/${Date.now()}-${file.name}`;
    const { error: uploadErr } = await supabase.storage
      .from('harti-ferme')
      .upload(path, file, { upsert: true });

    setUploading(false);
    event.target.value = '';

    if (uploadErr) {
      setUploadError(uploadErr.message);
      return;
    }

    const { data } = supabase.storage.from('harti-ferme').getPublicUrl(path);
    startCalibrare(data.publicUrl);
  }

  async function salveazaCalibrarea() {
    if (!calibrationUrl || calibrationPoints.length < 3) return;

    setSavingCalibrare(true);
    setCalibrareError(null);

    const [coltSS, coltDS, coltSJ] = calibrationPoints;

    const { error } = await supabase
      .from('ferme')
      .update({
        harta_url: calibrationUrl,
        imagine_colt_ss_lat: coltSS[0],
        imagine_colt_ss_lon: coltSS[1],
        imagine_colt_ds_lat: coltDS[0],
        imagine_colt_ds_lon: coltDS[1],
        imagine_colt_sj_lat: coltSJ[0],
        imagine_colt_sj_lon: coltSJ[1],
      })
      .eq('id', fermaId);

    setSavingCalibrare(false);

    if (error) {
      setCalibrareError(error.message);
      return;
    }

    onImagineSaved(calibrationUrl, coltSS, coltDS, coltSJ);
    cancelCalibrare();
  }

  async function stergeImaginea() {
    const { error } = await supabase
      .from('ferme')
      .update({
        harta_url: null,
        imagine_colt_ss_lat: null,
        imagine_colt_ss_lon: null,
        imagine_colt_ds_lat: null,
        imagine_colt_ds_lon: null,
        imagine_colt_sj_lat: null,
        imagine_colt_sj_lon: null,
      })
      .eq('id', fermaId);

    if (!error) {
      onImagineSaved(null, null, null, null);
    }
  }

  async function adaugaTipGazon() {
    if (!nouTipGazonNume.trim()) return;

    setTipuriGazonSaving(true);
    setTipuriGazonError(null);

    const { error } = await supabase.from('tipuri_gazon').insert({ nume: nouTipGazonNume.trim() });

    setTipuriGazonSaving(false);

    if (error) {
      setTipuriGazonError(
        error.code === '23505' ? 'Există deja un tip de gazon cu acest nume.' : error.message,
      );
      return;
    }

    setNouTipGazonNume('');
    onTipuriGazonSchimbate();
  }

  async function stergeTipGazon(id: string) {
    setTipuriGazonSaving(true);
    setTipuriGazonError(null);

    const { error } = await supabase.from('tipuri_gazon').delete().eq('id', id);

    setTipuriGazonSaving(false);

    if (error) {
      setTipuriGazonError(error.message);
      return;
    }

    onTipuriGazonSchimbate();
  }

  async function adaugaParcela() {
    if (!nouaParcelaNume.trim()) {
      setAdaugaParcelaError('Numele parcelei e obligatoriu.');
      return;
    }

    const suprafataNum = nouaParcelaSuprafata === '' ? null : Number(nouaParcelaSuprafata);
    if (nouaParcelaSuprafata !== '' && (Number.isNaN(suprafataNum) || (suprafataNum ?? 0) < 0)) {
      setAdaugaParcelaError('Suprafața trebuie să fie un număr pozitiv.');
      return;
    }

    setAdaugaParcelaSaving(true);
    setAdaugaParcelaError(null);

    const { data, error } = await supabase
      .from('parcele')
      .insert({
        ferma_id: fermaId,
        nume: nouaParcelaNume.trim(),
        tip_gazon: nouaParcelaTipGazon || null,
        suprafata_mp: suprafataNum,
        poligon_harta: null,
      })
      .select('id,ferma_id,nume,tip_gazon,stadiu,suprafata_mp,poligon_harta')
      .single();

    setAdaugaParcelaSaving(false);

    if (error || !data) {
      setAdaugaParcelaError(error?.message ?? 'Eroare la adăugarea parcelei.');
      return;
    }

    onParcelaAdaugata(data as Parcela);
    setNouaParcelaNume('');
    setNouaParcelaTipGazon('');
    setNouaParcelaSuprafata('');
    setAdaugaParcelaOpen(false);
  }

  function handleParcelaStearsa(parcelaId: string) {
    onParcelaStearsa(parcelaId);
    setSelectedParcelaId(null);
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
          {(drawingParcelaId || calibrating) && <MapClickCapture onClick={handleMapClick} />}

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

          {areOverlayCalibrat && !calibrating && (
            <RotatedImageOverlay
              imageUrl={imagineUrl as string}
              topLeft={imagineColtSS as [number, number]}
              topRight={imagineColtDS as [number, number]}
              bottomLeft={imagineColtSJ as [number, number]}
              opacity={overlayOpacity}
              visible={overlayVisible}
              onNaturalSize={handleOverlayNaturalSize}
            />
          )}

          {parcele.map((parcela, index) => {
            const latLngs = polygonLatLngs(parcela);
            if (latLngs.length < 3) return null;
            const color = PARCELA_COLORS[index % PARCELA_COLORS.length];
            const isSelected = parcela.id === selectedParcelaId;
            const center = centroidLatLng(latLngs);
            return (
              <Fragment key={parcela.id}>
                <Polygon
                  positions={latLngs}
                  pathOptions={{
                    color: color.stroke,
                    fillColor: color.fill,
                    fillOpacity: 0.35,
                    weight: isSelected ? 4 : 2,
                  }}
                  eventHandlers={{
                    click: () => {
                      if (!drawingParcelaId && !calibrating) setSelectedParcelaId(parcela.id);
                    },
                  }}
                />
                {center && <Marker position={center} icon={parcelaLabelIcon(parcela.nume)} interactive={false} />}
              </Fragment>
            );
          })}

          {drawMode === 'poligon' && drawingPoints.length > 0 && (
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

          {drawMode === 'cerc' && cercCentru && (
            <CircleMarker
              center={cercCentru}
              radius={7}
              pathOptions={{ color: '#d21919', fillColor: '#d21919', fillOpacity: 1 }}
            />
          )}
          {drawMode === 'cerc' && cercMargine && (
            <CircleMarker
              center={cercMargine}
              radius={6}
              pathOptions={{ color: '#d21919', fillColor: '#fff', fillOpacity: 1 }}
            />
          )}
          {drawMode === 'cerc' && cercCentru && cercMargine && razaCerc !== null && (
            <Circle
              center={cercCentru}
              radius={razaCerc}
              pathOptions={{ color: '#d21919', fillColor: 'rgba(210,25,25,0.15)', weight: 2 }}
            />
          )}

          {calibrating &&
            calibrationPoints.map((p, i) => (
              <CircleMarker
                key={i}
                center={p}
                radius={7}
                pathOptions={{ color: '#1f4e8c', fillColor: '#3070c4', fillOpacity: 1 }}
              />
            ))}
        </MapContainer>
      </div>

      {editable && !calibrating && !drawingParcelaId && (
        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label
            style={{
              display: 'inline-block',
              padding: '0.5rem 0.9rem',
              border: '1px solid #ccc',
              borderRadius: '6px',
              background: '#f5f5f5',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            {uploading
              ? 'Se încarcă...'
              : imagineUrl
                ? 'Schimbă imaginea suprapusă'
                : 'Adaugă imagine suprapusă (ex. captură Google Earth)'}
            <input type="file" accept="image/*" onChange={handleFileChange} disabled={uploading} style={{ display: 'none' }} />
          </label>
          {imagineUrl && (
            <>
              {!areOverlayCalibrat && (
                <button onClick={() => startCalibrare(imagineUrl)} style={{ padding: '0.5rem 0.9rem' }}>
                  Calibrează imaginea
                </button>
              )}
              {areOverlayCalibrat && (
                <button onClick={() => startCalibrare(imagineUrl)} style={{ padding: '0.5rem 0.9rem' }}>
                  Recalibrează
                </button>
              )}
              <button onClick={() => void stergeImaginea()} style={{ padding: '0.5rem 0.9rem' }}>
                Șterge imaginea
              </button>
            </>
          )}
        </div>
      )}
      {uploadError && <p style={{ color: '#b00020' }}>{uploadError}</p>}

      {calibrating && (
        <div style={{ marginTop: '1rem', border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {calibrationUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={calibrationUrl}
                alt="Imagine de calibrat"
                style={{ maxWidth: '220px', maxHeight: '220px', border: '1px solid #ccc', borderRadius: '4px' }}
              />
            )}
            <div style={{ flex: '1 1 240px' }}>
              <p style={{ fontWeight: 'bold', marginTop: 0 }}>
                {calibrationPoints.length < 3
                  ? PASI_CALIBRARE[calibrationPoints.length]
                  : 'Toate cele 3 puncte sunt adăugate.'}
              </p>
              <p style={{ fontSize: '0.85rem', color: '#666' }}>
                Uită-te la imaginea din stânga, identifică pe harta de dedesubt exact ce se vede în
                colțul respectiv, apoi dă click acolo. Punct {calibrationPoints.length}/3.
              </p>
              {calibrareError && <p style={{ color: '#b00020' }}>{calibrareError}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <button onClick={undoLastCalibrationPoint} disabled={calibrationPoints.length === 0}>
                  Șterge ultimul punct
                </button>
                <button
                  onClick={() => void salveazaCalibrarea()}
                  disabled={calibrationPoints.length < 3 || savingCalibrare}
                >
                  {savingCalibrare ? 'Salvez...' : 'Salvează calibrarea'}
                </button>
                <button onClick={cancelCalibrare}>Renunță</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {areOverlayCalibrat && !calibrating && (
        <div
          style={{
            marginTop: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
            fontSize: '0.85rem',
          }}
        >
          <button onClick={() => setOverlayVisible((v) => !v)} style={{ padding: '0.4rem 0.75rem' }}>
            {overlayVisible ? 'Ascunde imaginea suprapusă' : 'Arată imaginea suprapusă'}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            Transparență
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
              disabled={!overlayVisible}
            />
          </label>
        </div>
      )}

      {editable && !calibrating && !drawingParcelaId && (
        <div style={{ marginTop: '1rem' }}>
          {!adaugaParcelaOpen ? (
            <button onClick={() => setAdaugaParcelaOpen(true)} style={{ padding: '0.5rem 0.85rem' }}>
              ➕ Adaugă parcelă nouă
            </button>
          ) : (
            <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
              <p style={{ fontWeight: 'bold', marginTop: 0 }}>Parcelă nouă</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
                  Nume
                  <input
                    type="text"
                    value={nouaParcelaNume}
                    onChange={(e) => setNouaParcelaNume(e.target.value)}
                    placeholder="ex. Parcelă 7"
                    style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '160px' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
                  Tip gazon (opțional)
                  <select
                    value={nouaParcelaTipGazon}
                    onChange={(e) => setNouaParcelaTipGazon(e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
                  >
                    <option value="">—</option>
                    {tipuriGazon.map((t) => (
                      <option key={t.id} value={t.nume}>
                        {t.nume}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
                  Suprafață mp (opțional)
                  <input
                    type="number"
                    min="0"
                    value={nouaParcelaSuprafata}
                    onChange={(e) => setNouaParcelaSuprafata(e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', width: '140px' }}
                  />
                </label>
              </div>
              {adaugaParcelaError && <p style={{ color: '#b00020' }}>{adaugaParcelaError}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button onClick={() => void adaugaParcela()} disabled={adaugaParcelaSaving}>
                  {adaugaParcelaSaving ? 'Salvez...' : 'Salvează'}
                </button>
                <button
                  onClick={() => {
                    setAdaugaParcelaOpen(false);
                    setAdaugaParcelaError(null);
                  }}
                >
                  Renunță
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {editable && !calibrating && !drawingParcelaId && (
        <div style={{ marginTop: '0.75rem' }}>
          {!tipuriGazonOpen ? (
            <button onClick={() => setTipuriGazonOpen(true)} style={{ padding: '0.5rem 0.85rem' }}>
              ⚙️ Gestionează tipurile de gazon
            </button>
          ) : (
            <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
              <p style={{ fontWeight: 'bold', marginTop: 0 }}>Tipuri de gazon</p>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                {tipuriGazon.map((t) => (
                  <span
                    key={t.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.3rem 0.6rem',
                      borderRadius: '999px',
                      background: '#f0f0f0',
                      fontSize: '0.85rem',
                    }}
                  >
                    {t.nume}
                    <button
                      onClick={() => void stergeTipGazon(t.id)}
                      disabled={tipuriGazonSaving}
                      title="Șterge tipul"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {tipuriGazon.length === 0 && <span style={{ color: '#666', fontSize: '0.85rem' }}>Niciun tip definit încă.</span>}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
                  Tip nou
                  <input
                    type="text"
                    value={nouTipGazonNume}
                    onChange={(e) => setNouTipGazonNume(e.target.value)}
                    placeholder="ex. semi-umbră"
                    style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '160px' }}
                  />
                </label>
                <button onClick={() => void adaugaTipGazon()} disabled={tipuriGazonSaving || !nouTipGazonNume.trim()}>
                  Adaugă
                </button>
                <button onClick={() => setTipuriGazonOpen(false)}>Închide</button>
              </div>
              {tipuriGazonError && <p style={{ color: '#b00020', marginTop: '0.5rem' }}>{tipuriGazonError}</p>}
            </div>
          )}
        </div>
      )}

      {editable && !calibrating && (
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
              <p style={{ marginTop: 0 }}>
                Desenezi conturul pentru <strong>{parcelaInDrawing?.nume}</strong>.
              </p>

              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
                <button
                  onClick={() => schimbaModDesenare('poligon')}
                  style={{
                    padding: '0.4rem 0.75rem',
                    fontSize: '0.85rem',
                    background: drawMode === 'poligon' ? '#2e7d32' : '#f5f5f5',
                    color: drawMode === 'poligon' ? '#fff' : '#333',
                    border: '1px solid #ccc',
                    borderRadius: '6px',
                  }}
                >
                  Poligon
                </button>
                <button
                  onClick={() => schimbaModDesenare('cerc')}
                  style={{
                    padding: '0.4rem 0.75rem',
                    fontSize: '0.85rem',
                    background: drawMode === 'cerc' ? '#2e7d32' : '#f5f5f5',
                    color: drawMode === 'cerc' ? '#fff' : '#333',
                    border: '1px solid #ccc',
                    borderRadius: '6px',
                  }}
                >
                  Cerc (pivot)
                </button>
              </div>

              {drawMode === 'poligon' ? (
                <p style={{ fontSize: '0.85rem', color: '#666' }}>
                  Dă click pe hartă ca să adaugi colțuri ({drawingPoints.length} puncte adăugate,
                  minim 3).
                </p>
              ) : (
                <p style={{ fontSize: '0.85rem', color: '#666' }}>
                  {!cercCentru
                    ? 'Click pe centrul cercului (locul pivotului de irigații).'
                    : `Click pe marginea cercului, ca să stabilești raza${
                        razaCerc !== null ? ` (~${Math.round(razaCerc)} m)` : ''
                      }. Poți da click din nou ca s-o ajustezi.`}
                </p>
              )}

              {saveError && <p style={{ color: '#b00020' }}>{saveError}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                {drawMode === 'poligon' ? (
                  <>
                    <button onClick={undoLastPoint} disabled={drawingPoints.length === 0}>
                      Șterge ultimul punct
                    </button>
                    <button onClick={() => void saveDrawing()} disabled={drawingPoints.length < 3 || saving}>
                      {saving ? 'Salvez...' : 'Salvează conturul'}
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={undoCerc} disabled={!cercCentru}>
                      Șterge ultimul punct
                    </button>
                    <button onClick={() => void saveDrawing()} disabled={!cercCentru || !cercMargine || saving}>
                      {saving ? 'Salvez...' : 'Salvează conturul'}
                    </button>
                  </>
                )}
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
            tipuriGazon={tipuriGazon}
            showRedrawButton={editable}
            onRedraw={() => startDrawing(selectedParcela.id)}
            editable={editable}
            onParcelaUpdated={onParcelaUpdated}
            onParcelaDeleted={handleParcelaStearsa}
          />
        </div>
      ) : (
        !calibrating && (
          <p style={{ color: '#666', marginTop: '1rem' }}>
            Atinge o parcelă pe hartă ca să înregistrezi ce ai lucrat.
          </p>
        )
      )}
    </div>
  );
}
