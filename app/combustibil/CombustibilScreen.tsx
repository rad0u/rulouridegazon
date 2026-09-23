'use client';

import { Fragment, useState } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';

type Eveniment = { data_ora: string; delta_litri: number };

// Ore de funcționare (contact SAU mișcare GPS) în intervalul în care s-a produs
// scăderea — informativ, nu mai alimentează niciun steag (v12). null înseamnă
// că nu existau deloc date de contact/poziție în interval, iar valoarea a fost
// calculată pe ore calendaristice (fallback pe modelul vechi).
type EvenimentScadereMare = Eveniment & { ore_functionare: number | null };

// Consum total + ore de funcționare, pe zi locală (România) — Radu, 2026-09-22
// (v12): perioadă de teste până pe 30 septembrie 2026, fără steaguri roșii —
// se afișează doar cifrele, ca să adunăm date reale de consum per utilaj.
// O zi cu 0 ore de funcționare are consum_pe_ora null (nu calculăm nimic).
type ZiConsum = {
  data: string;
  consum_litri: number;
  ore_functionare: number;
  consum_pe_ora: number | null;
};

type RezultatUtilaj = {
  utilaj_id: string;
  nume: string;
  ferma_nume: string | null;
  tanc_capacitate_litri: number;
  nr_citiri: number;
  prima_citire: string | null;
  ultima_citire: string | null;
  consum_normal_litri: number;
  realimentat_litri: number;
  realimentari: Eveniment[];
  scaderi_mari: EvenimentScadereMare[];
  consum_zilnic: ZiConsum[];
  // v12: consum mediu ponderat pe oră = suma consumului pe zilele cu ore de
  // funcționare > 0, împărțită la suma acelorași ore. null dacă utilajul n-a
  // funcționat deloc în perioada aleasă.
  consum_mediu_ponderat_l_pe_ora: number | null;
  manual_litri: number;
  manual_nr: number;
  diferenta_litri: number;
  diferenta_semnificativa: boolean;
  eroare?: string;
};

type UtilajNecalibrat = {
  utilaj_id: string;
  nume: string;
  ferma_nume: string | null;
  manual_litri: number;
  manual_nr: number;
};

// v14: `zile` e null când raportul a fost cerut pe un interval CUSTOM
// (de_la/pana_la) în loc de presetul „Ultimele N zile". `pana_la` e null
// când intervalul custom nu are dată de sfârșit (merge până acum).
type Raport = {
  zile: number | null;
  de_la: string;
  pana_la: string | null;
  rezultate: RezultatUtilaj[];
  necalibrate: UtilajNecalibrat[];
};

function formatData(data: string | null) {
  if (!data) return '—';
  return new Date(data).toLocaleString('ro-RO');
}

function motivScadere(e: EvenimentScadereMare): string {
  if (e.ore_functionare === null) {
    return 'fără date de contact — calculat pe timp calendaristic';
  }
  if (e.ore_functionare === 0) {
    return 'utilaj staționat tot intervalul';
  }
  return `a funcționat ${e.ore_functionare}h în interval`;
}

