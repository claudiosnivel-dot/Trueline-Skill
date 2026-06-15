#!/usr/bin/env node
// loop.test.mjs — test della MACCHINA del loop sui PERCORSI che il set seminato
// (happy-path) NON esercita: cap di retry, rifiuto byte-identico, budget
// esaurito, gate negato, no-fix. Usa una COPIA TEMP isolata e fix provider
// FINTI in-memory (non la tabella reale): qui si testa la MECCANICA, non le fix.
//
// Tutti gli scenari usano un fingerprint REALE di un finding rls (RLS001 = S3)
// preso dalla copia: cosi' il PRE-CHECK (05 §6) lo trova ancora presente e la
// macchina percorre davvero proposta/gate/apply/re-run, invece di promuovere
// subito a verified per "gia' azzerato".
//
// Esce 0 se tutti gli scenari passano, 1 altrimenti. Node ESM, solo built-in.

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFindingLoop } from './loop.mjs';
import { createVerifyWorkspace } from './verify_workspace.mjs';
import { LOOP_BUDGET } from '../checkpoint/thresholds.mjs';
import { normalize } from '../findings/normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RLS_CHECK = resolve(__dirname, '..', 'oracles', 'rls_check.mjs');
const RUN_OPTS = { runId: 'loop-test', createdAt: '1970-01-01T00:00:00.000Z' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// Ricava un fingerprint REALE del finding RLS001 (S3) dalla copia. DEVE girare
// con cwd = dir (la copia), ESATTAMENTE come fa il loop in rerunOracleFor:
// il fingerprint dipende dal path normalizzato, che cambia col cwd. Usare un
// cwd diverso produrrebbe un fingerprint che non corrisponde a quello del
// re-run del loop, e il pre-check lo crederebbe "gia' azzerato".
function realRlsFingerprint(dir) {
  const migrations = resolve(dir, 'supabase', 'migrations');
  const res = spawnSync(process.execPath, [RLS_CHECK, migrations], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, cwd: dir });
  const json = JSON.parse(res.stdout);
  const findings = normalize('rls-check', json, { ...RUN_OPTS, scope: 'static-ddl' });
  const f = findings.find((x) => x.source_oracle.rule_id === 'RLS001_MISSING_RLS');
  return f ? f.fingerprint : 'FP_FALLBACK';
}

// Finding rls reale-per-fingerprint (il re-run usa rls_check, deterministico).
function realRlsFinding(dir) {
  return {
    fingerprint: realRlsFingerprint(dir),
    category: 'rls',
    severity: 'HIGH',
    location: { file: 'eval/reference-app/supabase/migrations/0001_init.sql', start_line: 63, end_line: 63, symbol: 'public.audit_logs' },
    evidence: 'test',
    source_oracle: { oracle: 'rls-check', rule_id: 'RLS001_MISSING_RLS' },
    fix_state: 'detected', baseline_status: 'new', run_id: 'test',
  };
}

console.log('=== loop.test — percorsi di retry/scarto (05 §3-§4) ===\n');

// Scenario 1: GATE NEGATO -> accepted-risk (mai verified).
{
  const ws = createVerifyWorkspace({ id: 'test-gate-deny' });
  try {
    const provider = { name: 'noop', propose: () => ({ id: 'p', kind: 'rls', signature: 'noop', apply: () => ({ ok: true, detail: 'noop' }) }) };
    const res = runFindingLoop(realRlsFinding(ws.dir), {
      dir: ws.dir, fixProvider: provider, evalMode: false, runOpts: RUN_OPTS,
      gate: () => ({ approved: false, reason: 'umano ha rifiutato' }),
    });
    check('gate negato -> accepted-risk, mai verified',
      res.fix_state === 'accepted-risk', `fix_state=${res.fix_state}`);
  } finally { ws.cleanup(); }
}

// Scenario 2: NESSUNA FIX proposta -> verification-failed (mai scarto silenzioso).
{
  const ws = createVerifyWorkspace({ id: 'test-nofix' });
  try {
    const provider = { name: 'empty', propose: () => null };
    const res = runFindingLoop(realRlsFinding(ws.dir), { dir: ws.dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS });
    check('nessuna fix -> verification-failed (no scarto silenzioso)',
      res.fix_state === 'verification-failed' && res.noFix === true, `fix_state=${res.fix_state}`);
  } finally { ws.cleanup(); }
}

// Scenario 3: CAP DI RETRY esaurito con patch INEFFICACE (no-op) -> verification-failed.
//   Ogni tentativo ha signature DIVERSA (per non incappare nel rifiuto
//   byte-identico) ma non risolve il finding rls reale -> si esauriscono i tentativi.
{
  const ws = createVerifyWorkspace({ id: 'test-cap' });
  try {
    let n = 0;
    const provider = {
      name: 'ineffective',
      propose: () => { n += 1; return { id: `p${n}`, kind: 'rls', signature: `sig-${n}`, apply: () => ({ ok: true, detail: 'no-op effettivo' }) }; },
    };
    const res = runFindingLoop(realRlsFinding(ws.dir), { dir: ws.dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS });
    check('cap retry esaurito -> verification-failed (mai verified)',
      res.fix_state === 'verification-failed' && res.attemptsExhausted === true,
      `fix_state=${res.fix_state}`);
    check('numero tentativi == cap O-COL-006 (proposta + 2 retry)',
      res.attempts.length === LOOP_BUDGET.MAX_RETRIES_PER_FINDING + 1,
      `${res.attempts.length} (atteso ${LOOP_BUDGET.MAX_RETRIES_PER_FINDING + 1})`);
  } finally { ws.cleanup(); }
}

// Scenario 4: RIFIUTO byte-identico -> verification-failed alla ri-sottomissione.
{
  const ws = createVerifyWorkspace({ id: 'test-dup' });
  try {
    const provider = {
      name: 'same-sig',
      propose: () => ({ id: 'p', kind: 'rls', signature: 'SAME', apply: () => ({ ok: true, detail: 'no-op' }) }),
    };
    const res = runFindingLoop(realRlsFinding(ws.dir), { dir: ws.dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS });
    check('ri-sottomissione byte-identica -> verification-failed',
      res.fix_state === 'verification-failed' && res.duplicatePatch === true,
      `fix_state=${res.fix_state}`);
  } finally { ws.cleanup(); }
}

// Scenario 5: BUDGET globale esaurito -> verification-failed (budgetExhausted).
{
  const ws = createVerifyWorkspace({ id: 'test-budget' });
  try {
    const provider = { name: 'noop', propose: () => ({ id: 'p', kind: 'rls', signature: 's', apply: () => ({ ok: true, detail: 'noop' }) }) };
    const budget = { startedAt: Date.now() - 10, deadlineMs: Date.now() - 1 }; // gia' scaduto
    const res = runFindingLoop(realRlsFinding(ws.dir), { dir: ws.dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    check('budget globale esaurito -> verification-failed',
      res.fix_state === 'verification-failed' && res.budgetExhausted === true,
      `fix_state=${res.fix_state}`);
  } finally { ws.cleanup(); }
}

const allOk = results.every((r) => r.ok);
console.log(`\n=== loop.test RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${results.filter((r) => r.ok).length}/${results.length})`);
process.exit(allOk ? 0 : 1);
