'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useUserRole } from '../../../lib/useUserRole';
import type { Parcela } from '../../../lib/parcelaTypes';
import ImportInventarMasaVerde from '../../../components/ImportInventarMasaVerde';
import RaportMasaVerde, { STIL_RAPORT_MASA_VERDE } from '../../../components/RaportMasaVerde';
import {
  formatDataLunga,
  formatHa,
  formatMp,
  type ComparatieParcela,
  type Inventar,
  type RandInventar,
} from '../../../lib/inventarMasaVerde';

// 2026-11-13 (Radu): pentru fiecare parcelă din inventarul ales — ultimul inventar
// ANTERIOR (dată strict mai mică) al aceleiași parcele și suprafața de rulouri
// înregistrată ca recoltată între cele două (după data anterioară, până la data
// inventarului inclusiv). Vezi RaportMasaVerde (coloanele de comparație).
type RandAnterior = {
  parcela_id: string | null;
  suprafata_masa_verde_mp: number;
  inventar_masa_verde: { id: string; data_inventar: string; created_at: string } | null;
};

async function calculeazaComparatie(
  fermaId: string,
  dataInventar: string,
  parcelaIds: string[],
): Promise<Record<string, ComparatieParcela>> {
  const rezultat: Record<string, ComparatieParcela> = {};
  if (parcelaIds.length === 0) return rezultat;

  const { data: anterioare } = await supabase
    .from('inventar_masa_verde_parcele')
    .select('parcela_id, suprafata_masa_verde_mp, inventar_masa_verde!inner(id, data_inventar, created_at, ferma_id)')
    .eq('inventar_masa_verde.ferma_id', fermaId)
    .lt('inventar_masa_verde.data_inventar', dataInventar)
    .in('parcela_id', parcelaIds);

  // Pe fiecare parcelă: cel mai recent inventar anterior (la aceeași dată, cel creat ultimul).
  const celMaiRecent = new Map<string, { id: string; data: string; creat: string }>();
  const lista = ((anterioare as unknown as RandAnterior[]) ?? []).filter((r) => r.parcela_id && r.inventar_masa_verde);
  for (const r of lista) {
    const inv = r.inventar_masa_verde!;
    const cur = celMaiRecent.get(r.parcela_id!);
    if (!cur || inv.data_inventar > cur.data || (inv.data_inventar === cur.data && inv.created_at > cur.creat)) {
      celMaiRecent.set(r.parcela_id!, { id: inv.id, data: inv.data_inventar, creat: inv.created_at });
    }
  }
  for (const r of lista) {
    const ales = celMaiRecent.get(r.parcela_id!);
    if (!ales || r.inventar_masa_verde!.id !== ales.id) continue;
    const c = (rezultat[r.parcela_id!] ??= { dataAnterior: ales.data, masaVerdeAnteriorMp: 0, recoltatMp: 0 });
    c.masaVerdeAnteriorMp += Number(r.suprafata_masa_verde_mp);
  }

  const cuAnterior = Object.keys(rezultat);
  if (cuAnterior.length === 0) return rezultat;
  const ceaMaiVeche = cuAnterior.map((id) => rezultat[id].dataAnterior).sort()[0];

  const PAGINA = 1000;
  for (let from = 0; ; from += PAGINA) {
    const { data: recoltari, error } = await supabase
      .from('operatiuni')
      .select('parcela_id, data, cantitate_mp_recoltat')
      .in('parcela_id', cuAnterior)
      .not('cantitate_mp_recoltat', 'is', null)
      .gt('data', ceaMaiVeche)
      .lte('data', dataInventar)
      .order('id')
      .range(from, from + PAGINA - 1);
    if (error) break;
    const randuri = (recoltari as { parcela_id: string; data: string; cantitate_mp_recoltat: number }[]) ?? [];
    for (const o of randuri) {
      const c = rezultat[o.parcela_id];
      if (c && o.data > c.dataAnterior) c.recoltatMp += Number(o.cantitate_mp_recoltat);
    }
    if (randuri.length < PAGINA) break;
  }
  return rezultat;
}

