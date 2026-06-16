#!/usr/bin/env node
// measure_budget.mjs — taratura RIPRODUCIBILE del budget di tempo di parete del loop
// (O-COL-006, 10-EVALUATION §6 / thresholds.md §5.1).
//
// Misura il tempo di parete di `run_loop --eval --mode=remediate --characterize` sulla
// reference app — ESATTAMENTE come il criterio A del gate M5 (Date.now() attorno allo
// spawnSync) — su N campioni, e stampa min/max/mean/p95. Il pin si ottiene come
// round(p95 x 1.25) e si registra in trueline/scripts/checkpoint/thresholds.mjs
// (WALL_CLOCK_DERIVATION + LOOP_BUDGET) e in references/oracles/thresholds.md §5/§5.1.
//
// Richiede il DB di prova up (TRUELINE_TEST_PSQL, default = container Supabase locale)
// per la characterization RLS a runtime. NON tocca git; il loop opera su copie isolate
// (verify_workspace) e la fixture canonica resta bit-identica.
//
// USO:  N=10 WARMUP=1 node eval/harness/measure_budget.mjs
//   N      numero di campioni misurati (default 5; usare >=10 per il pin, §5.1 step 3)
//   WARMUP 1 (default) esegue un run di riscaldamento escluso dai campioni; 0 lo salta.
import { spawnSync } from 'node:child_process';
import { resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Lo script vive in eval/harness/ -> la radice del repo e' due livelli sopra.
const ROOT = resolve(__dirname, '..', '..');
const RUN_LOOP = resolve(ROOT, 'trueline', 'scripts', 'loop', 'run_loop.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TEST_PSQL = process.env.TRUELINE_TEST_PSQL
  || 'docker exec -i supabase_db_trueline-db-test psql -U postgres -d postgres';

function timedRun() {
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}`,
    TRUELINE_TEST_PSQL: TEST_PSQL,
  };
  const t0 = Date.now();
  const res = spawnSync(process.execPath,
    [RUN_LOOP, '--eval', '--mode=remediate', '--characterize'],
    { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ms = Date.now() - t0;
  let ok = null, nFindings = null;
  try { const r = JSON.parse(res.stdout); ok = r.ok; nFindings = (r.findings || []).length; } catch { /* */ }
  return { ms, status: res.status, ok, nFindings };
}

const N = Number(process.env.N || 5);
const WARMUP = process.env.WARMUP === '0' ? 0 : 1;
const samples = [];
for (let i = 0; i < WARMUP; i++) {
  const w = timedRun();
  console.log(`warmup: ${w.ms}ms status=${w.status} ok=${w.ok} findings=${w.nFindings}`);
}
for (let i = 0; i < N; i++) {
  const r = timedRun();
  samples.push(r.ms);
  console.log(`run ${i + 1}: ${r.ms}ms status=${r.status} ok=${r.ok} findings=${r.nFindings}`);
}
samples.sort((a, b) => a - b);
const min = samples[0];
const max = samples[samples.length - 1];
const mean = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
const p95 = samples[Math.min(samples.length - 1, Math.ceil(0.95 * samples.length) - 1)];
console.log('---SUMMARY---');
console.log(JSON.stringify({ n: samples.length, samples, min, max, mean, p95 }));
console.log(`pin suggerito: GLOBAL_WALL_CLOCK_MS = round(p95 x 1.25) = ${Math.round(p95 * 1.25)}`);
