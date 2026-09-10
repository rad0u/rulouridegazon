'use client';

import { Fragment, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';
import type { UtilajPozitie, FermaHarta } from '../../components/UtilajeMapView';
import type { Parcela } from '../../lib/parcelaTypes';

type ZiIstoric = {
  data: string;
  total_ore_functionare: number;
  parcele: { nume: string; ore: number }[];
};

type IstoricParcele = {
  utilaj_id: string;
  utilaj_nume: string;
  zile: number;
  are_parcele_desenate: boolean;
  zile_istoric: ZiIstoric[];
};

type DeviceTraccarNelegat = {
  traccar_device_id: string;
  nume_traccar: string;
  status: string;
  ultima_actualizare: string | null;
};

function formatDataZi(data: string): string {
  // `data` e YYYY-MM-DD (fus orar România) — construim data locală direct din
  // componente, ca să nu depindem de fusul orar al browserului la parsare.
  const [an, luna, zi] = data.split('-').map(Number);
  const d = new Date(an, luna - 1, zi);
  return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
}

// react-leaflet foloseşte `window`/`document` la import, deci se încarcă
// doar în browser, nu şi la randare pe server.
const UtilajeMapView = dynamic(() => import('../../components/UtilajeMapView'), {
  ssr: false,
  loading: () => <p>Se încarcă harta...</p>,
});

// Cât timp utilajul nu are `tanc_capacitate_litri` setat în baza de date,
// presupunem că senzorul DUT-E nu e încă (definitiv) calibrat pe rezervorul
// real, deci valoarea e brută ("kvants"), nu litri. Odată setată capacitatea
// (după calibrare pe teren), aceeași valoare e afișată direct ca litri.
function formatCombustibil(u: UtilajPozitie): string {
  if (u.combustibil_nivel === null) return '—';

  if (u.combustibil_capacitate_litri && u.combustibil_capacitate_litri > 0) {
    const procent = Math.round((u.combustibil_nivel / u.combustibil_capacitate_litri) * 100);
    return `${Math.round(u.combustibil_nivel)} L / ${u.combustibil_capacitate_litri} L (${procent}%)`;
  }

  return `${u.combustibil_nivel} (brut, necalibrat)`;
}

// Cron-ul sincronizează din Traccar la fiecare 15 minute, deci un decalaj de
// până la ~20-30 min e normal. Peste pragul de mai jos, cu utilajul online dar
// fără citire nouă de combustibil, e semn că sonda a fost deconectată (fir
// tăiat/scos) — scenariul clasic „deconectez sonda înainte să fur motorină”.
const FUEL_STALE_MINUTES = 60;

function fuelSignalAgeMinutes(u: UtilajPozitie): number | null {
  if (!u.combustibil_data) return null;
  return (Date.now() - new Date(u.combustibil_data).getTime()) / 60000;
}

function isFuelSignalStale(u: UtilajPozitie): boolean {
  // Alertăm doar dacă utilajul a avut vreodată o citire (deci are sondă montată
  // și funcțională) și utilajul e online — dacă nu are sondă deloc, nu e o
  // anomalie, doar lipsă de echipament.
  if (u.status !== 'online' || u.combustibil_nivel === null) return false;
  const age = fuelSignalAgeMinutes(u);
  return age !== null && age > FUEL_STALE_MINUTES;
}

export default function UtilajeScreen() {
  const [utilaje, setUtilaje] = useState<UtilajPozitie[]>([]);
  const [ferme, setFerme] = useState<FermaHarta[]>([]);
  const [parcele, setParcele] = useState<Parcela[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  // Hărțile fermelor (imaginea suprapusă calibrată) + parcelele lor —
  // aceleași date ca pe /ferme/[fermaId], afișate aici pe aceeași hartă
  // satelit, ca să se vadă exact pe ce parcelă e fiecare utilaj.
  async function incarcaHartaFerme() {
    const [fermeRes, parceleRes] = await Promise.all([
      supabase
        .from('ferme')
        .select(
          'id, nume, harta_url, imagine_colt_ss_lat, imagine_colt_ss_lon, imagine_colt_ds_lat, imagine_colt_ds_lon, imagine_colt_sj_lat, imagine_colt_sj_lon',
        ),
      supabase.from('parcele').select('id, ferma_id, nume, tip_gazon, stadiu, suprafata_mp, poligon_harta'),
    ]);

    if (!fermeRes.error && fermeRes.data) {
      setFerme(
        fermeRes.data.map((f) => ({
          id: f.id,
          nume: f.nume,
          harta_url: f.harta_url,
          imagineColtSS:
            f.imagine_colt_ss_lat !== null && f.imagine_colt_ss_lon !== null
              ? [f.imagine_colt_ss_lat, f.imagine_colt_ss_lon]
              : null,
          imagineColtDS:
            f.imagine_colt_ds_lat !== null && f.imagine_colt_ds_lon !== null
              ? [f.imagine_colt_ds_lat, f.imagine_colt_ds_lon]
              : null,
          imagineColtSJ:
            f.imagine_colt_sj_lat !== null && f.imagine_colt_sj_lon !== null
              ? [f.imagine_colt_sj_lat, f.imagine_colt_sj_lon]
              : null,
        })),
      );
    }

    if (!parceleRes.error && parceleRes.data) {
      setParcele(parceleRes.data as Parcela[]);
    }
  }

  const [utilajExtins, setUtilajExtins] = useState<string | null>(null);
  const [istoricZile, setIstoricZile] = useState(14);
  const [istoric, setIstoric] = useState<IstoricParcele | null>(null);
  const [istoricLoading, setIstoricLoading] = useState(false);
  const [istoricError, setIstoricError] = useState<string | null>(null);

  const [pozaUploadingId, setPozaUploadingId] = useState<string | null>(null);
  const [pozaError, setPozaError] = useState<string | null>(null);

  const [capacitateEditId, setCapacitateEditId] = useState<string | null>(null);
  const [capacitateInput, setCapacitateInput] = useState('');
  const [capacitateSaving, setCapacitateSaving] = useState(false);
  const [capacitateError, setCapacitateError] = useState<string | null>(null);

  const [numeEditId, setNumeEditId] = useState<string | null>(null);
  const [numeInput, setNumeInput] = useState('');
  const [numeSaving, setNumeSaving] = useState(false);
  const [numeError, setNumeError] = useState<string | null>(null);

  async function salveazaNume(utilajId: string) {
    if (!numeInput.trim()) {
      setNumeError('Numele nu poate fi gol.');
      return;
    }

    setNumeSaving(true);
    setNumeError(null);

    const { error: updateError } = await supabase
      .from('utilaje')
      .update({ nume: numeInput.trim() })
      .eq('id', utilajId);

    setNumeSaving(false);

    if (updateError) {
      setNumeError(updateError.message);
      return;
    }

    setUtilaje((prev) =>
      prev.map((u) => (u.utilaj_id === utilajId ? { ...u, nume: numeInput.trim() } : u)),
    );
    setNumeEditId(null);
  }

  const [showAddForm, setShowAddForm] = useState(false);
  const [traccarDevices, setTraccarDevices] = useState<DeviceTraccarNelegat[]>([]);
  const [traccarLoading, setTraccarLoading] = useState(false);
  const [traccarError, setTraccarError] = useState<string | null>(null);

  const [novDeviceId, setNovDeviceId] = useState('');
  const [novNume, setNovNume] = useState('');
  const [novTip, setNovTip] = useState('utilaj agricol');
  const [novFermaId, setNovFermaId] = useState('');
  const [novCapacitate, setNovCapacitate] = useState('');
  const [novSaving, setNovSaving] = useState(false);
  const [novError, setNovError] = useState<string | null>(null);

  async function incarcaTraccarDevices() {
    setTraccarLoading(true);
    setTraccarError(null);

    const { data, error: invokeError } = await supabase.functions.invoke('list-traccar-devices');

    setTraccarLoading(false);

    if (invokeError) {
      const message =
        (invokeError as { context?: { error?: string } })?.context?.error ?? invokeError.message;
      setTraccarError(message);
      return;
    }
    if (data?.error) {
      setTraccarError(data.error);
      return;
    }

    setTraccarDevices((data?.device_nelegate as DeviceTraccarNelegat[]) ?? []);
  }

  function toggleAddForm() {
    const urmatoare = !showAddForm;
    setShowAddForm(urmatoare);
    if (urmatoare && traccarDevices.length === 0 && !traccarLoading) {
      void incarcaTraccarDevices();
    }
    if (urmatoare && ferme.length === 0) {
      void incarcaHartaFerme();
    }
  }

  function alegeDeviceTraccar(deviceId: string) {
    setNovDeviceId(deviceId);
    if (!deviceId) return;
    const device = traccarDevices.find((d) => d.traccar_device_id === deviceId);
    // Pre-completăm numele doar dacă operatorul nu a scris deja ceva — nu
    // suprascriem o valoare introdusă manual.
    if (device && !novNume.trim()) {
      setNovNume(device.nume_traccar);
    }
  }

  async function salveazaUtilajNou() {
    setNovError(null);

    if (!novNume.trim()) {
      setNovError('Introdu numele utilajului.');
      return;
    }
    if (!novFermaId) {
      setNovError('Alege ferma.');
      return;
    }
    const capacitate = novCapacitate.trim() ? Number(novCapacitate.replace(',', '.')) : null;
    if (novCapacitate.trim() && (!Number.isFinite(capacitate) || (capacitate ?? 0) <= 0)) {
      setNovError('Capacitatea tancului trebuie să fie un număr valid (sau lasă gol).');
      return;
    }

    setNovSaving(true);

    const { error: insertError } = await supabase.from('utilaje').insert({
      nume: novNume.trim(),
      tip: novTip.trim() || null,
      ferma_id: novFermaId,
      traccar_device_id: novDeviceId || null,
      tanc_capacitate_litri: capacitate,
      activ: true,
    });

    setNovSaving(false);

    if (insertError) {
      setNovError(insertError.message);
      return;
    }

    setNovDeviceId('');
    setNovNume('');
    setNovTip('utilaj agricol');
    setNovFermaId('');
    setNovCapacitate('');
    setShowAddForm(false);
    void incarcaTraccarDevices();
    void reincarca();
  }

  async function incarcaPoza(utilajId: string, file: File) {
    setPozaError(null);
    setPozaUploadingId(utilajId);

    const extensie = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const cale = `${utilajId}-${Date.now()}.${extensie}`;

    const { error: uploadError } = await supabase.storage.from('poze-utilaje').upload(cale, file, {
      upsert: true,
      contentType: file.type || undefined,
    });

    if (uploadError) {
      setPozaUploadingId(null);
      setPozaError(uploadError.message);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('poze-utilaje').getPublicUrl(cale);
    const pozaUrl = publicUrlData.publicUrl;

    const { error: updateError } = await supabase.from('utilaje').update({ poza_url: pozaUrl }).eq('id', utilajId);

    setPozaUploadingId(null);

    if (updateError) {
      setPozaError(updateError.message);
      return;
    }

    setUtilaje((prev) => prev.map((u) => (u.utilaj_id === utilajId ? { ...u, poza_url: pozaUrl } : u)));
  }

  async function salveazaCapacitate(utilajId: string) {
    const litri = Number(capacitateInput.replace(',', '.'));

    if (!capacitateInput.trim() || !Number.isFinite(litri) || litri <= 0) {
      setCapacitateError('Introdu un număr valid de litri (mai mare ca 0).');
      return;
    }

    setCapacitateSaving(true);
    setCapacitateError(null);

    const { error: updateError } = await supabase
      .from('utilaje')
      .update({ tanc_capacitate_litri: litri })
      .eq('id', utilajId);

    setCapacitateSaving(false);

    if (updateError) {
      setCapacitateError(updateError.message);
      return;
    }

    setUtilaje((prev) =>
      prev.map((u) => (u.utilaj_id === utilajId ? { ...u, combustibil_capacitate_litri: litri } : u)),
    );
    setCapacitateEditId(null);
  }

  async function incarcaIstoric(utilajId: string, zileDeFolosit: number) {
    setIstoricLoading(true);
    setIstoricError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/get-utilaj-istoric-parcele?utilaj_id=${utilajId}&zile=${zileDeFolosit}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = await res.json();

      setIstoricLoading(false);

      if (!res.ok) {
        setIstoricError(json?.error ?? 'Eroare la încărcarea istoricului.');
        return;
      }

      setIstoric(json as IstoricParcele);
    } catch (e) {
      setIstoricLoading(false);
      setIstoricError('Eroare de rețea la încărcarea istoricului.');
    }
  }

  function toggleIstoric(utilajId: string) {
    if (utilajExtins === utilajId) {
      setUtilajExtins(null);
      setIstoric(null);
      setIstoricError(null);
      return;
    }
    setUtilajExtins(utilajId);
    setIstoric(null);
    setIstoricError(null);
    void incarcaIstoric(utilajId, istoricZile);
  }

  async function reincarca() {
    setLoading(true);
    setError(null);

    const [{ data, error: invokeError }] = await Promise.all([
      supabase.functions.invoke('get-utilaje-positions'),
      incarcaHartaFerme(),
    ]);

    setLoading(false);
    setLoadedOnce(true);

    if (invokeError) {
      const message =
        (invokeError as { context?: { error?: string } })?.context?.error ?? invokeError.message;
      setError(message);
      return;
    }

    if (data?.error) {
      setError(data.error);
      return;
    }

    setUtilaje((data?.utilaje as UtilajPozitie[]) ?? []);
  }

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: 'clamp(0.75rem, 3vw, 1.5rem)',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Hartă utilaje</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => toggleAddForm()}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: showAddForm ? '#eef6ff' : '#f5f5f5',
              cursor: 'pointer',
            }}
          >
            {showAddForm ? 'Anulează' : '+ Adaugă utilaj'}
          </button>
          <button
            onClick={() => void reincarca()}
            disabled={loading}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: loading ? '#eee' : '#f5f5f5',
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading ? 'Se încarcă...' : 'Reîncarcă'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Adaugă utilaj</h2>

          {traccarLoading && <p style={{ margin: '0 0 0.6rem', color: '#666' }}>Se încarcă device-urile din Traccar...</p>}
          {traccarError && (
            <p style={{ color: '#b00020', margin: '0 0 0.6rem' }}>
              Nu am putut încărca device-urile din Traccar: {traccarError}. Poți completa manual mai jos.
            </p>
          )}
          {!traccarLoading && !traccarError && traccarDevices.length === 0 && (
            <p style={{ margin: '0 0 0.6rem', color: '#666' }}>
              Niciun device Traccar nelegat găsit — toate device-urile din Traccar sunt deja asociate unui
              utilaj, sau poți introduce unul manual mai jos.
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
              Device Traccar (opțional)
              <select
                value={novDeviceId}
                onChange={(e) => alegeDeviceTraccar(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '260px' }}
              >
                <option value="">— fără (introdu manual) —</option>
                {traccarDevices.map((d) => (
                  <option key={d.traccar_device_id} value={d.traccar_device_id}>
                    {d.nume_traccar} — IMEI {d.traccar_device_id}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
              Nume utilaj
              <input
                type="text"
                value={novNume}
                onChange={(e) => setNovNume(e.target.value)}
                placeholder="ex. Tractor 3"
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '160px' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
              Tip
              <input
                type="text"
                value={novTip}
                onChange={(e) => setNovTip(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '140px' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
              Fermă
              <select
                value={novFermaId}
                onChange={(e) => setNovFermaId(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '160px' }}
              >
                <option value="">Alege ferma</option>
                {ferme.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nume}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
              Capacitate tanc (L, opțional)
              <input
                type="number"
                min="0"
                step="0.1"
                value={novCapacitate}
                onChange={(e) => setNovCapacitate(e.target.value)}
                placeholder="litri"
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', width: '140px' }}
              />
            </label>

            <button
              onClick={() => void salveazaUtilajNou()}
              disabled={novSaving}
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: '6px',
                border: '1px solid #ccc',
                background: novSaving ? '#eee' : '#f5f5f5',
                cursor: novSaving ? 'default' : 'pointer',
              }}
            >
              {novSaving ? 'Se salvează...' : 'Salvează utilaj'}
            </button>
          </div>

          {novError && <p style={{ color: '#b00020', margin: '0.6rem 0 0' }}>{novError}</p>}
        </div>
      )}

      {error && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>
          {error}
        </p>
      )}

      {!loadedOnce && !loading && !error && (
        <p>Apasă „Reîncarcă” pentru a vedea poziția curentă a utilajelor.</p>
      )}

      {loadedOnce && !error && utilaje.length === 0 && <p>Niciun utilaj activ înregistrat.</p>}

      {loadedOnce && !error && utilaje.some((u) => isFuelSignalStale(u)) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            background: '#fdecea',
            border: '1px solid #f5c2c0',
            color: '#8a1f13',
            fontWeight: 600,
          }}
        >
          <span aria-hidden>⚠️</span>
          <span>
            {utilaje.filter((u) => isFuelSignalStale(u)).length === 1
              ? '1 utilaj e online, dar fără citire de combustibil de peste o oră — posibil sondă deconectată. Verifică rândul marcat mai jos.'
              : `${utilaje.filter((u) => isFuelSignalStale(u)).length} utilaje sunt online, dar fără citire de combustibil de peste o oră — posibil sonde deconectate. Verifică rândurile marcate mai jos.`}
          </span>
        </div>
      )}

      {loadedOnce && !error && utilaje.length > 0 && (
        <>
          <div
            style={{
              height: 'clamp(320px, 60vh, 600px)',
              flexShrink: 0,
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid #ddd',
            }}
          >
            <UtilajeMapView utilaje={utilaje} ferme={ferme} parcele={parcele} />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                  <th style={{ padding: '0.4rem' }}>Poză</th>
                  <th style={{ padding: '0.4rem' }}>Utilaj</th>
                  <th style={{ padding: '0.4rem' }}>Fermă</th>
                  <th style={{ padding: '0.4rem' }}>Status</th>
                  <th style={{ padding: '0.4rem' }}>Ultima poziție</th>
                  <th style={{ padding: '0.4rem' }}>Combustibil</th>
                  <th style={{ padding: '0.4rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {utilaje.map((u) => {
                  const stale = isFuelSignalStale(u);
                  const age = fuelSignalAgeMinutes(u);
                  const extins = utilajExtins === u.utilaj_id;

                  return (
                    <Fragment key={u.utilaj_id}>
                      <tr
                        onClick={() => toggleIstoric(u.utilaj_id)}
                        style={{
                          borderBottom: '1px solid #f0f0f0',
                          background: extins ? '#eef6ff' : stale ? '#fdecea' : undefined,
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ padding: '0.4rem' }} onClick={(e) => e.stopPropagation()}>
                          <label
                            style={{
                              display: 'block',
                              width: '44px',
                              height: '44px',
                              borderRadius: '6px',
                              overflow: 'hidden',
                              border: '1px solid #ccc',
                              cursor: 'pointer',
                              position: 'relative',
                              background: '#f5f5f5',
                            }}
                            title="Schimbă poza"
                          >
                            {u.poza_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={u.poza_url}
                                alt={u.nume}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                              />
                            ) : (
                              <span
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '100%',
                                  height: '100%',
                                  fontSize: '1.2rem',
                                  color: '#999',
                                }}
                              >
                                📷
                              </span>
                            )}
                            {pozaUploadingId === u.utilaj_id && (
                              <span
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: 'rgba(255,255,255,0.8)',
                                  fontSize: '0.65rem',
                                }}
                              >
                                ...
                              </span>
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              disabled={pozaUploadingId !== null}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void incarcaPoza(u.utilaj_id, file);
                                e.target.value = '';
                              }}
                              style={{ display: 'none' }}
                            />
                          </label>
                        </td>
                        <td style={{ padding: '0.4rem' }} onClick={(e) => e.stopPropagation()}>
                          {numeEditId === u.utilaj_id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                              <input
                                type="text"
                                autoFocus
                                value={numeInput}
                                onChange={(e) => setNumeInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void salveazaNume(u.utilaj_id);
                                  if (e.key === 'Escape') {
                                    setNumeEditId(null);
                                    setNumeError(null);
                                  }
                                }}
                                style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid #ccc', minWidth: '140px' }}
                              />
                              <button
                                onClick={() => void salveazaNume(u.utilaj_id)}
                                disabled={numeSaving}
                                style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #4a7', background: '#eaf7ee', cursor: numeSaving ? 'default' : 'pointer' }}
                              >
                                {numeSaving ? '...' : '✓'}
                              </button>
                              <button
                                onClick={() => {
                                  setNumeEditId(null);
                                  setNumeError(null);
                                }}
                                style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <>
                              {u.nume}{' '}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setNumeEditId(u.utilaj_id);
                                  setNumeInput(u.nume);
                                  setNumeError(null);
                                }}
                                title="Editează numele"
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: '0.8rem', padding: 0 }}
                              >
                                ✎
                              </button>
                            </>
                          )}
                        </td>
                        <td style={{ padding: '0.4rem' }}>{u.ferma_nume ?? '—'}</td>
                        <td style={{ padding: '0.4rem' }}>{u.status === 'online' ? 'online' : 'offline'}</td>
                        <td style={{ padding: '0.4rem' }}>
                          {u.ultima_actualizare ? new Date(u.ultima_actualizare).toLocaleString('ro-RO') : '—'}
                        </td>
                        <td style={{ padding: '0.4rem', color: stale ? '#8a1f13' : undefined, fontWeight: stale ? 600 : undefined }}>
                          {capacitateEditId === u.utilaj_id ? (
                            <div
                              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="number"
                                min="1"
                                step="0.1"
                                autoFocus
                                value={capacitateInput}
                                onChange={(e) => setCapacitateInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void salveazaCapacitate(u.utilaj_id);
                                  if (e.key === 'Escape') {
                                    setCapacitateEditId(null);
                                    setCapacitateError(null);
                                  }
                                }}
                                placeholder="litri tanc"
                                style={{ width: '80px', padding: '0.2rem 0.3rem', borderRadius: '4px', border: '1px solid #ccc' }}
                              />
                              <button
                                onClick={() => void salveazaCapacitate(u.utilaj_id)}
                                disabled={capacitateSaving}
                                style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #4a7', background: '#eaf7ee', cursor: capacitateSaving ? 'default' : 'pointer' }}
                              >
                                {capacitateSaving ? '...' : '✓'}
                              </button>
                              <button
                                onClick={() => {
                                  setCapacitateEditId(null);
                                  setCapacitateError(null);
                                }}
                                style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <>
                              {formatCombustibil(u)}{' '}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCapacitateEditId(u.utilaj_id);
                                  setCapacitateInput(
                                    u.combustibil_capacitate_litri ? String(u.combustibil_capacitate_litri) : '',
                                  );
                                  setCapacitateError(null);
                                }}
                                title="Editează capacitatea tancului (L)"
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: '0.8rem', padding: 0 }}
                              >
                                ✎
                              </button>
                              {stale && (
                                <div style={{ fontSize: '0.8rem' }}>
                                  ⚠️ fără citire de {age !== null ? Math.round(age / 60) : '?'}h — verifică sonda
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td style={{ padding: '0.4rem', color: '#666', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {extins ? 'Ascunde istoric ▲' : 'Istoric parcele ▼'}
                        </td>
                      </tr>
                      {extins && (
                        <tr key={`${u.utilaj_id}-istoric`}>
                          <td colSpan={7} style={{ padding: '0.75rem', background: '#fafafa' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                              <strong>Istoric ore pe parcele — {u.nume}</strong>
                              <select
                                value={istoricZile}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  setIstoricZile(v);
                                  void incarcaIstoric(u.utilaj_id, v);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                style={{ padding: '0.35rem', borderRadius: '6px', border: '1px solid #ccc' }}
                              >
                                <option value={7}>Ultimele 7 zile</option>
                                <option value={14}>Ultimele 14 zile</option>
                                <option value={30}>Ultimele 30 zile</option>
                              </select>
                            </div>

                            {istoricLoading && <p style={{ margin: 0 }}>Se încarcă istoricul...</p>}

                            {istoricError && (
                              <p style={{ color: '#b00020', margin: 0 }}>{istoricError}</p>
                            )}

                            {!istoricLoading && !istoricError && istoric && !istoric.are_parcele_desenate && (
                              <p style={{ margin: 0, color: '#666' }}>
                                Ferma acestui utilaj nu are încă parcele desenate pe hartă — se poate
                                calcula doar totalul orelor de funcționare, fără defalcare pe parcele.
                              </p>
                            )}

                            {!istoricLoading && !istoricError && istoric && istoric.zile_istoric.length === 0 && (
                              <p style={{ margin: 0, color: '#666' }}>
                                Niciun interval de funcționare înregistrat în perioada selectată.
                              </p>
                            )}

                            {!istoricLoading && !istoricError && istoric && istoric.zile_istoric.length > 0 && (
                              <div style={{ overflowX: 'auto' }}>
                                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
                                  <thead>
                                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                                      <th style={{ padding: '0.35rem' }}>Data</th>
                                      <th style={{ padding: '0.35rem' }}>Ore pe parcele</th>
                                      <th style={{ padding: '0.35rem' }}>Total ore funcționare</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {istoric.zile_istoric.map((zi) => (
                                      <tr key={zi.data} style={{ borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '0.35rem', whiteSpace: 'nowrap' }}>
                                          {formatDataZi(zi.data)}
                                        </td>
                                        <td style={{ padding: '0.35rem' }}>
                                          {zi.parcele.length > 0
                                            ? zi.parcele.map((p) => `${p.ore}h ${p.nume}`).join(', ')
                                            : '—'}
                                        </td>
                                        <td style={{ padding: '0.35rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                          {zi.total_ore_functionare}h
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pozaError && (
            <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px', margin: 0 }}>
              Eroare la încărcarea pozei: {pozaError}
            </p>
          )}

          {capacitateError && (
            <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px', margin: 0 }}>
              Eroare la salvarea capacității tancului: {capacitateError}
            </p>
          )}

          {utilaje.some((u) => u.combustibil_nivel !== null && !u.combustibil_capacitate_litri) && (
            <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
              Valorile de combustibil marcate „brut, necalibrat” sunt citirea directă a senzorului
              DUT-E, nu litri reali — apar ca litri automat, fără nicio modificare de cod, imediat
              ce senzorul e calibrat pe rezervorul real și capacitatea tancului (L) e completată
              pentru utilajul respectiv.
            </p>
          )}
        </>
      )}
    </main>
  );
}
