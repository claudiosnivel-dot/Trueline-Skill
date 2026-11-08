// control4_ac.test.mjs — il ramo AC-acceptance del controllo 4 (AT-1 Fase A).
// Verifica: (a) default invariato (no blueprintDir -> ramo legacy degradato);
// (b) target_test verde -> verde; (c) target_test rosso -> RED; (d) file vacuo
// (nessun test()) -> RED (floor anti-vacuo); (e) nessun file materializzato ->
// degradato (non verde); (f) manifest senza run_file -> ramo legacy (guard);
// (g) VR-1: manifest senza run_file ma progetto vitest -> ramo per-AC col runner vitest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { control4Conformance } from './checkpoint.mjs';

const MANIFEST = { test_runner: { run_file: 'node --test {file}' } };
// Il tag `covers:` va DENTRO il file di test, non solo nel blueprint: la Fase B ha
// aggiunto la precondizione di TRACE (assertionTrace) PRIMA del floor anti-vacuo e
// prima dell'esecuzione, quindi un target_test non taggato esce «non tracciabile
// all'AC» e non arriva mai al ramo che questi test vogliono esercitare. Senza il tag,
// tre di questi sei test non misuravano cio' che dichiarano: due erano ROSSI dal
// 26/06/2026, e il terzo — «target_test che fallisce -> RED» — era VERDE PER LA
// RAGIONE SBAGLIATA, rosso di trace invece che rosso di test fallito.
function scaffold({ testBody, covers = 'AC-1' }) {
  const root = mkdtempSync(join(tmpdir(), 'c4-'));
  const app = join(root, 'app'); const bp = join(root, 'bp');
  mkdirSync(join(app, 'tests'), { recursive: true }); mkdirSync(bp, { recursive: true });
  if (testBody !== null) writeFileSync(join(app, 'tests', 'a.test.mjs'), `// covers: ${covers}\n${testBody}`);
  writeFileSync(join(bp, '01.md'), [
    '```yaml', '- id: T-1', '  macrotask: m', '  objective: o', '  definition_of_done: [d]',
    '  acceptance_criteria:', '    - id: AC-1', '      given: g', '      when: w', '      then: t',
    '  target_tests:', '    - file: "tests/a.test.mjs"', `      covers: ${covers}`, '```',
  ].join('\n'));
  return { app, bp };
}

test('default (no blueprintDir) -> ramo legacy invariato (degradato senza test/charz)', () => {
  const { app } = scaffold({ testBody: null });
  const c = control4Conformance(app, { mode: 'build' });
  assert.equal(c.id, 4); assert.equal(c.green, false); assert.equal(c.status, 'degraded');
});

test('AC-acceptance: target_test verde -> controllo 4 verde', () => {
  const { app, bp } = scaffold({ testBody: "import {test} from 'node:test'; import a from 'node:assert/strict'; test('x',()=>a.equal(1,1));" });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(c.green, true);
});

test('AC-acceptance: target_test che fallisce -> RED', () => {
  const { app, bp } = scaffold({ testBody: "import {test} from 'node:test'; import a from 'node:assert/strict'; test('x',()=>a.equal(1,2));" });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(c.green, false);
});

test('AC-acceptance: file senza test (vacuo) -> RED (floor anti-vacuo)', () => {
  const { app, bp } = scaffold({ testBody: 'const x=1; export default x;' });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(c.green, false); assert.match(c.detail, /vacuo|alcun test/i);
});

test('AC-acceptance: nessun file materializzato -> degradato (non verde)', () => {
  const { app, bp } = scaffold({ testBody: null });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(c.green, false); assert.equal(c.status, 'degraded');
});

test('manifest senza run_file -> ramo legacy (guard)', () => {
  const { app, bp } = scaffold({ testBody: "import {test} from 'node:test'; test('x',()=>{});" });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: { test_runner: {} } });
  assert.equal(c.status, 'degraded'); // non entra nel ramo AC
});

// VR-1: postgres-jsts e gli altri pack JS/TS non dichiarano run_file. Se il progetto
// dichiara vitest e il manifest lo riconosce, il ramo per-AC si attiva col runner vitest
// (qui il vitest FINTO di eval/vitest-runner; il vero sta in run_file.vitest.test.mjs).
test('manifest senza run_file + progetto vitest -> ramo per-AC col runner vitest', () => {
  const { app, bp } = scaffold({ testBody: "import { it } from 'vitest'; // FAKE:pass 1" });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ type: 'module', devDependencies: { vitest: '5.1.0' } }));
  cpSync(fileURLToPath(new URL('../../../eval/vitest-runner/fake-vitest/', import.meta.url)), join(app, 'node_modules', 'vitest'), { recursive: true });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: { test_runner: { detect: ['vitest', 'jest'] } } });
  assert.equal(c.status, 'green', c.detail);
  assert.match(c.detail, /accettazione AC: 1 target_test verdi/);
});
