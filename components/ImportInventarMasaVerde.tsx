'use client';

// 2026-10-30 (Radu): import inventar masă verde — fișier SW Maps (KML / GeoJSON /
// GPX / CSV / zip / kmz) cu contururile gazonului rămas, numite ca parcelele
// (10, 3 etc.). Se potrivesc cu parcelele fermei după nume (apoi pe hartă, dacă
// numele nu se potrivește) și se salvează ca inventar nou, cu data aleasă.
// NU modifică parcelele (nici conturul, nici suprafața) — doar evidența masei verzi.

import { useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Parcela, polygonLatLngs } from '../lib/parcelaTypes';
import { ariePoligonMp } from '../lib/geo';
import {
  parseazaFisier,
  parseazaArhiva,
  cheieNume,
  esantioaneInterior,
  fractieInPoligon,
  type CandidatPoligon,
} from '../lib/importParcele';

type Rand = {
  c: CandidatPoligon;
  parcelaId: string; // 'ignora' | id parcelă
  nota: string | null;
};

const fmt = (n: number) => Math.round(n).toLocaleString('ro-RO');
const PRAG_SUPRAPUNERE = 0.5;

function azi(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function potrivire(c: CandidatPoligon, parcele: Parcela[]): { parcelaId: string; nota: string | null } {
  if (!c.valid) return { parcelaId: 'ignora', nota: null };
  if (c.sursa === 'Linie') return { parcelaId: 'ignora', nota: 'Linie, nu poligon (ignorată).' };

  if (c.nume) {
    const k = cheieNume(c.nume);
    const dupaNume = k ? parcele.filter((p) => cheieNume(p.nume) === k) : [];
    if (dupaNume.length === 1) return { parcelaId: dupaNume[0].id, nota: null };
    if (dupaNume.length > 1) {
      return { parcelaId: 'ignora', nota: `În fermă există ${dupaNume.length} parcele cu acest nume — alege manual.` };
    }
  }

  // Fără potrivire pe nume: parcela în care se află (cel puțin jumătate din) conturul măsurat.
  const es = esantioaneInterior(c.ring);
  let best: { p: Parcela; f: number } | null = null;
  for (const p of parcele) {
    const ring = polygonLatLngs(p);
    if (ring.length < 3) continue;
    const f = fractieInPoligon(es, ring);
    if (!best || f > best.f) best = { p, f };
  }
  if (best && best.f >= PRAG_SUPRAPUNERE) {
    return {
      parcelaId: best.p.id,
      nota: `Numele „${c.nume || 'fără nume'}” nu se potrivește — potrivit pe hartă: ${Math.round(best.f * 100)}% din contur e în parcela „${best.p.nume}”.`,
    };
  }
  return { parcelaId: 'ignora', nota: 'Nu am găsit parcela cu acest nume — alege-o manual dacă vrei să fie inclusă.' };
}

export default function ImportInventarMasaVerde({
  fermaId,
  parcele,
  onSaved,
}: {
  fermaId: string;
  parcele: Parcela[];
  onSaved: (inventarId: string) => void;
}) {
  const [deschis, setDeschis] = useState(false);
  const [numeFisier, setNumeFisier] = useState('');
  const [format, setFormat] = useState('');
  const [avertismente, setAvertismente] = useState<string[]>([]);
  const [randuri, setRanduri] = useState<Rand[]>([]);
  const [dataInventar, setDataInventar] = useState(azi());
  const [nota, setNota] = useState('');
  const [eroare, setEroare] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [salvez, setSalvez] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setNumeFisier('');
    setFormat('');
    setAvertismente([]);
    setRanduri([]);
    setEroare(null);
    setNota('');
    if (inputRef.current) inputRef.current.value = '';
  }

  function inchide() {
    reset();
    setDeschis(false);
  }

  async function alegeFisier(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setEroare(null);
    setMesaj(null);
    try {
      const eArhiva = /\.(zip|kmz)$/i.test(f.name);
      const rez = eArhiva
        ? await parseazaArhiva(new Uint8Array(await f.arrayBuffer()))
        : parseazaFisier(f.name, await f.text());
      setRanduri(
        rez.candidati.map((c) => {
          const { parcelaId, nota: n } = potrivire(c, parcele);
          return { c, parcelaId, nota: n };
        }),
      );
      setNumeFisier(f.name);
      setFormat(rez.format);
      setAvertismente(rez.avertismente);
    } catch (err) {
      setRanduri([]);
      setEroare(err instanceof Error ? err.message : 'Nu am putut citi fișierul.');
    }
  }

  function schimba(idx: number, parcelaId: string) {
    setRanduri((prev) => prev.map((r, i) => (i === idx ? { ...r, parcelaId } : r)));
  }

  const deSalvat = randuri.filter((r) => r.c.valid && r.parcelaId !== 'ignora');
  const parcelaDeLa = (id: string) => parcele.find((p) => p.id === id);
  const folositeDeMaiMulteOri = new Set<string>();
  {
    const nr = new Map<string, number>();
    for (const r of deSalvat) nr.set(r.parcelaId, (nr.get(r.parcelaId) ?? 0) + 1);
    nr.forEach((n, id) => {
      if (n > 1) folositeDeMaiMulteOri.add(id);
    });
  }

  async function salveaza() {
    if (deSalvat.length === 0 || !dataInventar) return;
    setSalvez(true);
    setEroare(null);
    setMesaj(null);

    const { data: auth } = await supabase.auth.getUser();
    const { data: inv, error: errInv } = await supabase
      .from('inventar_masa_verde')
      .insert({
        ferma_id: fermaId,
        data_inventar: dataInventar,
        nota: nota.trim() || null,
        nume_fisier: numeFisier || null,
        introdus_de: auth.user?.id ?? null,
      })
      .select('id')
      .single();

    if (errInv || !inv) {
      setSalvez(false);
      setEroare(errInv?.message ?? 'Eroare la salvarea inventarului.');
      return;
    }

    const linii = deSalvat.map((r) => {
      const p = parcelaDeLa(r.parcelaId)!;
      const ringLonLat = [...r.c.ring, r.c.ring[0]].map(([lat, lon]) => [lon, lat]);
      const ringParcela = polygonLatLngs(p);
      const totalCalculat = ringParcela.length >= 3 ? ariePoligonMp(ringParcela) : null;
      return {
        inventar_id: inv.id,
        parcela_id: p.id,
        nume_parcela: p.nume,
        suprafata_totala_mp: p.suprafata_mp ?? (totalCalculat !== null ? Math.round(totalCalculat) : null),
        poligon_parcela: ringParcela.length >= 3 ? p.poligon_harta : null,
        suprafata_masa_verde_mp: Math.round(r.c.suprafataMp * 100) / 100,
        poligon_masa_verde: { type: 'Polygon', coordinates: [ringLonLat] },
      };
    });

    const { error: errLinii } = await supabase.from('inventar_masa_verde_parcele').insert(linii);
    if (errLinii) {
      // nu lăsăm un inventar gol: îl ștergem pe cel creat adineauri
      await supabase.from('inventar_masa_verde').delete().eq('id', inv.id);
      setSalvez(false);
      setEroare(`Eroare la salvarea parcelelor: ${errLinii.message}`);
      return;
    }

    setSalvez(false);
    reset();
    setDeschis(false);
    setMesaj(`Inventar salvat: ${linii.length} ${linii.length === 1 ? 'parcelă' : 'parcele'}.`);
    onSaved(inv.id);
  }

  if (!deschis) {
    return (
      <div>
        <button onClick={() => setDeschis(true)} style={{ padding: '0.6rem 1rem', fontWeight: 600 }}>
          📥 Import inventar din SW Maps
        </button>
        {mesaj && <span style={{ marginLeft: '0.75rem', color: '#2e7d32', fontSize: '0.9rem' }}>{mesaj}</span>}
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem', background: '#fff' }}>
      <p style={{ fontWeight: 'bold', marginTop: 0 }}>Import inventar masă verde</p>
      <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
        Exportă din SW Maps contururile gazonului rămas (KML / GeoJSON / GPX / CSV sau arhiva .zip / .kmz), cu parcelele
        numite ca în aplicație (10, 3 etc.). Parcelele fermei <strong>nu se modifică</strong> — importul doar ține
        evidența masei verzi și rămâne în istoric.
      </p>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <label style={{ fontSize: '0.9rem' }}>
          Data inventarului
          <input
            type="date"
            value={dataInventar}
            onChange={(e) => setDataInventar(e.target.value)}
            style={{ display: 'block', padding: '0.4rem', marginTop: '0.2rem' }}
          />
        </label>
        <label style={{ fontSize: '0.9rem', flex: '1 1 220px' }}>
          Notă (opțional)
          <input
            type="text"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            style={{ display: 'block', padding: '0.4rem', marginTop: '0.2rem', width: '100%' }}
          />
        </label>
      </div>

      <input ref={inputRef} type="file" accept=".zip,.kmz,.kml,.geojson,.json,.gpx,.csv,.txt" onChange={(e) => void alegeFisier(e)} />
      {eroare && <p style={{ color: '#b00020' }}>{eroare}</p>}

      {randuri.length > 0 && (
        <>
          <p style={{ fontSize: '0.85rem', color: '#555' }}>
            {numeFisier} — format {format}, {randuri.length} {randuri.length === 1 ? 'poligon găsit' : 'poligoane găsite'};{' '}
            {deSalvat.length} se vor importa.
          </p>
          {avertismente.map((a, i) => (
            <p key={i} style={{ fontSize: '0.85rem', color: '#8a5a00', margin: '0.2rem 0' }}>
              ⚠️ {a}
            </p>
          ))}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th style={{ padding: '0.3rem' }}>Din fișier</th>
                  <th style={{ padding: '0.3rem', textAlign: 'right' }}>Masă verde măsurată</th>
                  <th style={{ padding: '0.3rem' }}>Parcela din aplicație</th>
                  <th style={{ padding: '0.3rem', textAlign: 'right' }}>Suprafață totală parcelă</th>
                </tr>
              </thead>
              <tbody>
                {randuri.map((r, i) => {
                  const p = r.parcelaId !== 'ignora' ? parcelaDeLa(r.parcelaId) : undefined;
                  const depasire = p?.suprafata_mp != null && r.c.valid && r.c.suprafataMp > p.suprafata_mp * 1.02;
                  return (
                    <tr key={r.c.cheie} style={{ borderBottom: '1px solid #eee', verticalAlign: 'top', opacity: r.parcelaId === 'ignora' ? 0.55 : 1 }}>
                      <td style={{ padding: '0.3rem' }}>
                        {r.c.nume || <em style={{ color: '#888' }}>(fără nume)</em>}
                        <div style={{ color: '#888' }}>{r.c.ring.length} puncte</div>
                        {r.nota && <div style={{ color: '#8a5a00' }}>{r.nota}</div>}
                        {r.c.avertismente.map((a, j) => (
                          <div key={j} style={{ color: r.c.valid ? '#8a5a00' : '#b00020' }}>
                            {a}
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: '0.3rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {r.c.valid ? (
                          <>
                            {fmt(r.c.suprafataMp)} mp
                            <div style={{ color: '#888' }}>{(r.c.suprafataMp / 10000).toFixed(2)} ha</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '0.3rem' }}>
                        <select
                          value={r.parcelaId}
                          disabled={!r.c.valid}
                          onChange={(e) => schimba(i, e.target.value)}
                          style={{ padding: '0.3rem', maxWidth: '230px' }}
                        >
                          <option value="ignora">Nu importa</option>
                          {parcele.map((pp) => (
                            <option key={pp.id} value={pp.id}>
                              Parcela {pp.nume}
                            </option>
                          ))}
                        </select>
                        {r.parcelaId !== 'ignora' && folositeDeMaiMulteOri.has(r.parcelaId) && (
                          <div style={{ color: '#8a5a00' }}>Mai multe contururi pe aceeași parcelă — suprafețele se adună.</div>
                        )}
                      </td>
                      <td style={{ padding: '0.3rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {p ? (p.suprafata_mp != null ? `${fmt(p.suprafata_mp)} mp` : '—') : '—'}
                        {depasire && <div style={{ color: '#b00020' }}>Masa verde depășește suprafața parcelei</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button onClick={() => void salveaza()} disabled={salvez || deSalvat.length === 0 || !dataInventar}>
          {salvez ? 'Se salvează...' : `Salvează inventarul (${deSalvat.length} ${deSalvat.length === 1 ? 'parcelă' : 'parcele'})`}
        </button>
        <button onClick={inchide} disabled={salvez}>
          Închide
        </button>
      </div>
    </div>
  );
}
