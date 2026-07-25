// checkpoint.a2c.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionBlockers, control1Hygiene } from './checkpoint.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// finding sintetici minimali (partitionBlockers usa solo fingerprint + source_oracle.oracle + fix_state).
const mk = (oracle, fp) => ({ source_oracle: { oracle }, fingerprint: fp, category: 'x', severity: 'LOW' });
const EMPTY = new Set();

test('BUILD (default detectionOnly={twin}): dup/cycle NUOVI bloccano; twin no', () => {
  const findings = [mk('jscpd', 'a'), mk('cycle', 'b'), mk('twin', 'c')];
  const blockers = partitionBlockers(findings, EMPTY); // default = solo twin detection-only
  const oracles = blockers.map((f) => f.source_oracle.oracle).sort();
  assert.deepEqual(oracles, ['cycle', 'jscpd'], 'in BUILD dup/cycle bloccano, twin no');
});

test('REMEDIATE (detectionOnly={twin,jscpd,cycle}): dup/cycle NON bloccano', () => {
  const findings = [mk('jscpd', 'a'), mk('cycle', 'b'), mk('twin', 'c')];
  const detectionOnly = new Set(['twin', 'jscpd', 'cycle']);
  const blockers = partitionBlockers(findings, EMPTY, detectionOnly);
  assert.equal(blockers.length, 0, 'in REMEDIATE dup/cycle sono report-only');
});

test('pre-esistente (fp in baseline) non blocca in nessuna modalità', () => {
  const findings = [mk('jscpd', 'a')];
  const blockers = partitionBlockers(findings, new Set(['a'])); // BUILD default
  assert.equal(blockers.length, 0);
});

// Un progetto minimale su cui control1Hygiene gira (dead-code via run_deadcode può
// degradare senza node_modules: il focus qui è il VACUITY GUARD, non i finding).
function miniApp() {
  const d = mkdtempSync(join(tmpdir(), 'a2c-app-'));
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(d, 'package.json'), '{"name":"mini","version":"1.0.0"}\n');
  // Stub knip (dead-code) dep-free: run_deadcode invoca node_modules/knip/bin/knip.js.
  // Senza, run_deadcode hard-erra e control1 esce PRIMA del vacuity guard: qui il
  // focus è il GUARD, non i finding — lo stub emette 0 issue -> dead-code verde.
  mkdirSync(join(d, 'node_modules', 'knip', 'bin'), { recursive: true });
  writeFileSync(join(d, 'node_modules', 'knip', 'bin', 'knip.js'), 'process.stdout.write(JSON.stringify({ issues: [] }));\n');
  return d;
}
const DECL = { oracles: { duplication: { tool: 'jscpd', min_tokens: 50 }, architecture: { tool: 'madge' } }, languages: ['ts'] };
const RUN = { runId: 'a2c', createdAt: '1970-01-01T00:00:00.000Z' };

// miniApp con jscpd LOCALE stub che emette nDup duplicati (deterministico, offline).
// Solo `duplication` dichiarata (niente madge/npx) -> test stabile. Il vacuity guard
// (P2) scatta SOLO con debito d'igiene reale; a debito zero un progetto pulito senza
// baseline dev'essere VERDE (non ha nulla da grandfather-are).
const DUP_ONLY = { oracles: { duplication: { tool: 'jscpd', min_tokens: 50 } }, languages: ['ts'] };
function miniAppDup(nDup) {
  const d = mkdtempSync(join(tmpdir(), 'a2c-p2-'));
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(d, 'package.json'), '{"name":"mini","version":"1.0.0"}\n');
  mkdirSync(join(d, 'node_modules', 'knip', 'bin'), { recursive: true });
  writeFileSync(join(d, 'node_modules', 'knip', 'bin', 'knip.js'), 'process.stdout.write(JSON.stringify({ issues: [] }));\n');
  mkdirSync(join(d, 'node_modules', 'jscpd', 'bin'), { recursive: true });
  const dup = '{firstFile:{name:"src/a.ts",startLoc:{line:1},endLoc:{line:20}},secondFile:{name:"src/b.ts",startLoc:{line:1},endLoc:{line:20}},lines:20,tokens:60,fragment:"clone"}';
  writeFileSync(join(d, 'node_modules', 'jscpd', 'bin', 'jscpd'),
    'const fs=require(\'fs\'),p=require(\'path\');const a=process.argv;const o=a[a.indexOf(\'--output\')+1];'
    + `fs.writeFileSync(p.join(o,'jscpd-report.json'),JSON.stringify({duplicates:${nDup ? `[${dup}]` : '[]'}}));\n`);
  return d;
}

