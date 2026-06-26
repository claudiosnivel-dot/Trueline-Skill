// run_file.test.mjs — micro-gate dell'esecutore single-file (AT-1 Fase A, A2).
// Tre casi: file che passa / file vuoto (testCount 0) / file che fallisce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTargetFile } from './run_file.mjs';

const TPL = 'node --test {file}';
function app(files) {
  const d = mkdtempSync(join(tmpdir(), 'rf-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}

test('file con 1 test che passa -> passed, testCount 1', () => {
  const d = app({ 'a.test.mjs': "import {test} from 'node:test'; import a from 'node:assert/strict'; test('x',()=>a.equal(1,1));" });
  const r = runTargetFile(d, 'a.test.mjs', TPL);
  assert.equal(r.error, false); assert.equal(r.passed, true); assert.ok(r.testCount >= 1);
});

test('file SENZA test -> testCount 0 (floor anti-vacuo a valle)', () => {
  const d = app({ 'e.test.mjs': 'const x = 1; export default x;' });
  const r = runTargetFile(d, 'e.test.mjs', TPL);
  assert.equal(r.error, false); assert.equal(r.testCount, 0);
});

test('file con test che fallisce -> passed false', () => {
  const d = app({ 'f.test.mjs': "import {test} from 'node:test'; import a from 'node:assert/strict'; test('x',()=>a.equal(1,2));" });
  const r = runTargetFile(d, 'f.test.mjs', TPL);
  assert.equal(r.error, false); assert.equal(r.passed, false);
});
