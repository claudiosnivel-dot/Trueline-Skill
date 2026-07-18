// characterization.test.mjs — un test node:test che PASSA. Dependency-free
// (importa solo src/dead.ts): controlli 3 (regressioni) e 4 (conformance) verdi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usedHelper } from '../src/dead.ts';

test('usedHelper e vivo e corretto', () => {
  assert.equal(typeof usedHelper, 'function');
  assert.equal(usedHelper(), 7);
});
