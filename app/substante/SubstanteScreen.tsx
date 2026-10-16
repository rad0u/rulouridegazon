'use client';

import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useUserRole } from '../../lib/useUserRole';
import { inBaza, parseazaNumar } from '../../lib/unitati';
import CantitateCuUm from '../../components/CantitateCuUm';

type NomenclatorItem = { id: string; nume: string; unitate_masura: string };
type Ferma = { id: string; nume: string };

type SubstantaStoc = {
  id: string;
  nume: string;
  unitate_masura: string;
  stoc_curent: number;
  pret_unitar: number | null;
  ferma_id: string | null;
  ferme: { nume: string } | null;
};

type Intrare = {
  id: string;
  cantitate: number;
  pret_intrare_unitar: number;
  data: string;
  furnizor: string | null;
  nota: string | null;
  created_at: string;
  substante: { nume: string; unitate_masura: string; ferma_id: string | null; ferme: { nume: string } | null } | null;
  utilizatori: { nume: string } | null;
};

function aziLocal(): string {
  const d = new Date();
  const an = d.getFullYear();
  const luna = String(d.getMonth() + 1).padStart(2, '0');
  const zi = String(d.getDate()).padStart(2, '0');
  return `${an}-${luna}-${zi}`;
}

function formatData(data: string): string {
  return new Date(data).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatLei(valoare: number | null): string {
  if (valoare === null || Number.isNaN(valoare)) return '—';
  return valoare.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lei';
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  padding: '0.5rem',
  marginTop: '0.25rem',
  borderRadius: '6px',
  border: '1px solid #ccc',
  minWidth: '160px',
};

const butonStyle: React.CSSProperties = {
  padding: '0.6rem 1.2rem',
  borderRadius: '6px',
  border: '1px solid #ccc',
  background: '#f5f5f5',
  cursor: 'pointer',
};

// 2026-10-08 (Radu): "la substante adauga-mi si un buton Tipareste stoc, unde
// sa-mi faca un raport la zi a stocului de substante" -- raport A4 cu stocul
// curent al tuturor substanțelor (inclusiv stoc 0/negativ, marcate cu roșu
// „Atenție la stoc!"), grupat pe ferme (câte o pagină per fermă), cu valoarea
// stocului și totaluri. Codurile S1.. sunt aceleași ca în Activități
// detectate pe parcele (poziția în lista fermei, ordonată nume + id). Bloc
// ascuns pe ecran, vizibil doar la tipărire (@media print).
function RaportStocSubstante({ stocuri, momentul }: { stocuri: SubstantaStoc[]; momentul: Date }) {
  const perFerma = new Map<string, { nume: string; randuri: SubstantaStoc[] }>();
  for (const sub of stocuri) {
    const cheie = sub.ferma_id ?? 'fara-ferma';
    let grup = perFerma.get(cheie);
    if (!grup) {
      grup = { nume: sub.ferme?.nume ?? 'Fără fermă', randuri: [] };
      perFerma.set(cheie, grup);
    }
    grup.randuri.push(sub);
  }
  const grupuri = Array.from(perFerma.values()).sort((a, b) => a.nume.localeCompare(b.nume, 'ro'));

  const valoare = (r: SubstantaStoc) => (r.pret_unitar !== null ? r.pret_unitar * r.stoc_curent : null);
  const totalGrup = (randuri: SubstantaStoc[]) =>
    randuri.reduce((suma, r) => suma + (valoare(r) ?? 0), 0);
  const moment = momentul.toLocaleString('ro-RO', { dateStyle: 'long', timeStyle: 'short' });

  return (
    <section className="raport-stoc">
      {grupuri.map((grup, gi) => (
        <div key={grup.nume} className="raport-pagina" style={gi > 0 ? { breakBefore: 'page' } : undefined}>
          <h2>RAPORT STOC SUBSTANȚE</h2>
          <div className="antet">
            <div><strong>Fermă:</strong> {grup.nume}</div>
            <div><strong>Situația la:</strong> {moment}</div>
            <div className="mic" style={{ gridColumn: '1 / -1' }}>
              SC Rulouri de Gazon SRL · {grup.randuri.length} substanțe · valorile sunt calculate la prețul mediu de
              intrare.
            </div>
          </div>
          <table>
            <colgroup>
              <col style={{ width: '7%' }} />
              <col style={{ width: '33%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '16%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Cod</th>
                <th>Substanță</th>
                <th>Stoc</th>
                <th>Preț mediu</th>
                <th>Valoare</th>
                <th>Obs.</th>
              </tr>
            </thead>
            <tbody>
              {grup.randuri.map((r, i) => {
                const problema = r.stoc_curent === null || r.stoc_curent <= 0;
                return (
                  <tr key={r.id}>
                    <td>S{i + 1}</td>
                    <td>{r.nume}</td>
                    <td className="dr">
                      {r.stoc_curent} {r.unitate_masura}
                    </td>
                    <td className="dr">{r.pret_unitar !== null ? `${formatLei(r.pret_unitar)}/${r.unitate_masura}` : '—'}</td>
                    <td className="dr">{formatLei(valoare(r))}</td>
                    <td>{problema && <span className="avert">Atenție la stoc!</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="dr"><strong>Total valoare stoc — {grup.nume}</strong></td>
                <td className="dr"><strong>{formatLei(totalGrup(grup.randuri))}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
      {grupuri.length > 1 && (
        <div className="raport-pagina" style={{ breakBefore: 'page' }}>
          <h2>RAPORT STOC SUBSTANȚE — Total pe ferme</h2>
          <div className="antet">
            <div><strong>Situația la:</strong> {moment}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Fermă</th>
                <th>Nr. substanțe</th>
                <th>Valoare stoc</th>
              </tr>
            </thead>
            <tbody>
              {grupuri.map((grup) => (
                <tr key={grup.nume}>
                  <td>{grup.nume}</td>
                  <td className="dr">{grup.randuri.length}</td>
                  <td className="dr">{formatLei(totalGrup(grup.randuri))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>TOTAL</strong></td>
                <td className="dr"><strong>{grupuri.reduce((n, g) => n + g.randuri.length, 0)}</strong></td>
                <td className="dr"><strong>{formatLei(grupuri.reduce((suma, g) => suma + totalGrup(g.randuri), 0))}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

const STIL_RAPORT_STOC = `
  .raport-stoc { display: none; }
  @media print {
    @page { size: A4 portrait; margin: 10mm; }
    body { background: #fff !important; }
    header { display: none !important; }
    body div:has(> header) { display: block !important; min-height: 0 !important; }
    main { display: block !important; min-height: 0 !important; padding: 0 !important; }
    .substante-ecran > *:not(.raport-stoc) { display: none !important; }
    .raport-stoc { display: block !important; color: #000; font-size: 10pt; }
    .raport-stoc h2 { margin: 0; font-size: 15pt; text-align: center; }
    .raport-stoc .antet { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin: 6px 0 8px; font-size: 9.5pt; }
    .raport-stoc .mic { font-size: 8.5pt; color: #333; }
    .raport-stoc table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .raport-stoc th, .raport-stoc td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; text-align: left; font-size: 9pt; word-wrap: break-word; }
    .raport-stoc th { background: #eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .raport-stoc .dr { text-align: right; }
    .raport-stoc thead { display: table-header-group; }
    .raport-stoc tfoot { display: table-row-group; }
    .raport-stoc tr { break-inside: avoid; page-break-inside: avoid; }
    .raport-stoc .avert { color: #c00000; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export default function SubstanteScreen() {
  const { role, loading: roleLoading } = useUserRole();

  if (roleLoading) {
    return (
      <main style={{ padding: '2rem' }}>
        <p>Se verifică accesul...</p>
      </main>
    );
  }

  if (role === 'admin_central') return <SubstanteAdminCentral />;
  if (role === 'admin_ferma') return <SubstanteAdminFerma />;

  return (
    <main style={{ padding: '2rem' }}>
      <h1>Acces interzis</h1>
      <p>Această secțiune este disponibilă doar pentru admin general sau administratorul unei ferme.</p>
    </main>
  );
}

const initialNomenclatorForm = { nume: '', unitate_masura: 'kg' };

const initialAlimentareForm = {
  ferma_id: '',
  nomenclator_id: '',
  cantitate: '',
  cantitate_um: '',
  pret_intrare_unitar: '',
  data: aziLocal(),
  furnizor: '',
  nota: '',
};

type TransferSubstanta = {
  id: string;
  cantitate: number;
  pret_unitar: number;
  data: string;
  nota: string | null;
  created_at: string;
  sursa: { nume: string; unitate_masura: string; ferme: { nume: string } | null } | null;
  dest: { ferme: { nume: string } | null } | null;
  utilizatori: { nume: string } | null;
};

const initialTransferForm = {
  sursa_id: '',
  ferma_dest_id: '',
  cantitate: '',
  cantitate_um: '',
  data: aziLocal(),
  nota: '',
};

function SubstanteAdminCentral() {
  const [nomenclator, setNomenclator] = useState<NomenclatorItem[]>([]);
  const [ferme, setFerme] = useState<Ferma[]>([]);
  const [stocuri, setStocuri] = useState<SubstantaStoc[]>([]);
  const [intrari, setIntrari] = useState<Intrare[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [nomenclatorForm, setNomenclatorForm] = useState(initialNomenclatorForm);
  const [nomenclatorSaving, setNomenclatorSaving] = useState(false);
  const [nomenclatorError, setNomenclatorError] = useState<string | null>(null);

  const [form, setForm] = useState(initialAlimentareForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const [transferuri, setTransferuri] = useState<TransferSubstanta[]>([]);
  const [transferDeschis, setTransferDeschis] = useState(false);
  const [transferForm, setTransferForm] = useState(initialTransferForm);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferOk, setTransferOk] = useState<string | null>(null);

  const [nomenclatorModalDeschis, setNomenclatorModalDeschis] = useState(false);
  const [cautareNomenclator, setCautareNomenclator] = useState('');

  const [intrareExtinsa, setIntrareExtinsa] = useState<string | null>(null);
  const [editIntrareForm, setEditIntrareForm] = useState<{
    ferma_id: string;
    cantitate: string;
    cantitate_um: string;
    pret_intrare_unitar: string;
    data: string;
    furnizor: string;
    nota: string;
  } | null>(null);
  const [editIntrareSaving, setEditIntrareSaving] = useState(false);
  const [editIntrareError, setEditIntrareError] = useState<string | null>(null);

  const [momentRaport, setMomentRaport] = useState<Date>(() => new Date());

  // Reîncarcă stocul chiar înainte de tipărire, ca raportul să fie „la zi".
  async function tiparesteStoc() {
    await incarca();
    setMomentRaport(new Date());
    setTimeout(() => window.print(), 150);
  }

  async function incarca() {
    setLoading(true);
    setLoadError(null);

    const [nomenclatorRes, fermeRes, stocuriRes, intrariRes, transferuriRes] = await Promise.all([
      supabase.from('substante_nomenclator').select('id, nume, unitate_masura').order('nume'),
      supabase.from('ferme').select('id, nume').order('nume'),
      supabase
        .from('substante')
        .select('id, nume, unitate_masura, stoc_curent, pret_unitar, ferma_id, ferme(nume)')
        .order('nume')
        .order('id'),
      supabase
        .from('substante_intrari')
        .select(
          'id, cantitate, pret_intrare_unitar, data, furnizor, nota, created_at, substante(nume, unitate_masura, ferma_id, ferme(nume)), utilizatori(nume)',
        )
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('substante_transferuri')
        .select(
          'id, cantitate, pret_unitar, data, nota, created_at, sursa:substante!substanta_sursa_id(nume, unitate_masura, ferme(nume)), dest:substante!substanta_dest_id(ferme(nume)), utilizatori(nume)',
        )
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    setLoading(false);
    setLoadedOnce(true);

    if (nomenclatorRes.error) {
      setLoadError(nomenclatorRes.error.message);
      return;
    }
    if (fermeRes.error) {
      setLoadError(fermeRes.error.message);
      return;
    }
    if (stocuriRes.error) {
      setLoadError(stocuriRes.error.message);
      return;
    }
    if (intrariRes.error) {
      setLoadError(intrariRes.error.message);
      return;
    }
    // Istoricul transferurilor e secundar: dacă nu se încarcă, restul ecranului rămâne utilizabil.
    if (transferuriRes.error) {
      console.error('Transferuri substanțe:', transferuriRes.error.message);
    } else {
      setTransferuri((transferuriRes.data as unknown as TransferSubstanta[]) ?? []);
    }

    setNomenclator((nomenclatorRes.data as NomenclatorItem[]) ?? []);
    setFerme((fermeRes.data as Ferma[]) ?? []);
    setStocuri((stocuriRes.data as unknown as SubstantaStoc[]) ?? []);
    setIntrari((intrariRes.data as unknown as Intrare[]) ?? []);
  }

  useEffect(() => {
    void incarca();
  }, []);

  async function adaugaNomenclator(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNomenclatorError(null);

    if (!nomenclatorForm.nume.trim()) {
      setNomenclatorError('Completează denumirea substanței.');
      return;
    }

    setNomenclatorSaving(true);
    const { error: insertError } = await supabase.from('substante_nomenclator').insert({
      nume: nomenclatorForm.nume.trim(),
      unitate_masura: nomenclatorForm.unitate_masura.trim() || 'kg',
    });
    setNomenclatorSaving(false);

    if (insertError) {
      setNomenclatorError(
        insertError.code === '23505'
          ? 'Există deja o substanță cu această denumire în nomenclator.'
          : insertError.message,
      );
      return;
    }

    setNomenclatorForm(initialNomenclatorForm);
    await incarca();
  }

  function updateForm(field: keyof typeof initialAlimentareForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSaveOk(false);
  }

  const substantaSelectata = nomenclator.find((n) => n.id === form.nomenclator_id) ?? null;
  const cantitateNum = inBaza(parseazaNumar(form.cantitate), form.cantitate_um, substantaSelectata?.unitate_masura ?? '');
  const pretNum = Number(form.pret_intrare_unitar);
  const costTotal =
    form.cantitate && form.pret_intrare_unitar && !Number.isNaN(cantitateNum) && !Number.isNaN(pretNum)
      ? cantitateNum * pretNum
      : null;

  async function salveazaAlimentare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    setSaveOk(false);

    if (!form.ferma_id) {
      setSaveError('Alege ferma căreia îi alimentezi gestiunea.');
      return;
    }
    if (!form.nomenclator_id) {
      setSaveError('Alege substanța din nomenclator.');
      return;
    }
    if (!form.cantitate || Number.isNaN(cantitateNum) || cantitateNum <= 0) {
      setSaveError('Completează o cantitate pozitivă.');
      return;
    }
    if (!form.pret_intrare_unitar || pretNum < 0) {
      setSaveError('Completează prețul de intrare (poate fi 0, dar nu negativ).');
      return;
    }

    setSaving(true);
    const { error: rpcError } = await supabase.rpc('alimenteaza_substanta', {
      p_ferma_id: form.ferma_id,
      p_nomenclator_id: form.nomenclator_id,
      p_cantitate: cantitateNum,
      p_pret_intrare_unitar: pretNum,
      p_data: form.data,
      p_furnizor: form.furnizor.trim() || null,
      p_nota: form.nota.trim() || null,
    });
    setSaving(false);

    if (rpcError) {
      setSaveError(rpcError.message);
      return;
    }

    setSaveOk(true);
    setForm((prev) => ({
      ...initialAlimentareForm,
      ferma_id: prev.ferma_id,
      nomenclator_id: prev.nomenclator_id,
    }));
    await incarca();
  }

  const sursaTransfer = stocuri.find((x) => x.id === transferForm.sursa_id) ?? null;
  const cantitateTransfer = inBaza(
    parseazaNumar(transferForm.cantitate),
    transferForm.cantitate_um,
    sursaTransfer?.unitate_masura ?? '',
  );
  const optiuniSursaTransfer = stocuri
    .filter((x) => (x.stoc_curent ?? 0) > 0 && x.ferma_id)
    .sort((a, b) => (a.ferme?.nume ?? '').localeCompare(b.ferme?.nume ?? '', 'ro') || a.nume.localeCompare(b.nume, 'ro'));

  async function salveazaTransfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransferError(null);
    setTransferOk(null);

    if (!sursaTransfer) {
      setTransferError('Alege gestiunea sursă (fermă + substanță).');
      return;
    }
    if (!transferForm.ferma_dest_id) {
      setTransferError('Alege ferma destinație.');
      return;
    }
    if (transferForm.ferma_dest_id === sursaTransfer.ferma_id) {
      setTransferError('Ferma destinație trebuie să fie diferită de cea sursă.');
      return;
    }
    if (!transferForm.cantitate || Number.isNaN(cantitateTransfer) || cantitateTransfer <= 0) {
      setTransferError('Completează o cantitate pozitivă.');
      return;
    }
    if (cantitateTransfer > (sursaTransfer.stoc_curent ?? 0)) {
      setTransferError(
        `Stoc insuficient în gestiunea sursă (disponibil: ${sursaTransfer.stoc_curent} ${sursaTransfer.unitate_masura}).`,
      );
      return;
    }

    setTransferSaving(true);
    const { error: rpcError } = await supabase.rpc('transfera_substanta', {
      p_substanta_sursa_id: sursaTransfer.id,
      p_ferma_dest_id: transferForm.ferma_dest_id,
      p_cantitate: cantitateTransfer,
      p_data: transferForm.data,
      p_nota: transferForm.nota.trim() || null,
    });
    setTransferSaving(false);

    if (rpcError) {
      setTransferError(rpcError.message);
      return;
    }

    const fermaDest = ferme.find((f) => f.id === transferForm.ferma_dest_id)?.nume ?? '';
    setTransferOk(
      `Transferat ${cantitateTransfer} ${sursaTransfer.unitate_masura} din ${sursaTransfer.ferme?.nume ?? 'gestiunea sursă'} în ${fermaDest}.`,
    );
    setTransferForm({ ...initialTransferForm, data: transferForm.data, sursa_id: '', ferma_dest_id: transferForm.ferma_dest_id });
    await incarca();
  }

  function deschideEditareIntrare(i: Intrare) {
    if (intrareExtinsa === i.id) {
      setIntrareExtinsa(null);
      setEditIntrareForm(null);
      return;
    }
    setIntrareExtinsa(i.id);
    setEditIntrareError(null);
    setEditIntrareForm({
      ferma_id: i.substante?.ferma_id ?? '',
      cantitate: String(i.cantitate),
      cantitate_um: i.substante?.unitate_masura ?? '',
      pret_intrare_unitar: String(i.pret_intrare_unitar),
      data: i.data,
      furnizor: i.furnizor ?? '',
      nota: i.nota ?? '',
    });
  }

  async function salveazaEditareIntrare(intrareId: string) {
    if (!editIntrareForm) return;
    setEditIntrareError(null);

    const bazaEdit = intrari.find((x) => x.id === intrareId)?.substante?.unitate_masura ?? '';
    const cant = inBaza(parseazaNumar(editIntrareForm.cantitate), editIntrareForm.cantitate_um, bazaEdit);
    const pret = Number(editIntrareForm.pret_intrare_unitar);

    if (!editIntrareForm.ferma_id) {
      setEditIntrareError('Alege ferma.');
      return;
    }
    if (!editIntrareForm.cantitate || Number.isNaN(cant) || cant <= 0) {
      setEditIntrareError('Cantitatea trebuie să fie un număr pozitiv.');
      return;
    }
    if (!editIntrareForm.pret_intrare_unitar || Number.isNaN(pret) || pret < 0) {
      setEditIntrareError('Prețul de intrare trebuie să fie un număr valid (poate fi 0).');
      return;
    }
    if (!editIntrareForm.data) {
      setEditIntrareError('Alege data.');
      return;
    }

    setEditIntrareSaving(true);
    const { error: rpcError } = await supabase.rpc('editeaza_alimentare_substanta', {
      p_intrare_id: intrareId,
      p_ferma_id: editIntrareForm.ferma_id,
      p_cantitate: cant,
      p_pret_intrare_unitar: pret,
      p_data: editIntrareForm.data,
      p_furnizor: editIntrareForm.furnizor.trim() || null,
      p_nota: editIntrareForm.nota.trim() || null,
    });
    setEditIntrareSaving(false);

    if (rpcError) {
      setEditIntrareError(rpcError.message);
      return;
    }

    setIntrareExtinsa(null);
    setEditIntrareForm(null);
    await incarca();
  }

  return (
    <main
      className="substante-ecran"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: 'clamp(0.75rem, 3vw, 1.5rem)',
        gap: '1.25rem',
      }}
    >
      <style>{STIL_RAPORT_STOC}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Substanțe</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => void incarca()} disabled={loading} style={{ ...butonStyle, background: loading ? '#eee' : '#f5f5f5' }}>
            {loading ? 'Se încarcă...' : 'Reîncarcă'}
          </button>
          <button
            onClick={() => void tiparesteStoc()}
            disabled={loading}
            title="Reîncarcă stocul și tipărește pe A4 un raport la zi al stocului de substanțe."
            style={butonStyle}
          >
            Tipărește stoc
          </button>
        </div>
      </div>

      {loadError && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{loadError}</p>
      )}

      {/* Nomenclator */}
      <section style={{ border: '1px solid #eee', borderRadius: '8px', padding: '1rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Nomenclator substanțe</h2>
        <p style={{ color: '#666', marginTop: '-0.5rem' }}>
          Catalogul comun de substanțe (denumire + unitate de măsură), folosit la alimentarea gestiunilor fermelor.
        </p>
        <form onSubmit={adaugaNomenclator} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          <label>
            Denumire substanță
            <input
              type="text"
              value={nomenclatorForm.nume}
              onChange={(e) => setNomenclatorForm({ ...nomenclatorForm, nume: e.target.value })}
              placeholder="ex. Îngrășământ NPK 20-20-20"
              style={inputStyle}
            />
          </label>
          <label>
            Unitate de măsură
            <select
              value={nomenclatorForm.unitate_masura}
              onChange={(e) => setNomenclatorForm({ ...nomenclatorForm, unitate_masura: e.target.value })}
              style={inputStyle}
            >
              <option value="kg">kg</option>
              <option value="l">l</option>
              <option value="buc">buc</option>
            </select>
          </label>
          <button type="submit" disabled={nomenclatorSaving} style={butonStyle}>
            {nomenclatorSaving ? 'Se adaugă...' : 'Adaugă în nomenclator'}
          </button>
        </form>
        {nomenclatorError && <p style={{ color: '#b00020', marginBottom: 0 }}>{nomenclatorError}</p>}

        <button
          type="button"
          onClick={() => setNomenclatorModalDeschis(true)}
          style={{ ...butonStyle, marginTop: '0.75rem' }}
        >
          Vezi nomenclator ({nomenclator.length})
        </button>
      </section>

      {/* Alimentare gestiune */}
      <section style={{ border: '1px solid #eee', borderRadius: '8px', padding: '1rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Alimentare gestiune fermă</h2>
        <p style={{ color: '#666', marginTop: '-0.5rem' }}>
          Adaugă stoc dintr-o substanță din nomenclator la gestiunea unei ferme, cu prețul de intrare — necesar pentru
          calculul exact al costului de producție. Prețul mediu al substanței se recalculează automat (medie ponderată
          cu stocul existent).
        </p>
        <form onSubmit={salveazaAlimentare} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          <label>
            Fermă
            <select value={form.ferma_id} onChange={(e) => updateForm('ferma_id', e.target.value)} style={inputStyle}>
              <option value="">— alege ferma —</option>
              {ferme.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nume}
                </option>
              ))}
            </select>
          </label>
          <label>
            Substanță (din nomenclator)
            <select value={form.nomenclator_id} onChange={(e) => updateForm('nomenclator_id', e.target.value)} style={inputStyle}>
              <option value="">— alege substanța —</option>
              {nomenclator.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nume} ({n.unitate_masura})
                </option>
              ))}
            </select>
          </label>
          <label>
            Cantitate {substantaSelectata ? `(${substantaSelectata.unitate_masura})` : ''}
            <CantitateCuUm
              baza={substantaSelectata?.unitate_masura}
              value={form.cantitate}
              um={form.cantitate_um}
              onChange={(v, u) => {
                setForm((prev) => ({ ...prev, cantitate: v, cantitate_um: u }));
                setSaveOk(false);
              }}
              style={inputStyle}
            />
          </label>
          <label>
            Preț intrare (lei/{substantaSelectata ? substantaSelectata.unitate_masura : 'u.m.'})
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.pret_intrare_unitar}
              onChange={(e) => updateForm('pret_intrare_unitar', e.target.value)}
              style={inputStyle}
            />
          </label>
          <label>
            Dată
            <input type="date" value={form.data} onChange={(e) => updateForm('data', e.target.value)} style={inputStyle} />
          </label>
          <label>
            Furnizor (opțional)
            <input type="text" value={form.furnizor} onChange={(e) => updateForm('furnizor', e.target.value)} style={inputStyle} />
          </label>
          <label>
            Notă (opțional)
            <input type="text" value={form.nota} onChange={(e) => updateForm('nota', e.target.value)} style={inputStyle} />
          </label>
          <button type="submit" disabled={saving} style={{ ...butonStyle, background: saving ? '#eee' : '#e8f5e9' }}>
            {saving ? 'Se salvează...' : 'Alimentează gestiunea'}
          </button>
        </form>
        {costTotal !== null && (
          <p style={{ color: '#666', marginBottom: 0 }}>Cost total intrare: {formatLei(costTotal)}</p>
        )}
        {saveError && <p style={{ color: '#b00020', marginBottom: 0 }}>{saveError}</p>}
        {saveOk && <p style={{ color: '#2e7d32', marginBottom: 0 }}>Gestiunea a fost alimentată cu succes.</p>}
      </section>

      {/* Transfer între gestiuni */}
      <section style={{ border: '1px solid #eee', borderRadius: '8px', padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Transfer între gestiuni</h2>
          <button
            type="button"
            onClick={() => {
              setTransferDeschis((v) => !v);
              setTransferError(null);
            }}
            style={{ ...butonStyle, background: transferDeschis ? '#eee' : '#e3f2fd' }}
          >
            {transferDeschis ? 'Închide transferul ▲' : '⇄ Transfer între gestiuni'}
          </button>
        </div>
        {transferOk && <p style={{ color: '#2e7d32', marginBottom: 0 }}>{transferOk}</p>}
        {transferDeschis && (
          <>
            <p style={{ color: '#666' }}>
              Mută o cantitate dintr-o gestiune (fermă) în alta. Stocul sursei scade, iar cel al destinației crește, la
              prețul mediu al sursei din momentul transferului. Dacă ferma destinație nu are încă acea substanță, gestiunea
              ei se creează automat.
            </p>
            <form
              onSubmit={salveazaTransfer}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}
            >
              <label>
                Din gestiunea (fermă — substanță)
                <select
                  value={transferForm.sursa_id}
                  onChange={(e) => {
                    setTransferForm((prev) => ({
                      ...prev,
                      sursa_id: e.target.value,
                      cantitate_um: '',
                      ferma_dest_id: prev.ferma_dest_id === (stocuri.find((x) => x.id === e.target.value)?.ferma_id ?? '') ? '' : prev.ferma_dest_id,
                    }));
                    setTransferOk(null);
                  }}
                  style={{ ...inputStyle, minWidth: '280px' }}
                >
                  <option value="">— alege sursa —</option>
                  {optiuniSursaTransfer.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.ferme?.nume ?? '—'} — {x.nume} (stoc {x.stoc_curent} {x.unitate_masura})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                În ferma
                <select
                  value={transferForm.ferma_dest_id}
                  onChange={(e) => {
                    setTransferForm((prev) => ({ ...prev, ferma_dest_id: e.target.value }));
                    setTransferOk(null);
                  }}
                  style={inputStyle}
                >
                  <option value="">— alege ferma destinație —</option>
                  {ferme
                    .filter((f) => f.id !== sursaTransfer?.ferma_id)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nume}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Cantitate {sursaTransfer ? `(${sursaTransfer.unitate_masura})` : ''}
                <CantitateCuUm
                  baza={sursaTransfer?.unitate_masura}
                  value={transferForm.cantitate}
                  um={transferForm.cantitate_um}
                  onChange={(v, u) => {
                    setTransferForm((prev) => ({ ...prev, cantitate: v, cantitate_um: u }));
                    setTransferOk(null);
                  }}
                  style={inputStyle}
                />
              </label>
              <label>
                Dată
                <input
                  type="date"
                  value={transferForm.data}
                  onChange={(e) => setTransferForm((prev) => ({ ...prev, data: e.target.value }))}
                  style={inputStyle}
                />
              </label>
              <label>
                Notă (opțional)
                <input
                  type="text"
                  value={transferForm.nota}
                  onChange={(e) => setTransferForm((prev) => ({ ...prev, nota: e.target.value }))}
                  style={inputStyle}
                />
              </label>
              <button type="submit" disabled={transferSaving} style={{ ...butonStyle, background: transferSaving ? '#eee' : '#e8f5e9' }}>
                {transferSaving ? 'Se transferă...' : 'Transferă'}
              </button>
            </form>
            {sursaTransfer && !Number.isNaN(cantitateTransfer) && cantitateTransfer > 0 && (
              <p style={{ color: '#666', marginBottom: 0 }}>
                Valoare transferată: {formatLei(cantitateTransfer * (sursaTransfer.pret_unitar ?? 0))} (preț mediu{' '}
                {formatLei(sursaTransfer.pret_unitar)}/{sursaTransfer.unitate_masura}). Rămâne în sursă:{' '}
                {Math.round(((sursaTransfer.stoc_curent ?? 0) - cantitateTransfer) * 1e6) / 1e6} {sursaTransfer.unitate_masura}.
              </p>
            )}
            {transferError && <p style={{ color: '#b00020', marginBottom: 0 }}>{transferError}</p>}
          </>
        )}
      </section>

      {/* Stoc curent */}
      <section style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Stoc curent pe ferme</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '0.4rem' }}>Fermă</th>
              <th style={{ padding: '0.4rem' }}>Substanță</th>
              <th style={{ padding: '0.4rem' }}>Stoc curent</th>
              <th style={{ padding: '0.4rem' }}>Preț mediu</th>
              <th style={{ padding: '0.4rem' }}>Valoare stoc</th>
            </tr>
          </thead>
          <tbody>
            {loadedOnce && stocuri.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '0.75rem', color: '#666' }}>
                  Nicio substanță în gestiune încă — alimentează prima din formularul de mai sus.
                </td>
              </tr>
            )}
            {stocuri.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '0.4rem' }}>{s.ferme?.nume ?? '—'}</td>
                <td style={{ padding: '0.4rem' }}>{s.nume}</td>
                <td style={{ padding: '0.4rem' }}>
                  {s.stoc_curent} {s.unitate_masura}
                </td>
                <td style={{ padding: '0.4rem' }}>
                  {s.pret_unitar !== null ? `${formatLei(s.pret_unitar)}/${s.unitate_masura}` : '—'}
                </td>
                <td style={{ padding: '0.4rem' }}>{formatLei(s.pret_unitar !== null ? s.pret_unitar * s.stoc_curent : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Istoric intrări */}
      <section style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Istoric alimentări (ultimele 50)</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '0.4rem' }}>Dată</th>
              <th style={{ padding: '0.4rem' }}>Fermă</th>
              <th style={{ padding: '0.4rem' }}>Substanță</th>
              <th style={{ padding: '0.4rem' }}>Cantitate</th>
              <th style={{ padding: '0.4rem' }}>Preț intrare</th>
              <th style={{ padding: '0.4rem' }}>Furnizor</th>
              <th style={{ padding: '0.4rem' }}>Introdus de</th>
              <th style={{ padding: '0.4rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {loadedOnce && intrari.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '0.75rem', color: '#666' }}>
                  Niciun istoric încă.
                </td>
              </tr>
            )}
            {intrari.map((i) => {
              const extinsa = intrareExtinsa === i.id;
              return (
                <Fragment key={i.id}>
                  <tr
                    onClick={() => deschideEditareIntrare(i)}
                    style={{
                      borderBottom: i.nota && !extinsa ? 'none' : '1px solid #f0f0f0',
                      background: extinsa ? '#eef6ff' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    <td style={{ padding: '0.4rem' }}>{formatData(i.data)}</td>
                    <td style={{ padding: '0.4rem' }}>{i.substante?.ferme?.nume ?? '—'}</td>
                    <td style={{ padding: '0.4rem' }}>{i.substante?.nume ?? '—'}</td>
                    <td style={{ padding: '0.4rem' }}>
                      {i.cantitate} {i.substante?.unitate_masura ?? ''}
                    </td>
                    <td style={{ padding: '0.4rem' }}>
                      {formatLei(i.pret_intrare_unitar)}/{i.substante?.unitate_masura ?? ''}
                    </td>
                    <td style={{ padding: '0.4rem' }}>{i.furnizor ?? '—'}</td>
                    <td style={{ padding: '0.4rem' }}>{i.utilizatori?.nume ?? '—'}</td>
                    <td style={{ padding: '0.4rem', color: '#666', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {extinsa ? 'Ascunde ▲' : 'Corectează ▼'}
                    </td>
                  </tr>
                  {i.nota && !extinsa && (
                    <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td colSpan={8} style={{ padding: '0 0.4rem 0.5rem', color: '#666', fontSize: '0.85rem' }}>
                        {i.nota}
                      </td>
                    </tr>
                  )}
                  {extinsa && editIntrareForm && (
                    <tr>
                      <td colSpan={8} style={{ padding: '0.75rem', background: '#fafafa' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                          <label>
                            Fermă
                            <select
                              value={editIntrareForm.ferma_id}
                              onChange={(e) => setEditIntrareForm({ ...editIntrareForm, ferma_id: e.target.value })}
                              style={inputStyle}
                            >
                              <option value="">— alege ferma —</option>
                              {ferme.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.nume}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Cantitate
                            <CantitateCuUm
                              baza={i.substante?.unitate_masura}
                              value={editIntrareForm.cantitate}
                              um={editIntrareForm.cantitate_um}
                              onChange={(v, u) => setEditIntrareForm({ ...editIntrareForm, cantitate: v, cantitate_um: u })}
                              style={inputStyle}
                            />
                          </label>
                          <label>
                            Preț intrare
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editIntrareForm.pret_intrare_unitar}
                              onChange={(e) => setEditIntrareForm({ ...editIntrareForm, pret_intrare_unitar: e.target.value })}
                              style={inputStyle}
                            />
                          </label>
                          <label>
                            Dată
                            <input
                              type="date"
                              value={editIntrareForm.data}
                              onChange={(e) => setEditIntrareForm({ ...editIntrareForm, data: e.target.value })}
                              style={inputStyle}
                            />
                          </label>
                          <label>
                            Furnizor
                            <input
                              type="text"
                              value={editIntrareForm.furnizor}
                              onChange={(e) => setEditIntrareForm({ ...editIntrareForm, furnizor: e.target.value })}
                              style={inputStyle}
                            />
                          </label>
                          <label>
                            Notă
                            <input
                              type="text"
                              value={editIntrareForm.nota}
                              onChange={(e) => setEditIntrareForm({ ...editIntrareForm, nota: e.target.value })}
                              style={inputStyle}
                            />
                          </label>
                          <button
                            onClick={() => void salveazaEditareIntrare(i.id)}
                            disabled={editIntrareSaving}
                            style={{ ...butonStyle, background: editIntrareSaving ? '#eee' : '#e8f5e9' }}
                          >
                            {editIntrareSaving ? 'Se salvează...' : 'Salvează corecția'}
                          </button>
                        </div>
                        <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem', marginBottom: 0 }}>
                          Substanța nu se poate schimba aici. Corectarea recalculează automat stocul și prețul
                          mediu, ca și cum alimentarea ar fi fost introdusă corect de la început — dacă schimbi
                          ferma, recalculează atât pe ferma veche (care pierde alimentarea), cât și pe cea nouă.
                        </p>
                        {editIntrareError && <p style={{ color: '#b00020', marginTop: '0.5rem', marginBottom: 0 }}>{editIntrareError}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      {transferuri.length > 0 && (
        <section style={{ overflowX: 'auto' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Istoric transferuri (ultimele 50)</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                <th style={{ padding: '0.4rem' }}>Dată</th>
                <th style={{ padding: '0.4rem' }}>Substanță</th>
                <th style={{ padding: '0.4rem' }}>Din</th>
                <th style={{ padding: '0.4rem' }}>În</th>
                <th style={{ padding: '0.4rem' }}>Cantitate</th>
                <th style={{ padding: '0.4rem' }}>Valoare</th>
                <th style={{ padding: '0.4rem' }}>Operat de</th>
                <th style={{ padding: '0.4rem' }}>Notă</th>
              </tr>
            </thead>
            <tbody>
              {transferuri.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '0.4rem' }}>{formatData(t.data)}</td>
                  <td style={{ padding: '0.4rem' }}>{t.sursa?.nume ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{t.sursa?.ferme?.nume ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{t.dest?.ferme?.nume ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>
                    {t.cantitate} {t.sursa?.unitate_masura ?? ''}
                  </td>
                  <td style={{ padding: '0.4rem' }}>{formatLei(t.cantitate * t.pret_unitar)}</td>
                  <td style={{ padding: '0.4rem' }}>{t.utilizatori?.nume ?? '—'}</td>
                  <td style={{ padding: '0.4rem', color: '#666' }}>{t.nota ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {nomenclatorModalDeschis && (
        <div
          onClick={() => setNomenclatorModalDeschis(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.25)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '10px',
              width: 'min(560px, 100%)',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid #eee' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Nomenclator substanțe ({nomenclator.length})</h2>
              <button
                onClick={() => setNomenclatorModalDeschis(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1, color: '#666' }}
                aria-label="Închide"
              >
                ×
              </button>
            </div>
            <div style={{ padding: '0.75rem 1.25rem' }}>
              <input
                type="text"
                value={cautareNomenclator}
                onChange={(e) => setCautareNomenclator(e.target.value)}
                placeholder="Caută după denumire..."
                style={{ ...inputStyle, width: '100%', minWidth: 0 }}
              />
            </div>
            <div style={{ overflowY: 'auto', padding: '0 1.25rem 1.25rem' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    <th style={{ padding: '0.4rem', position: 'sticky', top: 0, background: '#fff' }}>Denumire</th>
                    <th style={{ padding: '0.4rem', position: 'sticky', top: 0, background: '#fff' }}>U.M.</th>
                  </tr>
                </thead>
                <tbody>
                  {nomenclator
                    .filter((n) => n.nume.toLowerCase().includes(cautareNomenclator.trim().toLowerCase()))
                    .map((n) => (
                      <tr key={n.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                        <td style={{ padding: '0.4rem' }}>{n.nume}</td>
                        <td style={{ padding: '0.4rem', color: '#888' }}>{n.unitate_masura}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      <RaportStocSubstante stocuri={stocuri} momentul={momentRaport} />
    </main>
  );
}

function SubstanteAdminFerma() {
  const [stocuri, setStocuri] = useState<SubstantaStoc[]>([]);
  const [intrari, setIntrari] = useState<Intrare[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [momentRaport, setMomentRaport] = useState<Date>(() => new Date());

  // Reîncarcă stocul chiar înainte de tipărire, ca raportul să fie „la zi".
  async function tiparesteStoc() {
    await incarca();
    setMomentRaport(new Date());
    setTimeout(() => window.print(), 150);
  }

  async function incarca() {
    setLoading(true);
    setLoadError(null);

    const [stocuriRes, intrariRes] = await Promise.all([
      supabase
        .from('substante')
        .select('id, nume, unitate_masura, stoc_curent, pret_unitar, ferma_id, ferme(nume)')
        .order('nume')
        .order('id'),
      supabase
        .from('substante_intrari')
        .select('id, cantitate, pret_intrare_unitar, data, furnizor, nota, created_at, substante(nume, unitate_masura, ferme(nume)), utilizatori(nume)')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    setLoading(false);
    setLoadedOnce(true);

    if (stocuriRes.error) {
      setLoadError(stocuriRes.error.message);
      return;
    }
    if (intrariRes.error) {
      setLoadError(intrariRes.error.message);
      return;
    }

    setStocuri((stocuriRes.data as unknown as SubstantaStoc[]) ?? []);
    setIntrari((intrariRes.data as unknown as Intrare[]) ?? []);
  }

  useEffect(() => {
    void incarca();
  }, []);

  return (
    <main
      className="substante-ecran"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: 'clamp(0.75rem, 3vw, 1.5rem)',
        gap: '1.25rem',
      }}
    >
      <style>{STIL_RAPORT_STOC}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Substanțe</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => void incarca()} disabled={loading} style={{ ...butonStyle, background: loading ? '#eee' : '#f5f5f5' }}>
            {loading ? 'Se încarcă...' : 'Reîncarcă'}
          </button>
          <button
            onClick={() => void tiparesteStoc()}
            disabled={loading}
            title="Reîncarcă stocul și tipărește pe A4 un raport la zi al stocului de substanțe."
            style={butonStyle}
          >
            Tipărește stoc
          </button>
        </div>
      </div>
      <p style={{ color: '#666', marginTop: '-0.75rem' }}>
        Alimentarea gestiunii se face de către admin general. Aici vezi stocul curent și istoricul intrărilor pentru
        ferma ta.
      </p>

      {loadError && (
        <p style={{ color: '#b00020', background: '#fdecea', padding: '0.75rem', borderRadius: '6px' }}>{loadError}</p>
      )}

      <section style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Stoc curent</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '0.4rem' }}>Substanță</th>
              <th style={{ padding: '0.4rem' }}>Stoc curent</th>
              <th style={{ padding: '0.4rem' }}>Preț mediu</th>
              <th style={{ padding: '0.4rem' }}>Valoare stoc</th>
            </tr>
          </thead>
          <tbody>
            {loadedOnce && stocuri.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '0.75rem', color: '#666' }}>
                  Nicio substanță în gestiune încă.
                </td>
              </tr>
            )}
            {stocuri.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '0.4rem' }}>{s.nume}</td>
                <td style={{ padding: '0.4rem' }}>
                  {s.stoc_curent} {s.unitate_masura}
                </td>
                <td style={{ padding: '0.4rem' }}>
                  {s.pret_unitar !== null ? `${formatLei(s.pret_unitar)}/${s.unitate_masura}` : '—'}
                </td>
                <td style={{ padding: '0.4rem' }}>{formatLei(s.pret_unitar !== null ? s.pret_unitar * s.stoc_curent : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Istoric alimentări (ultimele 50)</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '0.4rem' }}>Dată</th>
              <th style={{ padding: '0.4rem' }}>Substanță</th>
              <th style={{ padding: '0.4rem' }}>Cantitate</th>
              <th style={{ padding: '0.4rem' }}>Preț intrare</th>
              <th style={{ padding: '0.4rem' }}>Furnizor</th>
            </tr>
          </thead>
          <tbody>
            {loadedOnce && intrari.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '0.75rem', color: '#666' }}>
                  Niciun istoric încă.
                </td>
              </tr>
            )}
            {intrari.map((i) => (
              <tr key={i.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '0.4rem' }}>{formatData(i.data)}</td>
                <td style={{ padding: '0.4rem' }}>{i.substante?.nume ?? '—'}</td>
                <td style={{ padding: '0.4rem' }}>
                  {i.cantitate} {i.substante?.unitate_masura ?? ''}
                </td>
                <td style={{ padding: '0.4rem' }}>
                  {formatLei(i.pret_intrare_unitar)}/{i.substante?.unitate_masura ?? ''}
                </td>
                <td style={{ padding: '0.4rem' }}>{i.furnizor ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <RaportStocSubstante stocuri={stocuri} momentul={momentRaport} />
    </main>
  );
}
