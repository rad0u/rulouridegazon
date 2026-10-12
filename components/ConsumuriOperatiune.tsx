'use client';

// 2026-10-12 (Radu): „daca substanta se afla in bidoane de 5 litri si
// operatorul trece ca a utilizat o unitate (deci un litru) aplicatia scade un
// bidon, nu un litru. [...] e nevoie de un buton de modificare a operatiunilor,
// unde operatorul sa poata introduce cantitatile corecte."
//
// Afișează consumurile (substanțe + materii prime) unei operațiuni și un buton
// „Modifică cantitățile”. La salvare se face UPDATE pe rândurile
// operatiuni_substante / operatiuni_materii_prime; stocul se recalculează în
// baza de date (triggere din supabase/schema-operatiuni-corectie-consum.sql),
// iar modificarea e jurnalizată automat (/jurnal-activitate).

import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export type LinieConsum = { id: string; nume: string; um: string; cantitate: number };

interface Props {
  substante: LinieConsum[];
  materii: LinieConsum[];
  onSaved: () => void | Promise<void>;
}

const fmt = (n: number) => String(Number(n.toFixed(4))).replace('.', ',');

export default function ConsumuriOperatiune({ substante, materii, onSaved }: Props) {
  const [editare, setEditare] = useState(false);
  const [valori, setValori] = useState<Record<string, string>>({});
  const [salvez, setSalvez] = useState(false);
  const [eroare, setEroare] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);

  if (substante.length === 0 && materii.length === 0) return null;

  function porneste() {
    const v: Record<string, string> = {};
    for (const l of [...substante, ...materii]) v[l.id] = String(l.cantitate);
    setValori(v);
    setEroare(null);
    setMesaj(null);
    setEditare(true);
  }

  async function salveaza() {
    const modificari: { tabel: 'operatiuni_substante' | 'operatiuni_materii_prime'; linie: LinieConsum; noua: number }[] = [];
    const randuri = [
      ...substante.map((l) => ({ tabel: 'operatiuni_substante' as const, linie: l })),
      ...materii.map((l) => ({ tabel: 'operatiuni_materii_prime' as const, linie: l })),
    ];
    for (const { tabel, linie } of randuri) {
      const brut = (valori[linie.id] ?? '').trim().replace(',', '.');
      const noua = Number(brut);
      if (brut === '' || !Number.isFinite(noua) || noua <= 0) {
        setEroare(`Cantitatea pentru „${linie.nume}” trebuie să fie un număr mai mare ca 0.`);
        return;
      }
      if (noua !== Number(linie.cantitate)) modificari.push({ tabel, linie, noua });
    }
    if (modificari.length === 0) {
      setEditare(false);
      return;
    }

    setSalvez(true);
    setEroare(null);
    const erori: string[] = [];
    let ok = 0;
    for (const m of modificari) {
      const { data, error } = await supabase
        .from(m.tabel)
        .update({ cantitate: m.noua })
        .eq('id', m.linie.id)
        .select('id');
      if (error) erori.push(`${m.linie.nume}: ${error.message}`);
      else if (!data || data.length !== 1) erori.push(`${m.linie.nume}: nu ai drept de modificare`);
      else ok++;
    }
    setSalvez(false);

    if (erori.length > 0) {
      setEroare(`Am salvat ${ok} din ${modificari.length}. Erori: ${erori.join('; ')}`);
      if (ok > 0) await onSaved();
      return;
    }
    setEditare(false);
    setMesaj('Cantități modificate — stocul s-a recalculat.');
    await onSaved();
  }

  if (!editare) {
    return (
      <div style={{ fontSize: '0.85rem', color: '#555' }}>
        {substante.length > 0 && (
          <div>{substante.map((s) => `${s.nume}: ${fmt(s.cantitate)} ${s.um}`).join(', ')}</div>
        )}
        {materii.length > 0 && (
          <div>{materii.map((m) => `${m.nume}: ${fmt(m.cantitate)} ${m.um}`).join(', ')}</div>
        )}
        <button onClick={porneste} style={{ marginTop: '0.3rem', padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}>
          ✏️ Modifică cantitățile
        </button>
        {mesaj && <span style={{ marginLeft: '0.6rem', color: '#2e7d32' }}>{mesaj}</span>}
      </div>
    );
  }

  const camp = (l: LinieConsum) => (
    <label key={l.id} style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem', minWidth: '190px' }}>
      {l.nume}
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <input
          type="text"
          inputMode="decimal"
          value={valori[l.id] ?? ''}
          onChange={(e) => setValori((prev) => ({ ...prev, [l.id]: e.target.value }))}
          style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid #ccc', width: '110px' }}
        />
        <span>{l.um}</span>
        <span style={{ color: '#888' }}>(era {fmt(l.cantitate)})</span>
      </span>
    </label>
  );

  return (
    <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '0.75rem', background: '#fafafa' }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#555' }}>
        Introdu cantitatea corectă, în unitatea de măsură a stocului (cea afișată lângă câmp). Dacă stocul e în
        bidoane și ai folosit 1 litru dintr-un bidon de 5 litri, scrie 0,2. Stocul se recalculează automat.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {substante.map(camp)}
        {materii.map(camp)}
      </div>
      {eroare && <p style={{ color: '#b00020', margin: '0.5rem 0 0' }}>{eroare}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
        <button onClick={() => void salveaza()} disabled={salvez}>
          {salvez ? 'Salvez...' : 'Salvează'}
        </button>
        <button onClick={() => setEditare(false)} disabled={salvez}>
          Renunță
        </button>
      </div>
    </div>
  );
}
