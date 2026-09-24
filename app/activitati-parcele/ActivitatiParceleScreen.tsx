'use client';

import { useEffect, useState } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';
import { LABEL_OPERATIUNE, Substanta, TIPURI_CU_SUBSTANTE, TipOperatiune } from '../../lib/operatiuniTypes';

// Coadă de sesiuni de lucru detectate automat din traseul GPS al utilajelor
// (vezi supabase/functions/get-sesiuni-detectate) — Radu, 2026-09-19:
// "munca fără utilaj nu există", deci acest ecran înlocuiește complet
// selecția manuală de parcelă din ParcelaPanel. Adminul de fermă nu mai
// alege parcela — aplicația a dedus-o deja din traseu.
//
// v2, 2026-09-24 (Radu): șefii de fermă nu mai aleg tipul de operațiune
// dintr-o listă — doar dacă a fost FERTILIZARE (solidă sau foliară, cu
// substanță + cantitate) sau, pentru utilajele marcate "utilaj de
// recoltare" (checkbox nou în /utilaje), doar suprafața (mp) de gazon
// recoltată. Orice altă sesiune se confirmă direct, fără nicio alegere de
// tip (salvată intern ca 'Altele').
//
// ParcelaPanel rămâne neschimbat — folosit acum doar pentru istoricul pe
// parcelă și pentru corectări manuale punctuale (admin_central), nu ca flux
// zilnic principal — acolo lista completă de tipuri de operațiune rămâne
// disponibilă.

type Sesiune = {
  utilaj_id: string;
  utilaj_nume: string;
  utilaj_recoltare: boolean;
  parcela_id: string;
  parcela_nume: string;
  inceput: string;
  sfarsit: string;
  ore: number;
};

type Raport = {
  zile: number;
  ferma_id: string;
  are_parcele_desenate: boolean;
  sesiuni: Sesiune[];
};

type SubstantaLinie = { substanta_id: string; cantitate: string };

type FormSesiune = {
  esteFertilizare: boolean;
  tipFertilizare: TipOperatiune | '';
  oreLucru: string;
  cantitateMpRecoltat: string;
  note: string;
  substanteLinii: SubstantaLinie[];
  saving: boolean;
  error: string | null;
};

function cheieSesiune(s: Sesiune): string {
  return `${s.utilaj_id}_${s.inceput}`;
}

