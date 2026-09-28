'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Parcela } from '../lib/parcelaTypes';
import { LABEL_OPERATIUNE, Operatiune } from '../lib/operatiuniTypes';

interface ParcelaPanelProps {
  parcela: Parcela;
  tipuriGazon: { id: string; nume: string }[];
  onRedraw?: () => void;
  showRedrawButton: boolean;
  editable: boolean;
  onParcelaUpdated?: (parcela: Parcela) => void;
  onParcelaDeleted?: (parcelaId: string) => void;
}

export default function ParcelaPanel({
  parcela,
  tipuriGazon,
  onRedraw,
  showRedrawButton,
  editable,
  onParcelaUpdated,
  onParcelaDeleted,
}: ParcelaPanelProps) {
  const [istoric, setIstoric] = useState<Operatiune[]>([]);
  const [loadingIstoric, setLoadingIstoric] = useState(true);

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
      .select(
        'id,tip,data,ore_lucru,note,cantitate_mp_recoltat,operatiuni_substante(cantitate,substante(nume,unitate_masura)),operatiuni_materii_prime(cantitate,materii_prime(nume,unitate_masura))',
      )
      .eq('parcela_id', parcela.id)
      .order('data', { ascending: false });

    if (!fetchError) {
      setIstoric((rows as unknown as Operatiune[]) ?? []);
    }
    setLoadingIstoric(false);
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
              {tipuriGazon.map((t) => (
                <option key={t.id} value={t.nume}>
                  {t.nume}
                </option>
              ))}
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

      {/* 2026-09-28 (Radu): "in pagina de configurare a unei ferme apare in
          subsol tabelul cu Ce ai lucrat pe aceasta parcela? si cardurile cu
          operatiuni. astea trebuie sa dispara, nu mai sunt de actualitate"
          — formularul de înregistrare manuală a unei lucrări pe parcelă
          (grila de tipuri de operațiune + formularul de detalii) a fost
          eliminat de aici; lucrările se înregistrează acum exclusiv prin
          fluxul GPS din /activitati-parcele. Istoricul de mai jos rămâne —
          e alimentat în continuare din tabela `operatiuni`, deci arată
          corect și lucrările confirmate din noul flux. */}

      <hr style={{ margin: '1rem 0' }} />

      <div>
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
                {op.cantitate_mp_recoltat != null && <> · {op.cantitate_mp_recoltat} mp recoltați</>}
                {op.operatiuni_substante && op.operatiuni_substante.length > 0 && (
                  <div style={{ fontSize: '0.85rem', color: '#555' }}>
                    {op.operatiuni_substante
                      .map((s) => `${s.substante?.nume ?? '—'}: ${s.cantitate} ${s.substante?.unitate_masura ?? ''}`)
                      .join(', ')}
                  </div>
                )}
                {op.operatiuni_materii_prime && op.operatiuni_materii_prime.length > 0 && (
                  <div style={{ fontSize: '0.85rem', color: '#555' }}>
                    {op.operatiuni_materii_prime
                      .map(
                        (m) =>
                          `${m.materii_prime?.nume ?? '—'}: ${m.cantitate} ${m.materii_prime?.unitate_masura ?? ''}`,
                      )
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
