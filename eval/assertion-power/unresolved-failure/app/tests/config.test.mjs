// SPECIMEN — NON e' un difetto da correggere.
// Questo target_test usa il binding ATTESO a livello di MODULO, fuori da ogni test():
// neutralizzato EXPECTED, la riga lancia PRIMA che node:test registri alcunche', quindi il
// file esegue ZERO test. L'oracolo DOVEVA farcela e non ce l'ha fatta: e' un GUASTO
// (kind 'failure'), non un limite per costruzione — quindi DEGRADA, a differenza di
// eval/assertion-power/unresolved, dove l'oracolo semplicemente non arriva.
// Consumato da: eval/harness/assertion_power_check.mjs -> sotto-test `failure-unresolved:degraded`.
// Correggerlo (spostando la riga dentro il test) renderebbe ROSSO il keystone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.mjs';
import { EXPECTED } from './expected.mjs';

// USO A LIVELLO DI MODULO del binding atteso: e' questo che fa esplodere l'import.
const HOST = EXPECTED.url.toUpperCase();

// covers: AC-1
test('la config e\' quella attesa', () => {
  assert.deepEqual(CONFIG, EXPECTED);
  assert.ok(HOST.length > 0);
});
