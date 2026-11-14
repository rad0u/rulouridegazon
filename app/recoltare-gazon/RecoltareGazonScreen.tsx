'use client';

// 2026-11-14 (Radu): „Recoltare gazon" — raport de control pe utilajele de
// recoltare (utilaje.este_utilaj_recoltare = true) ale unei ferme, pe un
// interval ales: ORE de motor, MOTORINĂ consumată, MP RECOLTAȚI declarați, pe
// fiecare utilaj și zi. Scop (cerut după investigația F5 Săbăreni, parcelele
// 3 și 10, inventarele 30.10 → 13.11): să se vadă imediat zilele în care
// utilajul a lucrat (ore + motorină din senzor/GPS, independente de șeful de
// fermă) dar recoltarea nu e declarată, și sesiunile GPS detectate dar încă
// NEVALIDATE în „Activități parcele".
//
// Surse (fără schimbări de backend):
//  - mp declarați: `operatiuni` tip='Recoltare' pe utilajele de recoltare ale
//    fermei (confirmate în Activități parcele), cu parcela;
//  - ore + motorină pe zi: edge function `get-combustibil-report`
//    (`consum_zilnic`) — bilanț de masă pe citiri filtrate (elimină valorile
//    peste capacitatea rezervorului, ex. codurile de eroare 6553,2 ale sondei
//    Autostack, și glitch-urile tranzitorii, ex. 0 L);
//  - sesiuni nevalidate: edge function `get-sesiuni-detectate` (sesiunile
//    deja confirmate nu mai apar acolo — deduplicare pe server).
//
// „mp estimați": pe fiecare utilaj, randamentul mediu (mp declarați / oră de
// motor) din zilele cu recoltare declarată, aplicat zilelor în care utilajul a
// lucrat (≥ PRAG_ORE_ZI_LUCRATA) fără mp declarați. E o estimare orientativă,
// nu o măsurătoare — utilă ca ordin de mărime pentru diferențele de inventar.
//
// Acces: doar admin_central (ca și get-combustibil-report).

import { useEffect, useState } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';

// O zi cu mai puțin de atât (ore de motor) nu e considerată „zi lucrată".
const PRAG_ORE_ZI_LUCRATA = 1;
// Cantitate declarată sub acest prag = valoare de umplutură (ex. „1 mp").
const PRAG_MP_SUSPECT = 10;

type Utilaj = { id: string; nume: string; tanc_capacitate_litri: number | null };

type RandOperatiune = {
  data: string;
  utilaj_id: string;
  cantitate_mp_recoltat: number | null;
  ore_lucru: number | null;
  parcele: { nume: string } | null;
};

type ZiConsum = { data: string; consum_litri: number; ore_functionare: number; consum_pe_ora: number | null };
type RezultatCombustibil = { utilaj_id: string; consum_zilnic?: ZiConsum[]; eroare?: unknown };

type Sesiune = {
  utilaj_id: string;
  utilaj_recoltare: boolean;
  parcela_nume: string;
  in_afara?: boolean;
  inceput: string;
  sfarsit: string;
  ore: number;
  litri_combustibil: number | null;
};

type RandZi = {
  zi: string;
  ore: number | null; // ore motor (senzor/GPS)
  litri: number | null;
  mp: number; // mp declarați
  nrInregistrari: number;
  nrSuspecte: number; // înregistrări cu mp < PRAG_MP_SUSPECT
  parcele: { nume: string; mp: number }[];
  nevalidateNr: number;
  nevalidateOre: number;
  mpEstimat: number | null; // doar pentru zile lucrate fără mp declarați
};

type RaportUtilaj = {
  utilaj: Utilaj;
  zile: RandZi[];
  totalOre: number;
  totalLitri: number;
  totalMp: number;
  randament: number | null; // mp / oră motor, din zilele cu mp declarați
  zileFaraMp: number;
  mpEstimatNedeclarat: number;
  nevalidateNr: number;
  areDateCombustibil: boolean;
};

const nf0 = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtZiLocala = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' });

