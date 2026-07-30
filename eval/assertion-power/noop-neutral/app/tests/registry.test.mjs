// SPECIMEN — NON e' un difetto da correggere.
// Il lato atteso (`EXPECTED_REGISTRY`) e' gia' nella forma inerte, quindi la
// neutralizzazione e' un NO-OP: l'oracolo non puo' aggiudicare il candidato e lo dichiara
// STRUCTURAL, senza scrivere un solo byte.
// Consumato da: eval/harness/assertion_power_check.mjs -> sotto-test `noop-neutralization:declared`.
// Correggerlo (dare valori ai due oggetti) renderebbe ROSSO il keystone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../src/registry.mjs';
import { EXPECTED_REGISTRY } from './expected.mjs';

// covers: AC-1
test('il registry e\' quello atteso', () => {
  assert.deepEqual(registry, EXPECTED_REGISTRY);
});
