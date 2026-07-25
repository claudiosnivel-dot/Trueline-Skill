#!/usr/bin/env node
// a2c_hygiene_activation_check.mjs — keystone A2c. Verità = FATTO d'oracolo (L-COL-002).
// Prova il gate BUILD delta d'igiene: baseline grandfather-a il debito; il debito NUOVO
// blocca; il baseline è load-bearing; il vacuity guard scatta; twin segnala senza gatare.
import { control1Hygiene } from '../../trueline/scripts/checkpoint/checkpoint.mjs';
import { capture, writeBaseline, hygieneBaselinePath, loadHygieneBaseline } from '../../trueline/scripts/findings/baseline.mjs';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(HERE, '..', 'ecosystems', '_a2c-fixtures', 'dup-cycle-debt');
const MANIFEST = { oracles: { duplication: { tool: 'jscpd', min_tokens: 50 }, architecture: { tool: 'madge' } }, languages: ['ts'] };
const RUN = { runId: 'a2c', createdAt: '1970-01-01T00:00:00.000Z' };

let fails = 0;
const check = (n, c, d) => { if (!c) { fails++; console.log(`  [FAIL] ${n} — ${d}`); } else console.log(`  [ok]   ${n}`); };

if (!existsSync(FIX)) { console.error(`precondizione: fixture ${FIX} assente (provision_fixtures.sh)`); process.exit(2); }
// knip e' l'UNICA hard-dep: control1Hygiene esegue il dead-code (run_deadcode/knip)
// per PRIMO e knip NON ha fallback npx. jscpd/madge risolvono via il fallback npx nei
// loro wrapper (capture li usa), quindi NON sono richiesti in node_modules.
if (!existsSync(join(FIX, 'node_modules', 'knip', 'bin', 'knip.js'))) {
  console.error('precondizione: knip non provvigionato nel fixture (provision_fixtures.sh)'); process.exit(2);
}

// Copia di lavoro (il capture solo legge, ma il gate ripetibile richiede una copia).
const work = mkdtempSync(join(tmpdir(), 'a2c-ks-'));
cpSync(FIX, work, { recursive: true });

const c1 = (dir, missing) => {
  const hb = loadHygieneBaseline(dir);
  return control1Hygiene(dir, { baseline: hb.set, runOpts: RUN, manifest: MANIFEST, mode: 'build', hygieneBaselineMissing: missing });
};

// (0) vacuity: nessun baseline committato + dup/cycle attivi in BUILD -> NON verde.
const vac = c1(work, true);
check('vacuity:missing-baseline', vac.green === false && /baseline/i.test(vac.detail),
  `atteso non-verde con nota baseline, visto green=${vac.green} detail=${vac.detail}`);

// (1) cattura il baseline d'igiene del debito esistente e scrivilo nel path tracciato.
const cap = capture(work, ['jscpd', 'cycle', 'twin'], { ...RUN, minTokens: 50 });
if (!cap.ok) { console.error(`capture fallita: ${cap.detail} ${JSON.stringify(cap.errors)}`); process.exit(2); }
writeBaseline(hygieneBaselinePath(work), cap.snapshot);
const dupCount = cap.findings.filter((f) => f.category === 'duplication').length;
const cycCount = cap.findings.filter((f) => f.source_oracle.oracle === 'cycle').length;
check('capture:non-vacuo', dupCount >= 1 && cycCount >= 1, `dup=${dupCount} cycle=${cycCount} (debito reale nel fixture)`);

// (2) preexisting:green — con baseline, il debito pre-esistente è grandfathered.
const pre = c1(work, false);
check('preexisting:green', pre.green === true, `atteso verde (debito grandfathered), visto green=${pre.green} detail=${pre.detail}`);
check('twin:signal-not-gate', pre.findings.some((f) => f.source_oracle.oracle === 'twin') === false || pre.green === true,
  'twin non deve gatare (segnale)');

// (3) newdebt:red — introduci un clone NUOVO (oltre il baseline) -> blocca.
const block = Array.from({ length: 20 }, (_, i) => `  const w${i} = tally(${i}) - shift(${i}) * 3;`).join('\n');
writeFileSync(join(work, 'src', 'c.ts'), `export function c(){\n${block}\n  return 3;\n}\n`);
writeFileSync(join(work, 'src', 'd.ts'), `export function d(){\n${block}\n  return 4;\n}\n`);
const nu = c1(work, false); // baseline invariato (non ri-catturato)
check('newdebt:red', nu.green === false && nu.blockers.some((b) => b.category === 'duplication'),
  `atteso rosso con blocker duplication NUOVO, visto green=${nu.green} blockers=${nu.blockers.length}`);

// (4) baseline-loadbearing — svuota il baseline -> TUTTO il debito torna new -> rosso.
writeBaseline(hygieneBaselinePath(work), { version: 1, fingerprints: [], findings: {} });
const empty = c1(work, false);
check('baseline-loadbearing', empty.green === false && empty.blockers.length >= dupCount,
  `baseline svuotato -> tutto il debito è new (rosso), visto green=${empty.green} blockers=${empty.blockers.length} (>=${dupCount})`);

rmSync(work, { recursive: true, force: true });
console.log(fails === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
