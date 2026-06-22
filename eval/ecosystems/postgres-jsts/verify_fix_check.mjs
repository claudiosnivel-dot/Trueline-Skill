#!/usr/bin/env node
// verify_fix_check.mjs — GATE di T2.1 (SP-7): il verify-fix LOOP promuove a
// `verified` le 2 categorie del verified_set (secret, dead-code) sulla fixture
// postgres-jsts (Node/Express + pg su Postgres NON-Supabase, authz-surface =
// route-authz, NIENTE RLS-al-DB), in PARITA con supabase-jsts/postgres-py.
// Scritto TEST-FIRST.
//
// Il "verde" e' un FATTO degli ORACOLI riesiguiti dal loop (gitleaks/knip), MAI
// una frase dell'LLM (L-COL-002). Su una COPIA ISOLATA della fixture (MAI
// l'originale: eval/.tmp-verify-jsts/<id>, .git+node_modules inclusi) il gate:
//   1) raccoglie i finding del FLOOR dagli oracoli legati (gli stessi del loop);
//   2) per OGNI finding esegue runFindingLoop col fix-provider deterministico
//      (eval-mode: gate umano auto-approvato, solo-eval, L-COL-021);
//   3) ASSERISCE gli stati-fix attesi (FATTI dell'oracolo, non opinioni):
//        PG-S1 (secret src/config.ts, working-tree)   -> verified (gitleaks WT pulito)
//        PG-S5 (dead-code unusedDeadHelper, knip)      -> verified (knip non lo segnala piu')
//        PG-S6 (secret-in-history legacy/credentials.ts) -> mitigated-residual (MAI verified)
//   4) GUARD: la suite node:test di caratterizzazione resta VERDE post-fix sulla copia.
//   5) IGIENE: la fixture ORIGINALE resta bit-identica (status interno vuoto +
//      HEAD interno invariato) e l'HEAD del repo ESTERNO e' INVARIATO.
//
// NIENTE RLS: postgres-jsts non ha RLS-al-DB (la sua authz-surface e' route-authz
// via semgrep), quindi rls NON e' nel verified_set: nessun DB-test runtime,
// nessuna migration-dir, nessuna invarianza RLS. E' la differenza strutturale con
// postgres-py (che ha PY-S3 rls/current_setting).
//
// FALSIFICABILITA: neutralizzando il fix del secret o del dead-code (no-op) questo
// gate DEVE fallire sul rispettivo seed (gitleaks/knip continuano a segnalare). Il
// gate NON e' un timbro sempre-verde.
//
// NOTA DI ONDATA (W1): il binding dei seed-path postgres-jsts nel dispatch JS del
// fix-provider e' fornito da T2.1 (W2). Se in questa ondata il fix-provider non
// riconosce ancora i path dei seed postgres-jsts (src/config.ts, src/dead.ts,
// src/legacy/credentials.ts), questo gate fallira': e' atteso e va dichiarato. Il
// gate detection-level di T1.1 e' fixture_check.mjs; questo script e' costruito per
// essere esercitato in W3 dall'orchestratore.
//
// Gli oracoli gitleaks richiedono C:/Users/claud/go/bin sul PATH: lo arricchiamo
// per gli spawn. NON tocca MAI il git del repo ESTERNO se non in SOLA LETTURA. Le
// mutazioni git avvengono sul .git INTERNO della COPIA (isolato, L-COL-024).
//
// Node ESM, solo built-in + i moduli del loop (tutti dep-free). Esce 0 sse TUTTI
// i check passano; 1 altrimenti.

import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, cpSync, rmSync, mkdirSync, readdirSync,
} from 'node:fs';
import { resolve, dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize } from '../../../trueline/scripts/findings/normalize.mjs';
import { validateMany } from '../../../trueline/scripts/findings/validate_finding.mjs';
import { deterministicFixProvider } from '../../../trueline/scripts/loop/fix_provider.mjs';
import { runFindingLoop } from '../../../trueline/scripts/loop/loop.mjs';
import { createWorkBranch } from '../../../trueline/scripts/git/layered_git.mjs';
import { LOOP_BUDGET } from '../../../trueline/scripts/checkpoint/thresholds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// eval/ecosystems/postgres-jsts -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RUN_DEADCODE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_deadcode.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify-jsts');

