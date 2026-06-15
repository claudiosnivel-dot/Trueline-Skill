#!/usr/bin/env node
// m1_gate_check.mjs — GATE M1 (checkpoint + verify-fix loop).
//
// Asserisce, in modo DETERMINISTICO (L-COL-002: verde = output reale di comando,
// mai una frase), i criteri di M1 (10 §3 criterio 2 + 10 §4 criterio 7):
//
//   A) SET IN-SCOPE verificato-a-zero -> fix_state = verified:
//        S1 (secret working-tree), S3/S4/S5 (rls), S8 (dead-code).
//   B) S2 (secret-in-history) -> fix_state ESATTAMENTE mitigated-residual,
//        MAI verified (rotazione simulata; history rewrite distruttiva = no auto).
//   C) GIT A STRATI esercitato:
//        - BUILD verde + non-coupled            -> merge autonomo
//        - BUILD verde + coupled / unknown      -> merge SOSPESO (human-gated)
//        - REMEDIATE                            -> merge human-gated
//        - operazione distruttiva               -> bloccata in autonomia
//   D) CHECKPOINT: controlli 1-2 verdi (delta), 3-4 DEGRADATI (M3, non falso verde).
//   E) INTEGRITA FIXTURE: dopo il loop, eval/reference-app e' INTATTO ->
//        i gate M0 (detection + present) escono ancora 0; nessuna copia temp
//        residua in eval/.tmp-verify.
//
// Esce 0 se TUTTI i criteri passano, 1 altrimenti.
//
// Node ESM, solo built-in + l'orchestratore del loop.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const RUN_LOOP = resolve(ROOT, 'trueline', 'scripts', 'loop', 'run_loop.mjs');
const RUN_EVAL = resolve(ROOT, 'eval', 'harness', 'run_eval.mjs');
const TMP_VERIFY = resolve(ROOT, 'eval', '.tmp-verify');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