function ziLocala(iso: string) {
  return fmtZiLocala.format(new Date(iso));
}
function formatZi(iso: string) {
  const [an, luna, zi] = iso.split('-').map(Number);
  return new Date(an, luna - 1, zi).toLocaleDateString('ro-RO', { weekday: 'short', day: '2-digit', month: 'short' });
}
function aziISO() {
  return fmtZiLocala.format(new Date());
}
function acumZileISO(n: number) {
  return fmtZiLocala.format(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}
function cel(n: number | null, f: Intl.NumberFormat = nf1) {
  return n === null ? '—' : f.format(n);
}

async function apelFunctie<T>(nume: string, params: Record<string, string>, token: string | undefined): Promise<T> {
  const res = await fetch(`${supabaseUrl}/functions/v1/${nume}?${new URLSearchParams(params).toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Eroare ${res.status} la ${nume}`);
  return json as T;
}

export default function RecoltareGazonScreen() {
  const { role, loading: roleLoading } = useUserRole();

  const [ferme, setFerme] = useState<{ id: string; nume: string }[]>([]);
  const [fermaId, setFermaId] = useState('');
  const [deLa, setDeLa] = useState(acumZileISO(30));
  const [panaLa, setPanaLa] = useState(aziISO());
  const [raport, setRaport] = useState<RaportUtilaj[] | null>(null);
  const [avertismente, setAvertismente] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== 'admin_central') return;
    void supabase
      .from('ferme')
      .select('id,nume')
      .order('nume')
      .then(({ data }) => setFerme((data as { id: string; nume: string }[]) ?? []));
  }, [role]);

  async function genereaza() {
    if (!fermaId) return setError('Alege o fermă.');
    if (deLa > panaLa) return setError('Data de început trebuie să fie înainte de data de sfârșit.');
    setLoading(true);
    setError(null);
    setAvertismente([]);
    setRaport(null);

    const avert: string[] = [];

    // 1. Utilajele de recoltare ale fermei
    const { data: utilajeData, error: errU } = await supabase
      .from('utilaje')
      .select('id,nume,tanc_capacitate_litri')
      .eq('ferma_id', fermaId)
      .eq('este_utilaj_recoltare', true)
      .order('nume');
    if (errU) {
      setLoading(false);
      return setError(errU.message);
    }
    const utilaje = (utilajeData as Utilaj[]) ?? [];
    if (utilaje.length === 0) {
      setLoading(false);
      setRaport([]);
      return;
    }
    const ids = utilaje.map((u) => u.id);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    // 2. În paralel: recoltări declarate, combustibil/ore, sesiuni nevalidate
    const [opRes, combRes, sesRes] = await Promise.allSettled([
      supabase
        .from('operatiuni')
        .select('data,utilaj_id,cantitate_mp_recoltat,ore_lucru,parcele(nume)')
        .eq('tip', 'Recoltare')
        .in('utilaj_id', ids)
        .gte('data', deLa)
        .lte('data', panaLa)
        .order('data')
        .limit(5000),
      apelFunctie<{ rezultate: RezultatCombustibil[] }>('get-combustibil-report', { de_la: deLa, pana_la: panaLa }, token),
      apelFunctie<{ sesiuni: Sesiune[] }>('get-sesiuni-detectate', { ferma_id: fermaId, de_la: deLa, pana_la: panaLa }, token),
    ]);

    let operatiuni: RandOperatiune[] = [];
    if (opRes.status === 'fulfilled' && !opRes.value.error) {
      operatiuni = (opRes.value.data as unknown as RandOperatiune[]) ?? [];
    } else {
      setLoading(false);
      const msg = opRes.status === 'fulfilled' ? opRes.value.error?.message : String(opRes.reason);
      return setError(`Eroare la citirea recoltărilor: ${msg}`);
    }

    const consumPeUtilaj = new Map<string, Map<string, ZiConsum>>();
    if (combRes.status === 'fulfilled') {
      for (const r of combRes.value.rezultate ?? []) {
        if (!ids.includes(r.utilaj_id) || !r.consum_zilnic) continue;
        consumPeUtilaj.set(r.utilaj_id, new Map(r.consum_zilnic.map((z) => [z.data, z])));
      }
    } else {
      avert.push(`Orele și motorina nu s-au putut încărca (${(combRes.reason as Error).message}). Raportul arată doar mp declarați.`);
    }

    const sesiuni: Sesiune[] = [];
    if (sesRes.status === 'fulfilled') {
      for (const s of sesRes.value.sesiuni ?? []) if (ids.includes(s.utilaj_id)) sesiuni.push(s);
    } else {
      avert.push(`Sesiunile nevalidate nu s-au putut încărca (${(sesRes.reason as Error).message}).`);
    }

    // 3. Construire raport pe utilaj → zi
    const rezultat: RaportUtilaj[] = utilaje.map((u) => {
      const zile = new Map<string, RandZi>();
      const zi = (cheie: string) => {
        let z = zile.get(cheie);
        if (!z) {
          z = { zi: cheie, ore: null, litri: null, mp: 0, nrInregistrari: 0, nrSuspecte: 0, parcele: [], nevalidateNr: 0, nevalidateOre: 0, mpEstimat: null };
          zile.set(cheie, z);
        }
        return z;
      };

      const consum = consumPeUtilaj.get(u.id);
      if (consum) {
        for (const c of consum.values()) {
          if (c.data < deLa || c.data > panaLa) continue;
          if (c.ore_functionare <= 0 && c.consum_litri <= 0) continue;
          const z = zi(c.data);
          z.ore = c.ore_functionare;
          z.litri = c.consum_litri;
        }
      }

      for (const o of operatiuni.filter((x) => x.utilaj_id === u.id)) {
        const cant = Number(o.cantitate_mp_recoltat ?? 0);
        const z = zi(o.data);
        z.nrInregistrari += 1;
        if (cant < PRAG_MP_SUSPECT) z.nrSuspecte += 1;
        z.mp += cant;
        const numeP = o.parcele?.nume ?? '?';
        const p = z.parcele.find((x) => x.nume === numeP);
        if (p) p.mp += cant;
        else z.parcele.push({ nume: numeP, mp: cant });
      }

      for (const s of sesiuni.filter((x) => x.utilaj_id === u.id)) {
        const z = zi(ziLocala(s.inceput));
        z.nevalidateNr += 1;
        z.nevalidateOre += Number(s.ore ?? 0);
      }

      const lista = Array.from(zile.values()).sort((a, b) => (a.zi < b.zi ? -1 : 1));

      // randament: mp / oră motor, din zilele cu mp declarați reali și ore măsurate
      let mpRef = 0;
      let oreRef = 0;
      for (const z of lista) {
        if (z.mp >= PRAG_MP_SUSPECT && z.ore && z.ore >= PRAG_ORE_ZI_LUCRATA) {
          mpRef += z.mp;
          oreRef += z.ore;
        }
      }
      const randament = oreRef > 0 ? mpRef / oreRef : null;

      for (const z of lista) z.parcele.sort((a, b) => b.mp - a.mp);

      return {
        utilaj: u,
        zile: lista,
        totalOre: lista.reduce((s, z) => s + (z.ore ?? 0), 0),
        totalLitri: lista.reduce((s, z) => s + (z.litri ?? 0), 0),
        totalMp: lista.reduce((s, z) => s + z.mp, 0),
        randament,
        zileFaraMp: 0,
        mpEstimatNedeclarat: 0,
        nevalidateNr: lista.reduce((s, z) => s + z.nevalidateNr, 0),
        areDateCombustibil: !!consum,
      };
    });

    // 4. Zile lucrate fără recoltare declarată. Fiecare utilaj de recoltare se
    // judecă separat (Radu, 14.11: la F5, Autostack intră în teren când Steyr
    // 4100 Kompakt nu face față — NU lucrează în tandem, recoltarea fiecăruia
    // trebuie declarată pe el).
    for (const r of rezultat) {
      for (const z of r.zile) {
        if ((z.ore ?? 0) < PRAG_ORE_ZI_LUCRATA || z.mp >= PRAG_MP_SUSPECT) continue;
        r.zileFaraMp += 1;
        if (r.randament !== null) {
          z.mpEstimat = Math.round((z.ore as number) * r.randament);
          r.mpEstimatNedeclarat += z.mpEstimat;
        }
      }
    }

    if (combRes.status === 'fulfilled') {
      for (const r of rezultat) {
        if (!r.areDateCombustibil) {
          avert.push(`${r.utilaj.nume}: fără date de combustibil (utilaj necalibrat — lipsește capacitatea rezervorului — sau fără citiri în interval).`);
        }
      }
    }

    setAvertismente(avert);
    setRaport(rezultat);
    setLoading(false);
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

  const totalMp = raport?.reduce((s, r) => s + r.totalMp, 0) ?? 0;
  const totalEstimat = raport?.reduce((s, r) => s + r.mpEstimatNedeclarat, 0) ?? 0;
  const totalNevalidate = raport?.reduce((s, r) => s + r.nevalidateNr, 0) ?? 0;

  const th: React.CSSProperties = { padding: '0.35rem 0.4rem', fontWeight: 600, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '0.35rem 0.4rem', verticalAlign: 'top' };
  const num: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };

  return (
    <main style={{ padding: 'clamp(1rem, 4vw, 2rem)', maxWidth: '1150px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Recoltare gazon</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Utilajele de recoltare ale fermei, pe zile: ore de motor și motorină (din senzor/GPS) față de mp recoltați declarați în „Activități
        parcele". Roșu = utilajul a lucrat, dar nu e declarată recoltare. Portocaliu = sesiuni detectate, încă nevalidate.
      </p>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', margin: '1rem 0' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem' }}>
          Ferma
          <select
            value={fermaId}
            onChange={(e) => setFermaId(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '180px' }}
          >
            <option value="">Alege ferma</option>
            {ferme.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nume}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem' }}>
          De la
          <input type="date" value={deLa} max={panaLa} onChange={(e) => setDeLa(e.target.value)} style={{ padding: '0.45rem', borderRadius: '6px', border: '1px solid #ccc' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem' }}>
          Până la
          <input type="date" value={panaLa} min={deLa} onChange={(e) => setPanaLa(e.target.value)} style={{ padding: '0.45rem', borderRadius: '6px', border: '1px solid #ccc' }} />
        </label>
        <button
          onClick={() => void genereaza()}
          disabled={loading}
          style={{ padding: '0.6rem 1.2rem', fontWeight: 600, borderRadius: '6px', border: '1px solid #ccc', background: '#eaf7ea', cursor: loading ? 'default' : 'pointer' }}
        >
          {loading ? 'Se încarcă... (poate dura până la un minut)' : 'Generează'}
        </button>
      </div>

      {error && <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>}
      {avertismente.map((a, i) => (
        <p key={i} style={{ color: '#8a5a00', background: '#fff6e0', padding: '0.6rem 0.75rem', borderRadius: '6px', margin: '0 0 0.5rem' }}>
          {a}
        </p>
      ))}

      {raport && raport.length === 0 && <p style={{ color: '#666' }}>Ferma aleasă nu are utilaje marcate „de recoltare".</p>}

      {raport && raport.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', margin: '0 0 1rem', fontSize: '1rem' }}>
            <span>
              Recoltat declarat: <strong>{nf0.format(totalMp)} mp</strong>
            </span>
            {totalEstimat > 0 && (
              <span style={{ color: '#b00020' }}>
                Estimat nedeclarat: <strong>~{nf0.format(totalEstimat)} mp</strong>
              </span>
            )}
            {totalNevalidate > 0 && (
              <span style={{ color: '#a35a00' }}>
                Sesiuni nevalidate: <strong>{totalNevalidate}</strong>
              </span>
            )}
          </div>

          {raport.map((r) => (
            <section key={r.utilaj.id} style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <strong style={{ fontSize: '1.1rem' }}>{r.utilaj.nume}</strong>
                <span style={{ color: '#444', fontSize: '0.9rem' }}>
                  {nf1.format(r.totalOre)} h · {nf0.format(r.totalLitri)} L
                  {r.totalOre > 0 ? ` (${nf1.format(r.totalLitri / r.totalOre)} L/h)` : ''} · <strong>{nf0.format(r.totalMp)} mp declarați</strong>
                  {r.randament !== null ? ` · randament ${nf0.format(r.randament)} mp/h` : ''}
                </span>
              </div>
              {(r.zileFaraMp > 0 || r.nevalidateNr > 0) && (
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem' }}>
                  {r.zileFaraMp > 0 && (
                    <span style={{ color: '#b00020', marginRight: '1rem' }}>
                      {r.zileFaraMp} {r.zileFaraMp === 1 ? 'zi lucrată' : 'zile lucrate'} fără recoltare declarată
                      {r.mpEstimatNedeclarat > 0
                        ? ` (estimat ~${nf0.format(r.mpEstimatNedeclarat)} mp)`
                        : r.randament === null
                          ? ' (fără estimare: utilajul nu are nicio zi cu recoltare declarată în interval)'
                          : ''}
                    </span>
                  )}
                  {r.nevalidateNr > 0 && <span style={{ color: '#a35a00' }}>{r.nevalidateNr} sesiuni nevalidate în Activități parcele</span>}
                </p>
              )}

              {r.zile.length === 0 ? (
                <p style={{ color: '#666', margin: 0 }}>Nicio activitate în interval.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                        <th style={th}>Zi</th>
                        <th style={{ ...th, textAlign: 'right' }}>Ore motor</th>
                        <th style={{ ...th, textAlign: 'right' }}>Motorină (L)</th>
                        <th style={{ ...th, textAlign: 'right' }}>L/h</th>
                        <th style={{ ...th, textAlign: 'right' }}>mp declarați</th>
                        <th style={{ ...th, textAlign: 'right' }}>mp/h</th>
                        <th style={th}>Parcele</th>
                        <th style={th}>Observații</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.zile.map((z) => {
                        const lucrata = (z.ore ?? 0) >= PRAG_ORE_ZI_LUCRATA;
                        const faraMp = lucrata && z.mp < PRAG_MP_SUSPECT;
                        const bg = faraMp ? '#fdecea' : z.nevalidateNr > 0 ? '#fff3e0' : undefined;
                        const obs: string[] = [];
                        if (faraMp) obs.push(z.mpEstimat !== null ? `fără recoltare declarată (estimat ~${nf0.format(z.mpEstimat)} mp)` : 'fără recoltare declarată');
                        if (z.nevalidateNr > 0) obs.push(`${z.nevalidateNr} sesiuni nevalidate (${nf1.format(z.nevalidateOre)} h)`);
                        if (z.nrSuspecte > 0) obs.push(`${z.nrSuspecte} înregistr. sub ${PRAG_MP_SUSPECT} mp`);
                        return (
                          <tr key={z.zi} style={{ borderBottom: '1px solid #eee', background: bg }}>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatZi(z.zi)}</td>
                            <td style={num}>{cel(z.ore)}</td>
                            <td style={num}>{cel(z.litri, nf0)}</td>
                            <td style={num}>{z.ore && z.litri !== null && z.ore > 0 ? nf1.format(z.litri / z.ore) : '—'}</td>
                            <td style={{ ...num, fontWeight: 600 }}>{z.nrInregistrari > 0 ? nf0.format(z.mp) : '—'}</td>
                            <td style={num}>{z.mp >= PRAG_MP_SUSPECT && z.ore ? nf0.format(z.mp / z.ore) : '—'}</td>
                            <td style={{ ...td, color: '#555' }}>
                              {z.parcele.map((p) => (
                                <span key={p.nume} style={{ display: 'inline-block', marginRight: '0.6rem' }}>
                                  {p.nume}: {nf0.format(p.mp)}
                                </span>
                              ))}
                            </td>
                            <td style={{ ...td, color: faraMp ? '#b00020' : z.nevalidateNr > 0 || z.nrSuspecte > 0 ? '#8a5a00' : '#666' }}>{obs.join(' · ')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}

          <p style={{ color: '#777', fontSize: '0.8rem' }}>
            Ore motor și motorină: din senzorul de nivel și GPS (contact sau mișcare reală), aceeași metodă ca raportul Combustibil; citirile
            imposibile ale sondei (peste capacitatea rezervorului, căderi bruște la 0) sunt ignorate. „Estimat" = orele zilei × randamentul mediu al
            utilajului din zilele cu recoltare declarată în interval — orientativ. O zi „lucrată" are cel puțin {PRAG_ORE_ZI_LUCRATA} h de motor.
          </p>
        </>
      )}
    </main>
  );
}
