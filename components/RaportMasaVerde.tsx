'use client';

// 2026-10-30 (Radu): raport „Inventar masă verde” — pe fiecare parcelă, desenul
// conturului inițial (gri) cu conturul măsurat al gazonului rămas (verde)
// suprapus exact pe conturul din SW Maps, și lângă el legenda: suprafața totală
// și masa verde (mp). Pagină de sinteză + câte o secțiune per parcelă, A4 portret.
// Același mecanism de tipărire ca la raportul de stoc substanțe.

import {
  formatDataLunga,
  formatHa,
  formatMp,
  grupeazaPeParcela,
  lungimeScara,
  pregatesteDesen,
  type GrupParcela,
  type RandInventar,
} from '../lib/inventarMasaVerde';

const VERDE = '#2e9e4f';
const VERDE_MARGINE = '#1b6e32';
const GRI = '#d9d9d9';
const GRI_MARGINE = '#555';

function DesenParcela({ grup }: { grup: GrupParcela }) {
  const toate = [...(grup.poligonParcela ? [grup.poligonParcela] : []), ...grup.poligoaneMasaVerde];
  const desen = pregatesteDesen(toate);
  if (!desen) return <div className="mv-fara-desen">Contur indisponibil</div>;

  const scara = lungimeScara(desen.latimeM);
  const u = desen.unit;
  const xScara = desen.x0;
  const yScara = desen.yJos + u * 0.5;
  const fontSize = u * 3.2;

  return (
    <svg viewBox={desen.viewBox} className="mv-svg" role="img" aria-label={`Parcela ${grup.nume}`} preserveAspectRatio="xMidYMid meet">
      {grup.poligonParcela && (
        <path d={desen.cale(grup.poligonParcela)} fill={GRI} stroke={GRI_MARGINE} strokeWidth={1.4} vectorEffect="non-scaling-stroke" fillRule="evenodd" />
      )}
      {grup.poligoaneMasaVerde.map((p, i) => (
        <path key={i} d={desen.cale(p)} fill={VERDE} stroke={VERDE_MARGINE} strokeWidth={1.2} vectorEffect="non-scaling-stroke" fillRule="evenodd" />
      ))}
      {/* bară de scară */}
      <g>
        <line x1={xScara} y1={yScara} x2={xScara + scara} y2={yScara} stroke="#000" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={xScara} y1={yScara - u} x2={xScara} y2={yScara + u} stroke="#000" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={xScara + scara} y1={yScara - u} x2={xScara + scara} y2={yScara + u} stroke="#000" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <text x={xScara + scara + u} y={yScara + fontSize * 0.35} fontSize={fontSize} fill="#000">
          {scara} m
        </text>
      </g>
      {/* nord */}
      <g>
        <text x={desen.latimeM - u * 4} y={u * 6} fontSize={fontSize * 1.3} fontWeight="bold" textAnchor="middle" fill="#000">
          N
        </text>
        <line x1={desen.latimeM - u * 4} y1={u * 9} x2={desen.latimeM - u * 4} y2={u * 6.8} stroke="#000" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

export default function RaportMasaVerde({
  fermaNume,
  dataInventar,
  randuri,
  nota,
}: {
  fermaNume: string;
  dataInventar: string;
  randuri: RandInventar[];
  nota?: string | null;
}) {
  const grupuri = grupeazaPeParcela(randuri);
  const totalMasaVerde = grupuri.reduce((s, g) => s + g.masaVerdeMp, 0);
  const totalSuprafata = grupuri.reduce((s, g) => s + (g.totalMp ?? 0), 0);
  const dataText = formatDataLunga(dataInventar);

  return (
    <section className="raport-mv">
      <div className="mv-pagina">
        <h2>INVENTAR MASĂ VERDĂ</h2>
        <div className="mv-antet">
          <div>
            <strong>Fermă:</strong> {fermaNume}
          </div>
          <div>
            <strong>Inventar la data de:</strong> {dataText}
          </div>
          <div className="mv-mic" style={{ gridColumn: '1 / -1' }}>
            SC Rulouri de Gazon SRL · {grupuri.length} {grupuri.length === 1 ? 'parcelă măsurată' : 'parcele măsurate'} · suprafețele
            „masă verde” sunt calculate din conturul măsurat în teren (SW Maps).{nota ? ` ${nota}` : ''}
          </div>
        </div>
        <table className="mv-tabel">
          <thead>
            <tr>
              <th>Parcela</th>
              <th className="mv-dr">Suprafață totală (mp)</th>
              <th className="mv-dr">Masă verde (mp)</th>
              <th className="mv-dr">Masă verde (ha)</th>
              <th className="mv-dr">% din parcelă</th>
            </tr>
          </thead>
          <tbody>
            {grupuri.map((g) => (
              <tr key={g.cheie}>
                <td>{g.nume}</td>
                <td className="mv-dr">{g.totalMp !== null ? formatMp(g.totalMp) : '—'}</td>
                <td className="mv-dr">{formatMp(g.masaVerdeMp)}</td>
                <td className="mv-dr">{formatHa(g.masaVerdeMp)}</td>
                <td className="mv-dr">{g.totalMp ? `${Math.round((g.masaVerdeMp / g.totalMp) * 100)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>TOTAL</strong>
              </td>
              <td className="mv-dr">
                <strong>{formatMp(totalSuprafata)}</strong>
              </td>
              <td className="mv-dr">
                <strong>{formatMp(totalMasaVerde)}</strong>
              </td>
              <td className="mv-dr">
                <strong>{formatHa(totalMasaVerde)}</strong>
              </td>
              <td className="mv-dr">
                <strong>{totalSuprafata > 0 ? `${Math.round((totalMasaVerde / totalSuprafata) * 100)}%` : '—'}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {grupuri.map((g) => (
        <div key={g.cheie} className="mv-bloc">
          <div className="mv-bloc-titlu">
            <span>
              {fermaNume} — Parcela {g.nume}
            </span>
            <span>Inventar la {dataText}</span>
          </div>
          <div className="mv-bloc-corp">
            <div className="mv-desen">
              <DesenParcela grup={g} />
            </div>
            <div className="mv-legenda">
              <div className="mv-leg-rand">
                <span className="mv-leg-patrat" style={{ background: GRI, borderColor: GRI_MARGINE }} />
                <div>
                  <div className="mv-leg-eticheta">Suprafață totală</div>
                  <div className="mv-leg-valoare">{g.totalMp !== null ? `${formatMp(g.totalMp)} mp` : 'necunoscută'}</div>
                  {g.totalMp !== null && <div className="mv-leg-mic">{formatHa(g.totalMp)} ha</div>}
                </div>
              </div>
              <div className="mv-leg-rand">
                <span className="mv-leg-patrat" style={{ background: VERDE, borderColor: VERDE_MARGINE }} />
                <div>
                  <div className="mv-leg-eticheta">Masă verde</div>
                  <div className="mv-leg-valoare">{formatMp(g.masaVerdeMp)} mp</div>
                  <div className="mv-leg-mic">
                    {formatHa(g.masaVerdeMp)} ha
                    {g.totalMp ? ` · ${Math.round((g.masaVerdeMp / g.totalMp) * 100)}% din parcelă` : ''}
                  </div>
                </div>
              </div>
              {g.poligonParcela === null && (
                <div className="mv-leg-mic">Parcela nu avea contur desenat la data inventarului — se vede doar masa verde.</div>
              )}
              {g.poligoaneMasaVerde.length > 1 && (
                <div className="mv-leg-mic">Masa verde e formată din {g.poligoaneMasaVerde.length} contururi măsurate.</div>
              )}
              {g.totalMp !== null && g.masaVerdeMp > g.totalMp * 1.02 && (
                <div className="mv-leg-mic mv-avert">Atenție: masa verde măsurată depășește suprafața totală a parcelei.</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

// Stiluri: pe ecran raportul se vede ca o previzualizare; la tipărire (@media print)
// se ascunde tot restul paginii (clasa .inventar-ecran e pe containerul ecranului).
export const STIL_RAPORT_MASA_VERDE = `
  .raport-mv { color: #000; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-top: 1rem; }
  .raport-mv h2 { margin: 0; font-size: 16pt; text-align: center; }
  .raport-mv .mv-antet { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin: 8px 0 10px; font-size: 10pt; }
  .raport-mv .mv-mic { font-size: 8.5pt; color: #333; }
  .raport-mv .mv-tabel { width: 100%; border-collapse: collapse; }
  .raport-mv .mv-tabel th, .raport-mv .mv-tabel td { border: 1px solid #000; padding: 3px 6px; font-size: 10pt; text-align: left; }
  .raport-mv .mv-tabel th { background: #eee; }
  .raport-mv .mv-dr { text-align: right !important; }
  .raport-mv .mv-bloc { border: 1px solid #000; margin-top: 14px; break-inside: avoid; page-break-inside: avoid; }
  .raport-mv .mv-bloc-titlu { display: flex; justify-content: space-between; gap: 8px; background: #eee; padding: 4px 8px; font-weight: bold; font-size: 11pt; border-bottom: 1px solid #000; }
  .raport-mv .mv-bloc-corp { display: flex; gap: 12px; padding: 8px; align-items: stretch; }
  .raport-mv .mv-desen { flex: 1 1 64%; min-width: 0; display: flex; align-items: center; justify-content: center; }
  .raport-mv .mv-svg { width: 100%; height: auto; max-height: 112mm; display: block; }
  .raport-mv .mv-fara-desen { color: #777; font-size: 10pt; padding: 2rem; }
  .raport-mv .mv-legenda { flex: 0 0 34%; display: flex; flex-direction: column; justify-content: center; gap: 14px; font-size: 10pt; }
  .raport-mv .mv-leg-rand { display: flex; gap: 8px; align-items: flex-start; }
  .raport-mv .mv-leg-patrat { flex: 0 0 auto; width: 16px; height: 16px; border: 1.5px solid #000; margin-top: 3px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .raport-mv .mv-leg-eticheta { font-size: 9.5pt; color: #333; }
  .raport-mv .mv-leg-valoare { font-size: 14pt; font-weight: bold; }
  .raport-mv .mv-leg-mic { font-size: 8.5pt; color: #444; }
  .raport-mv .mv-avert { color: #c00000; font-weight: bold; }
  .raport-mv svg path, .raport-mv svg line, .raport-mv svg text { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print {
    @page { size: A4 portrait; margin: 10mm; }
    body { background: #fff !important; }
    header { display: none !important; }
    body div:has(> header) { display: block !important; min-height: 0 !important; }
    main { display: block !important; min-height: 0 !important; padding: 0 !important; }
    .inventar-ecran > *:not(.raport-mv) { display: none !important; }
    .raport-mv { border: none; padding: 0 2px 0 0; margin: 0; border-radius: 0; box-sizing: border-box; width: 100%; }
    .raport-mv .mv-bloc { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .raport-mv .mv-tabel th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .raport-mv .mv-svg { max-height: 108mm; }
  }
`;