type InventarCuTotal = Inventar & {
  inventar_masa_verde_parcele: { suprafata_masa_verde_mp: number }[];
};

export default function InventarFermaScreen({ fermaId }: { fermaId: string }) {
  const { role, loading: roleLoading } = useUserRole();
  const [fermaNume, setFermaNume] = useState('');
  const [parcele, setParcele] = useState<Parcela[]>([]);
  const [inventare, setInventare] = useState<InventarCuTotal[]>([]);
  const [selectat, setSelectat] = useState<string | null>(null);
  const [randuri, setRanduri] = useState<RandInventar[]>([]);
  const [comparatie, setComparatie] = useState<Record<string, ComparatieParcela>>({});
  const [loading, setLoading] = useState(true);
  const [loadingRaport, setLoadingRaport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incarcaInventare = useCallback(async (alege?: string) => {
    const { data, error: err } = await supabase
      .from('inventar_masa_verde')
      .select('id, ferma_id, data_inventar, nota, nume_fisier, created_at, inventar_masa_verde_parcele(suprafata_masa_verde_mp)')
      .eq('ferma_id', fermaId)
      .order('data_inventar', { ascending: false })
      .order('created_at', { ascending: false });
    if (err) {
      setError(err.message);
      return;
    }
    const lista = (data as unknown as InventarCuTotal[]) ?? [];
    setInventare(lista);
    setSelectat((cur) => alege ?? (cur && lista.some((i) => i.id === cur) ? cur : lista[0]?.id ?? null));
  }, [fermaId]);

  useEffect(() => {
    if (role !== 'admin_central') return;
    void (async () => {
      const [{ data: f }, { data: p, error: pErr }] = await Promise.all([
        supabase.from('ferme').select('nume').eq('id', fermaId).maybeSingle(),
        supabase.from('parcele').select('id,ferma_id,nume,tip_gazon,stadiu,suprafata_mp,poligon_harta').eq('ferma_id', fermaId),
      ]);
      setFermaNume((f?.nume as string) ?? '');
      if (pErr) setError(pErr.message);
      const colator = new Intl.Collator('ro', { numeric: true });
      setParcele(((p as Parcela[]) ?? []).sort((a, b) => colator.compare(a.nume, b.nume)));
      await incarcaInventare();
      setLoading(false);
    })();
  }, [role, fermaId, incarcaInventare]);

  useEffect(() => {
    if (!selectat) {
      setRanduri([]);
      setComparatie({});
      return;
    }
    let activ = true;
    setLoadingRaport(true);
    void (async () => {
      const { data, error: err } = await supabase
        .from('inventar_masa_verde_parcele')
        .select('id, inventar_id, parcela_id, nume_parcela, suprafata_totala_mp, poligon_parcela, suprafata_masa_verde_mp, poligon_masa_verde')
        .eq('inventar_id', selectat);
      if (!activ) return;
      if (err) setError(err.message);
      const randuriNoi = (data as unknown as RandInventar[]) ?? [];
      const invAles = inventare.find((i) => i.id === selectat);
      const ids = Array.from(new Set(randuriNoi.map((r) => r.parcela_id).filter((id): id is string => !!id)));
      const comp = invAles ? await calculeazaComparatie(fermaId, invAles.data_inventar, ids) : {};
      if (!activ) return;
      setRanduri(randuriNoi);
      setComparatie(comp);
      setLoadingRaport(false);
    })();
    return () => {
      activ = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectat]);

  async function stergeInventar(inv: Inventar) {
    const ok = window.confirm(
      `Ștergi inventarul din ${formatDataLunga(inv.data_inventar)}? Parcelele fermei nu sunt afectate, dar raportul acestui inventar se pierde.`,
    );
    if (!ok) return;
    const { error: err } = await supabase.from('inventar_masa_verde').delete().eq('id', inv.id);
    if (err) {
      setError(err.message);
      return;
    }
    setSelectat(null);
    await incarcaInventare();
  }

  if (roleLoading) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Se verifică accesul...</p>
      </main>
    );
  }
  if (role !== 'admin_central') {
    return (
      <main style={{ padding: '2rem' }}>
        <h1>Acces interzis</h1>
        <p>Această secțiune este disponibilă doar pentru admin general.</p>
      </main>
    );
  }

  const inv = inventare.find((i) => i.id === selectat) ?? null;

  return (
    <main style={{ padding: 'clamp(1rem, 4vw, 2rem)', maxWidth: '1000px', margin: '0 auto' }}>
      <style dangerouslySetInnerHTML={{ __html: STIL_RAPORT_MASA_VERDE }} />
      <div className="inventar-ecran">
        <div>
          <Link href="/inventar-masa-verde" style={{ fontSize: '0.9rem' }}>
            ← Toate fermele
          </Link>
          <h1 style={{ margin: '0.25rem 0' }}>Inventar masă verde — {fermaNume || '...'}</h1>
        </div>

        {error && <p style={{ color: '#b00020' }}>{error}</p>}

        {loading ? (
          <p>Se încarcă...</p>
        ) : (
          <>
            <div style={{ margin: '0.75rem 0' }}>
              <ImportInventarMasaVerde
                fermaId={fermaId}
                parcele={parcele}
                onSaved={(id) => {
                  void incarcaInventare(id);
                }}
              />
            </div>

            <div>
              <h2 style={{ fontSize: '1.05rem', marginBottom: '0.4rem' }}>Istoric inventare</h2>
              {inventare.length === 0 ? (
                <p style={{ color: '#666' }}>Nu există niciun inventar pentru această fermă. Importă primul fișier din SW Maps.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                        <th style={{ padding: '0.4rem' }}>Data inventarului</th>
                        <th style={{ padding: '0.4rem', textAlign: 'right' }}>Parcele</th>
                        <th style={{ padding: '0.4rem', textAlign: 'right' }}>Masă verde</th>
                        <th style={{ padding: '0.4rem' }}>Notă / fișier</th>
                        <th style={{ padding: '0.4rem' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {inventare.map((i) => {
                        const total = i.inventar_masa_verde_parcele.reduce((s, r) => s + Number(r.suprafata_masa_verde_mp), 0);
                        const activ = i.id === selectat;
                        return (
                          <tr
                            key={i.id}
                            onClick={() => setSelectat(i.id)}
                            style={{ borderBottom: '1px solid #eee', cursor: 'pointer', background: activ ? '#eef7ee' : undefined }}
                          >
                            <td style={{ padding: '0.4rem', fontWeight: activ ? 700 : 400 }}>{formatDataLunga(i.data_inventar)}</td>
                            <td style={{ padding: '0.4rem', textAlign: 'right' }}>{i.inventar_masa_verde_parcele.length}</td>
                            <td style={{ padding: '0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {formatMp(total)} mp ({formatHa(total)} ha)
                            </td>
                            <td style={{ padding: '0.4rem', color: '#666' }}>{[i.nota, i.nume_fisier].filter(Boolean).join(' · ') || '—'}</td>
                            <td style={{ padding: '0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void stergeInventar(i);
                                }}
                                style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                              >
                                Șterge
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {inv && (
              <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Raport — inventar la {formatDataLunga(inv.data_inventar)}</h2>
                <button onClick={() => window.print()} disabled={loadingRaport || randuri.length === 0} style={{ padding: '0.5rem 1rem', fontWeight: 600 }}>
                  🖨️ Tipărește raportul
                </button>
              </div>
            )}
            {/* Raportul trebuie să fie copil DIRECT al .inventar-ecran: la tipărire se ascunde orice alt copil direct. */}
            {inv && loadingRaport && <p>Se încarcă raportul...</p>}
            {inv && !loadingRaport && (
              <RaportMasaVerde fermaNume={fermaNume} dataInventar={inv.data_inventar} randuri={randuri} nota={inv.nota} comparatie={comparatie} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
