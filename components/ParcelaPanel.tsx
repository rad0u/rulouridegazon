'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Parcela } from '../lib/parcelaTypes';
import {
  LABEL_OPERATIUNE,
  Operatiune,
  Substanta,
  TIPURI_CU_SUBSTANTE,
  TIPURI_OPERATIUNE,
  TipOperatiune,
} from '../lib/operatiuniTypes';

interface ParcelaPanelProps {
  parcela: Parcela;
  onRedraw?: () => void;
  showRedrawButton: boolean;
  editable: boolean;
  onParcelaUpdated?: (parcela: Parcela) => void;
  onParcelaDeleted?: (parcelaId: string) => void;
}

type SubstantaLinie = { substanta_id: string; cantitate: string };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ParcelaPanel({
  parcela,
  onRedraw,
  showRedrawButton,
  editable,
  onParcelaUpdated,
  onParcelaDeleted,
}: ParcelaPanelProps) {
  const [istoric, setIstoric] = useState<Operatiune[]>([]);
  const [loadingIstoric, setLoadingIstoric] = useState(true);
  const [substanteFerma, setSubstanteFerma] = useState<Substanta[]>([]);

  const [tipSelectat, setTipSelectat] = useState<TipOperatiune | null>(null);
  const [data, setData] = useState(todayISO());
  const [oreLucru, setOreLucru] = useState('');
  const [note, setNote] = useState('');
  const [substanteLinii, setSubstanteLinii] = useState<SubstantaLinie[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [editingDescriere, setEditingDescriere] = useState(false);
  const [editNume, setEditNume] = useState(parcela.nume);
  const [editTipGazon, setEditTipGazon] = useState(parcela.tip_gazon ?? '');
  const [editSuprafata, setEditSuprafata] = useState(parcela.suprafata_mp?.toString() ?? '');
  const [savingDescriere, setSavingDescriere] = useState(false);
  const [errorDescriere, setErrorDescriere] = useState<string | null>(null);

  useEffect(() => {
    void loadIstoric();
    void loadSubstante();
    resetForm();
    setEditingDescriere(false);
    setEditNume(parcela.nume);
    setEditTipGazon(parcela.tip_gazon ?? '');
    setEditSuprafata(parcela.suprafata_mp?.toString() ?? '');
    setErrorDescriere(null);
    setConfirmingDelete(false);
    setDeleteError(null);
  }, [parcela.id]);

  async function handleSaveDescriere() {
    setErrorDescriere(null);

    if (!editNume.trim()) {
      setErrorDescriere('Numele parcelei nu poate fi gol.');
      return;
    }

    const suprafataNum = editSuprafata === '' ? null : Number(editSuprafata);
    if (editSuprafata !== '' && (Number.isNaN(suprafataNum) || (suprafataNum ?? 0) < 0)) {
      setErrorDescriere('Suprafața trebuie să fie un număr pozitiv.');
      return;
    }

    setSavingDescriere(true);

    const payload = {
      nume: editNume.trim(),
      tip_gazon: editTipGazon.trim() || null,
      suprafata_mp: suprafataNum,
    };

    const { error: updateError } = await supabase
      .from('parcele')
      .update(payload)
      .eq('id', parcela.id);

    if (updateError) {
      setErrorDescriere(updateError.message);
      setSavingDescriere(false);
      return;
    }

    onParcelaUpdated?.({ ...parcela, ...payload });
    setEditingDescriere(false);
    setSavingDescriere(false);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);

    const { error: deleteErr } = await supabase.from('parcele').delete().eq('id', parcela.id);

    setDeleting(false);

    if (deleteErr) {
      if (deleteErr.code === '23503') {
        setDeleteError('Nu poți șterge — parcela are operațiuni sau recoltări înregistrate în istoric.');
      } else {
        setDeleteError(deleteErr.message);
      }
      return;
    }

    onParcelaDeleted?.(parcela.id);
  }

  async function loadIstoric() {
    setLoadingIstoric(true);
    const { data: rows, error: fetchError } = await supabase
      .from('operatiuni')
      .select('id,tip,data,ore_lucru,note,operatiuni_substante(cantitate,substante(nume,unitate_masura))')
      .eq('parcela_id', parcela.id)
      .order('data', { ascending: false });

    if (!fetchError) {
      setIstoric((rows as unknown as Operatiune[]) ?? []);
    }
    setLoadingIstoric(false);
  }

  async function loadSubstante() {
    const { data: rows } = await supabase
      .from('substante')
      .select('id,nume,unitate_masura,stoc_curent')
      .or(`ferma_id.eq.${parcela.ferma_id},ferma_id.is.null`)
      .order('nume');

    setSubstanteFerma((rows as Substanta[]) ?? []);
  }

  function resetForm() {
    setTipSelectat(null);
    setData(todayISO());
    setOreLucru('');
    setNote('');
    setSubstanteLinii([]);
    setError(null);
    setSuccess(null);
  }

  function selectTip(tip: TipOperatiune) {
    setTipSelectat(tip);
    setData(todayISO());
    setOreLucru('');
    setNote('');
    setSubstanteLinii(TIPURI_CU_SUBSTANTE.includes(tip) ? [{ substanta_id: '', cantitate: '' }] : []);
    setError(null);
    setSuccess(null);
  }

  function addSubstantaLinie() {
    setSubstanteLinii((prev) => [...prev, { substanta_id: '', cantitate: '' }]);
  }

  function updateSubstantaLinie(index: number, field: keyof SubstantaLinie, value: string) {
    setSubstanteLinii((prev) =>
      prev.map((linie, i) => (i === index ? { ...linie, [field]: value } : linie))
    );
  }

  function removeSubstantaLinie(index: number) {
    setSubstanteLinii((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tipSelectat) return;

    setError(null);
    setSuccess(null);

    if (!data) {
      setError('Alege data operațiunii.');
      return;
    }

    const oreNum = oreLucru === '' ? null : Number(oreLucru);
    if (
      oreLucru !== '' &&
      (Number.isNaN(oreNum) || !Number.isInteger(oreNum) || (oreNum ?? 0) < 0 || (oreNum ?? 0) > 8)
    ) {
      setError('Orele de lucru trebuie să fie un număr întreg între 0 și 8.');
      return;
    }

    const needsSubstante = TIPURI_CU_SUBSTANTE.includes(tipSelectat);
    const liniiValide = substanteLinii.filter((l) => l.substanta_id && l.cantitate);

    if (needsSubstante && liniiValide.length === 0) {
      setError('Adaugă cel puțin o substanță folosită (cu cantitate).');
      return;
    }

    for (const linie of liniiValide) {
      const cant = Number(linie.cantitate);
      if (Number.isNaN(cant) || cant <= 0) {
        setError('Cantitatea trebuie să fie un număr pozitiv pentru fiecare substanță.');
        return;
      }
    }

    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: opInsert, error: opError } = await supabase
      .from('operatiuni')
      .insert({
        parcela_id: parcela.id,
        tip: tipSelectat,
        data,
        ore_lucru: oreNum,
        note: note.trim() || null,
        user_id: user?.id ?? null,
      })
      .select('id')
      .single();

    if (opError || !opInsert) {
      setError(opError?.message ?? 'Eroare la salvarea operațiunii.');
      setSaving(false);
      return;
    }

    if (needsSubstante && liniiValide.length > 0) {
      const rows = liniiValide.map((l) => ({
        operatiune_id: opInsert.id,
        substanta_id: l.substanta_id,
        cantitate: Number(l.cantitate),
      }));

      const { error: substErr } = await supabase.from('operatiuni_substante').insert(rows);
      if (substErr) {
        setError(`Operațiunea a fost salvată, dar substanțele nu s-au putut înregistra: ${substErr.message}`);
        setSaving(false);
        await loadIstoric();
        return;
      }
    }

    setSuccess('Operațiunea a fost salvată.');
    resetForm();
    await Promise.all([loadIstoric(), loadSubstante()]);
    setSaving(false);
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
      {editingDescriere ? (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            Nume
            <input
              type="text"
              value={editNume}
              onChange={(e) => setEditNume(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.4rem' }}
            />
          </label>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            Tip gazon
            <select
              value={editTipGazon}
              onChange={(e) => setEditTipGazon(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.4rem' }}
            >
              <option value="">—</option>
              <option value="rustic">rustic</option>
              <option value="sport">sport</option>
              <option value="în pregătire">în pregătire</option>
            </select>
          </label>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            Suprafață (mp)
            <input
              type="number"
              min="0"
              step="1"
              value={editSuprafata}
              onChange={(e) => setEditSuprafata(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.4rem' }}
            />
          </label>

          {errorDescriere && <p style={{ color: '#b00020' }}>{errorDescriere}</p>}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => void handleSaveDescriere()} disabled={savingDescriere}>
              {savingDescriere ? 'Salvez...' : 'Salvează'}
            </button>
            <button
              onClick={() => {
                setEditingDescriere(false);
                setEditNume(parcela.nume);
                setEditTipGazon(parcela.tip_gazon ?? '');
                setEditSuprafata(parcela.suprafata_mp?.toString() ?? '');
                setErrorDescriere(null);
              }}
              disabled={savingDescriere}
            >
              Renunță
            </button>
          </div>
        </div>
      ) : (
        <div>
          <h3 style={{ marginTop: 0 }}>{parcela.nume}</h3>
          <p>
            <strong>Tip gazon:</strong> {parcela.tip_gazon ?? '—'}
          </p>
          {parcela.stadiu && (
            <p>
              <strong>Stadiu:</strong> {parcela.stadiu}
            </p>
          )}
          <p>
            <strong>Suprafață:</strong> {parcela.suprafata_mp ?? '—'} mp
          </p>
          {editable && (
            <button onClick={() => setEditingDescriere(true)} style={{ marginBottom: '0.5rem' }}>
              Editează descrierea
            </button>
          )}
        </div>
      )}

      {showRedrawButton && onRedraw && (
        <button onClick={onRedraw} style={{ marginBottom: '1rem', marginRight: '0.5rem' }}>
          Redesenează conturul
        </button>
      )}

      {editable && (
        <div style={{ marginBottom: '1rem', display: 'inline-block' }}>
          {!confirmingDelete ? (
            <button onClick={() => setConfirmingDelete(true)}>Șterge parcela</button>
          ) : (
            <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              Sigur ștergi „{parcela.nume}"?
              <button onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? 'Șterg...' : 'Da, șterge'}
              </button>
              <button onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                Anulează
              </button>
            </span>
          )}
          {deleteError && <p style={{ color: '#b00020', margin: '0.4rem 0 0' }}>{deleteError}</p>}
        </div>
      )}

      <hr style={{ margin: '1rem 0' }} />

      {!tipSelectat ? (
        <div>
          <p style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Ce ai lucrat pe această parcelă?</p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '0.6rem',
            }}
          >
            {TIPURI_OPERATIUNE.map((tip) => (
              <button
                key={tip}
                onClick={() => selectTip(tip)}
                style={{ padding: '0.9rem 0.75rem', fontSize: '1.05rem', fontWeight: 'bold' }}
              >
                {LABEL_OPERATIUNE[tip]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset
            style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: '8px' }}
            disabled={saving}
          >
            <legend style={{ fontWeight: 'bold', padding: '0 0.5rem' }}>
              {LABEL_OPERATIUNE[tipSelectat]}
            </legend>

            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Data
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Ore de lucru
              <input
                type="number"
                min="0"
                max="8"
                step="1"
                inputMode="numeric"
                value={oreLucru}
                onChange={(e) => setOreLucru(e.target.value.replace(/[^0-9]/g, ''))}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem' }}
              />
            </label>

            {TIPURI_CU_SUBSTANTE.includes(tipSelectat) && (
              <div style={{ marginBottom: '0.75rem' }}>
                <span style={{ display: 'block', marginBottom: '0.35rem' }}>
                  Substanțe / sămânță folosită
                </span>
                {substanteLinii.map((linie, index) => (
                  <div
                    key={index}
                    style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}
                  >
                    <select
                      value={linie.substanta_id}
                      onChange={(e) => updateSubstantaLinie(index, 'substanta_id', e.target.value)}
                      style={{ flex: '1 1 180px', padding: '0.5rem' }}
                    >
                      <option value="">Alege substanță</option>
                      {substanteFerma.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nume} ({s.unitate_masura}) — stoc {s.stoc_curent ?? 0}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Cantitate"
                      value={linie.cantitate}
                      onChange={(e) => updateSubstantaLinie(index, 'cantitate', e.target.value)}
                      style={{ flex: '1 1 100px', padding: '0.5rem' }}
                    />
                    <button
                      type="button"
                      onClick={() => removeSubstantaLinie(index)}
                      disabled={substanteLinii.length === 1}
                      style={{ flex: '0 0 auto', padding: '0.5rem 0.9rem' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addSubstantaLinie}>
                  + Adaugă substanță
                </button>
              </div>
            )}

            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Note (opțional)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: '0.35rem', padding: '0.5rem' }}
                rows={2}
              />
            </label>

            {error && <div style={{ color: '#b00020', marginBottom: '0.75rem' }}>{error}</div>}
            {success && <div style={{ color: '#0b6623', marginBottom: '0.75rem' }}>{success}</div>}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="submit"
                style={{ flex: '1 1 160px', padding: '0.9rem 1rem', fontWeight: 'bold' }}
              >
                {saving ? 'Salvez...' : 'Salvează'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                style={{ flex: '1 1 120px', padding: '0.9rem 1rem' }}
              >
                Renunță
              </button>
            </div>
          </fieldset>
        </form>
      )}

      <div style={{ marginTop: '1.5rem' }}>
        <h4>Istoric operațiuni</h4>
        {loadingIstoric ? (
          <p>Se încarcă...</p>
        ) : istoric.length === 0 ? (
          <p style={{ color: '#666' }}>Nicio operațiune înregistrată încă pe această parcelă.</p>
        ) : (
          <ul style={{ paddingLeft: '1.1rem' }}>
            {istoric.map((op) => (
              <li key={op.id} style={{ marginBottom: '0.5rem' }}>
                <strong>{op.data}</strong> — {LABEL_OPERATIUNE[op.tip]}
                {op.ore_lucru != null && <> · {op.ore_lucru}h</>}
                {op.operatiuni_substante && op.operatiuni_substante.length > 0 && (
                  <div style={{ fontSize: '0.85rem', color: '#555' }}>
                    {op.operatiuni_substante
                      .map((s) => `${s.substante?.nume ?? '—'}: ${s.cantitate} ${s.substante?.unitate_masura ?? ''}`)
                      .join(', ')}
                  </div>
                )}
                {op.note && <div style={{ fontSize: '0.85rem', color: '#555' }}>{op.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
