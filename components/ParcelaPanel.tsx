'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Parcela } from '../lib/parcelaTypes';
import { LABEL_OPERATIUNE, Operatiune } from '../lib/operatiuniTypes';
import ConsumuriOperatiune from './ConsumuriOperatiune';
import EditareOperatiune from './EditareOperatiune';

const FORMAT_ORA = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'Europe/Bucharest',
  hour: '2-digit',
  minute: '2-digit',
});
function oraLocala(iso: string): string {
  return FORMAT_ORA.format(new Date(iso));
}

// 2026-11-26 (Radu): „anul și luna cultivării" = începutul ciclului de producție curent
// (parcele_cicluri.data_start, la nivel de lună). O singură sursă: aceeași dată decide și
// dacă ciclul e „complet" (început după 01.10.2026) în raportul Consumuri lunare.
type CicluCurent = { id: string; data_start: string; data_sfarsit: string | null };
const LUNI_RO = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
function lunaAnText(data: string): string {
  const [an, luna] = data.split('-').map(Number);
  return `${LUNI_RO[luna - 1]} ${an}`;
}

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
  const [editOpId, setEditOpId] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [editingDescriere, setEditingDescriere] = useState(false);
  const [editNume, setEditNume] = useState(parcela.nume);
  const [editTipGazon, setEditTipGazon] = useState(parcela.tip_gazon ?? '');
  const [editSuprafata, setEditSuprafata] = useState(parcela.suprafata_mp?.toString() ?? '');
  const [savingDescriere, setSavingDescriere] = useState(false);
  const [errorDescriere, setErrorDescriere] = useState<string | null>(null);
  const [ciclu, setCiclu] = useState<CicluCurent | null>(null);
  const [editLunaCultivare, setEditLunaCultivare] = useState(''); // AAAA-LL

  async function loadCiclu() {
    const { data } = await supabase
      .from('parcele_cicluri')
      .select('id,data_start,data_sfarsit')
      .eq('parcela_id', parcela.id)
      .order('data_start', { ascending: false })
      .limit(1)
      .maybeSingle();
    const c = (data as CicluCurent | null) ?? null;
    setCiclu(c);
    setEditLunaCultivare(c ? c.data_start.slice(0, 7) : '');
  }

  useEffect(() => {
    void loadIstoric();
    void loadCiclu();
    setEditOpId(null);
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
    if (editLunaCultivare !== '' && !/^\d{4}-\d{2}$/.test(editLunaCultivare)) {
      setErrorDescriere('Alege luna și anul cultivării.');
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

    // Luna cultivării → începutul ciclului curent (sau un ciclu nou, dacă parcela nu are niciunul).
    const dataStartNoua = editLunaCultivare ? `${editLunaCultivare}-01` : null;
    if (dataStartNoua && dataStartNoua !== ciclu?.data_start) {
      const { error: cicluErr } = ciclu
        ? await supabase.from('parcele_cicluri').update({ data_start: dataStartNoua, nota: null }).eq('id', ciclu.id)
        : await supabase.from('parcele_cicluri').insert({
            parcela_id: parcela.id,
            data_start: dataStartNoua,
            tip_gazon: payload.tip_gazon,
            suprafata_mp: payload.suprafata_mp,
          });
      if (cicluErr) {
        const mesaj =
          cicluErr.code === '23P01'
            ? 'Luna cultivării se suprapune cu ciclul anterior al parcelei (care se încheie după această lună).'
            : cicluErr.code === '23514'
              ? 'Luna cultivării nu poate fi după data de încheiere a ciclului.'
              : cicluErr.message;
        setErrorDescriere(`Descrierea s-a salvat, dar luna cultivării nu: ${mesaj}`);
        setSavingDescriere(false);
        onParcelaUpdated?.({ ...parcela, ...payload });
        return;
      }
      await loadCiclu();
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
        'id,tip,data,ore_lucru,note,cantitate_mp_recoltat,utilaj_id,sesiune_inceput,sesiune_sfarsit,utilaje(nume),utilizatori(nume),operatiuni_substante(id,cantitate,substante(nume,unitate_masura)),operatiuni_materii_prime(id,cantitate,materii_prime(nume,unitate_masura))',
      )
      .eq('parcela_id', parcela.id)
      .order('data', { ascending: false })
      .order('sesiune_inceput', { ascending: false, nullsFirst: false });

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
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            Cultivată în (luna și anul)
            <input
              type="month"
              value={editLunaCultivare}
              onChange={(e) => setEditLunaCultivare(e.target.value)}
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
                setEditLunaCultivare(ciclu ? ciclu.data_start.slice(0, 7) : '');
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
          <p>
            <strong>Cultivată în:</strong> {ciclu ? lunaAnText(ciclu.data_start) : '—'}
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
                {op.sesiune_inceput && op.sesiune_sfarsit && (
                  <> · {oraLocala(op.sesiune_inceput)}–{oraLocala(op.sesiune_sfarsit)}</>
                )}
                {op.ore_lucru != null && <> · {op.ore_lucru}h</>}
                <div style={{ fontSize: '0.85rem', color: '#333' }}>
                  🚜 {op.utilaje?.nume ?? <span style={{ color: '#999' }}>utilaj nespecificat</span>}
                  {op.utilizatori?.nume && <span style={{ color: '#777' }}> · validat de {op.utilizatori.nume}</span>}
                </div>
                {editable && editOpId !== op.id && (
                  <button
                    type="button"
                    onClick={() => setEditOpId(op.id)}
                    style={{ fontSize: '0.8rem', padding: '0.1rem 0.5rem', marginTop: '0.2rem' }}
                  >
                    ✏️ Modifică
                  </button>
                )}
                {editable && editOpId === op.id && (
                  <EditareOperatiune
                    op={op}
                    fermaId={parcela.ferma_id}
                    onCancel={() => setEditOpId(null)}
                    onSaved={() => {
                      setEditOpId(null);
                      void loadIstoric();
                    }}
                  />
                )}
                {op.cantitate_mp_recoltat != null && <> · {op.cantitate_mp_recoltat} mp recoltați</>}
                {editable ? (
                  <ConsumuriOperatiune
                    substante={(op.operatiuni_substante ?? []).map((s) => ({
                      id: s.id,
                      nume: s.substante?.nume ?? '—',
                      um: s.substante?.unitate_masura ?? '',
                      cantitate: Number(s.cantitate),
                    }))}
                    materii={(op.operatiuni_materii_prime ?? []).map((m) => ({
                      id: m.id,
                      nume: m.materii_prime?.nume ?? '—',
                      um: m.materii_prime?.unitate_masura ?? '',
                      cantitate: Number(m.cantitate),
                    }))}
                    onSaved={loadIstoric}
                  />
                ) : (
                  <>
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
                  </>
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
