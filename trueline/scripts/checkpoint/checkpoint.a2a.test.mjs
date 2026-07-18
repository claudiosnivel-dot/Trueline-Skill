// checkpoint.a2a.test.mjs — unit del GATING multi-oracolo del controllo 1 (A2a).
//
// Il controllo 1 diventa multi-oracolo (dead-code + dup + cycle gate, twin
// detection-only). Qui verifichiamo l'ESCLUSIONE PER-ORACOLO: twin non blocca,
// gli altri si'. Test PURO su finding sintetici (nessun tool esterno): il gate
// end-to-end sui fixture reali vive nel keystone a2a_hygiene_check (Task 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionBlockers, control1Hygiene, control1DeadCode } from './checkpoint.mjs';

test('DETECTION_ONLY_ORACLES esclude twin dai blockers (per-oracolo, non per-categoria)', () => {
  // due finding architecture: cycle GATA, twin NO (stessa categoria, oracolo diverso).
  const findings = [
    { category: 'duplication', source_oracle: { oracle: 'jscpd' }, fingerprint: 'a', baseline_status: 'new', severity: 'LOW' },
    { category: 'architecture', source_oracle: { oracle: 'cycle' }, fingerprint: 'c', baseline_status: 'new', severity: 'LOW' },
    { category: 'architecture', source_oracle: { oracle: 'twin' }, fingerprint: 'b', baseline_status: 'new', severity: 'LOW' },
  ];
  const blockers = partitionBlockers(findings, new Set());
  assert.equal(blockers.length, 2, 'jscpd + cycle bloccano, twin no');
  assert.ok(blockers.every((b) => b.source_oracle.oracle !== 'twin'), 'nessun blocker twin');
  assert.ok(blockers.some((b) => b.source_oracle.oracle === 'jscpd'));
  assert.ok(blockers.some((b) => b.source_oracle.oracle === 'cycle'));
});

test('partitionBlockers: delta — un fingerprint in baseline non blocca (pre-esistente)', () => {
  const findings = [
    { category: 'duplication', source_oracle: { oracle: 'jscpd' }, fingerprint: 'known', severity: 'LOW' },
    { category: 'duplication', source_oracle: { oracle: 'jscpd' }, fingerprint: 'fresh', severity: 'LOW' },
  ];
  const blockers = partitionBlockers(findings, new Set(['known']));
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].fingerprint, 'fresh');
  // annota baseline_status come deltaBlockers
  assert.equal(findings[0].baseline_status, 'pre-existing');
  assert.equal(findings[1].baseline_status, 'new');
});

test('control1DeadCode e\' un alias di control1Hygiene (compat chiamanti storici)', () => {
  assert.equal(control1DeadCode, control1Hygiene);
});

test('twin da solo (nessun manifest dup/cycle) -> mai un blocker: verdetto invariante', () => {
  // BIT-invarianza del verdetto: findings di soli twin -> 0 blockers -> green resta.
  const onlyTwin = [
    { category: 'architecture', source_oracle: { oracle: 'twin' }, fingerprint: 't1', severity: 'LOW' },
    { category: 'architecture', source_oracle: { oracle: 'twin' }, fingerprint: 't2', severity: 'LOW' },
  ];
  assert.equal(partitionBlockers(onlyTwin, new Set()).length, 0);
});
