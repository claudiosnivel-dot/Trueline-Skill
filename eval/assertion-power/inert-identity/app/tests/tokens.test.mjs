// SPECIMEN — NON e' un difetto da correggere.
// Questo test e' DELIBERATAMENTE inerte: assert.deepEqual(config.theme.extend.colors, colors)
// confronta lo STESSO oggetto, perche' config.mjs importa colors per riferimento.
// E' il caso misurato il 30/07/2026 su progetto-web-ai, ridotto al minimo.
// Consumato da: eval/harness/assertion_power_check.mjs -> sotto-test `inert:detected`.
// Correggerlo renderebbe ROSSO il keystone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import { colors } from '../src/tokens.mjs';

// covers: AC-1
test('la theme deriva dai token', () => {
  assert.deepEqual(config.theme.extend.colors, colors);
});
