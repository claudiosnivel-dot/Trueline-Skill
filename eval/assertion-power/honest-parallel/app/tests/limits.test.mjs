import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_LIMITS } from '../src/document.mjs';
import { POOL_LIMITS } from '../src/pool.mjs';

// covers: AC-1
test('i tetti non sono divergiti', () => {
  assert.equal(DOCUMENT_LIMITS.error_issues, POOL_LIMITS.error_issues);
});
