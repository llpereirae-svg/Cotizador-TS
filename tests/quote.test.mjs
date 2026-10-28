import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote } from '../assets/quote.js';

test('la estimación reproduce los ejemplos observados en el cotizador', () => {
  const examples = [
    [1, 12, 840, 126, 966],
    [5, 60, 1800, 270, 2070],
    [10, 120, 3000, 450, 3450],
    [20, 240, 5400, 810, 6210],
    [50, 600, 12600, 1890, 14490]
  ];
  for (const [monthly, annual, baseCents, taxCents, totalCents] of examples) {
    assert.deepEqual(calculateQuote(monthly), { monthly, annual, baseCents, taxCents, totalCents });
  }
});

test('la estimación rechaza cantidades vacías, no enteras o fuera de rango', () => {
  for (const monthly of [undefined, null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.equal(calculateQuote(monthly), null);
  }
});
