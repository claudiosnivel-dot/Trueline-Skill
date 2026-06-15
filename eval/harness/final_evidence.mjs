#!/usr/bin/env node
// final_evidence.mjs — evidenza completa per M0 gate

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalize } from '../../trueline/scripts/findings/normalize.mjs';
import { validateMany } from '../../trueline/scripts/findings/validate_finding.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REGISTRY_PATH = resolve(ROOT, 'eval', 'harness', 'expected', 'registry.json');
const REFERENCE_APP = resolve(ROOT, 'eval', 'reference-app');
const MIGRATIONS_DIR = resolve(REFERENCE_APP, 'supabase', 'migrations');
const GO_BIN = 'C:/Users/claud/go/bin';
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RLS_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'rls_check.mjs');
const RUN_DEADCODE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_deadcode.mjs');

function runOracle(script, args, cwd = ROOT) {
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
  if (res.error) return { ok: false, json: null };
  const raw = (res.stdout || '').trim();
  if (!raw) return { ok: false, json: null };
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch { return { ok: false, json: null }; }
}

const allFindings = [];
const runOpts = { runId: 'M0-detection-gate', createdAt: '1970-01-01T00:00:00.000Z' };

// Raccogli finding
const r1 = runOracle(RUN_GITLEAKS, [REFERENCE_APP, 'working-tree']);
if (r1.ok) allFindings.push(...normalize('gitleaks', r1.json, { ...runOpts, scope: 'working-tree' }));

const r2 = runOracle(RUN_GITLEAKS, [REFERENCE_APP, 'history']);
if (r2.ok) allFindings.push(...normalize('gitleaks', r2.json, { ...runOpts, scope: 'history' }));

const r3 = runOracle(RLS_CHECK, [MIGRATIONS_DIR]);
if (r3.ok) allFindings.push(...normalize('rls-check', r3.json, { ...runOpts, scope: 'static-ddl' }));

const r8 = runOracle(RUN_DEADCODE, [REFERENCE_APP]);
if (r8.ok) allFindings.push(...normalize('knip', r8.json, { ...runOpts, scope: 'working-tree' }));

const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
const SCOPE_M0 = new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S8']);

console.log('=== EVIDENCE BY DEFECT (S1..S8) ===\n');

for (const entry of registry.defects.sort((a, b) => a.id.localeCompare(b.id))) {
  if (!SCOPE_M0.has(entry.id)) {
    console.log(`${entry.id} [${entry.category}/${entry.source_oracle}] DEFERRED M4\n`);
    continue;
  }
  
  const hits = allFindings.filter(f => 
    f.category === entry.category && 
    f.source_oracle.oracle === entry.source_oracle
  );
  
  // Refina match
  let match = null;
  if (entry.category === 'rls') {
    const sym = entry.anchor.policy || entry.anchor.table;
    match = hits.find(f => f.location.symbol === sym || f.evidence.includes(entry.anchor.table));
  } else if (entry.id === 'S2') {
    const expPath = `eval/reference-app/${entry.anchor.history_path}`;
    match = hits.find(f => f.location.file === expPath);
  } else {
    const expPath = entry.anchor.file.replace(/\\/g, '/');
    match = hits.find(f => f.location.file === expPath || f.location.file.includes(entry.anchor.file.split('/').pop()));
  }
  
  if (match) {
    console.log(`${entry.id} [${entry.category}]`);
    console.log(`  source_oracle: oracle=${match.source_oracle.oracle} rule_id=${match.source_oracle.rule_id}`);
    console.log(`  severity: ${match.severity}`);
    console.log(`  location: file=${match.location.file} line=${match.location.start_line}${match.location.symbol ? ` symbol=${match.location.symbol}` : ''}`);
    console.log(`  fingerprint: ${match.fingerprint}`);
    console.log(`  fix_state: ${match.fix_state}`);
    console.log(`  STATUS: DETECTED\n`);
  } else {
    console.log(`${entry.id} [${entry.category}]`);
    console.log(`  STATUS: NOT DETECTED (expected oracle: ${entry.source_oracle})\n`);
  }
}

// Summary table
console.log('=== DETECTION SUMMARY TABLE ===\n');
console.log('Defect | Category     | Oracle      | Status    | Rule ID');
console.log('-------|--------------|-------------|-----------|----------------------------------');
for (const entry of registry.defects.sort((a, b) => a.id.localeCompare(b.id))) {
  const hits = allFindings.filter(f => 
    f.category === entry.category && 
    f.source_oracle.oracle === entry.source_oracle
  );
  
  let match = null;
  if (entry.category === 'rls') {
    const sym = entry.anchor.policy || entry.anchor.table;
    match = hits.find(f => f.location.symbol === sym || f.evidence.includes(entry.anchor.table));
  } else if (entry.id === 'S2') {
    const expPath = `eval/reference-app/${entry.anchor.history_path}`;
    match = hits.find(f => f.location.file === expPath);
  } else {
    const expPath = entry.anchor.file.replace(/\\/g, '/');
    match = hits.find(f => f.location.file === expPath || f.location.file.includes(entry.anchor.file.split('/').pop()));
  }
  
  const status = !SCOPE_M0.has(entry.id) ? 'DEFERRED' : match ? 'DETECTED' : 'FAIL';
  const ruleId = match ? match.source_oracle.rule_id : (SCOPE_M0.has(entry.id) ? '(not found)' : '(N/A)');
  console.log(`${entry.id}   | ${entry.category.padEnd(12)} | ${entry.source_oracle.padEnd(11)} | ${status.padEnd(9)} | ${ruleId}`);
}

// Schema validation
const v = validateMany(allFindings);
console.log(`\n=== SCHEMA VALIDATION ===\n`);
console.log(`Total findings: ${v.count}`);
console.log(`Valid: ${v.ok ? 'YES' : 'NO'}`);
if (v.errors.length > 0) {
  console.log(`Errors: ${v.errors.length}`);
  v.errors.slice(0, 3).forEach(e => console.log(`  - ${e}`));
}
