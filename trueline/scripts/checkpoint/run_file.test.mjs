// run_file.test.mjs — micro-gate dell'esecutore single-file (AT-1 Fase A, A2).
// node --test: file che passa / file vuoto (testCount 0) / file che fallisce.
// vitest (VR-1): contratto dell'adattatore contro un vitest FINTO, deterministico e
// offline — conta, esito, file non incluso, vitest assente, scelta del runner per
// file — e risoluzione del template a livello di progetto (resolveRunFile).
// La prova contro il vitest VERO sta in run_file.vitest.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTargetFile, resolveRunFile } from './run_file.mjs';

const TPL = 'node --test {file}';
const VITEST_TPL = 'vitest run {file}';
function app(files) {
  const d = mkdtempSync(join(tmpdir(), 'rf-'));
  for (const [name, body] of Object.entries(files)) {
    const p = join(d, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
  }
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

// --- vitest FINTO -------------------------------------------------------------
// eval/vitest-runner/fake-vitest/ imita la superficie che l'adattatore usa del vitest
// vero (bin nel package.json, `run <file> --reporter=json --outputFile=<p>`, report
// Jest-compatibile); l'esito lo decide un marcatore `FAKE:...` nel file target, e ogni
// invocazione si annota in calls.log, cosi' i test vedono QUALE runner e' partito.
const FAKE_VITEST_DIR = fileURLToPath(new URL('../../../eval/vitest-runner/fake-vitest/', import.meta.url));

function vitestApp(files, { withVitest = true } = {}) {
  const d = app({
    'package.json': JSON.stringify({ type: 'module', devDependencies: { vitest: '5.1.0' } }),
    ...files,
  });
  if (withVitest) cpSync(FAKE_VITEST_DIR, join(d, 'node_modules', 'vitest'), { recursive: true });
  return d;
}
const calls = (d) => readFileSync(join(d, 'node_modules/vitest/calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('vitest: file che passa -> passed, testCount dal report del solo file target', () => {
  const d = vitestApp({ 'tests/a.test.ts': "import { it } from 'vitest'; // FAKE:pass 3" });
  const r = runTargetFile(d, 'tests/a.test.ts', VITEST_TPL);
  assert.equal(r.error, false); assert.equal(r.passed, true); assert.equal(r.testCount, 3);
  const [argv] = calls(d);
  // il filtro e' il path ASSOLUTO con `/`: vitest lo confronta per prefisso, non per sottostringa
  assert.equal(argv[1], join(d, 'tests/a.test.ts').replace(/\\/g, '/'));
});

test('vitest: file con un test che fallisce -> passed false', () => {
  const d = vitestApp({ 'tests/f.test.ts': "import { it } from 'vitest'; // FAKE:fail" });
  const r = runTargetFile(d, 'tests/f.test.ts', VITEST_TPL);
  assert.equal(r.error, false); assert.equal(r.passed, false); assert.equal(r.testCount, 2);
});

test('vitest: file senza test -> testCount 0 (floor anti-vacuo a valle)', () => {
  const d = vitestApp({ 'tests/e.test.ts': "import 'vitest'; // FAKE:empty" });
  const r = runTargetFile(d, 'tests/e.test.ts', VITEST_TPL);
  assert.equal(r.error, false); assert.equal(r.testCount, 0);
});

test('vitest: file non incluso dalla config -> testCount 0 e detail che lo dice', () => {
  const d = vitestApp({ 'tests/x.test.ts': "import 'vitest'; // FAKE:excluded" });
  const r = runTargetFile(d, 'tests/x.test.ts', VITEST_TPL);
  assert.equal(r.error, false); assert.equal(r.testCount, 0); assert.equal(r.passed, false);
  assert.match(r.detail, /non incluso/);
});

test('vitest: il filtro include anche un altro file -> si conta solo il target, e un rosso altrui non diventa verde', () => {
  const d = vitestApp({ 'tests/o.test.ts': "import { it } from 'vitest'; // FAKE:other" });
  const r = runTargetFile(d, 'tests/o.test.ts', VITEST_TPL);
  assert.equal(r.error, false); assert.equal(r.testCount, 1); assert.equal(r.passed, false);
  assert.match(r.detail, /altri 1 file/);
});

test('vitest: assente in node_modules -> error dichiarato, mai un verde', () => {
  const d = vitestApp({ 'tests/a.test.ts': "import { it } from 'vitest'; // FAKE:pass 1" }, { withVitest: false });
  const r = runTargetFile(d, 'tests/a.test.ts', VITEST_TPL);
  assert.equal(r.error, true); assert.equal(r.passed, false); assert.match(r.detail, /vitest/);
});

test('vitest: un file che importa node:test gira con node --test anche col template vitest', () => {
  const d = vitestApp({ 'tests/n.test.mjs': "import {test} from 'node:test'; import a from 'node:assert/strict'; test('x',()=>a.equal(1,1));" });
  const r = runTargetFile(d, 'tests/n.test.mjs', VITEST_TPL);
  assert.equal(r.error, false); assert.equal(r.passed, true); assert.equal(r.testCount, 1);
  assert.match(r.detail, /node:test/);
});

test('node --test: un file che importa da vitest gira con vitest anche col template node', () => {
  const d = vitestApp({ 'tests/v.test.ts': "import { it, expect } from 'vitest'; // FAKE:pass 2" });
  const r = runTargetFile(d, 'tests/v.test.ts', TPL);
  assert.equal(r.error, false); assert.equal(r.passed, true); assert.equal(r.testCount, 2);
  assert.equal(calls(d).length, 1);
});

// --- resolveRunFile: il template a livello di progetto -------------------------
test('resolveRunFile: il run_file dichiarato dal manifest vince sempre', () => {
  const d = vitestApp({});
  const m = { test_runner: { detect: ['vitest', 'node:test'], run_file: 'node --test {file}' } };
  assert.equal(resolveRunFile(d, m), 'node --test {file}');
});

test('resolveRunFile: manifest senza run_file + vitest dichiarato dal progetto -> template vitest', () => {
  const d = vitestApp({});
  assert.equal(resolveRunFile(d, { test_runner: { detect: ['vitest', 'jest'] } }), 'vitest run {file}');
});

test('resolveRunFile: progetto senza vitest -> null (ramo legacy invariato)', () => {
  const d = app({ 'package.json': JSON.stringify({ devDependencies: { jest: '30.0.0' } }) });
  assert.equal(resolveRunFile(d, { test_runner: { detect: ['vitest', 'jest'] } }), null);
});

test('resolveRunFile: manifest che non riconosce vitest -> null anche se il progetto lo usa', () => {
  const d = vitestApp({});
  assert.equal(resolveRunFile(d, { test_runner: { detect: ['pytest'] } }), null);
  assert.equal(resolveRunFile(d, null), null);
});
