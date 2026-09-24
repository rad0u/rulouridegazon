export const TIPURI_OPERATIUNE = [
  'Udat',
  'Tuns',
  'Aspirat',
  'Suprainsamantare',
  'Fertilizare/Tratamente',
  'Recoltare',
  'Altele',
] as const;

export type TipOperatiune = (typeof TIPURI_OPERATIUNE)[number];

export const TIPURI_CU_SUBSTANTE: TipOperatiune[] = ['Suprainsamantare', 'Fertilizare/Tratamente'];

// 2026-09-24 (Radu): șefii de fermă nu mai aleg tipul de operațiune dintr-o
// listă lungă — doar dacă a fost fertilizare (solidă sau foliară, cu
// substanță + cantitate) sau recoltare (doar mp de gazon recoltat, pentru
// utilajele marcate "utilaj de recoltare" — vezi utilaje.este_utilaj_recoltare
// și app/activitati-parcele/ActivitatiParceleScreen.tsx). Restul sesiunilor
// confirmate primesc automat tipul generic 'Altele', fără nicio alegere din
// listă. 'Udat'/'Tuns'/'Aspirat' rămân valori valide (istoric + corectări
// manuale din ParcelaPanel, admin_central), dar nu mai sunt oferite ca
// opțiuni în fluxul zilnic de confirmare.
export const LABEL_OPERATIUNE: Record<TipOperatiune, string> = {
  Udat: 'Udat',
  Tuns: 'Tuns',
  Aspirat: 'Aspirat',
  Suprainsamantare: 'Tratamente foliare',
  'Fertilizare/Tratamente': 'Fertilizare solidă',
  Recoltare: 'Recoltare',
  Altele: 'Altă lucrare',
};

export type Substanta = {
  id: string;
  nume: string;
  unitate_masura: string;
  stoc_curent: number | null;
};

export type SubstantaOperatiune = {
  cantitate: number;
  substante: { nume: string; unitate_masura: string } | null;
};

export type Operatiune = {
  id: string;
  tip: TipOperatiune;
  data: string;
  ore_lucru: number | null;
  note: string | null;
  cantitate_mp_recoltat: number | null;
  operatiuni_substante: SubstantaOperatiune[] | null;
};
