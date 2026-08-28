'use client';

import { Fragment, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';
import type { MasinaPozitie, GeofenceHarta } from '../../components/MasiniMapView';

const MasiniMapView = dynamic(() => import('../../components/MasiniMapView'), {
  ssr: false,
  loading: () => <p>Se încarcă harta...</p>,
});

type Sofer = { id: string; nume: string };
type Ferma = { id: string; nume: string };

const RO_LAT_MIN = 42;
const RO_LAT_MAX = 50;
const RO_LON_MIN = 18;
const RO_LON_MAX = 32;

function geofenceRingLatLng(poligon: { coordinates?: number[][][] } | null): [number, number][] {
  const ring = poligon?.coordinates?.[0];
  if (!ring || ring.length < 3) return [];
  const latLngs: [number, number][] = ring.map(([lon, lat]) => [lat, lon]);
  const plauzibil = latLngs.every(
    ([lat, lon]) => lat >= RO_LAT_MIN && lat <= RO_LAT_MAX && lon >= RO_LON_MIN && lon <= RO_LON_MAX,
  );
  return plauzibil ? latLngs : [];
}

const initialForm = {
  nume: '',
  numar_inmatriculare: '',
  marca_model: '',
  traccar_device_id: '',
  sofer_implicit_id: '',
  ferma_id: '',
  viteza_limita_kmh: '',
};

export default function MasiniScreen() {
  const { role, loading: roleLoading } = useUserRole();

  if (roleLoading) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Se verifică accesul...</p>
      </main>
    );
  }

  if (role === 'admin_central') return <MasiniAdminCentral />;
  if (role === 'admin_ferma') return <MasiniAdminFerma />;

  return (
    <main style={{ padding: '2rem' }}>
      <h1>Acces interzis</h1>
      <p>Această secțiune este disponibilă doar pentru admin general sau administratorul unei ferme.</p>
    </main>
  );
}

