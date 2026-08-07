import { supabase } from '../../../lib/supabaseClient';

type FarmSummary = {
  id: string;
  nume: string;
  cost_ora_lucru: number | null;
};

type FarmTotals = {
  ferme: FarmSummary[];
  parcelaAreas: Record<string, number>;
  laborCosts: Record<string, number>;
  materialCosts: Record<string, number>;
  indirectCosts: Record<string, Record<string, number>>;
};

function formatPeriod(date: string) {
  const dt = new Date(date);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

async function fetchFarmData() {
  const [{ data: farms, error: farmError }, { data: parcels, error: parcelError }, { data: operations, error: opError }, { data: materials, error: matError }, { data: indirects, error: indirectError }] = await Promise.all([
    supabase.from('ferme').select('id,nume,cost_ora_lucru'),
    supabase.from('parcele').select('ferma_id,suprafata_mp'),
    supabase.from('operatiuni').select('id,parcela_id,data,ore_lucru,parcele(ferma_id)'),
    supabase.from('operatiuni_substante').select('cantitate,substante(pret_unitar),operatiuni(parcela_id,parcele(ferma_id))'),
    supabase.from('cheltuieli_indirecte').select('ferma_id,data,valoare')
  ]);

  if (farmError) throw new Error(farmError.message);
  if (parcelError) throw new Error(parcelError.message);
  if (opError) throw new Error(opError.message);
  if (matError) throw new Error(matError.message);
  if (indirectError) throw new Error(indirectError.message);

  return {
    farms: farms ?? [],
    parcels: parcels ?? [],
    operations: operations ?? [],
    materials: materials ?? [],
    indirects: indirects ?? []
  };
}

export default async function DashboardCostProducție() {
  const { farms, parcels, operations, materials, indirects } = await fetchFarmData();

  const parcelaAreas: Record<string, number> = {};
  parcels.forEach((parcela: any) => {
    const fermaId = parcela.ferma_id;
    parcelaAreas[fermaId] = (parcelaAreas[fermaId] ?? 0) + Number(parcela.suprafata_mp || 0);
  });

  const laborCosts: Record<string, number> = {};
  operations.forEach((op: any) => {
    const fermaId = op.parcele?.ferma_id;
    const costOra = farms.find((f: any) => f.id === fermaId)?.cost_ora_lucru ?? 0;
    const ore = Number(op.ore_lucru || 0);
    laborCosts[fermaId] = (laborCosts[fermaId] ?? 0) + ore * costOra;
  });

  const materialCosts: Record<string, number> = {};
  materials.forEach((item: any) => {
    const fermaId = item.operatiuni?.parcele?.ferma_id;
    const pret = Number(item.substante?.pret_unitar || 0);
    const qty = Number(item.cantitate || 0);
    materialCosts[fermaId] = (materialCosts[fermaId] ?? 0) + pret * qty;
  });

  const indirectCosts: Record<string, Record<string, number>> = {};
  indirects.forEach((item: any) => {
    const fermaId = item.ferma_id;
    const period = formatPeriod(item.data);
    indirectCosts[fermaId] = indirectCosts[fermaId] ?? {};
    indirectCosts[fermaId][period] = (indirectCosts[fermaId][period] ?? 0) + Number(item.valoare || 0);
  });

  const rows: Array<{ ferma: string; period: string; totalCost: number; area: number; costPerMp: number }> = [];

  farms.forEach((farm: any) => {
    const area = parcelaAreas[farm.id] ?? 0;
    const labor = laborCosts[farm.id] ?? 0;
    const material = materialCosts[farm.id] ?? 0;
    const periods = Object.keys(indirectCosts[farm.id] ?? {});

    if (periods.length === 0) {
      const totalCost = labor + material;
      rows.push({
        ferma: farm.nume,
        period: 'Subtotal',
        totalCost,
        area,
        costPerMp: area > 0 ? totalCost / area : 0
      });
      return;
    }

    periods.forEach((period) => {
      const indirect = indirectCosts[farm.id][period] ?? 0;
      const totalCost = labor + material + indirect;
      rows.push({
        ferma: farm.nume,
        period,
        totalCost,
        area,
        costPerMp: area > 0 ? totalCost / area : 0
      });
    });
  });

  return (
    <main style={{ padding: '2rem' }}>
      <h1>Cost de producție</h1>
      <p>Analiză costuri pe fermă și perioadă.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '0.75rem' }}>Fermă</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '0.75rem' }}>Perioadă</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '0.75rem' }}>Cost total</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '0.75rem' }}>Suprafață (mp)</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '0.75rem' }}>Cost / mp</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.ferma}-${row.period}`}>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid #f0f0f0' }}>{row.ferma}</td>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid #f0f0f0' }}>{row.period}</td>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>{row.totalCost.toFixed(2)} lei</td>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>{row.area}</td>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid #f0f0f0', textAlign: 'right' }}>{row.costPerMp.toFixed(2)} lei/mp</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
