'use client';

// 2026-11-17 (Radu: „și un buton de modificare a operațiunii la fiecare în
// parte") — formular de corectare pentru o operațiune din istoricul parcelei
// (ParcelaPanel). Doar admin_central (ParcelaPanel îl afișează doar când
// `editable`; RLS permite UPDATE și pentru admin_ferma pe ferma lui).
// Se pot corecta: tipul, data, utilajul, orele, mp recoltați, nota.
// 2026-11-17 (Radu: „la tip operațiune să pot introduce cantitatea și
// materia primă folosită dacă aleg însămânțare/fertilizare/tratament"):
// pentru tipurile cu substanțe (fertilizare solidă / tratamente foliare) și
// cu materii prime (însămânțare) se pot ADĂUGA linii noi (produs + cantitate);
// INSERT-ul scade stocul prin triggerele din DB (scade_stoc_*), ca în
// /activitati-parcele. Liniile existente se corectează din ConsumuriOperatiune.
// Intervalul sesiunii GPS (sesiune_inceput/sfarsit) NU se modifică — e
// dovada din traseu; consumurile (substanțe/materii prime) se corectează
// separat, din ConsumuriOperatiune.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  LABEL_OPERATIUNE,
  TIPURI_CU_MATERII_PRIME,
  TIPURI_CU_SUBSTANTE,
  TIPURI_OPERATIUNE,
  type Operatiune,
  type TipOperatiune,
} from '../lib/operatiuniTypes';
import { inBaza, parseazaNumar } from '../lib/unitati';
import CantitateCuUm from './CantitateCuUm';

type Produs = { id: string; nume: string; unitate_masura: string; stoc_curent: number | null };
type Linie = { produs_id: string; cantitate: string; um: string };
const LINIE_GOALA: Linie = { produs_id: '', cantitate: '', um: '' };

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
  const [substante, setSubstante] = useState<Produs[]>([]);
  const [materii, setMaterii] = useState<Produs[]>([]);
  const [liniiSub, setLiniiSub] = useState<Linie[]>([]);
  const [liniiMp, setLiniiMp] = useState<Linie[]>([]);
  const [saving, setSaving] = useState(false);
  const [eroare, setEroare] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('utilaje')
      .select('id,nume')
      .eq('ferma_id', fermaId)
      .order('nume')
      .then(({ data: rows }) => setUtilaje((rows as { id: string; nume: string }[]) ?? []));
    void supabase
      .from('substante')
      .select('id,nume,unitate_masura,stoc_curent')
      .eq('ferma_id', fermaId)
      .order('nume')
      .then(({ data: rows }) => setSubstante((rows as Produs[]) ?? []));
    void supabase
      .from('materii_prime')
      .select('id,nume,unitate_masura,stoc_curent')
      .eq('ferma_id', fermaId)
      .order('nume')
      .then(({ data: rows }) => setMaterii((rows as Produs[]) ?? []));
  }, [fermaId]);

  const cuSubstante = TIPURI_CU_SUBSTANTE.includes(tip);
  const cuMaterii = TIPURI_CU_MATERII_PRIME.includes(tip);

  // Linii completate → rânduri de inserat (cantitate în unitatea de bază).
  // Întoarce un mesaj de eroare dacă o linie e pe jumătate completată.
  function randuri(linii: Linie[], produse: Produs[], eticheta: string): { id: string; cantitate: number }[] | string {
    const rez: { id: string; cantitate: number }[] = [];
    for (const l of linii) {
      if (!l.produs_id && l.cantitate.trim() === '') continue;
      const p = produse.find((x) => x.id === l.produs_id);
      if (!p) return `Alege ${eticheta} pentru fiecare cantitate completată.`;
      const c = inBaza(parseazaNumar(l.cantitate), l.um || p.unitate_masura, p.unitate_masura);
      if (!Number.isFinite(c) || c <= 0) return `Cantitatea pentru „${p.nume}” trebuie să fie un număr mai mare ca 0.`;
      rez.push({ id: p.id, cantitate: c });
    }
    return rez;
  }

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
    const noiSub = cuSubstante ? randuri(liniiSub, substante, 'substanța') : [];
    if (typeof noiSub === 'string') return setEroare(noiSub);
    const noiMp = cuMaterii ? randuri(liniiMp, materii, 'materia primă') : [];
    if (typeof noiMp === 'string') return setEroare(noiMp);

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
    if (error) {
      setSaving(false);
      return setEroare(`Nu s-a putut salva: ${error.message}`);
    }
    if (noiSub.length > 0) {
      const { error: e } = await supabase
        .from('operatiuni_substante')
        .insert(noiSub.map((r) => ({ operatiune_id: op.id, substanta_id: r.id, cantitate: r.cantitate })));
      if (e) {
        setSaving(false);
        return setEroare(`Operațiunea s-a salvat, dar substanțele nu: ${e.message}`);
      }
    }
    if (noiMp.length > 0) {
      const { error: e } = await supabase
        .from('operatiuni_materii_prime')
        .insert(noiMp.map((r) => ({ operatiune_id: op.id, materie_prima_id: r.id, cantitate: r.cantitate })));
      if (e) {
        setSaving(false);
        return setEroare(`Operațiunea s-a salvat, dar materiile prime nu: ${e.message}`);
      }
    }
    setSaving(false);
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
      {cuSubstante && (
        <SectiuneProduse
          titlu="Adaugă substanțe folosite (fertilizanți / tratamente)"
          produse={substante}
          linii={liniiSub}
          setLinii={setLiniiSub}
          existente={(op.operatiuni_substante ?? []).length}
        />
      )}
      {cuMaterii && (
        <SectiuneProduse
          titlu="Adaugă materii prime folosite (sămânță etc.)"
          produse={materii}
          linii={liniiMp}
          setLinii={setLiniiMp}
          existente={(op.operatiuni_materii_prime ?? []).length}
        />
      )}
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

