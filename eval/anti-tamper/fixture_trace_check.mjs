#!/usr/bin/env node
// fixture_trace_check.mjs — gate STANDALONE dei 6 fixture di trace (AT-1 Fase B).
// Asserisce, su FATTI (L-COL-002): (a) ORTOGONALITA' — validate_blueprint PASS su ogni
// seeded-blueprint (i fixture sono strutturalmente validi: il trace e' un concern di
// FILE, non di struttura del blueprint); (b) lo STATO-TAG su disco atteso per scenario,
// via textTracesAc sul file reale (cosi' il keystone Task 5 verifica solo il VERDETTO
// end-to-end). Node ESM, solo built-in. exit 0 = tutti PASS, 1 = un fail, 2 = precondizione.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTasks } from '../../trueline/scripts/blueprint/blueprint_tasks.mjs';
import { textTracesAc } from '../../trueline/scripts/blueprint/ac_assertion_trace_check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const VALIDATE = resolve(ROOT, 'trueline', 'scripts', 'blueprint', 'validate_blueprint.mjs');
const FIX = __dirname;

const checks = [];
const assert = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const bp = (id) => resolve(FIX, id, 'seeded-blueprint');
const app = (id) => resolve(FIX, id, 'reference-app');
const fileHas = (id, rel, acId) => {
  const p = join(app(id), rel);
  return existsSync(p) && textTracesAc(readFileSync(p, 'utf8'), acId);
};
function validateOk(id) {
  const r = spawnSync(process.execPath, [VALIDATE, bp(id)], { encoding: 'utf8' });
  return r.status === 0;
}

const ALL = ['tampered-untagged', 'tag-in-stringa', 'ac-multi-file', 'covers-scalare', 'tag-spurio', 'mixed-coverage'];

// Precondizione: ogni fixture esiste (blueprint + reference-app).
const missing = ALL.filter((id) => !existsSync(bp(id)) || !existsSync(app(id)));
if (missing.length) {
  console.log(`=== fixture_trace_check: (precondizione mancante) === ${missing.join(', ')}`);
  process.exit(2);
}

// (a) ORTOGONALITA': validate_blueprint PASS su tutti.
for (const id of ALL) assert(`[${id}] validate_blueprint PASS (ortogonalita')`, validateOk(id), bp(id));

// (b) STATO-TAG atteso per scenario (sui file reali su disco).
assert('[tampered-untagged] a.test.mjs esiste ma NON traccia AC-1',
  existsSync(join(app('tampered-untagged'), 'tests/a.test.mjs')) && !fileHas('tampered-untagged', 'tests/a.test.mjs', 'AC-1'));
assert('[tag-in-stringa] a.test.mjs NON traccia AC-1 (covers solo in stringa)',
  !fileHas('tag-in-stringa', 'tests/a.test.mjs', 'AC-1'));
assert('[ac-multi-file] a.test.mjs traccia AC-1, b.test.mjs NO, entrambi su disco',
  fileHas('ac-multi-file', 'tests/a.test.mjs', 'AC-1') && !fileHas('ac-multi-file', 'tests/b.test.mjs', 'AC-1')
  && existsSync(join(app('ac-multi-file'), 'tests/b.test.mjs')));
assert('[covers-scalare] covers e\' SCALARE → loadTasks normalizza a [AC-1]; a.test.mjs traccia AC-1', (() => {
  const tasks = loadTasks(bp('covers-scalare'));
  const tt = tasks[0] && tasks[0].target_tests && tasks[0].target_tests[0];
  return tt && Array.isArray(tt.covers) && tt.covers.includes('AC-1') && fileHas('covers-scalare', 'tests/a.test.mjs', 'AC-1');
})());
assert('[tag-spurio] a.test.mjs traccia AC-1 reale (e contiene anche covers:AC-99 spurio)', (() => {
  const p = join(app('tag-spurio'), 'tests/a.test.mjs');
  const txt = existsSync(p) ? readFileSync(p, 'utf8') : '';
  return textTracesAc(txt, 'AC-1') && /covers:\s*AC-99\b/.test(txt);
})());
assert('[mixed-coverage] a.test.mjs traccia AC-1; b.test.mjs MANCANTE su disco',
  fileHas('mixed-coverage', 'tests/a.test.mjs', 'AC-1') && !existsSync(join(app('mixed-coverage'), 'tests/b.test.mjs')));

const allOk = checks.every((c) => c.ok);
console.log(`=== FIXTURE_TRACE_CHECK: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length})`);
process.exit(allOk ? 0 : 1);
