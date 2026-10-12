'use client';

// 2026-10-09 (Radu): import de parcele din coordonate măsurate (SW Maps etc.).
// Citește un fișier KML / GeoJSON / GPX / CSV, arată poligoanele găsite (cu
// suprafața calculată din coordonate), le potrivește cu parcelele existente
// după nume și, la confirmare, salvează contururile cu precizia completă din
// fișier (fără rotunjire, fără simplificare). Doar admin_central (RLS + trigger).

import { useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Parcela, polygonLatLngs, centroidLatLng } from '../lib/parcelaTypes';
import { distantaMetri } from '../lib/geo';
import { parseazaFisier, cheieNume, type CandidatPoligon } from '../lib/importParcele';

export type PreviewImport = { cheie: string; nume: string; ring: [number, number][]; valid: boolean };

type Actiune = 'ignora' | 'nou' | string; // string = id parcelă existentă

type Rand = {
  c: CandidatPoligon;
  actiune: Actiune;
  numeNou: string;
  implicita: Actiune; // propunerea automată (la bifare se revine la ea)
  nota: string | null; // ex. nume duplicat în fermă, poligon departe de ferma curentă
};

// Peste această distanță față de centrul fermei, poligonul e suspect (fișier de la altă fermă?).
const PRAG_DEPARTE_KM = 15;

interface Props {
  fermaId: string;
  parcele: Parcela[];
  centruFerma: [number, number] | null; // [lat, lon] — pentru verificarea „fișier de la altă fermă”
  onPreview: (p: PreviewImport[] | null) => void;
  onPolygonSaved: (parcelaId: string, poligon: Parcela['poligon_harta']) => void;
  onParcelaUpdated: (parcela: Parcela) => void;
  onParcelaAdaugata: (parcela: Parcela) => void;
}

const fmt = (n: number) => Math.round(n).toLocaleString('ro-RO');

function actiuneImplicita(
  c: CandidatPoligon,
  parcele: Parcela[],
  centruFerma: [number, number] | null,
): { actiune: Actiune; nota: string | null } {
  if (!c.valid) return { actiune: 'ignora', nota: null };
  // Liniile (drumuri, canale etc.) din lista de feature-uri nu sunt parcele: ignorate implicit.
  if (c.sursa === 'Linie') return { actiune: 'ignora', nota: 'Linie, nu poligon (ignorată implicit; o poți bifa dacă vrei totuși să fie închisă ca parcelă).' };

  // Poligon departe de centrul fermei -> probabil fișierul altei ferme: nu propunem nicio acțiune.
  if (centruFerma) {
    const centroid = centroidLatLng(c.ring);
    if (centroid) {
      const km = distantaMetri(centroid, centruFerma) / 1000;
      if (km > PRAG_DEPARTE_KM) {
        return {
          actiune: 'ignora',
          nota: `Poligonul e la ~${Math.round(km)} km de centrul acestei ferme — fișier de la altă fermă? (ignorat implicit)`,
        };
      }
    }
  }

  if (c.nume) {
    const k = cheieNume(c.nume);
    const potrivite = k ? parcele.filter((p) => cheieNume(p.nume) === k) : [];
    if (potrivite.length === 1) return { actiune: potrivite[0].id, nota: null };
    if (potrivite.length > 1) {
      return {
        actiune: 'ignora',
        nota: `În fermă există ${potrivite.length} parcele cu acest nume — alege manual care e înlocuită.`,
      };
    }
    return { actiune: 'nou', nota: null };
  }
  return { actiune: 'ignora', nota: null };
}

