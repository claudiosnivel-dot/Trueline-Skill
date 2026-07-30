import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thing } from '../src/thing.mjs';
import { mirror } from '../mirror.mjs';

// covers: AC-1
test('mirror rispecchia thing', () => {
  assert.deepEqual(mirror, thing);
});