function formatDataZi(data: string) {
  return new Date(`${data}T12:00:00`).toLocaleDateString('ro-RO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

// v14: eticheta perioadei active a raportului, pentru afișat sub controale —
// fie „Ultimele N zile", fie intervalul custom ales (de_la – pana_la, sau
// „de_la – azi" dacă n-a fost aleasă o dată de sfârșit).
function formatPerioada(r: Raport): string {
  if (r.zile !== null) return `Ultimele ${r.zile} zile`;
  const deLa = new Date(r.de_la).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!r.pana_la) return `${deLa} — azi`;
  // pana_la e limita EXCLUSIVĂ (miezul nopții al zilei următoare) — scădem o
  // zi pentru afișare, ca să arătăm ultima zi inclusă, nu prima exclusă.
  const panaLaInclusiv = new Date(new Date(r.pana_la).getTime() - 12 * 3_600_000);
  const panaLa = panaLaInclusiv.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
  return deLa === panaLa ? deLa : `${deLa} — ${panaLa}`;
}

export default function CombustibilScreen() {
  const [zile, setZile] = useState(7);
  // v14: interval custom, ales dintr-un calendar — are prioritate față de
  // presetul `zile` cât timp `deLaCustom` e completat. Vezi nota v14 din
  // get-combustibil-report/index.ts (context: calibrarea sondelor din
  // săptămâna 14-21 septembrie 2026 contaminează perioadele care o includ).
  const [deLaCustom, setDeLaCustom] = useState('');
  const [panaLaCustom, setPanaLaCustom] = useState('');
  const [raport, setRaport] = useState<Raport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandat, setExpandat] = useState<string | null>(null);

  async function incarca(opts?: { zile?: number; deLa?: string; panaLa?: string }) {
    setLoading(true);
    setError(null);

    const deLaDeFolosit = opts?.deLa ?? (opts ? undefined : deLaCustom || undefined);
    const panaLaDeFolosit = opts?.panaLa ?? (opts ? undefined : panaLaCustom || undefined);

    const params = new URLSearchParams();
    if (deLaDeFolosit) {
      params.set('de_la', deLaDeFolosit);
      if (panaLaDeFolosit) params.set('pana_la', panaLaDeFolosit);
    } else {
      params.set('zile', String(opts?.zile ?? zile));
    }

    // supabase-js functions.invoke() nu trece query params ușor pe GET, deci
    // apelăm direct endpointul funcției prin fetch, cu tokenul sesiunii curente.
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/get-combustibil-report?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      setLoading(false);

      if (!res.ok) {
        setError(json?.error ?? 'Eroare la încărcarea raportului.');
        return;
      }

      setRaport(json as Raport);
    } catch (e) {
      setLoading(false);
      setError('Eroare de rețea la încărcarea raportului.');
    }
  }

  function aplicaPreset(v: number) {
    setZile(v);
    setDeLaCustom('');
    setPanaLaCustom('');
    void incarca({ zile: v });
  }

  function aplicaIntervalCustom() {
    if (!deLaCustom) return;
    void incarca({ deLa: deLaCustom, panaLa: panaLaCustom || undefined });
  }

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: 'clamp(0.75rem, 3vw, 1.5rem)',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Raport combustibil</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={zile}
            onChange={(e) => aplicaPreset(Number(e.target.value))}
            style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
          >
            <option value={7}>Ultimele 7 zile</option>
            <option value={14}>Ultimele 14 zile</option>
            <option value={30}>Ultimele 30 zile</option>
          </select>

          {/* v14: interval custom dintr-un calendar — vezi nota v14 din
              get-combustibil-report/index.ts. „Până la" e opțional (fără el,
              intervalul merge până acum). */}
          <span style={{ fontSize: '0.8rem', color: '#666' }}>sau interval:</span>
          <input
            type="date"
            value={deLaCustom}
            onChange={(e) => setDeLaCustom(e.target.value)}
            style={{ padding: '0.45rem', borderRadius: '6px', border: '1px solid #ccc' }}
          />
          <span style={{ fontSize: '0.8rem', color: '#666' }}>–</span>
          <input
            type="date"
            value={panaLaCustom}
            onChange={(e) => setPanaLaCustom(e.target.value)}
            min={deLaCustom || undefined}
            style={{ padding: '0.45rem', borderRadius: '6px', border: '1px solid #ccc' }}
          />
          <button
            onClick={aplicaIntervalCustom}
            disabled={loading || !deLaCustom}
            style={{
              padding: '0.45rem 0.8rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: !deLaCustom ? '#f5f5f5' : '#fff',
              cursor: !deLaCustom || loading ? 'default' : 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Aplică
          </button>

          <button
            onClick={() => void incarca()}
            disabled={loading}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '6px',
              border: '1px solid #ccc',
              background: loading ? '#eee' : '#f5f5f5',
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading ? 'Se încarcă...' : 'Reîncarcă'}
          </button>
        </div>
      </div>

      {raport && (
        <p style={{ fontSize: '0.8rem', color: '#888', margin: 0 }}>Perioadă afișată: {formatPerioada(raport)}</p>
      )}

      <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
        Perioadă de teste până pe 30 septembrie 2026: raportul arată consumul calculat, fără steaguri
        roșii automate — adunăm date reale înainte să calibrăm un prag de plauzibilitate. Coloana
        „Consum mediu (L/h)" e consumul mediu PONDERAT pe oră, calculat doar din zilele în care utilajul
        chiar a funcționat (o zi cu 0 ore de funcționare nu intră în calcul). Raportul se bazează doar pe
        sondă — nu mai compară cu alimentările înregistrate manual de operatoare. Apasă „Detalii" pentru
        defalcarea zi cu zi a fiecărui utilaj.
        <br />
        <strong>Notă calibrare:</strong> săptămâna 14–21 septembrie 2026 s-a calibrat sonda pe fiecare
        utilaj — perioada de calibrare arată consumuri complet nerealiste (rezervorul era umplut în pași
        cunoscuți, cu utilajul staționat). Pentru cifre de încredere, alege intervalul custom de mai sus
        începând cu 22 septembrie 2026.
      </p>

      {error && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>
          {error}
        </p>
      )}

      {!raport && !loading && !error && (
        <p>Apasă „Reîncarcă” pentru a vedea raportul de consum.</p>
      )}

      {raport && raport.rezultate.length === 0 && (
        <p>Niciun utilaj calibrat încă — vezi nota de mai jos.</p>
      )}

      {raport && raport.rezultate.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '0.4rem' }}>Utilaj</th>
                <th style={{ padding: '0.4rem' }}>Fermă</th>
                <th style={{ padding: '0.4rem' }}>Consum normal</th>
                <th style={{ padding: '0.4rem' }}>Realimentat (sondă)</th>
                <th style={{ padding: '0.4rem' }}>Scăderi mari</th>
                <th style={{ padding: '0.4rem' }}>Consum mediu (L/h)</th>
                <th style={{ padding: '0.4rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {raport.rezultate.map((r) => {
                const areScaderi = r.scaderi_mari.length > 0;
                const deschis = expandat === r.utilaj_id;

                return (
                  <Fragment key={r.utilaj_id}>
                    <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.4rem' }}>{r.nume}</td>
                      <td style={{ padding: '0.4rem' }}>{r.ferma_nume ?? '—'}</td>
                      <td style={{ padding: '0.4rem' }}>{r.consum_normal_litri} L</td>
                      <td style={{ padding: '0.4rem' }}>
                        {r.realimentat_litri} L{r.realimentari.length > 0 ? ` (${r.realimentari.length}x)` : ''}
                      </td>
                      <td style={{ padding: '0.4rem' }}>
                        {areScaderi
                          ? `${r.scaderi_mari.length} eveniment(e), ${Math.round(
                              r.scaderi_mari.reduce((s, e) => s + Math.abs(e.delta_litri), 0) * 10,
                            ) / 10} L`
                          : '—'}
                      </td>
                      <td style={{ padding: '0.4rem' }}>
                        {r.consum_mediu_ponderat_l_pe_ora !== null ? `${r.consum_mediu_ponderat_l_pe_ora} L/h` : '—'}
                      </td>
                      <td style={{ padding: '0.4rem' }}>
                        {(areScaderi || r.realimentari.length > 0 || r.consum_zilnic.length > 0) && (
                          <button
                            onClick={() => setExpandat(deschis ? null : r.utilaj_id)}
                            style={{
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              border: '1px solid #ccc',
                              background: '#fff',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                            }}
                          >
                            {deschis ? 'Ascunde' : 'Detalii'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {deschis && (
                      <tr key={`${r.utilaj_id}-detalii`}>
                        <td colSpan={7} style={{ padding: '0.6rem', background: '#fafafa' }}>
                          {r.consum_zilnic.length > 0 && (
                            <div style={{ marginBottom: '0.75rem' }}>
                              <strong>Consum zilnic:</strong>
                              <table style={{ borderCollapse: 'collapse', marginTop: '0.35rem', fontSize: '0.85rem' }}>
                                <thead>
                                  <tr style={{ textAlign: 'left' }}>
                                    <th style={{ padding: '0.2rem 0.6rem 0.2rem 0' }}>Zi</th>
                                    <th style={{ padding: '0.2rem 0.6rem' }}>Ore funcționare</th>
                                    <th style={{ padding: '0.2rem 0.6rem' }}>Consum</th>
                                    <th style={{ padding: '0.2rem 0.6rem' }}>Consum/oră</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.consum_zilnic.map((z) => (
                                    <tr key={z.data}>
                                      <td style={{ padding: '0.2rem 0.6rem 0.2rem 0' }}>{formatDataZi(z.data)}</td>
                                      <td style={{ padding: '0.2rem 0.6rem' }}>{z.ore_functionare}h</td>
                                      <td style={{ padding: '0.2rem 0.6rem' }}>{z.consum_litri} L</td>
                                      <td style={{ padding: '0.2rem 0.6rem' }}>
                                        {z.consum_pe_ora !== null ? `${z.consum_pe_ora} L/h` : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#666' }}>
                                Consum mediu ponderat (doar zilele cu funcționare):{' '}
                                {r.consum_mediu_ponderat_l_pe_ora !== null ? `${r.consum_mediu_ponderat_l_pe_ora} L/h` : '—'}
                              </p>
                            </div>
                          )}
                          {r.scaderi_mari.length > 0 && (
                            <div style={{ marginBottom: '0.5rem' }}>
                              <strong>Scăderi mari (peste 15L, informativ):</strong>
                              <ul style={{ margin: '0.25rem 0 0 1rem' }}>
                                {r.scaderi_mari.map((e, i) => (
                                  <li key={i}>
                                    {formatData(e.data_ora)} — {e.delta_litri} L
                                    <span style={{ color: '#666', fontWeight: 400 }}> ({motivScadere(e)})</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {r.realimentari.length > 0 && (
                            <div>
                              <strong>Realimentări (sondă):</strong>
                              <ul style={{ margin: '0.25rem 0 0 1rem' }}>
                                {r.realimentari.map((e, i) => (
                                  <li key={i}>
                                    {formatData(e.data_ora)} — +{e.delta_litri} L
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {raport && raport.necalibrate.length > 0 && (
        <div style={{ fontSize: '0.85rem', color: '#666' }}>
          <p style={{ margin: 0 }}>
            {raport.necalibrate.length} utilaj(e) fără capacitate de tanc completată (necalibrate) nu apar
            în comparația cu sonda: {raport.necalibrate.map((u) => u.nume).join(', ')}. Apar automat, fără
            nicio modificare de cod, imediat ce senzorul e calibrat și capacitatea tancului e completată.
          </p>
          {raport.necalibrate.some((u) => u.manual_nr > 0) && (
            <ul style={{ margin: '0.4rem 0 0 1rem' }}>
              {raport.necalibrate
                .filter((u) => u.manual_nr > 0)
                .map((u) => (
                  <li key={u.utilaj_id}>
                    {u.nume}: {u.manual_litri} L înregistrați manual ({u.manual_nr}x) — fără sondă de comparat.
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
