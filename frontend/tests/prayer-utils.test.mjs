import test from 'node:test';
import assert from 'node:assert/strict';

import { applyOffset, normalizeHHMM, assertDistinctMaghribIsha } from '../src/prayer-utils.js';

test('applyOffset handles positive rollover past midnight', () => {
  assert.equal(applyOffset('23:58', 5), '00:03');
});

test('applyOffset handles negative rollover before midnight', () => {
  assert.equal(applyOffset('00:03', -5), '23:58');
});

test('normalizeHHMM strips timezone suffixes like (CET)', () => {
  assert.equal(normalizeHHMM('19:21 (CET)'), '19:21');
});

test('maghrib and isha stay distinct when source values differ', () => {
  const day = { maghrib: '17:30', isha: '19:21' };
  assert.equal(assertDistinctMaghribIsha(day), true);
});

test('distinct guard fails when values are accidentally mapped equal', () => {
  const day = { maghrib: '17:30', isha: '17:30' };
  assert.equal(assertDistinctMaghribIsha(day), false);
});