// runOpts deterministici: IDENTICI a quelli che il loop usa in rerunOracleFor
// (default di runFindingLoop) cosi' i fingerprint che raccogliamo qui combaciano
// con quelli che il loop ricalcola al re-run. NON passiamo `manifest` (niente RLS).
const RUN_OPTS = { runId: 'loop', createdAt: '1970-01-01T00:00:00.000Z' };

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
function readSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }
const baseName = (p) => String(p).replace(/\\/g, '/').split('/').pop();
const posix = (p) => String(p).replace(/\\/g, '/');

function nodeRun(script, args, cwd) {
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}
function gitRead(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: res.status, stdout: (res.stdout || '').trim() };
}

// Normalizza un output nativo nel finding model, identico al loop: tagga lo scope;
// scarta se lo schema non valida.
function norm(oracle, json, scope) {
  const f = normalize(oracle, json, { ...RUN_OPTS, scope });
  const v = validateMany(f);
  return (v.ok ? f : []).map((x) => ({ ...x, _scope: scope }));
}

// Crea una COPIA ISOLATA della fixture (eval/.tmp-verify-jsts/<id>, .git+node_modules
// inclusi). Mirror di copyPackFixture: id unico per-run (pid + counter).
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_VERIFY_ROOT, `verify-fix-jsts-pid${process.pid}-${__c}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  cpSync(FIXTURE, dir, { recursive: true, dereference: false });
  const cleanup = () => {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* best-effort */ }
    try {
      if (existsSync(TMP_VERIFY_ROOT) && readdirSync(TMP_VERIFY_ROOT).length === 0) {
        rmSync(TMP_VERIFY_ROOT, { recursive: true, force: true });
      }
    } catch { /* best-effort */ }
  };
  return { dir, cleanup };
}

// Raccoglie i finding del FLOOR dalla copia, con gli STESSI oracoli/scope del loop:
// gitleaks WT+history (secret), knip (dead-code). NIENTE rls (non nel verified_set).
function collectFloorFindings(dir) {
  const out = [];
  const gwt = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let gwtJson = null; try { gwtJson = JSON.parse(gwt.stdout); } catch { /* */ }
  if (Array.isArray(gwtJson)) out.push(...norm('gitleaks', gwtJson, 'working-tree'));

  const gh = nodeRun(RUN_GITLEAKS, [dir, 'history'], dir);
  let ghJson = null; try { ghJson = JSON.parse(gh.stdout); } catch { /* */ }
  if (Array.isArray(ghJson)) out.push(...norm('gitleaks', ghJson, 'history'));

  const dc = nodeRun(RUN_DEADCODE, [dir], dir);
  let dcJson = null; try { dcJson = JSON.parse(dc.stdout); } catch { /* */ }
  if (dcJson) out.push(...norm('knip', dcJson, 'working-tree'));

  return out;
}

// Seleziona, dai finding raccolti, il rappresentante atteso di ciascun seed del
// floor (PG-S1/S5/S6). Selettore data-driven sull'ancora del registry (path/symbol).
function pickSeed(findings, kind) {
  if (kind === 'PG-S1') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'working-tree'
      && /(^|\/)src\/config\.ts$/.test(posix(f.location.file)));
  }
  if (kind === 'PG-S6') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'history'
      && /(^|\/)src\/legacy\/credentials\.ts$/.test(posix(f.location.file)));
  }
  if (kind === 'PG-S5') {
    return findings.find((f) => f.category === 'dead-code'
      && (f.location.symbol === 'unusedDeadHelper')
      && /(^|\/)src\/dead\.ts$/.test(posix(f.location.file)));
  }
  return undefined;
}

// Riesegue knip sulla copia e ritorna true se `symbol` e' ANCORA segnalato (per
// l'assert di azzeramento simbolo, indipendente dal loop).
function knipStillFlags(dir, symbol) {
  const dc = nodeRun(RUN_DEADCODE, [dir], dir);
  let json = null; try { json = JSON.parse(dc.stdout); } catch { return null; }
  if (!json || !Array.isArray(json.issues)) return null;
  for (const issue of json.issues) {
    for (const bucket of ['exports', 'types', 'enumMembers', 'namespaceMembers']) {
      for (const sym of issue[bucket] || []) {
        const name = typeof sym === 'string' ? sym : sym.name;
        if (name === symbol) return true;
      }
    }
  }
  return false;
}

console.log('============================================================');
console.log(' GATE T2.1 (SP-7) — verify-fix LOOP su postgres-jsts (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : PG-S1/PG-S5 -> verified ; PG-S6 -> mitigated-residual (mai verified)');
console.log('   NIENTE RLS: verified_set = [secret, dead-code] (route-authz non-Supabase)');
console.log('============================================================');
console.log('');

// Snapshot d'integrita' (sola lettura) — repo ESTERNO + fixture INTERNA.
const outerHeadBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
const innerHeadBefore = gitRead(FIXTURE, ['rev-parse', 'HEAD']).stdout;
const innerStatusBefore = gitRead(FIXTURE, ['status', '--porcelain']).stdout;

assert('la fixture reference-app esiste', existsSync(FIXTURE), FIXTURE);

let ws = null;
let dir = null;
try { ws = copyFixture(); dir = ws.dir; } catch (e) {
  assert('copia ISOLATA della fixture creata', false, e.message);
}
assert('copia ISOLATA della fixture creata (eval/.tmp-verify-jsts, .git+node_modules inclusi)',
  Boolean(dir) && existsSync(dir), dir || 'assente');

// ISOLAMENTO: la copia NON deve risolvere al repo esterno ne' alla fixture orig.
if (dir) {
  const top = gitRead(dir, ['rev-parse', '--show-toplevel']).stdout;
  const isIsolated = posix(resolve(top || dir)).toLowerCase() !== posix(resolve(ROOT)).toLowerCase()
    && posix(resolve(top || dir)).toLowerCase() !== posix(resolve(FIXTURE)).toLowerCase();
  assert('la copia e ISOLATA (toplevel != repo esterno e != fixture originale)', isIsolated,
    `toplevel=${posix(top)}`);
}

let results = {};

if (dir) {
  // Branch di lavoro autonomo sul .git INTERNO della copia (come run_loop).
  createWorkBranch(dir, 'trueline/remediate/verify-fix-jsts');

  // (1) raccogli i finding del floor dalla copia.
  const findings = collectFloorFindings(dir);
  console.log('');
  console.log(`  raccolti ${findings.length} finding dal floor (gitleaks WT+history, knip)`);

  const seeds = {
    'PG-S1': pickSeed(findings, 'PG-S1'),
    'PG-S5': pickSeed(findings, 'PG-S5'),
    'PG-S6': pickSeed(findings, 'PG-S6'),
  };
  for (const [id, f] of Object.entries(seeds)) {
    assert(`finding ${id} raccolto dagli oracoli del floor`, Boolean(f),
      f ? `cat=${f.category} rule=${f.source_oracle.rule_id} file=${posix(f.location.file)} sym=${f.location.symbol || '-'}` : 'ASSENTE');
  }

  // (2) esegui il loop per OGNI seed col fix-provider deterministico (eval-mode).
  const provider = deterministicFixProvider();
  const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
  console.log('');
  console.log('  esecuzione del verify-fix loop per ciascun seed del floor (eval-mode):');
  for (const id of ['PG-S1', 'PG-S5', 'PG-S6']) {
    const f = seeds[id];
    if (!f) { results[id] = { fix_state: 'MISSING' }; continue; }
    const res = runFindingLoop(f, { dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    results[id] = res;
    console.log(`    ${id}: fix_state=${res.fix_state} — ${String(res.reason || '').slice(0, 120)}`);
  }

  // (3) ASSERZIONI di stato-fix (FATTI dell'oracolo riesiguito dal loop).
  console.log('');
  console.log('  Stati-fix (promozione = FATTO dell oracolo, L-COL-002):');
  assert('PG-S1 -> verified (gitleaks working-tree PULITO su src/config.ts)',
    results['PG-S1'] && results['PG-S1'].fix_state === 'verified',
    `fix_state=${results['PG-S1'] && results['PG-S1'].fix_state}`);
  assert('PG-S5 -> verified (knip non segnala piu il simbolo unusedDeadHelper)',
    results['PG-S5'] && results['PG-S5'].fix_state === 'verified',
    `fix_state=${results['PG-S5'] && results['PG-S5'].fix_state}`);
  assert('PG-S6 -> mitigated-residual (MAI verified: history non riscritta)',
    results['PG-S6'] && results['PG-S6'].fix_state === 'mitigated-residual',
    `fix_state=${results['PG-S6'] && results['PG-S6'].fix_state}`);
  // RINFORZO L-COL-006/024: PG-S6 non puo' MAI essere verified.
  assert('PG-S6 NON e verified (mai un falso "sicuro")',
    !(results['PG-S6'] && results['PG-S6'].fix_state === 'verified'),
    results['PG-S6'] ? results['PG-S6'].fix_state : '-');

  // (3b) verifica INDIPENDENTE dell'azzeramento del simbolo dead-code: dopo il
  //   loop, knip NON deve piu' segnalare unusedDeadHelper.
  const stillFlags = knipStillFlags(dir, 'unusedDeadHelper');
  assert('knip (ri-girato) NON segnala piu il simbolo unusedDeadHelper',
    stillFlags === false,
    stillFlags === null ? 'knip non rieseguibile' : (stillFlags ? 'ANCORA segnalato (fix non efficace!)' : 'azzerato'));
  // contrasto: usedHelper resta definito (il fix non ha rotto il modulo).
  const deadAfter = readSafe(join(dir, 'src', 'dead.ts'));
  assert('contrasto: usedHelper resta definito in src/dead.ts dopo la rimozione del dead-code',
    /export\s+function\s+usedHelper\s*\(/.test(deadAfter),
    /export\s+function\s+usedHelper\s*\(/.test(deadAfter) ? 'presente' : 'RIMOSSA (fix ha rotto il modulo!)');
  assert('contrasto: unusedDeadHelper rimosso da src/dead.ts',
    !/export\s+function\s+unusedDeadHelper\s*\(/.test(deadAfter),
    /export\s+function\s+unusedDeadHelper\s*\(/.test(deadAfter) ? 'ANCORA presente' : 'rimosso');

  // (3c) secret PG-S1: il literal hardcoded e' sparito da src/config.ts (FATTO
  //   testuale in aggiunta al verdetto dell'oracolo): nessun sk_live_/postgres://
  //   con password resta come literal (la fix legge da process.env).
  const cfgAfter = readSafe(join(dir, 'src', 'config.ts'));
  assert('secret PG-S1: il literal hardcoded sparisce da src/config.ts (legge da process.env)',
    !/sk_live_PGS1/.test(cfgAfter),
    /sk_live_PGS1/.test(cfgAfter) ? 'literal ANCORA presente (fix non applicata!)' : 'literal rimosso');

  // (4) GUARD: la suite node:test di caratterizzazione resta VERDE post-fix.
  console.log('');
  console.log('  GUARD — node:test di caratterizzazione VERDE post-fix (la fix non rompe il contratto):');
  const guard = spawnSync(process.execPath, ['--test'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const guardOut = `${guard.stdout || ''}${guard.stderr || ''}`;
  const passN = (guardOut.match(/(?:^|\s)pass\s+(\d+)/m) || [])[1];
  const failN = (guardOut.match(/(?:^|\s)fail\s+(\d+)/m) || [])[1];
  assert('node --test sulla COPIA post-fix esce 0 (caratterizzazione verde)',
    guard.status === 0,
    guard.error ? `node non eseguibile: ${guard.error.message}` : `exit=${guard.status} pass=${passN || '?'} fail=${failN || '?'}`);
  assert('la GUARD post-fix esegue >=1 test e 0 falliti (rete di sicurezza reale)',
    Number(passN || 0) >= 1 && Number(failN || 0) === 0,
    `pass=${passN || '0'} fail=${failN || '0'}`);
}

// (5) IGIENE: fixture ORIGINALE bit-identica + HEAD esterno invariato.
console.log('');
console.log('  IGIENE — fixture originale bit-identica + HEAD esterno invariato:');
let cleanupOk = true;
try { if (ws && ws.cleanup) ws.cleanup(); } catch { cleanupOk = false; }
assert('copia temp ripulita senza errori', cleanupOk, cleanupOk ? 'cleanup OK' : 'cleanup fallito');
assert('nessun residuo della copia temp (dir rimossa)', !dir || !existsSync(dir),
  dir && existsSync(dir) ? 'residuo presente' : 'rimossa');
const innerStatusAfter = gitRead(FIXTURE, ['status', '--porcelain']).stdout;
const innerHeadAfter = gitRead(FIXTURE, ['rev-parse', 'HEAD']).stdout;
assert('fixture ORIGINALE bit-identica (status interno vuoto + HEAD interno invariato)',
  innerStatusAfter === '' && innerStatusAfter === innerStatusBefore && innerHeadAfter === innerHeadBefore,
  innerStatusAfter === '' && innerHeadAfter === innerHeadBefore ? 'invariata' : `status="${innerStatusAfter}" head=${innerHeadAfter.slice(0, 10)}`);
const outerHeadAfter = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
assert('HEAD del repo ESTERNO INVARIATO (0 contaminazione)', outerHeadAfter === outerHeadBefore,
  outerHeadAfter === outerHeadBefore ? `${outerHeadBefore.slice(0, 10)} (invariato)` : 'MUTATO (vietato!)');

// --- Esito --------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE T2.1 (SP-7) RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
