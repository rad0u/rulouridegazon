export const TIPURI_OPERATIUNE = [
  'Udat',
  'Tuns',
  'Aspirat',
  'Suprainsamantare',
  'Fertilizare/Tratamente',
  'Recoltare',
] as const;

export type TipOperatiune = (typeof TIPURI_OPERATIUNE)[number];

export const TIPURI_CU_SUBSTANTE: TipOperatiune[] = ['Suprainsamantare', 'Fertilizare/Tratamente'];

export const LABEL_OPERATIUNE: Record<TipOperatiune, string> = {
  Udat: 'Udat',
  Tuns: 'Tuns',
  Aspirat: 'Aspirat',
  Suprainsamantare: 'Tratamente foliare',
  'Fertilizare/Tratamente': 'Fertilizare solidă',
  Recoltare: 'Recoltare',
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
  operatiuni_substante: SubstantaOperatiune[] | null;
};
