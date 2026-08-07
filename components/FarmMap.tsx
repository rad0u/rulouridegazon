'use client';

import { useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Parcela, Point, PARCELA_COLORS, polygonPoints } from '../lib/parcelaTypes';
import ParcelaPanel from './ParcelaPanel';

interface FarmMapProps {
  fermaId: string;
  hartaUrl: string | null;
  parcele: Parcela[];
  editable: boolean;
  onHartaUploaded: (url: string) => void;
  onPolygonSaved: (parcelaId: string, poligon: Parcela['poligon_harta']) => void;
  onParcelaUpdated: (parcela: Parcela) => void;
}

export default function FarmMap({
  fermaId,
  hartaUrl,
  parcele,
  editable,
  onHartaUploaded,
  onPolygonSaved,
  onParcelaUpdated,
}: FarmMapProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [selectedParcelaId, setSelectedParcelaId] = useState<string | null>(null);
  const [drawingParcelaId, setDrawingParcelaId] = useState<string | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const imgWrapRef = useRef<HTMLDivElement>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    const path = `${fermaId}/${Date.now()}-${file.name}`;
    const { error: uploadErr } = await supabase.storage
      .from('harti-ferme')
      .upload(path, file, { upsert: true });

    if (uploadErr) {
      setUploadError(uploadErr.message);
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from('harti-ferme').getPublicUrl(path);
    const { error: updateErr } = await supabase
      .from('ferme')
      .update({ harta_url: data.publicUrl })
      .eq('id', fermaId);

    if (updateErr) {
      setUploadError(updateErr.message);
      setUploading(false);
      return;
    }

    onHartaUploaded(data.publicUrl);
    setUploading(false);
  }

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

  function handleMapClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!drawingParcelaId || !imgWrapRef.current) return;

    const rect = imgWrapRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));

    setDrawingPoints((prev) => [...prev, { x, y }]);
  }

  function undoLastPoint() {
    setDrawingPoints((prev) => prev.slice(0, -1));
  }

  async function saveDrawing() {
    if (!drawingParcelaId || drawingPoints.length < 3) return;

    setSaving(true);
    setSaveError(null);

    const ring = [...drawingPoints, drawingPoints[0]].map((p) => [p.x, p.y]);
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

  const selectedParcela = parcele.find((p) => p.id === selectedParcelaId) ?? null;
  const parcelaInDrawing = parcele.find((p) => p.id === drawingParcelaId) ?? null;
  const parceleFaraContur = parcele.filter((p) => !p.poligon_harta);

  return (
    <div>
      {editable && (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'inline-block' }}>
            <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.9rem' }}>
              {hartaUrl ? 'Schimbă imaginea hărții' : 'Încarcă imaginea hărții (captură Google Maps)'}
            </span>
            <input type="file" accept="image/*" onChange={handleFileChange} disabled={uploading} />
          </label>
          {uploading && <p>Se încarcă...</p>}
          {uploadError && <p style={{ color: '#b00020' }}>{uploadError}</p>}
        </div>
      )}

      {hartaUrl ? (
        <div
          ref={imgWrapRef}
          onClick={handleMapClick}
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: '420px',
            lineHeight: 0,
            cursor: drawingParcelaId ? 'crosshair' : 'default',
          }}
        >
          <img src={hartaUrl} alt="Hartă fermă" style={{ width: '100%', height: 'auto', display: 'block' }} />
          <svg
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            {parcele.map((parcela, index) => {
              const points = polygonPoints(parcela);
              if (points.length < 3) return null;
              const color = PARCELA_COLORS[index % PARCELA_COLORS.length];
              const isSelected = parcela.id === selectedParcelaId;
              return (
                <polygon
                  key={parcela.id}
                  points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={color.fill}
                  stroke={color.stroke}
                  strokeWidth={isSelected ? 4 : 2}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: 'pointer', pointerEvents: drawingParcelaId ? 'none' : 'auto' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedParcelaId(parcela.id);
                  }}
                />
              );
            })}

            {drawingPoints.length > 0 && (
              <polyline
                points={drawingPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#d21919"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {drawingPoints.map((p, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                background: '#d21919',
                border: '2px solid white',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
      ) : (
        <div>
          <p style={{ color: '#666' }}>
            {editable ? 'Încarcă imaginea hărții mai sus.' : 'Harta fermei nu a fost încărcată încă.'}
          </p>
          {parcele.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {parcele.map((parcela) => (
                <button
                  key={parcela.id}
                  onClick={() => setSelectedParcelaId(parcela.id)}
                  style={{ padding: '0.7rem 1rem' }}
                >
                  {parcela.nume}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {editable && hartaUrl && (
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
            showRedrawButton={editable && !!hartaUrl}
            onRedraw={() => startDrawing(selectedParcela.id)}
            editable={editable}
            onParcelaUpdated={onParcelaUpdated}
          />
        </div>
      ) : (
        hartaUrl && (
          <p style={{ color: '#666', marginTop: '1rem' }}>
            Atinge o parcelă pe hartă ca să înregistrezi ce ai lucrat.
          </p>
        )
      )}
    </div>
  );
}