function nodeRun(script, args) {
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// baseName robusto (i path della copia temp possono variare per scope).
const bn = (p) => String(p).replace(/\\/g, '/').split('/').pop();

console.log('============================================================');
console.log(' GATE M1 — checkpoint + verify-fix loop');
console.log(`   reference-app : ${resolve(ROOT, 'eval', 'reference-app')}`);
console.log('   set in-scope  : S1,S3,S4,S5,S8 -> verified; S2 -> mitigated-residual');
console.log('============================================================');
console.log('');

// --- Esegui il loop in EVAL-MODE su una COPIA TEMP ---------------------------
console.log('1) Esecuzione loop (--eval --mode=remediate) su copia temporanea:');
const loop = nodeRun(RUN_LOOP, ['--eval', '--mode=remediate']);
let report = null;
try { report = JSON.parse(loop.stdout); } catch { /* gestito sotto */ }
assert('run_loop esce 0 ed emette JSON', loop.status === 0 && report, `exit=${loop.status}`);

if (!report) {
  console.log('\nRESULT: FAIL — il loop non ha prodotto un report parsabile');
  console.log((loop.stderr || loop.stdout || '').split('\n').slice(-5).join('\n'));
  process.exit(1);
}

const F = report.findings || [];
// Helper: trova un finding per categoria + predicato sul file.
const find = (cat, fileBn, scope) => F.find((f) =>
  f.category === cat
  && bn(f.location.file) === fileBn
  && (scope ? true : true));

// --- A) SET IN-SCOPE -> verified ---------------------------------------------
console.log('');
console.log('2) Set in-scope verificato-a-zero -> fix_state=verified:');

// S1: secret working-tree su config.ts. (Possono esserci 2 regole sullo stesso
// literal: tutte le occorrenze su config.ts devono essere verified.)
const s1 = F.filter((f) => f.category === 'secret' && bn(f.location.file) === 'config.ts');
assert('S1 secret (config.ts) -> verified',
  s1.length > 0 && s1.every((f) => f.fix_state === 'verified'),
  `${s1.length} finding, stati=[${s1.map((f) => f.fix_state).join(',')}]`);

// S3/S4/S5: rls.
const rlsByRule = (rule) => F.find((f) => f.category === 'rls' && f.rule_id === rule);
for (const [label, rule] of [
  ['S3', 'RLS001_MISSING_RLS'],
  ['S4', 'RLS003_PERMISSIVE_TRUE'],
  ['S5', 'RLS004_MISSING_TENANT_PREDICATE'],
]) {
  const f = rlsByRule(rule);
  assert(`${label} rls (${rule}) -> verified`, f && f.fix_state === 'verified',
    f ? `fix_state=${f.fix_state}` : 'finding assente');
}

// S8: dead-code su unused.ts.
const s8 = find('dead-code', 'unused.ts');
assert('S8 dead-code (unused.ts) -> verified', s8 && s8.fix_state === 'verified',
  s8 ? `fix_state=${s8.fix_state}` : 'finding assente');

// --- B) S2 -> ESATTAMENTE mitigated-residual, MAI verified -------------------
console.log('');
console.log('3) S2 secret-in-history -> ESATTAMENTE mitigated-residual (MAI verified):');
const s2 = F.filter((f) => f.category === 'secret' && bn(f.location.file) === 'credentials.ts');
assert('S2 secret (credentials.ts) presente', s2.length > 0, `${s2.length} finding`);
assert('S2 -> tutti mitigated-residual', s2.length > 0 && s2.every((f) => f.fix_state === 'mitigated-residual'),
  `stati=[${s2.map((f) => f.fix_state).join(',')}]`);
assert('S2 -> NESSUNO verified (asserzione dura 05 §7)',
  s2.every((f) => f.fix_state !== 'verified'), 'nessun finding S2 e\' verified');

// --- C) GIT A STRATI ---------------------------------------------------------
console.log('');
console.log('4) Git a strati esercitato:');
const m = (report.git && report.git.merge) || {};
assert('BUILD verde + non-coupled -> merge AUTONOMO',
  m.build_noncoupled && m.build_noncoupled.autonomous_merge_allowed === true,
  m.build_noncoupled && m.build_noncoupled.gate);
assert('BUILD verde + coupled -> merge SOSPESO (human-gated)',
  m.build_coupled && m.build_coupled.autonomous_merge_allowed === false,
  m.build_coupled && m.build_coupled.gate);
assert('BUILD verde + unknown non confermato -> SOSPESO (fail-safe)',
  m.build_unknown_unconfirmed && m.build_unknown_unconfirmed.autonomous_merge_allowed === false,
  m.build_unknown_unconfirmed && m.build_unknown_unconfirmed.gate);
assert('REMEDIATE -> merge human-gated',
  m.remediate && m.remediate.autonomous_merge_allowed === false,
  m.remediate && m.remediate.gate);
const dst = report.git && report.git.destructive;
assert('Operazione distruttiva -> bloccata in autonomia',
  dst && dst.allowed === false && dst.requires_human_gate === true, dst && dst.op);

// --- D) CHECKPOINT (controlli 1-2 verdi, 3-4 degradati onesti) ---------------
console.log('');
console.log('5) Checkpoint (1-2 verdi via delta; 3-4 DEGRADATI = M3, non falso verde):');
const cp = report.checkpoint || { controls: [] };
const ctl = (id) => (cp.controls || []).find((c) => c.id === id) || {};
assert('Controllo 1 (dead-code) VERDE', ctl(1).green === true, ctl(1).detail);
assert('Controllo 2 (sicurezza) VERDE', ctl(2).green === true, ctl(2).detail);
assert('Controllo 3 (regressioni) DEGRADATO (M3, NON verde)',
  ctl(3).status === 'degraded' && ctl(3).green === false, ctl(3).detail);
assert('Controllo 4 (conformita) DEGRADATO (M3, NON verde)',
  ctl(4).status === 'degraded' && ctl(4).green === false, ctl(4).detail);

// --- E) INTEGRITA DEL FIXTURE ------------------------------------------------
console.log('');
console.log('6) Integrita del fixture canonico (eval/reference-app intatto):');
assert('Nessuna copia temp residua (eval/.tmp-verify)', !existsSync(TMP_VERIFY),
  existsSync(TMP_VERIFY) ? 'directory ancora presente' : 'assente');

const det = nodeRun(RUN_EVAL, ['--mode=detection']);
assert('Gate M0 detection ancora EXIT 0 (fixture intatto)', det.status === 0, `exit=${det.status}`);
const pres = nodeRun(RUN_EVAL, ['--mode=present']);
assert('Gate M0 present ancora EXIT 0 (fixture intatto)', pres.status === 0, `exit=${pres.status}`);

// --- Esito ------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE M1 RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
