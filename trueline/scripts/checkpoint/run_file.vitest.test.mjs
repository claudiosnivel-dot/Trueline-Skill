// run_file.vitest.test.mjs — prova END-TO-END del runner vitest contro il vitest VERO
// (VR-1). La fixture e' eval/vitest-runner/app: sorgenti tracciati, vitest provvigionato
// con `npm install` lì dentro. Senza vitest installato i test si SALTANO DICHIARATI
// (L-COL-006: un controllo che non gira non e' un verde), come gli end-to-end di
// run_gitleaks quando gitleaks manca.
//
// Cosa prova, oltre al contratto gia' coperto dal vitest finto di run_file.test.mjs:
//   - conta ed esito sul vitest reale (passa / fallisce / file senza test);
//   - il controllo 4 entra nel ramo per-AC con un manifest SENZA run_file (postgres-jsts
//     e gli altri pack JS/TS) quando il progetto dichiara vitest, e va verde;
//   - il potere dell'asserzione funziona sotto vitest: la tautologia di inert.test.mjs
//     esce INERTE -> controllo 4 rosso, e il modulo neutralizzato torna bit-identico.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTargetFile, VITEST_RUN_FILE } from './run_file.mjs';
import { control4Conformance } from './checkpoint.mjs';

const APP = fileURLToPath(new URL('../../../eval/vitest-runner/app/', import.meta.url));
const skip = existsSync(join(APP, 'node_modules', 'vitest', 'package.json'))
  ? false
  : 'vitest reale non provvigionato: npm install in eval/vitest-runner/app (saltato, NON verde)';
const MANIFEST = { test_runner: { detect: ['vitest', 'jest', 'node:test'] } };
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

test('vitest reale: file che passa -> passed, testCount 1', { skip }, () => {
  const r = runTargetFile(APP, 'tests/sane.test.mjs', VITEST_RUN_FILE);
  assert.equal(r.error, false, r.detail); assert.equal(r.passed, true, r.detail); assert.equal(r.testCount, 1);
});

test('vitest reale: file che fallisce -> passed false, testCount 1', { skip }, () => {
  const r = runTargetFile(APP, 'tests/failing.test.mjs', VITEST_RUN_FILE);
  assert.equal(r.error, false, r.detail); assert.equal(r.passed, false); assert.equal(r.testCount, 1);
});

// Con --passWithNoTests vitest 5.1.0 chiude un file senza test come suite `passed` ed
// exit 0 (misurato): il rosso non viene dal runner ma dal floor anti-vacuo a valle, come
// per node --test. Qui si prova che il conteggio e' 0, e sotto che il controllo 4 lo rifiuta.
test('vitest reale: file senza test -> testCount 0', { skip }, () => {
  const r = runTargetFile(APP, 'tests/empty.test.mjs', VITEST_RUN_FILE);
  assert.equal(r.error, false, r.detail); assert.equal(r.testCount, 0);
});

test('controllo 4: manifest senza run_file + progetto vitest -> ramo per-AC, verde', { skip }, () => {
  const c = control4Conformance(APP, { mode: 'build', blueprintDir: join(APP, 'bp', 'sane'), manifest: MANIFEST });
  assert.equal(c.status, 'green', c.detail);
  assert.match(c.detail, /accettazione AC: 1 target_test verdi/);
});

test('controllo 4: target_test vitest senza test -> rosso per il floor anti-vacuo', { skip }, () => {
  const c = control4Conformance(APP, { mode: 'build', blueprintDir: join(APP, 'bp', 'empty'), manifest: MANIFEST });
  assert.equal(c.status, 'red', c.detail);
  assert.match(c.detail, /vacuo/);
});

test('controllo 4: tautologia sotto vitest -> INERTE, rosso, modulo ripristinato bit-identico', { skip }, () => {
  const tokens = join(APP, 'src', 'tokens.mjs');
  const before = sha(tokens);
  const c = control4Conformance(APP, { mode: 'build', blueprintDir: join(APP, 'bp', 'inert'), manifest: MANIFEST });
  assert.equal(c.status, 'red', c.detail);
  assert.match(c.detail, /INERTE/);
  assert.match(c.detail, /TOKENS/);
  assert.equal(sha(tokens), before);
});
