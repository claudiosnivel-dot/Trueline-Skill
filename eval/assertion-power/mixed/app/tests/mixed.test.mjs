// SPECIMEN — NON e' un difetto da correggere.
// Due candidati DELIBERATAMENTE di natura diversa nello stesso target_test:
//   - [A vs EXPECTED_A] e' AGGIUDICABILE: neutralizzando EXPECTED_A il file diventa rosso,
//     quindi quell'asserzione ha potere;
//   - [mirror vs thing] e' STRUCTURAL: l'initializer di `thing` e' una chiamata, e
//     l'oracolo non sa renderlo inerte. Si DICHIARA, e non degrada.
// E' il caso misto che nessun'altra fixture arbitra: VERDE, con la dichiarazione accanto.
// Consumato da: eval/harness/assertion_power_check.mjs -> sotto-test `mixed:green-with-declared`.
// Correggerlo renderebbe ROSSO il keystone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A } from '../src/a.mjs';
import { EXPECTED_A } from './expected.mjs';
import { thing } from '../src/thing.mjs';
import { mirror } from '../src/mirror.mjs';

// covers: AC-1
test('A e\' quello atteso', () => {
  assert.deepEqual(A, EXPECTED_A);
});

// covers: AC-2
test('mirror rispecchia thing', () => {
  assert.deepEqual(mirror, thing);
});
