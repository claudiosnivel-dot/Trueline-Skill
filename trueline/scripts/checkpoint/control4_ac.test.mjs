// control4_ac.test.mjs — il ramo AC-acceptance del controllo 4 (AT-1 Fase A).
// Verifica: (a) default invariato (no blueprintDir -> ramo legacy degradato);
// (b) target_test verde -> verde; (c) target_test rosso -> RED; (d) file vacuo
// (nessun test()) -> RED (floor anti-vacuo); (e) nessun file materializzato ->
// degradato (non verde); (f) manifest senza run_file -> ramo legacy (guard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { control4Conformance } from './checkpoint.mjs';

const MANIFEST = { test_runner: { run_file: 'node --test {file}' } };
function scaffold({ testBody, covers = 'AC-1' }) {
  const root = mkdtempSync(join(tmpdir(), 'c4-'));
  const app = join(root, 'app'); const bp = join(root, 'bp');
  mkdirSync(join(app, 'tests'), { recursive: true }); mkdirSync(bp, { recursive: true });
  if (testBody !== null) writeFileSync(join(app, 'tests', 'a.test.mjs'), testBody);
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