export default function ImportParceleSwMaps({
  fermaId,
  parcele,
  centruFerma,
  onPreview,
  onPolygonSaved,
  onParcelaUpdated,
  onParcelaAdaugata,
}: Props) {
  const [deschis, setDeschis] = useState(false);
  const [numeFisier, setNumeFisier] = useState('');
  const [format, setFormat] = useState('');
  const [avertismente, setAvertismente] = useState<string[]>([]);
  const [randuri, setRanduri] = useState<Rand[]>([]);
  const [eroare, setEroare] = useState<string | null>(null);
  const [actualizeazaSuprafata, setActualizeazaSuprafata] = useState(false);
  const [salvez, setSalvez] = useState(false);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setNumeFisier('');
    setFormat('');
    setAvertismente([]);
    setRanduri([]);
    setEroare(null);
    setMesaj(null);
    if (inputRef.current) inputRef.current.value = '';
    onPreview(null);
  }

  function inchide() {
    reset();
    setDeschis(false);
  }

  function publicaPreview(r: Rand[]) {
    onPreview(
      r
        .filter((x) => x.c.valid)
        .map((x) => ({
          cheie: x.c.cheie,
          nume:
            x.actiune === 'ignora'
              ? x.c.nume || '(fără nume)'
              : x.actiune === 'nou'
                ? x.numeNou || x.c.nume || '(nou)'
                : parcele.find((p) => p.id === x.actiune)?.nume ?? x.c.nume,
          ring: x.c.ring,
          valid: x.actiune !== 'ignora',
        })),
    );
  }

  async function alegeFisier(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setEroare(null);
    setMesaj(null);
    try {
      const text = await f.text();
      const rez = parseazaFisier(f.name, text);
      const r: Rand[] = rez.candidati.map((c) => {
        const { actiune, nota } = actiuneImplicita(c, parcele, centruFerma);
        return { c, actiune, numeNou: c.nume, implicita: actiune, nota };
      });
      setNumeFisier(f.name);
      setFormat(rez.format);
      setAvertismente(rez.avertismente);
      setRanduri(r);
      publicaPreview(r);
    } catch (err) {
      setRanduri([]);
      onPreview(null);
      setEroare(err instanceof Error ? err.message : 'Nu am putut citi fișierul.');
    }
  }

  function schimba(idx: number, patch: Partial<Rand>) {
    setRanduri((prev) => {
      const next = prev.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      publicaPreview(next);
      return next;
    });
  }

  function bifeaza(idx: number, bifat: boolean) {
    const r = randuri[idx];
    if (!r || !r.c.valid) return;
    schimba(idx, { actiune: bifat ? (r.implicita !== 'ignora' ? r.implicita : 'nou') : 'ignora' });
  }

  function bifeazaToate(bifat: boolean) {
    setRanduri((prev) => {
      const next = prev.map((r) =>
        r.c.valid ? { ...r, actiune: bifat ? (r.implicita !== 'ignora' ? r.implicita : 'nou') : 'ignora' } : r,
      );
      publicaPreview(next);
      return next;
    });
  }

  // O parcelă existentă nu poate fi țintă pentru două rânduri deodată.
  const tinteFolosite = new Map<string, number>();
  randuri.forEach((r) => {
    if (r.actiune !== 'ignora' && r.actiune !== 'nou') {
      tinteFolosite.set(r.actiune, (tinteFolosite.get(r.actiune) ?? 0) + 1);
    }
  });
  const dublura = Array.from(tinteFolosite.values()).some((n) => n > 1);
  const numeNoiGoale = randuri.some((r) => r.actiune === 'nou' && !r.numeNou.trim());
  const deAplicat = randuri.filter((r) => r.c.valid && r.actiune !== 'ignora');
  const suprascrie = deAplicat.filter((r) => {
    if (r.actiune === 'nou') return false;
    const p = parcele.find((x) => x.id === r.actiune);
    return !!p && polygonLatLngs(p).length >= 3;
  });

  async function aplica() {
    if (deAplicat.length === 0 || dublura || numeNoiGoale) return;
    setSalvez(true);
    setEroare(null);
    setMesaj(null);
    let ok = 0;
    const erori: string[] = [];

    for (const r of deAplicat) {
      const ringLonLat = [...r.c.ring, r.c.ring[0]].map(([lat, lon]) => [lon, lat]);
      const poligon = { type: 'Polygon' as const, coordinates: [ringLonLat] };
      const suprafata = Math.round(r.c.suprafataMp);
      try {
        if (r.actiune === 'nou') {
          const { data, error } = await supabase
            .from('parcele')
            .insert({
              ferma_id: fermaId,
              nume: r.numeNou.trim(),
              tip_gazon: null,
              suprafata_mp: suprafata,
              poligon_harta: poligon,
            })
            .select('id,ferma_id,nume,tip_gazon,stadiu,suprafata_mp,poligon_harta')
            .single();
          if (error || !data) throw new Error(error?.message ?? 'eroare la adăugare');
          onParcelaAdaugata(data as Parcela);
        } else {
          const patch: Record<string, unknown> = { poligon_harta: poligon };
          if (actualizeazaSuprafata) patch.suprafata_mp = suprafata;
          const { data, error } = await supabase
            .from('parcele')
            .update(patch)
            .eq('id', r.actiune)
            .select('id,ferma_id,nume,tip_gazon,stadiu,suprafata_mp,poligon_harta')
            .single();
          if (error || !data) throw new Error(error?.message ?? 'eroare la salvare');
          if (actualizeazaSuprafata) onParcelaUpdated(data as Parcela);
          else onPolygonSaved(r.actiune, poligon);
        }
        ok++;
      } catch (err) {
        erori.push(`${r.numeNou || r.c.nume || r.c.cheie}: ${err instanceof Error ? err.message : 'eroare'}`);
      }
    }

    setSalvez(false);
    if (erori.length > 0) {
      setEroare(`Am salvat ${ok} din ${deAplicat.length}. Erori: ${erori.join('; ')}`);
    } else {
      reset();
      setMesaj(`Gata: ${ok} ${ok === 1 ? 'parcelă importată' : 'parcele importate'} cu coordonatele măsurate.`);
    }
  }

  if (!deschis) {
    return (
      <div style={{ marginTop: '0.75rem' }}>
        <button onClick={() => setDeschis(true)} style={{ padding: '0.5rem 0.85rem' }}>
          📥 Importă parcele din SW Maps (KML / GeoJSON / GPX / CSV)
        </button>
        {mesaj && <span style={{ marginLeft: '0.75rem', color: '#2e7d32', fontSize: '0.9rem' }}>{mesaj}</span>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: '0.75rem', border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
      <p style={{ fontWeight: 'bold', marginTop: 0 }}>Import parcele din coordonate măsurate</p>
      <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
        În SW Maps exportă măsurătorile ca <strong>KML</strong> (sau GeoJSON / GPX / CSV), în sistem WGS84 (lat/lon), apoi
        alege fișierul. Numele din fișier se potrivesc automat cu parcelele existente (ex. „P1” = „Parcela 1” = „1”).
        KMZ și Shapefile nu sunt acceptate direct.
      </p>

      <input ref={inputRef} type="file" accept=".kml,.geojson,.json,.gpx,.csv,.txt" onChange={(e) => void alegeFisier(e)} />

      {eroare && <p style={{ color: '#b00020' }}>{eroare}</p>}

      {randuri.length > 0 && (
        <>
          <p style={{ fontSize: '0.85rem', color: '#555' }}>
            {numeFisier} — format {format}, {randuri.length} {randuri.length === 1 ? 'poligon găsit' : 'poligoane găsite'}.
            Previzualizarea (linie întreruptă roșie/portocalie) e pe hartă.
          </p>
          {avertismente.map((a, i) => (
            <p key={i} style={{ fontSize: '0.85rem', color: '#8a5a00', margin: '0.2rem 0' }}>
              ⚠️ {a}
            </p>
          ))}

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.5rem 0' }}>
            <button onClick={() => bifeazaToate(true)} style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>
              Bifează toate
            </button>
            <button onClick={() => bifeazaToate(false)} style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>
              Debifează toate
            </button>
            <span style={{ fontSize: '0.85rem', color: '#555' }}>
              {deAplicat.length} din {randuri.length} se vor importa
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th style={{ padding: '0.3rem' }}>Import</th>
                  <th style={{ padding: '0.3rem' }}>Din fișier</th>
                  <th style={{ padding: '0.3rem', textAlign: 'right' }}>Suprafață măsurată</th>
                  <th style={{ padding: '0.3rem' }}>Ce fac</th>
                  <th style={{ padding: '0.3rem' }}>Suprafață actuală</th>
                </tr>
              </thead>
              <tbody>
                {randuri.map((r, i) => {
                  const tinta = r.actiune !== 'ignora' && r.actiune !== 'nou' ? parcele.find((p) => p.id === r.actiune) : undefined;
                  const arataDif =
                    tinta?.suprafata_mp != null && r.c.valid && tinta.suprafata_mp > 0
                      ? ((r.c.suprafataMp - tinta.suprafata_mp) / tinta.suprafata_mp) * 100
                      : null;
                  return (
                    <tr
                      key={r.c.cheie}
                      style={{ borderBottom: '1px solid #eee', verticalAlign: 'top', opacity: r.actiune === 'ignora' ? 0.55 : 1 }}
                    >
                      <td style={{ padding: '0.3rem', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={r.actiune !== 'ignora'}
                          disabled={!r.c.valid}
                          onChange={(e) => bifeaza(i, e.target.checked)}
                          title={r.c.valid ? 'Bifat = se importă' : 'Poligon invalid — nu se poate importa'}
                        />
                      </td>
                      <td style={{ padding: '0.3rem' }}>
                        {r.c.nume || <em style={{ color: '#888' }}>(fără nume)</em>}
                        <div style={{ color: '#888' }}>{r.c.ring.length} puncte</div>
                        {r.nota && <div style={{ color: '#b00020' }}>{r.nota}</div>}
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
                          value={r.actiune}
                          disabled={!r.c.valid}
                          onChange={(e) => schimba(i, { actiune: e.target.value })}
                          style={{ padding: '0.3rem', maxWidth: '230px' }}
                        >
                          <option value="ignora">Ignoră</option>
                          <option value="nou">➕ Parcelă nouă</option>
                          {parcele.map((p) => (
                            <option key={p.id} value={p.id}>
                              Înlocuiește conturul: {p.nume}
                              {polygonLatLngs(p).length >= 3 ? ' (are contur)' : ''}
                            </option>
                          ))}
                        </select>
                        {r.actiune === 'nou' && (
                          <input
                            type="text"
                            value={r.numeNou}
                            onChange={(e) => schimba(i, { numeNou: e.target.value })}
                            placeholder="Numele parcelei noi"
                            style={{ display: 'block', marginTop: '0.3rem', padding: '0.3rem', width: '100%', maxWidth: '230px' }}
                          />
                        )}
                      </td>
                      <td style={{ padding: '0.3rem', whiteSpace: 'nowrap' }}>
                        {tinta ? (
                          <>
                            {tinta.suprafata_mp != null ? `${fmt(tinta.suprafata_mp)} mp` : '—'}
                            {arataDif !== null && (
                              <div style={{ color: Math.abs(arataDif) > 5 ? '#b00020' : '#888' }}>
                                {arataDif >= 0 ? '+' : ''}
                                {arataDif.toFixed(1)}% față de măsurat
                              </div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <label style={{ display: 'block', marginTop: '0.75rem', fontSize: '0.9rem' }}>
            <input
              type="checkbox"
              checked={actualizeazaSuprafata}
              onChange={(e) => setActualizeazaSuprafata(e.target.checked)}
              style={{ marginRight: '0.4rem' }}
            />
            Actualizează și suprafața (mp) a parcelelor existente cu cea calculată din măsurătoare (parcelele noi o primesc oricum)
          </label>

          {dublura && (
            <p style={{ color: '#b00020', fontSize: '0.85rem' }}>
              Aceeași parcelă e aleasă la două poligoane — corectează înainte de import.
            </p>
          )}
          {numeNoiGoale && (
            <p style={{ color: '#b00020', fontSize: '0.85rem' }}>Completează numele pentru parcelele noi.</p>
          )}
          {suprascrie.length > 0 && (
            <p style={{ color: '#8a5a00', fontSize: '0.85rem' }}>
              ⚠️ {suprascrie.length} {suprascrie.length === 1 ? 'parcelă are' : 'parcele au'} deja contur desenat — va fi înlocuit
              (activitățile și istoricul rămân neschimbate).
            </p>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button onClick={() => void aplica()} disabled={salvez || deAplicat.length === 0 || dublura || numeNoiGoale}>
          {salvez ? 'Import...' : `Importă ${deAplicat.length} ${deAplicat.length === 1 ? 'parcelă' : 'parcele'}`}
        </button>
        <button onClick={inchide} disabled={salvez}>
          Închide
        </button>
      </div>
    </div>
  );
}