test('P2 — BUILD + duplication dichiarata + baseline assente + 0 dup: VERDE (niente da grandfather-are)', () => {
  const d = miniAppDup(0);
  const c1 = control1Hygiene(d, { baseline: new Set(), runOpts: RUN, manifest: DUP_ONLY, mode: 'build', hygieneBaselineMissing: true });
  rmSync(d, { recursive: true, force: true });
  assert.match(c1.detail, /dup:0/, 'precondizione: jscpd ha girato e trovato 0 duplicati');
  assert.equal(c1.green, true, 'progetto pulito (0 dup) senza baseline NON dev\'essere rosso (P2)');
});

test('vacuity guard — BUILD + duplication dichiarata + baseline assente + dup PRESENTE: NON verde (baseline mancante)', () => {
  const d = miniAppDup(1);
  const c1 = control1Hygiene(d, { baseline: new Set(), runOpts: RUN, manifest: DUP_ONLY, mode: 'build', hygieneBaselineMissing: true });
  rmSync(d, { recursive: true, force: true });
  assert.match(c1.detail, /dup:1/, 'precondizione: jscpd ha trovato 1 duplicato');
  assert.equal(c1.green, false, 'debito d\'igiene + baseline assente in BUILD -> non verde (L-COL-006)');
  assert.match(c1.detail, /baseline/i);
});

test('vacuity guard NON scatta in REMEDIATE (dup/cycle report-only, baseline irrilevante)', () => {
  const d = miniApp();
  const c1 = control1Hygiene(d, { baseline: new Set(), runOpts: RUN, manifest: DECL, mode: 'remediate', hygieneBaselineMissing: true });
  rmSync(d, { recursive: true, force: true });
  // In REMEDIATE non c'è gate d'igiene: il verdetto dipende solo dal dead-code (qui assente/degr),
  // MAI dal guard d'igiene. Asseriamo che il guard non abbia forzato un rosso "baseline".
  assert.doesNotMatch(c1.detail || '', /baseline d'igiene mancante/i);
});

// --- Degrado d'igiene (L-COL-006): oracolo DICHIARATO ma NON eseguito != verde ------
// Un jscpd LOCALE ROTTO (esce 1 senza scrivere il report) -> il wrapper dupcheck
// dichiara "non eseguito" -> dup:degr. knip stub verde (il dead-code non interferisce).
// Solo `duplication` dichiarata: niente madge/npx -> test DETERMINISTICO e offline.
function miniAppBrokenJscpd() {
  const d = mkdtempSync(join(tmpdir(), 'a2c-degr-'));
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(d, 'package.json'), '{"name":"mini","version":"1.0.0"}\n');
  mkdirSync(join(d, 'node_modules', 'knip', 'bin'), { recursive: true });
  writeFileSync(join(d, 'node_modules', 'knip', 'bin', 'knip.js'), 'process.stdout.write(JSON.stringify({ issues: [] }));\n');
  mkdirSync(join(d, 'node_modules', 'jscpd', 'bin'), { recursive: true });
  writeFileSync(join(d, 'node_modules', 'jscpd', 'bin', 'jscpd'), 'process.exit(1);\n');
  return d;
}
const DECL_DUP = { oracles: { duplication: { tool: 'jscpd', min_tokens: 50 } }, languages: ['ts'] };

test('degrado d\'igiene: duplication dichiarata ma wrapper degrada in BUILD -> green=false (L-COL-006)', () => {
  const d = miniAppBrokenJscpd();
  const c1 = control1Hygiene(d, { baseline: new Set(), runOpts: RUN, manifest: DECL_DUP, mode: 'build' });
  rmSync(d, { recursive: true, force: true });
  assert.match(c1.detail, /dup:degr/, 'precondizione: il wrapper dup deve essere degradato');
  assert.equal(c1.green, false, 'oracolo dup dichiarato ma non eseguito (dup:degr) NON è verde in BUILD');
  assert.match(c1.detail, /degrad/i);
});

test('degrado d\'igiene report-only in REMEDIATE: dup:degr NON declassa (m5/BIT-invarianza)', () => {
  const d = miniAppBrokenJscpd();
  const c1 = control1Hygiene(d, { baseline: new Set(), runOpts: RUN, manifest: DECL_DUP, mode: 'remediate' });
  rmSync(d, { recursive: true, force: true });
  // In REMEDIATE dup è report-only: il degrado NON forza il rosso "degradato d'igiene".
  assert.doesNotMatch(c1.detail || '', /oracolo d'igiene dichiarato ma non eseguito/i);
});