function SectiuneProduse({
  titlu,
  produse,
  linii,
  setLinii,
  existente,
}: {
  titlu: string;
  produse: Produs[];
  linii: Linie[];
  setLinii: (f: (prev: Linie[]) => Linie[]) => void;
  existente: number;
}) {
  const randuri = linii.length > 0 ? linii : [LINIE_GOALA];
  function schimba(i: number, patch: Partial<Linie>) {
    setLinii((prev) => {
      const baza = prev.length > 0 ? [...prev] : [{ ...LINIE_GOALA }];
      baza[i] = { ...baza[i], ...patch };
      return baza;
    });
  }
  return (
    <div style={{ marginTop: '0.6rem', fontSize: '0.8rem' }}>
      <div style={{ marginBottom: '0.3rem' }}>
        {titlu}
        {existente > 0 && (
          <span style={{ color: '#777' }}> — are deja {existente} înregistrate; cantitățile lor se corectează mai jos, cu „Modifică cantitățile”</span>
        )}
      </div>
      {randuri.map((l, i) => {
        const p = produse.find((x) => x.id === l.produs_id);
        const stocProblema = p && (p.stoc_curent === null || p.stoc_curent <= 0);
        return (
          <div key={i} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem', alignItems: 'center' }}>
            <select
              value={l.produs_id}
              onChange={(e) => {
                const np = produse.find((x) => x.id === e.target.value);
                schimba(i, { produs_id: e.target.value, um: np?.unitate_masura ?? '' });
              }}
              style={{ flex: '1 1 200px' }}
            >
              <option value="">Alege produsul</option>
              {produse.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nume} ({x.unitate_masura}) — stoc {x.stoc_curent ?? 0}
                </option>
              ))}
            </select>
            <CantitateCuUm
              baza={p?.unitate_masura}
              placeholder="Cantitate"
              value={l.cantitate}
              um={l.um}
              onChange={(v, u) => schimba(i, { cantitate: v, um: u })}
              style={{ width: '90px' }}
            />
            {stocProblema && <span style={{ color: '#c00000', fontWeight: 700 }}>Atenție la stoc!</span>}
            {randuri.length > 1 && (
              <button type="button" onClick={() => setLinii((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            )}
          </div>
        );
      })}
      <button type="button" onClick={() => setLinii((prev) => [...(prev.length > 0 ? prev : [{ ...LINIE_GOALA }]), { ...LINIE_GOALA }])}>
        + încă un produs
      </button>
    </div>
  );
}
