// ac_assertion_trace_check.test.mjs — unit test del checker di trace (AT-1 Fase B).
// Due livelli: (A) textTracesAc PURA (semantica del commento, niente IO) — copre la
// gameabilita' tag-in-stringa e l'ancoraggio dell'id; (B) assertionTrace su una temp
// fixture pid-named sotto eval/.tmp-at1b-unit-<pid> (gitignorata) — copre la logica AC
// (valutato/saltato, per-AC globale, tag spurio). Solo built-in, deterministico (pid).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textTracesAc, assertionTrace } from './ac_assertion_trace_check.mjs';

// ---------- (A) textTracesAc — semantica del commento, string-aware ----------
test('tag su riga di commento dedicata → conta', () => {
  assert.equal(textTracesAc('// covers: AC-1', 'AC-1'), true);
});
test('tag in commento di coda (dopo codice) → conta', () => {
  assert.equal(textTracesAc('runTest();   // covers: AC-1', 'AC-1'), true);
});
test('covers dentro una stringa → NON conta (gameabilita tag-in-stringa)', () => {
  assert.equal(textTracesAc('const s = "// covers: AC-1";', 'AC-1'), false);
  assert.equal(textTracesAc('const s = "covers: AC-1";', 'AC-1'), false);
});
test('covers come codice nudo (nessun commento) → NON conta', () => {
  assert.equal(textTracesAc('covers: AC-1', 'AC-1'), false);
});
test('id ancorato: AC-1 non matcha AC-10 e viceversa', () => {
  assert.equal(textTracesAc('// covers: AC-10', 'AC-1'), false);
  assert.equal(textTracesAc('// covers: AC-1', 'AC-10'), false);
  assert.equal(textTracesAc('// covers: AC-10', 'AC-10'), true);
});
test('prefissi # e -- contano come commento', () => {
  assert.equal(textTracesAc('# covers: AC-2', 'AC-2'), true);
  assert.equal(textTracesAc('-- covers: AC-2', 'AC-2'), true);
});
test('block comment /* ... */ multilinea conta', () => {
  assert.equal(textTracesAc('/*\n  covers: AC-3\n*/', 'AC-3'), true);
});
test('tag dopo la chiusura di una stringa sulla stessa riga conta', () => {
  assert.equal(textTracesAc('foo("x"); // covers: AC-1', 'AC-1'), true);
});

// ---------- (B) assertionTrace — logica AC su temp fixture -------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const TMP = join(ROOT, 'eval', `.tmp-at1b-unit-${process.pid}`);
function writeApp(files) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'tests'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(TMP, rel), content);
}
const task = (ac, tt) => [{ id: 'T-1', acceptance_criteria: ac, target_tests: tt }];

test('AC valutato e tracciato → ok', () => {
  writeApp({ 'tests/a.test.mjs': '// covers: AC-1\n' });
  const r = assertionTrace(task([{ id: 'AC-1' }], [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }]),
    TMP, ['tests/a.test.mjs']);
  assert.equal(r.ok, true);
});
test('AC valutato NON tracciato → red + untracked elencato', () => {
  writeApp({ 'tests/a.test.mjs': '// nessun tag qui\n' });
  const r = assertionTrace(task([{ id: 'AC-1' }], [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }]),
    TMP, ['tests/a.test.mjs']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.untracked, [{ task_id: 'T-1', ac_id: 'AC-1' }]);
});
test('file coprante mancante (fuori scope) → AC saltato, non red', () => {
  writeApp({ 'tests/a.test.mjs': '// covers: AC-1\n' });
  const r = assertionTrace(
    task([{ id: 'AC-1' }, { id: 'AC-2' }],
      [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }, { file: 'tests/b.test.mjs', covers: ['AC-2'] }]),
    TMP, ['tests/a.test.mjs']); // b fuori scope → AC-2 saltato
  assert.equal(r.ok, true);
});
test('per-AC GLOBALE: due file copranti, basta uno taggato', () => {
  writeApp({ 'tests/a.test.mjs': '// covers: AC-1\n', 'tests/b.test.mjs': '// niente\n' });
  const r = assertionTrace(task([{ id: 'AC-1' }],
    [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }, { file: 'tests/b.test.mjs', covers: ['AC-1'] }]),
    TMP, ['tests/a.test.mjs', 'tests/b.test.mjs']);
  assert.equal(r.ok, true);
});
test('tag spurio (AC-99 non dichiarato) ignorato, AC-1 reale traccia → ok', () => {
  writeApp({ 'tests/a.test.mjs': '// covers: AC-1\n// covers: AC-99\n' });
  const r = assertionTrace(task([{ id: 'AC-1' }], [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }]),
    TMP, ['tests/a.test.mjs']);
  assert.equal(r.ok, true);
});
test('covers scalare → trattato come [scalare] dal chiamante (qui gia array)', () => {
  writeApp({ 'tests/a.test.mjs': '// covers: AC-1\n' });
  const r = assertionTrace(task([{ id: 'AC-1' }], [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }]),
    TMP, ['tests/a.test.mjs']);
  assert.equal(r.ok, true);
});
test.after(() => { rmSync(TMP, { recursive: true, force: true }); });
