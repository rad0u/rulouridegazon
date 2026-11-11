'use client';

// 2026-11-11 (Radu): lucrările făcute de utilaje ÎN AFARA parcelelor fermei,
// deja confirmate în „Activități parcele” (tabela lucrari_in_afara_fermei).
// Aici rămân monitorizate orele și motorina, exact ca la parcele — o listă
// restrânsă, pe perioada aleasă sus, cu totaluri. Un rând din listă = un grup
// confirmat împreună (grup_id comun): orele detectate și litrii se însumează
// pe sesiunile grupului, iar orele de lucru / locul / nota sunt cele
// introduse la confirmare (stau doar pe primul rând al grupului).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { LABEL_OPERATIUNE, TipOperatiune } from '../lib/operatiuniTypes';

interface Props {
  fermaId: string | null;
  deLa: string;
  panaLa: string;
  // crește după fiecare confirmare nouă, ca lista să se reîncarce
  versiune?: number;
}

type Rand = {
  id: string;
  grup_id: string;
  tip: TipOperatiune;
  data: string;
  sesiune_inceput: string;
  ore_detectate: number | null;
  litri_combustibil: number | null;
  ore_lucru: number | null;
  locatie: string | null;
  note: string | null;
  utilaje: { nume: string } | null;
};

type Grup = {
  grup_id: string;
  data: string;
  inceput: string;
  utilaj: string;
  tip: TipOperatiune;
  oreDetectate: number;
  oreLucru: number | null;
  litri: number | null;
  locatie: string | null;
  note: string | null;
};

function rotunjeste(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatLitri(litri: number | null): string {
  return litri === null ? '—' : `${litri.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} L`;
}

export default function LucrariInAfaraInregistrate({ fermaId, deLa, panaLa, versiune = 0 }: Props) {
  const [deschis, setDeschis] = useState(false);
  const [grupuri, setGrupuri] = useState<Grup[]>([]);
  const [loading, setLoading] = useState(false);
  const [eroare, setEroare] = useState<string | null>(null);

  const incarca = useCallback(async () => {
    if (!fermaId) return;
    setLoading(true);
    setEroare(null);
    const { data, error } = await supabase
      .from('lucrari_in_afara_fermei')
      .select(
        'id,grup_id,tip,data,sesiune_inceput,ore_detectate,litri_combustibil,ore_lucru,locatie,note,utilaje(nume)',
      )
      .eq('ferma_id', fermaId)
      .gte('data', deLa)
      .lte('data', panaLa)
      .order('sesiune_inceput', { ascending: false })
      .limit(1000);
    setLoading(false);
    if (error) {
      setEroare(error.message);
      return;
    }

    const map = new Map<string, Grup>();
    for (const r of (data as unknown as Rand[]) ?? []) {
      let g = map.get(r.grup_id);
      if (!g) {
        g = {
          grup_id: r.grup_id,
          data: r.data,
          inceput: r.sesiune_inceput,
          utilaj: r.utilaje?.nume ?? '—',
          tip: r.tip,
          oreDetectate: 0,
          oreLucru: null,
          litri: null,
          locatie: null,
          note: null,
        };
        map.set(r.grup_id, g);
      }
      if (r.sesiune_inceput < g.inceput) g.inceput = r.sesiune_inceput;
      g.oreDetectate = rotunjeste(g.oreDetectate + Number(r.ore_detectate ?? 0));
      if (r.litri_combustibil !== null) g.litri = rotunjeste((g.litri ?? 0) + Number(r.litri_combustibil));
      if (r.ore_lucru !== null) g.oreLucru = Number(r.ore_lucru);
      if (r.locatie) g.locatie = r.locatie;
      if (r.note) g.note = r.note;
    }
    setGrupuri(Array.from(map.values()).sort((a, b) => (a.inceput < b.inceput ? 1 : -1)));
  }, [fermaId, deLa, panaLa]);

  useEffect(() => {
    if (deschis) void incarca();
  }, [deschis, incarca, versiune]);

  if (!fermaId) return null;

  const totalDetectate = rotunjeste(grupuri.reduce((acc, g) => acc + g.oreDetectate, 0));
  const totalLucru = grupuri.reduce((acc, g) => acc + (g.oreLucru ?? 0), 0);
  const totalLitri = grupuri.some((g) => g.litri !== null)
    ? rotunjeste(grupuri.reduce((acc, g) => acc + (g.litri ?? 0), 0))
    : null;

  return (
    <details
      open={deschis}
      onToggle={(e) => setDeschis((e.currentTarget as HTMLDetailsElement).open)}
      style={{ border: '1px solid #f0b46a', borderLeft: '5px solid #e8890c', borderRadius: '8px', padding: '0.75rem 1rem' }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        Lucrări în afara parcelelor / fermei, confirmate ({deLa} → {panaLa})
      </summary>
      <p style={{ fontSize: '0.8rem', color: '#666' }}>
        Lucrările utilajelor în afara parcelelor deja confirmate în perioada aleasă mai sus, cu orele și motorina
        consumată. Pentru perioade mai vechi, mărește intervalul (De la / Până la).
      </p>
      {loading && <p>Se încarcă...</p>}
      {eroare && <p style={{ color: '#b00020' }}>{eroare}</p>}
      {!loading && !eroare && grupuri.length === 0 && (
        <p style={{ color: '#666' }}>Nicio lucrare în afara parcelelor confirmată în perioada aleasă.</p>
      )}
      {grupuri.length > 0 && (
        <>
          <p style={{ margin: '0 0 0.5rem' }}>
            Total: <strong>{totalLucru}h</strong> ore de lucru (detectate: {totalDetectate}h) · motorină{' '}
            <strong>{formatLitri(totalLitri)}</strong> · {grupuri.length} lucrări
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {grupuri.map((g) => (
              <div key={g.grup_id} style={{ borderTop: '1px solid #eee', paddingTop: '0.5rem' }}>
                <strong>{g.data}</strong> — {g.utilaj} · {LABEL_OPERATIUNE[g.tip] ?? g.tip}
                <div style={{ fontSize: '0.85rem', color: '#555' }}>
                  {g.oreLucru ?? '—'}h lucrate (detectate {g.oreDetectate}h) · motorină {formatLitri(g.litri)}
                  {g.locatie ? ` · ${g.locatie}` : ''}
                  {g.note ? ` · ${g.note}` : ''}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </details>
  );
}