function formatOra(dataIso: string): string {
  return new Date(dataIso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

function formatDataOra(dataIso: string): string {
  return new Date(dataIso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Ziua locală (România) în care a început sesiunea — folosită ca `data` la
// operațiunea creată, indiferent de fusul serverului.
function ziuaLocala(dataIso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(dataIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function oreLucruImplicit(ore: number): string {
  return String(Math.min(8, Math.max(0, Math.round(ore))));
}

function formGol(ore: number): FormSesiune {
  return {
    esteFertilizare: false,
    tipFertilizare: '',
    oreLucru: oreLucruImplicit(ore),
    cantitateMpRecoltat: '',
    note: '',
    substanteLinii: [],
    saving: false,
    error: null,
  };
}

export default function ActivitatiParceleScreen() {
  const { role, loading: roleLoading } = useUserRole();

  const [fermeOptiuni, setFermeOptiuni] = useState<{ id: string; nume: string }[]>([]);
  const [fermaSelectata, setFermaSelectata] = useState<string>('');
  const [fermaProprie, setFermaProprie] = useState<string | null>(null);

  const [zile, setZile] = useState(3);
  const [raport, setRaport] = useState<Raport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [substanteFerma, setSubstanteFerma] = useState<Substanta[]>([]);
  const [forms, setForms] = useState<Record<string, FormSesiune>>({});
  const [confirmate, setConfirmate] = useState<Set<string>>(new Set());

  const poateVedea = role === 'admin_central' || role === 'admin_ferma';
  const fermaActiva = role === 'admin_central' ? fermaSelectata : fermaProprie;

  useEffect(() => {
    if (!poateVedea) return;

    if (role === 'admin_central') {
      void (async () => {
        const { data } = await supabase.from('ferme').select('id, nume').order('nume');
        setFermeOptiuni((data as { id: string; nume: string }[]) ?? []);
      })();
    } else if (role === 'admin_ferma') {
      void (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase.from('utilizatori').select('ferma_id').eq('id', user.id).single();
        setFermaProprie((data?.ferma_id as string) ?? null);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    if (fermaActiva) void incarca();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fermaActiva]);

  useEffect(() => {
    if (!fermaActiva) return;
    void (async () => {
      const { data } = await supabase
        .from('substante')
        .select('id,nume,unitate_masura,stoc_curent')
        .eq('ferma_id', fermaActiva)
        .gt('stoc_curent', 0)
        .order('nume');
      setSubstanteFerma((data as Substanta[]) ?? []);
    })();
  }, [fermaActiva]);

  async function incarca(zileNoi?: number) {
    if (!fermaActiva) return;
    setLoading(true);
    setError(null);

    const zileDeFolosit = zileNoi ?? zile;

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/get-sesiuni-detectate?ferma_id=${fermaActiva}&zile=${zileDeFolosit}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = await res.json();

      setLoading(false);

      if (!res.ok) {
        setError(json?.error ?? 'Eroare la încărcarea activităților detectate.');
        return;
      }

      const raportNou = json as Raport;
      setRaport(raportNou);

      // Formulare noi doar pentru sesiunile care nu au deja unul (păstrăm ce
      // a completat admin-ul dacă apasă Reîncarcă din greșeală).
      setForms((prev) => {
        const next = { ...prev };
        for (const s of raportNou.sesiuni) {
          const cheie = cheieSesiune(s);
          if (!next[cheie]) next[cheie] = formGol(s.ore);
        }
        return next;
      });
    } catch (e) {
      setLoading(false);
      setError('Eroare de rețea la încărcarea activităților.');
    }
  }

  function actualizeazaForm(cheie: string, patch: Partial<FormSesiune>) {
    setForms((prev) => ({ ...prev, [cheie]: { ...prev[cheie], ...patch } }));
  }

  function bifeazaFertilizare(cheie: string, esteFertilizare: boolean) {
    actualizeazaForm(cheie, {
      esteFertilizare,
      tipFertilizare: '',
      substanteLinii: esteFertilizare ? [{ substanta_id: '', cantitate: '' }] : [],
      error: null,
    });
  }

  function selecteazaTipFertilizare(cheie: string, tip: TipOperatiune) {
    actualizeazaForm(cheie, { tipFertilizare: tip, error: null });
  }

  function adaugaSubstantaLinie(cheie: string) {
    setForms((prev) => ({
      ...prev,
      [cheie]: { ...prev[cheie], substanteLinii: [...prev[cheie].substanteLinii, { substanta_id: '', cantitate: '' }] },
    }));
  }

  function actualizeazaSubstantaLinie(cheie: string, index: number, field: keyof SubstantaLinie, value: string) {
    setForms((prev) => ({
      ...prev,
      [cheie]: {
        ...prev[cheie],
        substanteLinii: prev[cheie].substanteLinii.map((l, i) => (i === index ? { ...l, [field]: value } : l)),
      },
    }));
  }

  function eliminaSubstantaLinie(cheie: string, index: number) {
    setForms((prev) => ({
      ...prev,
      [cheie]: { ...prev[cheie], substanteLinii: prev[cheie].substanteLinii.filter((_, i) => i !== index) },
    }));
  }

  async function confirmaSesiune(sesiune: Sesiune) {
    const cheie = cheieSesiune(sesiune);
    const form = forms[cheie];
    if (!form) return;

    const oreNum = form.oreLucru === '' ? null : Number(form.oreLucru);
    if (
      form.oreLucru !== '' &&
      (Number.isNaN(oreNum) || !Number.isInteger(oreNum) || (oreNum ?? 0) < 0 || (oreNum ?? 0) > 8)
    ) {
      actualizeazaForm(cheie, { error: 'Orele de lucru trebuie să fie un număr întreg între 0 și 8.' });
      return;
    }

    let tip: TipOperatiune;
    let cantitateMpRecoltat: number | null = null;
    let liniiValide: SubstantaLinie[] = [];
    const needsSubstante = !sesiune.utilaj_recoltare && form.esteFertilizare;

    if (sesiune.utilaj_recoltare) {
      // Utilaj de recoltare: nicio alegere de tip, doar suprafața recoltată.
      const mp = form.cantitateMpRecoltat === '' ? NaN : Number(form.cantitateMpRecoltat);
      if (Number.isNaN(mp) || mp <= 0) {
        actualizeazaForm(cheie, { error: 'Introdu suprafața recoltată (mp), un număr pozitiv.' });
        return;
      }
      tip = 'Recoltare';
      cantitateMpRecoltat = mp;
    } else if (form.esteFertilizare) {
      if (!form.tipFertilizare) {
        actualizeazaForm(cheie, { error: 'Alege tipul de fertilizare (solidă sau foliară).' });
        return;
      }
      tip = form.tipFertilizare;
      liniiValide = form.substanteLinii.filter((l) => l.substanta_id && l.cantitate);
      if (liniiValide.length === 0) {
        actualizeazaForm(cheie, { error: 'Adaugă cel puțin o substanță folosită (cu cantitate).' });
        return;
      }
      for (const linie of liniiValide) {
        const cant = Number(linie.cantitate);
        if (Number.isNaN(cant) || cant <= 0) {
          actualizeazaForm(cheie, { error: 'Cantitatea trebuie să fie un număr pozitiv pentru fiecare substanță.' });
          return;
        }
      }
    } else {
      // Nicio fertilizare, utilaj obișnuit — confirmăm direct, fără tip ales.
      tip = 'Altele';
    }

    actualizeazaForm(cheie, { saving: true, error: null });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: opInsert, error: opError } = await supabase
      .from('operatiuni')
      .insert({
        parcela_id: sesiune.parcela_id,
        tip,
        data: ziuaLocala(sesiune.inceput),
        ore_lucru: oreNum,
        cantitate_mp_recoltat: cantitateMpRecoltat,
        note: form.note.trim() || null,
        user_id: user?.id ?? null,
        utilaj_id: sesiune.utilaj_id,
        sesiune_inceput: sesiune.inceput,
        sesiune_sfarsit: sesiune.sfarsit,
      })
      .select('id')
      .single();

    if (opError || !opInsert) {
      actualizeazaForm(cheie, { saving: false, error: opError?.message ?? 'Eroare la salvarea operațiunii.' });
      return;
    }

    if (needsSubstante && liniiValide.length > 0) {
      const rows = liniiValide.map((l) => ({
        operatiune_id: opInsert.id,
        substanta_id: l.substanta_id,
        cantitate: Number(l.cantitate),
      }));
      const { error: substErr } = await supabase.from('operatiuni_substante').insert(rows);
      if (substErr) {
        actualizeazaForm(cheie, {
          saving: false,
          error: `Operațiunea a fost salvată, dar substanțele nu s-au putut înregistra: ${substErr.message}`,
        });
        return;
      }
    }

    actualizeazaForm(cheie, { saving: false });
    setConfirmate((prev) => new Set(prev).add(cheie));

    // Stocul poate să se fi schimbat (dacă alte ecrane au consumat între timp)
    // — reîncărcăm lista de substanțe pentru consistență cu ParcelaPanel.
    if (fermaActiva) {
      const { data } = await supabase
        .from('substante')
        .select('id,nume,unitate_masura,stoc_curent')
        .eq('ferma_id', fermaActiva)
        .gt('stoc_curent', 0)
        .order('nume');
      setSubstanteFerma((data as Substanta[]) ?? []);
    }
  }

  if (roleLoading) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Se verifică accesul...</p>
      </main>
    );
  }

  if (!poateVedea) {
    return (
      <main style={{ padding: '2rem' }}>
        <h1>Acces interzis</h1>
        <p>Această secțiune este disponibilă doar pentru administratori.</p>
      </main>
    );
  }

  const sesiuniDeAfisat = (raport?.sesiuni ?? []).filter((s) => !confirmate.has(cheieSesiune(s)));

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
        <h1 style={{ margin: 0 }}>Activități detectate pe parcele</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {role === 'admin_central' && (
            <select
              value={fermaSelectata}
              onChange={(e) => setFermaSelectata(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
            >
              <option value="">Alege ferma</option>
              {fermeOptiuni.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nume}
                </option>
              ))}
            </select>
          )}
          <select
            value={zile}
            onChange={(e) => {
              const v = Number(e.target.value);
              setZile(v);
              void incarca(v);
            }}
            style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
          >
            <option value={3}>Ultimele 3 zile</option>
            <option value={7}>Ultimele 7 zile</option>
            <option value={14}>Ultimele 14 zile</option>
            <option value={30}>Ultimele 30 zile</option>
          </select>
          <button
            onClick={() => void incarca()}
            disabled={loading || !fermaActiva}
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

      <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
        Aplicația detectează automat, din traseul GPS, unde a lucrat fiecare utilaj — nu mai trebuie să alegi
        parcela. Pentru utilajele obișnuite, confirmă direct (bifează doar dacă a fost fertilizare, ca să alegi
        substanța și cantitatea) — pentru utilajele de recoltare, introdu doar suprafața (mp) de gazon recoltată.
        O sesiune apare aici doar după ce s-a încheiat (utilajul a plecat din parcelă sau a oprit motorul) și doar
        dacă a durat peste 10 minute.
      </p>

      {role === 'admin_central' && !fermaSelectata && <p>Alege o fermă pentru a vedea activitățile detectate.</p>}

      {error && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{error}</p>
      )}

      {raport && !raport.are_parcele_desenate && (
        <p style={{ color: '#8a1f13', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>
          Această fermă nu are încă parcele cu contur desenat pe hartă — detecția automată are nevoie de
          poligoanele parcelelor ca să știe unde a lucrat utilajul. Desenează conturul parcelelor și activitățile
          vor apărea aici.
        </p>
      )}

      {raport && raport.are_parcele_desenate && sesiuniDeAfisat.length === 0 && !loading && (
        <p style={{ color: '#666' }}>Nicio activitate nouă detectată în perioada aleasă.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto' }}>
        {sesiuniDeAfisat.map((sesiune) => {
          const cheie = cheieSesiune(sesiune);
          const form = forms[cheie] ?? formGol(sesiune.ore);

          return (
            <div key={cheie} style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <div>
                  <strong>{sesiune.utilaj_nume}</strong> — parcela <strong>{sesiune.parcela_nume}</strong>
                  {sesiune.utilaj_recoltare && (
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#8a5a00' }}>utilaj de recoltare</span>
                  )}
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>
                    {formatDataOra(sesiune.inceput)}, {formatOra(sesiune.inceput)}–{formatOra(sesiune.sfarsit)} ·{' '}
                    {sesiune.ore}h
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                  Ore de lucru
                  <input
                    type="number"
                    min="0"
                    max="8"
                    step="1"
                    inputMode="numeric"
                    value={form.oreLucru}
                    onChange={(e) => actualizeazaForm(cheie, { oreLucru: e.target.value.replace(/[^0-9]/g, '') })}
                    style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', width: '90px' }}
                  />
                </label>

                {sesiune.utilaj_recoltare ? (
                  <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                    Suprafață recoltată (mp)
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      placeholder="mp"
                      value={form.cantitateMpRecoltat}
                      onChange={(e) => actualizeazaForm(cheie, { cantitateMpRecoltat: e.target.value })}
                      style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc', width: '140px' }}
                    />
                  </label>
                ) : (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', paddingBottom: '0.4rem' }}>
                    <input
                      type="checkbox"
                      checked={form.esteFertilizare}
                      onChange={(e) => bifeazaFertilizare(cheie, e.target.checked)}
                    />
                    A fost fertilizare?
                  </label>
                )}

                <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem', flex: '1 1 160px' }}>
                  Notă (opțional)
                  <input
                    type="text"
                    value={form.note}
                    onChange={(e) => actualizeazaForm(cheie, { note: e.target.value })}
                    style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
                  />
                </label>
              </div>

              {!sesiune.utilaj_recoltare && form.esteFertilizare && (
                <div style={{ marginTop: '0.6rem' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem', maxWidth: '260px' }}>
                    Tip fertilizare
                    <select
                      value={form.tipFertilizare}
                      onChange={(e) => selecteazaTipFertilizare(cheie, e.target.value as TipOperatiune)}
                      style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #ccc' }}
                    >
                      <option value="">Alege tipul</option>
                      {TIPURI_CU_SUBSTANTE.map((tip) => (
                        <option key={tip} value={tip}>
                          {LABEL_OPERATIUNE[tip]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div style={{ marginTop: '0.6rem' }}>
                    <span style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8rem' }}>
                      Substanțe / sămânță folosită
                    </span>
                    {form.substanteLinii.map((linie, index) => (
                      <div key={index} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <select
                          value={linie.substanta_id}
                          onChange={(e) => actualizeazaSubstantaLinie(cheie, index, 'substanta_id', e.target.value)}
                          style={{ flex: '1 1 180px', padding: '0.5rem' }}
                        >
                          <option value="">Alege substanță</option>
                          {substanteFerma.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.nume} ({s.unitate_masura}) — stoc {s.stoc_curent ?? 0}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Cantitate"
                          value={linie.cantitate}
                          onChange={(e) => actualizeazaSubstantaLinie(cheie, index, 'cantitate', e.target.value)}
                          style={{ flex: '1 1 100px', padding: '0.5rem' }}
                        />
                        <button
                          type="button"
                          onClick={() => eliminaSubstantaLinie(cheie, index)}
                          disabled={form.substanteLinii.length === 1}
                          style={{ flex: '0 0 auto', padding: '0.5rem 0.9rem' }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => adaugaSubstantaLinie(cheie)}>
                      + Adaugă substanță
                    </button>
                  </div>
                </div>
              )}

              {form.error && <p style={{ color: '#b00020', margin: '0.6rem 0 0' }}>{form.error}</p>}

              <button
                onClick={() => void confirmaSesiune(sesiune)}
                disabled={form.saving}
                style={{
                  marginTop: '0.75rem',
                  padding: '0.6rem 1.2rem',
                  borderRadius: '6px',
                  border: '1px solid #ccc',
                  background: form.saving ? '#eee' : '#eaf7ea',
                  fontWeight: 'bold',
                  cursor: form.saving ? 'default' : 'pointer',
                }}
              >
                {form.saving ? 'Se salvează...' : 'Confirmă'}
              </button>
            </div>
          );
        })}
      </div>
    </main>
  );
}
