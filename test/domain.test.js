import test from 'node:test';
import assert from 'node:assert/strict';
import { daysLate, validRentalDates, intervalsOverlap } from '../src/domain.js';

test('multa começa no dia seguinte e usa dias corridos', () => {
  assert.equal(daysLate('2026-12-10', '2026-12-10'), 0);
  assert.equal(daysLate('2026-12-10', '2026-12-13'), 3);
  assert.equal(daysLate('2026-12-10', '2026-12-09'), 0);
  assert.equal(daysLate('2026-12-31', '2027-01-02'), 2);
});

test('datas inválidas e invertidas são recusadas', () => {
  assert.equal(validRentalDates('2026-02-30', '2026-03-01'), false);
  assert.equal(validRentalDates('2026-12-11', '2026-12-10'), false);
  assert.equal(validRentalDates('2026-12-10', '2026-12-10'), true);
});

test('intervalos inclusivos detectam conflito no mesmo dia', () => {
  assert.equal(intervalsOverlap('2026-12-10', '2026-12-12', '2026-12-12', '2026-12-14'), true);
  assert.equal(intervalsOverlap('2026-12-10', '2026-12-11', '2026-12-12', '2026-12-14'), false);
});
