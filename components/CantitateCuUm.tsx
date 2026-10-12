'use client';

import type { CSSProperties } from 'react';
import { formateazaCantitate, inBaza, optiuniUm, parseazaNumar } from '../lib/unitati';

type Props = {
  /** Unitatea de bază a produsului (l / kg / buc). Dacă lipsește, se afișează doar câmpul de cantitate. */
  baza: string | null | undefined;
  /** Textul tastat. */
  value: string;
  /** Unitatea aleasă pentru introducere (baza sau o subunitate). */
  um: string;
  onChange: (value: string, um: string) => void;
  style?: CSSProperties;
  placeholder?: string;
  disabled?: boolean;
};

/**
 * Câmp de cantitate cu alegerea unității de introducere (ex. ml / l, g / kg).
 * Valoarea în unitatea de bază se obține cu `inBaza(parseazaNumar(value), um, baza)`.
 */
export default function CantitateCuUm({ baza, value, um, onChange, style, placeholder, disabled }: Props) {
  const optiuni = baza ? optiuniUm(baza) : [];
  const umEfectiv = baza && optiuni.some((o) => o.um === um) ? um : (baza ?? '');
  const numar = parseazaNumar(value);
  const convertit = baza && umEfectiv !== baza && !Number.isNaN(numar) ? inBaza(numar, umEfectiv, baza) : null;

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.15rem' }}>
      <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value, umEfectiv)}
          style={{ ...style, minWidth: 0 }}
        />
        {optiuni.length > 1 ? (
          <select
            value={umEfectiv}
            disabled={disabled}
            onChange={(e) => onChange(value, e.target.value)}
            style={{ ...style, width: 'auto' }}
            aria-label="Unitate de măsură"
          >
            {optiuni.map((o) => (
              <option key={o.um} value={o.um}>
                {o.um}
              </option>
            ))}
          </select>
        ) : (
          baza && <span style={{ color: '#666' }}>{baza}</span>
        )}
      </span>
      {convertit !== null && (
        <span style={{ fontSize: '0.8rem', color: '#2e7d32' }}>
          = {formateazaCantitate(convertit)} {baza}
        </span>
      )}
    </span>
  );
}
