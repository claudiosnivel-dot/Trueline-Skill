#!/usr/bin/env node
// run_deadcode.test.mjs — Task C3 > Step 1 (SP-0) + T2.0 (SP-2): dispatch --tool.
//
// Gate: node trueline/scripts/oracles/run_deadcode.test.mjs
// Atteso: OK + exit 0
//
// Casi testati:
//   1. default (knip): JSON valido, issues include unused.ts, exit 0.
//   2. --tool=knip esplicito: identico al default (smoke: instradato a knip).
//   3. --tool=__nope__: JSON valido, issues=[], note "tool __nope__ non supportato", exit 0.
//   4. --tool=vulture (SP-2 T2.0) sulla fixture postgres-py/reference-app:
//        JSON { tool:"vulture", issues:[...] } con >=1 issue name=="_unused_helper"
//        (SEED:PY-S5) e NESSUNA issue name=="used_helper" (contrasto/precisione).
//        Falsi positivi del framework su altri simboli sono tollerati.

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const SCRIPT = resolve(__dirname, 'run_deadcode.mjs');
const REF_APP = resolve(ROOT, 'eval', 'reference-app');
const PY_REF_APP = resolve(ROOT, 'eval', 'ecosystems', 'postgres-py', 'reference-app');

const results = [];
const check = (n, ok, detail) => {
  results.push({ n, ok: Boolean(ok) });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${detail ? ` — ${detail}` : ''}`);
};

function runDeadcode(extraArgs = [], timeoutMs = 60_000) {
  const r = spawnSync(
    process.execPath,
    [SCRIPT, REF_APP, ...extraArgs],
    { encoding: 'utf8', timeout: timeoutMs, env: process.env }
  );
  return r;
}

// Variante con project-dir esplicito (per la fixture Python di vulture).
function runDeadcodeOn(projectDir, extraArgs = [], timeoutMs = 60_000) {
  return spawnSync(
    process.execPath,
    [SCRIPT, projectDir, ...extraArgs],
    { encoding: 'utf8', timeout: timeoutMs, env: process.env }
  );
}

// ─── Caso 1: default (knip) ────────────────────────────────────────────────
console.log('\n[C3] Caso 1: default (nessun --tool) → knip');
{
  const r = runDeadcode([], 90_000);
  const exitOk = r.status === 0;
  check('caso-1 exit 0', exitOk, `exit=${r.status}`);

  let parsed = null;
  let parseOk = false;
  try { parsed = JSON.parse(r.stdout); parseOk = true; } catch (e) { /* nop */ }
  check('caso-1 stdout JSON valido', parseOk, parseOk ? '' : `stdout=${r.stdout.slice(0, 200)}`);

  if (parseOk) {
    // knip emette { files: [...] } o { issues: {...} } — cerchiamo 'unused.ts' nel testo grezzo
    const rawStr = JSON.stringify(parsed);
    const hasUnused = rawStr.includes('unused.ts');
    check('caso-1 unused.ts presente nell\'output knip', hasUnused, hasUnused ? '' : 'unused.ts non trovato nel JSON');
  }
}

// ─── Caso 2: --tool=knip esplicito ────────────────────────────────────────
console.log('\n[C3] Caso 2: --tool=knip esplicito → identico al default');
{
  const r = runDeadcode(['--tool=knip'], 90_000);
  const exitOk = r.status === 0;
  check('caso-2 exit 0', exitOk, `exit=${r.status}`);

  let parsed = null;
  let parseOk = false;
  try { parsed = JSON.parse(r.stdout); parseOk = true; } catch (e) { /* nop */ }
  check('caso-2 stdout JSON valido', parseOk, parseOk ? '' : `stdout=${r.stdout.slice(0, 200)}`);

  if (parseOk) {
    const rawStr = JSON.stringify(parsed);
    const hasUnused = rawStr.includes('unused.ts');
    check('caso-2 unused.ts presente nell\'output knip', hasUnused, hasUnused ? '' : 'unused.ts non trovato nel JSON');
  }
}

// ─── Caso 3: --tool=__nope__ (tool sconosciuto) ───────────────────────────
console.log('\n[C3] Caso 3: --tool=__nope__ → JSON vuoto + nota, mai falso verde');
{
  const r = runDeadcode(['--tool=__nope__'], 10_000);
  const exitOk = r.status === 0;
  check('caso-3 exit 0 (tool ignoto non e un errore di esecuzione)', exitOk, `exit=${r.status}`);

  let parsed = null;
  let parseOk = false;
  try { parsed = JSON.parse(r.stdout); parseOk = true; } catch (e) { /* nop */ }
  check('caso-3 stdout JSON valido', parseOk, parseOk ? '' : `stdout=${r.stdout.slice(0, 200)}`);

  if (parseOk) {
    // Deve avere issues vuoto (mai falso verde)
    const issuesOk = Array.isArray(parsed.issues) && parsed.issues.length === 0;
    check('caso-3 issues=[] (mai falso verde)', issuesOk, `issues=${JSON.stringify(parsed.issues)}`);

    // Deve avere una nota che menziona il tool
    const noteOk = typeof parsed.note === 'string' && parsed.note.includes('__nope__');
    check('caso-3 note contiene il nome del tool', noteOk, `note=${JSON.stringify(parsed.note)}`);
  }
}

// ─── Caso 4: --tool=vulture (SP-2 T2.0) sulla fixture Python ───────────────
console.log('\n[T2.0] Caso 4: --tool=vulture → segnala _unused_helper, NON used_helper');
{
  const r = runDeadcodeOn(PY_REF_APP, ['--tool=vulture'], 90_000);
  const exitOk = r.status === 0;
  check('caso-4 exit 0 (vulture eseguito, issue = informazione)', exitOk, `exit=${r.status} stderr=${(r.stderr || '').slice(0, 200)}`);

  let parsed = null;
  let parseOk = false;
  try { parsed = JSON.parse(r.stdout); parseOk = true; } catch (e) { /* nop */ }
  check('caso-4 stdout JSON valido', parseOk, parseOk ? '' : `stdout=${(r.stdout || '').slice(0, 300)}`);

  if (parseOk) {
    const toolOk = parsed.tool === 'vulture';
    check('caso-4 tool=="vulture"', toolOk, `tool=${JSON.stringify(parsed.tool)}`);

    const issuesOk = Array.isArray(parsed.issues);
    check('caso-4 issues e un array', issuesOk, `typeof issues=${typeof parsed.issues}`);

    const names = issuesOk ? parsed.issues.map((i) => i.name) : [];

    // SEED:PY-S5 — _unused_helper deve essere segnalato.
    const hasDead = names.includes('_unused_helper');
    check('caso-4 segnala _unused_helper (SEED:PY-S5)', hasDead, `names=${JSON.stringify(names)}`);

    // Contrasto/precisione — used_helper e usato, NON deve comparire.
    const noUsed = !names.includes('used_helper');
    check('caso-4 NON segnala used_helper (contrasto)', noUsed, `names=${JSON.stringify(names)}`);

    // La issue _unused_helper deve avere i campi del parser popolati.
    const dead = issuesOk ? parsed.issues.find((i) => i.name === '_unused_helper') : null;
    const fieldsOk = !!dead
      && typeof dead.file === 'string' && dead.file.length > 0
      && Number.isInteger(dead.line) && dead.line > 0
      && typeof dead.type === 'string' && dead.type.length > 0
      && Number.isInteger(dead.confidence);
    check('caso-4 issue _unused_helper ha file/line/type/confidence', fieldsOk, `issue=${JSON.stringify(dead)}`);
  }
}

// ─── Riepilogo ────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
if (failed.length > 0) {
  console.log('Test falliti:');
  failed.forEach((r) => console.log(`  - ${r.n}`));
}
process.exit(failed.length === 0 ? 0 : 1);