function MasiniAdminCentral() {
  const [masini, setMasini] = useState<MasinaPozitie[]>([]);
  const [soferi, setSoferi] = useState<Sofer[]>([]);
  const [ferme, setFerme] = useState<Ferma[]>([]);
  const [geofences, setGeofences] = useState<GeofenceHarta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [masinaExtinsa, setMasinaExtinsa] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ sofer_implicit_id: string; ferma_id: string; viteza_limita_kmh: string; activ: boolean } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function incarcaSoferiSiGeofences() {
    const [soferiRes, fermeRes, geofenceRes] = await Promise.all([
      supabase.from('utilizatori').select('id, nume').eq('rol', 'sofer').order('nume'),
      supabase.from('ferme').select('id, nume').order('nume'),
      supabase.from('geofences').select('id, nume, poligon').eq('activ', true),
    ]);

    setSoferi((soferiRes.data as Sofer[]) ?? []);
    setFerme((fermeRes.data as Ferma[]) ?? []);

    if (geofenceRes.data) {
      setGeofences(
        geofenceRes.data
          .map((g: any) => ({ id: g.id, nume: g.nume, ring: geofenceRingLatLng(g.poligon) }))
          .filter((g: GeofenceHarta) => g.ring.length >= 3),
      );
    }
  }

  async function reincarca() {
    setLoading(true);
    setError(null);

    const [{ data, error: invokeError }] = await Promise.all([
      supabase.functions.invoke('get-masini-positions'),
      incarcaSoferiSiGeofences(),
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

    setMasini((data?.masini as MasinaPozitie[]) ?? []);
  }

  function updateForm(field: keyof typeof initialForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleAddSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!form.nume.trim()) {
      setFormError('Completează numele mașinii.');
      return;
    }

    setSaving(true);
    const { error: insertError } = await supabase.from('masini').insert({
      nume: form.nume.trim(),
      numar_inmatriculare: form.numar_inmatriculare.trim() || null,
      marca_model: form.marca_model.trim() || null,
      traccar_device_id: form.traccar_device_id.trim() || null,
      sofer_implicit_id: form.sofer_implicit_id || null,
      ferma_id: form.ferma_id || null,
      viteza_limita_kmh: form.viteza_limita_kmh ? Number(form.viteza_limita_kmh) : null,
    });
    setSaving(false);

    if (insertError) {
      setFormError(insertError.message);
      return;
    }

    setForm(initialForm);
    await reincarca();
  }

  function toggleEditare(m: MasinaPozitie, soferId: string | null, vitezaLimita: number | null, activ: boolean) {
    if (masinaExtinsa === m.masina_id) {
      setMasinaExtinsa(null);
      setEditForm(null);
      return;
    }
    setMasinaExtinsa(m.masina_id);
    setEditError(null);
    setEditForm({
      sofer_implicit_id: soferId ?? '',
      ferma_id: (m as any).ferma_id ?? '',
      viteza_limita_kmh: vitezaLimita !== null ? String(vitezaLimita) : '',
      activ,
    });
  }

  async function salveazaEditare(masinaId: string) {
    if (!editForm) return;
    setEditSaving(true);
    setEditError(null);

    const { error: updateError } = await supabase
      .from('masini')
      .update({
        sofer_implicit_id: editForm.sofer_implicit_id || null,
        ferma_id: editForm.ferma_id || null,
        viteza_limita_kmh: editForm.viteza_limita_kmh ? Number(editForm.viteza_limita_kmh) : null,
        activ: editForm.activ,
      })
      .eq('id', masinaId);

    setEditSaving(false);

    if (updateError) {
      setEditError(updateError.message);
      return;
    }

    setMasinaExtinsa(null);
    setEditForm(null);
    await reincarca();
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
        <h1 style={{ margin: 0 }}>Flotă auto</h1>
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

      {error && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>
          {error}
        </p>
      )}

      {!loadedOnce && !loading && !error && (
        <p>Apasă „Reîncarcă” pentru a vedea poziția curentă a mașinilor.</p>
      )}

      {loadedOnce && !error && masini.length > 0 && (
        <div
          style={{
            height: 'clamp(320px, 55vh, 560px)',
            flexShrink: 0,
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #ddd',
          }}
        >
          <MasiniMapView masini={masini} geofences={geofences} />
        </div>
      )}

      {loadedOnce && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '0.4rem' }}>Mașină</th>
                <th style={{ padding: '0.4rem' }}>Nr. înmatriculare</th>
                <th style={{ padding: '0.4rem' }}>Fermă</th>
                <th style={{ padding: '0.4rem' }}>Șofer implicit</th>
                <th style={{ padding: '0.4rem' }}>Status</th>
                <th style={{ padding: '0.4rem' }}>Viteză</th>
                <th style={{ padding: '0.4rem' }}>Ultima poziție</th>
                <th style={{ padding: '0.4rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {masini.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '0.75rem', color: '#666' }}>
                    Nicio mașină înregistrată încă — adaugă prima din formularul de mai jos.
                  </td>
                </tr>
              )}
              {masini.map((m) => {
                const extinsa = masinaExtinsa === m.masina_id;
                return (
                  <Fragment key={m.masina_id}>
                    <tr
                      onClick={() => toggleEditare(m, null, m.viteza_limita_kmh, true)}
                      style={{ borderBottom: '1px solid #f0f0f0', background: extinsa ? '#eef6ff' : undefined, cursor: 'pointer' }}
                    >
                      <td style={{ padding: '0.4rem' }}>{m.nume}</td>
                      <td style={{ padding: '0.4rem' }}>{m.numar_inmatriculare ?? '—'}</td>
                      <td style={{ padding: '0.4rem' }}>{m.ferma_nume ?? 'pool central'}</td>
                      <td style={{ padding: '0.4rem' }}>{m.sofer_nume ?? '—'}</td>
                      <td style={{ padding: '0.4rem' }}>
                        {m.status === 'online' ? 'online' : 'offline'}
                        {m.cursa_activa && <span style={{ color: '#2e7d32', fontWeight: 600 }}> · în cursă</span>}
                      </td>
                      <td style={{ padding: '0.4rem' }}>{m.viteza_kmh ?? '—'} km/h</td>
                      <td style={{ padding: '0.4rem' }}>
                        {m.ultima_actualizare ? new Date(m.ultima_actualizare).toLocaleString('ro-RO') : '—'}
                      </td>
                      <td style={{ padding: '0.4rem', color: '#666', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {extinsa ? 'Ascunde ▲' : 'Editează ▼'}
                      </td>
                    </tr>
                    {extinsa && editForm && (
                      <tr>
                        <td colSpan={8} style={{ padding: '0.75rem', background: '#fafafa' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
                            <label>
                              Fermă
                              <select
                                value={editForm.ferma_id}
                                onChange={(e) => setEditForm({ ...editForm, ferma_id: e.target.value })}
                                style={{ display: 'block', padding: '0.5rem', marginTop: '0.25rem' }}
                              >
                                <option value="">— pool central —</option>
                                {ferme.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.nume}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Șofer implicit
                              <select
                                value={editForm.sofer_implicit_id}
                                onChange={(e) => setEditForm({ ...editForm, sofer_implicit_id: e.target.value })}
                                style={{ display: 'block', padding: '0.5rem', marginTop: '0.25rem' }}
                              >
                                <option value="">— fără —</option>
                                {soferi.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.nume}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Limită viteză (km/h)
                              <input
                                type="number"
                                value={editForm.viteza_limita_kmh}
                                onChange={(e) => setEditForm({ ...editForm, viteza_limita_kmh: e.target.value })}
                                style={{ display: 'block', padding: '0.5rem', marginTop: '0.25rem', width: '140px' }}
                              />
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <input
                                type="checkbox"
                                checked={editForm.activ}
                                onChange={(e) => setEditForm({ ...editForm, activ: e.target.checked })}
                              />
                              Activă
                            </label>
                            <button
                              onClick={() => void salveazaEditare(m.masina_id)}
                              disabled={editSaving}
                              style={{ padding: '0.55rem 1rem', borderRadius: '6px', border: '1px solid #2e7d32', background: '#2e7d32', color: '#fff', cursor: 'pointer' }}
                            >
                              {editSaving ? 'Salvez...' : 'Salvează'}
                            </button>
                          </div>
                          {editError && <p style={{ color: '#b00020', marginTop: '0.5rem' }}>{editError}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section style={{ marginTop: '1rem', maxWidth: '520px' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Adaugă mașină nouă</h2>
        <form onSubmit={handleAddSubmit}>
          <fieldset style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: '8px' }} disabled={saving}>
            <label style={{ display: 'block', marginBottom: '0.6rem' }}>
              Nume/etichetă
              <input
                type="text"
                value={form.nume}
                onChange={(e) => updateForm('nume', e.target.value)}
                placeholder="ex. Dacia Duster - Radu"
                style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: '0.6rem' }}>
              Număr înmatriculare
              <input
                type="text"
                value={form.numar_inmatriculare}
                onChange={(e) => updateForm('numar_inmatriculare', e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: '0.6rem' }}>
              Marcă/model
              <input
                type="text"
                value={form.marca_model}
                onChange={(e) => updateForm('marca_model', e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: '0.6rem' }}>
              IMEI dispozitiv GPS (FMC130) — Identifier din Traccar
              <input
                type="text"
                value={form.traccar_device_id}
                onChange={(e) => updateForm('traccar_device_id', e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: '0.6rem' }}>
              Fermă (opțional — necompletat = pool central)
              <select
                value={form.ferma_id}
                onChange={(e) => updateForm('ferma_id', e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
              >
                <option value="">— pool central —</option>
                {ferme.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nume}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: '0.6rem' }}>
              Șofer implicit
              <select
                value={form.sofer_implicit_id}
                onChange={(e) => updateForm('sofer_implicit_id', e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
              >
                <option value="">— fără —</option>
                {soferi.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nume}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: '0.6rem' }}>
              Limită viteză (km/h, opțional — pentru alerte)
              <input
                type="number"
                value={form.viteza_limita_kmh}
                onChange={(e) => updateForm('viteza_limita_kmh', e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
              />
            </label>

            {formError && <div style={{ color: '#b00020', marginBottom: '0.6rem' }}>{formError}</div>}

            <button type="submit" style={{ width: '100%', padding: '0.85rem', fontWeight: 'bold' }}>
              {saving ? 'Salvez...' : 'Adaugă mașină'}
            </button>
          </fieldset>
        </form>
        {soferi.length === 0 && (
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem' }}>
            Nu există încă niciun cont cu rol Șofer — creează unul din /utilizatori înainte de a
            aloca un șofer implicit.
          </p>
        )}
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Vizualizare admin_ferma — doar mașinile alocate fermei lui (RLS filtrează
// automat), fără hartă live, fără editare mașină. Poate doar introduce
// bonuri de combustibil pentru ele.
// ─────────────────────────────────────────────────────────────────────────

type MasinaFerma = { id: string; nume: string; numar_inmatriculare: string | null; marca_model: string | null; sofer_nume: string | null };
type Bon = {
  id: string;
  masina_id: string;
  data: string;
  litri: number | null;
  pret_litru: number | null;
  suma_totala: number;
  statie: string | null;
  km_bord: number | null;
  note: string | null;
};

const initialBonForm = {
  masina_id: '',
  data: new Date().toISOString().slice(0, 10),
  litri: '',
  pret_litru: '',
  suma_totala: '',
  statie: '',
  km_bord: '',
  note: '',
};

function MasiniAdminFerma() {
  const [masini, setMasini] = useState<MasinaFerma[]>([]);
  const [bonuri, setBonuri] = useState<Bon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState(initialBonForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function incarca() {
    setLoading(true);
    setError(null);

    const { data: masiniData, error: masiniErr } = await supabase
      .from('masini')
      .select('id, nume, numar_inmatriculare, marca_model, utilizatori(nume)')
      .eq('activ', true)
      .order('nume');

    if (masiniErr) {
      setLoading(false);
      setError(masiniErr.message);
      return;
    }

    const masiniList: MasinaFerma[] = (masiniData ?? []).map((m: any) => ({
      id: m.id,
      nume: m.nume,
      numar_inmatriculare: m.numar_inmatriculare,
      marca_model: m.marca_model,
      sofer_nume: m.utilizatori?.nume ?? null,
    }));
    setMasini(masiniList);

    const { data: bonuriData, error: bonuriErr } = await supabase
      .from('bonuri_combustibil_masini')
      .select('id, masina_id, data, litri, pret_litru, suma_totala, statie, km_bord, note')
      .order('data', { ascending: false })
      .limit(100);

    setLoading(false);

    if (bonuriErr) {
      setError(bonuriErr.message);
      return;
    }

    setBonuri((bonuriData as Bon[]) ?? []);
  }

  useEffect(() => {
    void incarca();
  }, []);

  function updateForm(field: keyof typeof initialBonForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!form.masina_id) {
      setFormError('Alege mașina.');
      return;
    }
    if (!form.suma_totala) {
      setFormError('Completează suma totală a bonului.');
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setFormError('Sesiune invalidă — reîncarcă pagina.');
      return;
    }

    setSaving(true);
    const { error: insertError } = await supabase.from('bonuri_combustibil_masini').insert({
      masina_id: form.masina_id,
      data: form.data,
      litri: form.litri ? Number(form.litri) : null,
      pret_litru: form.pret_litru ? Number(form.pret_litru) : null,
      suma_totala: Number(form.suma_totala),
      statie: form.statie.trim() || null,
      km_bord: form.km_bord ? Number(form.km_bord) : null,
      note: form.note.trim() || null,
      introdus_de: uid,
    });
    setSaving(false);

    if (insertError) {
      setFormError(insertError.message);
      return;
    }

    setForm({ ...initialBonForm, masina_id: form.masina_id, data: new Date().toISOString().slice(0, 10) });
    await incarca();
  }

  const numeMasinaById = new Map(masini.map((m) => [m.id, m]));

  return (
    <main style={{ padding: 'clamp(0.75rem, 3vw, 1.5rem)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ margin: 0 }}>Mașinile fermei mele</h1>
        <p style={{ color: '#666' }}>Vezi mașinile alocate fermei tale și introdu bonurile de combustibil pentru ele.</p>
      </div>

      {error && <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>}
      {loading && <p>Se încarcă...</p>}

      {!loading && (
        <section style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem', maxWidth: '760px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '0.4rem' }}>Mașină</th>
                <th style={{ padding: '0.4rem' }}>Nr. înmatriculare</th>
                <th style={{ padding: '0.4rem' }}>Model</th>
                <th style={{ padding: '0.4rem' }}>Șofer implicit</th>
              </tr>
            </thead>
            <tbody>
              {masini.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '0.75rem', color: '#666' }}>
                    Nicio mașină alocată fermei tale încă — cere adminului general să aloce una din /masini.
                  </td>
                </tr>
              )}
              {masini.map((m) => (
                <tr key={m.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '0.4rem' }}>{m.nume}</td>
                  <td style={{ padding: '0.4rem' }}>{m.numar_inmatriculare ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{m.marca_model ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{m.sofer_nume ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && masini.length > 0 && (
        <section style={{ maxWidth: '520px' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Adaugă bon de combustibil</h2>
          <form onSubmit={handleSubmit}>
            <fieldset style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: '8px' }} disabled={saving}>
              <label style={{ display: 'block', marginBottom: '0.6rem' }}>
                Mașină
                <select
                  value={form.masina_id}
                  onChange={(e) => updateForm('masina_id', e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
                >
                  <option value="">Alege mașină</option>
                  {masini.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nume} {m.numar_inmatriculare ? `(${m.numar_inmatriculare})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'block', marginBottom: '0.6rem' }}>
                Data
                <input
                  type="date"
                  value={form.data}
                  onChange={(e) => updateForm('data', e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
                />
              </label>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', flex: 1 }}>
                  Litri
                  <input
                    type="number"
                    step="0.01"
                    value={form.litri}
                    onChange={(e) => updateForm('litri', e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: '0.6rem', flex: 1 }}>
                  Preț/litru (lei)
                  <input
                    type="number"
                    step="0.01"
                    value={form.pret_litru}
                    onChange={(e) => updateForm('pret_litru', e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
                  />
                </label>
              </div>
              <label style={{ display: 'block', marginBottom: '0.6rem' }}>
                Sumă totală (lei)
                <input
                  type="number"
                  step="0.01"
                  value={form.suma_totala}
                  onChange={(e) => updateForm('suma_totala', e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
                />
              </label>
              <label style={{ display: 'block', marginBottom: '0.6rem' }}>
                Stație (opțional)
                <input
                  type="text"
                  value={form.statie}
                  onChange={(e) => updateForm('statie', e.target.value)}
                  placeholder="ex. OMV Săbăreni"
                  style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
                />
              </label>
              <label style={{ display: 'block', marginBottom: '0.6rem' }}>
                Km la bord (opțional)
                <input
                  type="number"
                  value={form.km_bord}
                  onChange={(e) => updateForm('km_bord', e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
                />
              </label>
              <label style={{ display: 'block', marginBottom: '0.6rem' }}>
                Notă (opțional)
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => updateForm('note', e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: '0.3rem', padding: '0.55rem' }}
                />
              </label>

              {formError && <div style={{ color: '#b00020', marginBottom: '0.6rem' }}>{formError}</div>}

              <button type="submit" style={{ width: '100%', padding: '0.85rem', fontWeight: 'bold', borderRadius: '6px', border: '1px solid #2e7d32', background: '#2e7d32', color: '#fff', cursor: 'pointer' }}>
                {saving ? 'Salvez...' : 'Salvează bon'}
              </button>
            </fieldset>
          </form>
        </section>
      )}

      {!loading && (
        <section>
          <h2 style={{ fontSize: '1.05rem' }}>Bonuri recente</h2>
          {bonuri.length === 0 && <p style={{ color: '#666' }}>Niciun bon introdus încă.</p>}
          {bonuri.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem', maxWidth: '760px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    <th style={{ padding: '0.4rem' }}>Data</th>
                    <th style={{ padding: '0.4rem' }}>Mașină</th>
                    <th style={{ padding: '0.4rem' }}>Litri</th>
                    <th style={{ padding: '0.4rem' }}>Sumă</th>
                    <th style={{ padding: '0.4rem' }}>Stație</th>
                  </tr>
                </thead>
                <tbody>
                  {bonuri.map((b) => (
                    <tr key={b.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.4rem' }}>{new Date(b.data).toLocaleDateString('ro-RO')}</td>
                      <td style={{ padding: '0.4rem' }}>{numeMasinaById.get(b.masina_id)?.nume ?? '—'}</td>
                      <td style={{ padding: '0.4rem' }}>{b.litri ?? '—'}</td>
                      <td style={{ padding: '0.4rem' }}>{b.suma_totala} lei</td>
                      <td style={{ padding: '0.4rem' }}>{b.statie ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
