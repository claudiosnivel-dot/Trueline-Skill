import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colors } from '../src/theme.mjs';
import { EXPECTED_COLORS } from './expected.mjs';

// covers: AC-1
test('la palette e\' quella attesa', () => {
  assert.deepEqual(colors, EXPECTED_COLORS);
});
