import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/index.mjs';

// covers: AC-1
test('add somma', () => { assert.equal(add(1, 2), 3); });
