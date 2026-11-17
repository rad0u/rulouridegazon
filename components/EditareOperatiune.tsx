'use client';

// 2026-11-17 (Radu: „și un buton de modificare a operațiunii la fiecare în
// parte") — formular de corectare pentru o operațiune din istoricul parcelei
// (ParcelaPanel). Doar admin_central (ParcelaPanel îl afișează doar când
// `editable`; RLS permite UPDATE și pentru admin_ferma pe ferma lui).
// Se pot corecta: tipul, data, utilajul, orele, mp recoltați, nota.
// Intervalul sesiunii GPS (sesiune_inceput/sfarsit) NU se modifică — e
// dovada din traseu; consumurile (substanțe/materii prime) se corectează
// separat, din ConsumuriOperatiune.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { LABEL_OPERATIUNE, TIPURI_OPERATIUNE, type Operatiune, type TipOperatiune } from '../lib/operatiuniTypes';

interface Props {
  op: Operatiune;
  fermaId: string;
  onSaved: () => void;
  onCancel: () => void;
}

export default function EditareOperatiune({ op, fermaId, onSaved, onCancel }: Props) {
  const [utilaje, setUtilaje] = useState<{ id: string; nume: string }[]>([]);
  const [tip, setTip] = useState<TipOperatiune>(op.tip);
  const [data, setData] = useState(op.data);
  const [utilajId, setUtilajId] = useState(op.utilaj_id ?? '');
  const [ore, setOre] = useState(op.ore_lucru?.toString() ?? '');
  const [mp, setMp] = useState(op.cantitate_mp_recoltat?.toString() ?? '');
  const [note, setNote] = useState(op.note ?? '');
  const [saving, setSaving] = useState(false);
  const [eroare, setEroare] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('utilaje')
      .select('id,nume')
      .eq('ferma_id', fermaId)
      .order('nume')
      .then(({ data: rows }) => setUtilaje((rows as { id: string; nume: string }[]) ?? []));
  }, [fermaId]);

  function numar(v: string): number | null | 'invalid' {
    const t = v.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : 'invalid';
  }

  async function salveaza() {
    setEroare(null);
    if (!data) return setEroare('Data e obligatorie.');
    const oreNr = numar(ore);
    const mpNr = numar(mp);
    if (oreNr === 'invalid') return setEroare('Orele trebuie să fie un număr ≥ 0.');
    if (mpNr === 'invalid') return setEroare('Suprafața recoltată trebuie să fie un număr ≥ 0.');
    if (tip === 'Recoltare' && mpNr === null) return setEroare('La recoltare completează mp recoltați.');

    setSaving(true);
    const { error } = await supabase
      .from('operatiuni')
      .update({
        tip,
        data,
        utilaj_id: utilajId || null,
        ore_lucru: oreNr,
        cantitate_mp_recoltat: tip === 'Recoltare' ? mpNr : null,
        note: note.trim() || null,
      })
      .eq('id', op.id);
    setSaving(false);
    if (error) return setEroare(`Nu s-a putut salva: ${error.message}`);
    onSaved();
  }

  const camp: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.15rem', fontSize: '0.8rem' };

  return (
    <div style={{ border: '1px solid #c8d6c0', background: '#f6faf3', borderRadius: 6, padding: '0.6rem', margin: '0.4rem 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
        <label style={camp}>
          Tip
          <select value={tip} onChange={(e) => setTip(e.target.value as TipOperatiune)}>
            {TIPURI_OPERATIUNE.map((t) => (
              <option key={t} value={t}>{LABEL_OPERATIUNE[t]}</option>
            ))}
          </select>
        </label>
        <label style={camp}>
          Data
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <label style={camp}>
          Utilaj
          <select value={utilajId} onChange={(e) => setUtilajId(e.target.value)}>
            <option value="">— nespecificat —</option>
            {utilaje.map((u) => (
              <option key={u.id} value={u.id}>{u.nume}</option>
            ))}
            {op.utilaj_id && !utilaje.some((u) => u.id === op.utilaj_id) && (
              <option value={op.utilaj_id}>{op.utilaje?.nume ?? 'utilaj curent'}</option>
            )}
          </select>
        </label>
        <label style={camp}>
          Ore lucru
          <input inputMode="decimal" value={ore} onChange={(e) => setOre(e.target.value)} />
        </label>
        {tip === 'Recoltare' && (
          <label style={camp}>
            mp recoltați
            <input inputMode="decimal" value={mp} onChange={(e) => setMp(e.target.value)} />
          </label>
        )}
      </div>
      <label style={{ ...camp, marginTop: '0.5rem' }}>
        Notă
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {eroare && <p style={{ color: '#b00020', margin: '0.4rem 0 0', fontSize: '0.85rem' }}>{eroare}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button type="button" onClick={salveaza} disabled={saving}>
          {saving ? 'Se salvează…' : 'Salvează'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>Renunță</button>
      </div>
    </div>
  );
}
