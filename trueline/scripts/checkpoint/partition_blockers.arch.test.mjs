import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionBlockers } from './checkpoint.mjs';

const mk = (oracle, fp, extra = {}) => ({
  fingerprint: fp, category: 'architecture', fix_state: 'detected',
  source_oracle: { oracle, rule_id: 'r' }, ...extra,
});

test('arch: gate ASSOLUTO — un finding pre-esistente BLOCCA comunque', () => {
  const base = new Set(['fp-arch']);
  const out = partitionBlockers([mk('arch', 'fp-arch')], base);
  assert.equal(out.length, 1, 'arch pre-esistente deve restare blocker (assoluto)');
});

test('cycle: delta — un finding pre-esistente NON blocca', () => {
  const out = partitionBlockers([mk('cycle', 'fp-cyc')], new Set(['fp-cyc']));
  assert.equal(out.length, 0);
});

test('arch accepted-risk: riportato ma NON blocca', () => {
  const out = partitionBlockers([mk('arch', 'fp-x', { fix_state: 'accepted-risk' })], new Set());
  assert.equal(out.length, 0);
});
