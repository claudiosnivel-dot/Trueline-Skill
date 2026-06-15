#!/usr/bin/env node
// extract_findings.mjs — estrae i finding dalla detection e li valida

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalize } from '../../trueline/scripts/findings/normalize.mjs';
import { validateMany } from '../../trueline/scripts/findings/validate_finding.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REFERENCE_APP = resolve(ROOT, 'eval', 'reference-app');
const MIGRATIONS_DIR = resolve(REFERENCE_APP, 'supabase', 'migrations');
const GO_BIN = 'C:/Users/claud/go/bin';
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RLS_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'rls_check.mjs');
const RUN_DEADCODE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_deadcode.mjs');

function runOracle(script, args, cwd = ROOT) {
  if (!existsSync(script)) return { ok: false, json: null, detail: `script assente: ${script}` };
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''};${GO_BIN}`,
  };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) return { ok: false, json: null, detail: `spawn: ${res.error.message}` };
  const raw = (res.stdout || '').trim();
  if (!raw) return { ok: false, json: null, detail: `no stdout (exit=${res.status})` };
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, json: null, detail: `stdout not JSON: ${e.message}` };
  }
}

const allFindings = [];
const runOpts = { runId: 'M0-detection-gate', createdAt: '1970-01-01T00:00:00.000Z' };

// S1: gitleaks working-tree
const r1 = runOracle(RUN_GITLEAKS, [REFERENCE_APP, 'working-tree']);
if (r1.ok) {
  const norm1 = normalize('gitleaks', r1.json, { ...runOpts, scope: 'working-tree' });
  allFindings.push(...norm1);
  console.log(`S1 gitleaks: ${norm1.length} finding`);
}

// S2: gitleaks history
const r2 = runOracle(RUN_GITLEAKS, [REFERENCE_APP, 'history']);
if (r2.ok) {
  const norm2 = normalize('gitleaks', r2.json, { ...runOpts, scope: 'history' });
  allFindings.push(...norm2);
  console.log(`S2 gitleaks history: ${norm2.length} finding`);
}

// S3/S4/S5: rls-check
const r3 = runOracle(RLS_CHECK, [MIGRATIONS_DIR]);
if (r3.ok) {
  const norm3 = normalize('rls-check', r3.json, { ...runOpts, scope: 'static-ddl' });
  allFindings.push(...norm3);
  console.log(`S3/S4/S5 rls-check: ${norm3.length} finding`);
}

// S8: knip
const r8 = runOracle(RUN_DEADCODE, [REFERENCE_APP]);
if (r8.ok) {
  const norm8 = normalize('knip', r8.json, { ...runOpts, scope: 'working-tree' });
  allFindings.push(...norm8);
  console.log(`S8 knip: ${norm8.length} finding`);
}

console.log(`\nTotal findings: ${allFindings.length}`);

// Valida tutti i finding
const v = validateMany(allFindings);
if (v.ok) {
  console.log(`VALIDATION: OK — tutti i ${v.count} finding sono conformi allo schema`);
} else {
  console.error(`VALIDATION: FAIL — ${v.errors.length} errori:`);
  v.errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
}

// Stampa un sample di finding
console.log(`\n=== SAMPLE FINDINGS (primi 2) ===`);
console.log(JSON.stringify(allFindings.slice(0, 2), null, 2));
