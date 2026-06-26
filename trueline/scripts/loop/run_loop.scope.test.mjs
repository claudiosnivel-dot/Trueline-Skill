// run_loop.scope.test.mjs — selectInScope ammette authz Firestore SOLO se nel
// verified_set del manifest (SP-8). Prova della BIT-invarianza del default v1:
// senza authz nel set (o senza manifest) il finding authz NON entra nel loop.
// Solo built-in; nessun side-effect su filesystem (test puro sulla funzione).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectInScope } from './run_loop.mjs';

test('selectInScope ammette authz solo se nel verified_set del manifest', () => {
  const fAuthz = { category: 'authz', fingerprint: 'x', location: { file: 'firestore.rules' } };
  const mfNoAuthz = { verified_set: ['secret', 'rls', 'dead-code'] };
  const mfAuthz = { verified_set: ['secret', 'dead-code', 'authz'] };
  assert.equal(selectInScope([fAuthz], mfNoAuthz).length, 0, 'senza authz nel set -> escluso (BIT-invariante)');
  assert.equal(selectInScope([fAuthz], mfAuthz).length, 1, 'con authz nel set + firestore.rules -> ammesso');
});

test('selectInScope senza manifest (default v1) NON ammette authz', () => {
  const fAuthz = { category: 'authz', fingerprint: 'x', location: { file: 'firestore.rules' } };
  // Nessun manifest -> verifiedSetFrom ritorna {secret, rls, dead-code}: authz fuori.
  assert.equal(selectInScope([fAuthz]).length, 0, 'default v1 esclude authz (BIT-invariante)');
  assert.equal(selectInScope([fAuthz], null).length, 0, 'manifest null -> default v1 esclude authz');
});

test('selectInScope: authz fuori firestore.rules NON e\' ammessa anche col set authz', () => {
  // Una regola authz su un file diverso (es. semgrep authz su src) non e' FB-S3.
  const fOther = { category: 'authz', fingerprint: 'z', location: { file: 'src/api.ts' } };
  const mfAuthz = { verified_set: ['secret', 'dead-code', 'authz'] };
  assert.equal(selectInScope([fOther], mfAuthz).length, 0, 'authz non-firestore.rules -> escluso');
});
