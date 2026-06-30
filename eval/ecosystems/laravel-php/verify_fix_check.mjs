#!/usr/bin/env node
// verify_fix_check.mjs — GATE di VERIFY (eco-F5a): il verify-fix LOOP promuove a
// `verified` la categoria secret del verified_set sulla fixture laravel-php (Laravel
// PHP + config/services.php). Clonato da eval/ecosystems/postgres-jsts/verify_fix_check.mjs
// e adattato per Laravel PHP: solo secret (gitleaks working-tree su config/services.php,
// LP-S1), nessun dead-code (psalm non nel verified_set F5a), nessuna suite node:test
// (PHP, non JS). Scritto TEST-FIRST.
//
// Il "verde" e' un FATTO degli ORACOLI rieseguiti dal loop (gitleaks), MAI una
// frase dell'LLM (L-COL-002). Su una COPIA ISOLATA della fixture (MAI l'originale:
// eval/.tmp-verify-php/<id>, .git incluso) il gate:
//   1) SNAPSHOT d'integrita' (sola lettura) — repo ESTERNO + fixture INTERNA;
//   2) PRECONDIZIONE: se reference-app/.git manca -> banner + exit 2 (il
//      provisioning dell'inner-repo e' dell'ORCHESTRATORE, L-COL-024);
//   3) COPIA ISOLATA della fixture (eval/.tmp-verify-php/<pid>-<n>, .git incluso);
//   4) createWorkBranch sul .git INTERNO della copia (come run_loop);
//   5) collectFloorFindings: gitleaks working-tree SOLO (LP-S1 e' WT; nessun seed
//      in history, nessun dead-code nel verified_set F5a);
//   6) pickSeed LP-S1 (secret, config/services.php, working-tree);
//   7) runFindingLoop col fix-provider deterministico (eval-mode: gate umano
//      auto-approvato, solo-eval, L-COL-021);
//   8) ASSERISCE lo stato-fix atteso (FATTO dell'oracolo, non opinione):
//        LP-S1 (secret config/services.php, working-tree) -> verified (gitleaks WT pulito)
//   9) RE-RUN INDIPENDENTE: gitleaks WT pulito sul file post-fix; literal
//      hardcoded sparito da config/services.php (verifica testuale AGGIUNTIVA);
//  10) IGIENE: temp pulito, fixture ORIGINALE bit-identica (status interno vuoto
//      + HEAD interno invariato) e HEAD del repo ESTERNO INVARIATO (0 contam).
//
// NIENTE RLS: laravel-php non ha RLS-al-DB (la sua authz-surface e' route-authz
// via semgrep), quindi rls NON e' nel verified_set: nessun DB-test runtime,
// nessuna migration-dir. NIENTE dead-code verified (psalm non disponibile nel
// sandbox F5a): solo secret nel verified_set. NIENTE node:test guard (fixture PHP,
// non JS/TS).
//
// NIENTE history: la fixture laravel-php semina LP-S1 SOLO nel working-tree
// (config/services.php attivo); nessun seed-history (LP-S2/LP-S3 non sono secret).
// gitleaks history NON viene chiamato: nessun esito mitigated-residual atteso.
//
// FALSIFICABILITA: neutralizzando il fix del secret (no-op in fix_provider)
// questo gate DEVE fallire su LP-S1 (gitleaks continua a segnalare il literal
// sk_live_... in config/services.php). Il gate NON e' un timbro sempre-verde.
//
// Gli oracoli gitleaks richiedono C:/Users/claud/go/bin sul PATH: lo arricchiamo
// per gli spawn. NON tocca MAI il git del repo ESTERNO se non in SOLA LETTURA. Le
// mutazioni git avvengono sul .git INTERNO della COPIA (isolato, L-COL-024).
//
// Node ESM, solo built-in + i moduli del loop (tutti dep-free). Esce 0 sse TUTTI
// i check passano; 1 altrimenti; 2 se l'inner-repo della fixture manca (skip).

import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, cpSync, rmSync, mkdirSync, readdirSync,
} from 'node:fs';
import { resolve, dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize } from '../../../trueline/scripts/findings/normalize.mjs';
import { validateMany } from '../../../trueline/scripts/findings/validate_finding.mjs';
import { deterministicFixProvider } from '../../harness/fix_provider.eval.mjs';
import { runFindingLoop } from '../../../trueline/scripts/loop/loop.mjs';
import { createWorkBranch } from '../../../trueline/scripts/git/layered_git.mjs';
import { LOOP_BUDGET } from '../../../trueline/scripts/checkpoint/thresholds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// eval/ecosystems/laravel-php -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify-php');

// runOpts deterministici: IDENTICI a quelli che il loop usa in rerunOracleFor
// (default di runFindingLoop) cosi' i fingerprint che raccogliamo qui combaciano
// con quelli che il loop ricalcola al re-run.
const RUN_OPTS = { runId: 'loop', createdAt: '1970-01-01T00:00:00.000Z' };

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
function readSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }
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

// Crea una COPIA ISOLATA della fixture (eval/.tmp-verify-php/<id>, .git incluso).
// Mirror di copyPackFixture: id unico per-run (pid + counter).
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_VERIFY_ROOT, `verify-fix-php-pid${process.pid}-${__c}`);
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

// Raccoglie i finding del FLOOR dalla copia via gitleaks working-tree SOLO.
// LP-S1 e' working-tree (config/services.php attivo); nessun seed in history.
// NIENTE knip/dead-code (psalm non nel verified_set F5a).
function collectFloorFindings(dir) {
  const out = [];
  const gwt = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let gwtJson = null; try { gwtJson = JSON.parse(gwt.stdout); } catch { /* */ }
  if (Array.isArray(gwtJson)) out.push(...norm('gitleaks', gwtJson, 'working-tree'));
  return out;
}

// Seleziona il finding LP-S1 dai finding raccolti: secret working-tree su
// config/services.php (ancora del registry: file + marker SEED:LP-S1).
function pickSeedLPS1(findings) {
  return findings.find((f) => f.category === 'secret' && f._scope === 'working-tree'
    && /(^|\/)config\/services\.php$/.test(posix(f.location.file)));
}

console.log('============================================================');
console.log(' GATE eco-F5a — verify-fix LOOP su laravel-php (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : LP-S1 -> verified (gitleaks WT pulito su config/services.php)');
console.log('   verified_set = [secret] ; NIENTE dead-code/RLS/history');
console.log('============================================================');
console.log('');

// (1) Snapshot d'integrita' (sola lettura) — repo ESTERNO + fixture INTERNA.
const outerHeadBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
const innerHeadBefore = gitRead(FIXTURE, ['rev-parse', 'HEAD']).stdout;
const innerStatusBefore = gitRead(FIXTURE, ['status', '--porcelain']).stdout;

// (2) PRECONDIZIONE: inner-repo deve esistere (L-COL-024).
const innerGit = join(FIXTURE, '.git');
if (!existsSync(innerGit)) {
  console.error('');
  console.error('  [SKIP] reference-app/.git ASSENTE — provisioning e\' compito dell\'ORCHESTRATORE');
  console.error(`  fixture: ${FIXTURE}`);
  console.error('  Eseguire "git init" + commit iniziale nella reference-app prima di invocare questo gate.');
  console.error('');
  process.exit(2);
}
assert('la fixture reference-app esiste e ha un inner-repo .git', existsSync(innerGit), FIXTURE);

// (3) COPIA ISOLATA della fixture.
let ws = null;
let dir = null;
try { ws = copyFixture(); dir = ws.dir; } catch (e) {
  assert('copia ISOLATA della fixture creata', false, e.message);
}
assert('copia ISOLATA della fixture creata (eval/.tmp-verify-php, .git incluso)',
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
  // (4) Branch di lavoro autonomo sul .git INTERNO della copia (come run_loop).
  createWorkBranch(dir, 'trueline/remediate/verify-fix-php');

  // (5) Raccogli i finding del floor dalla copia (gitleaks WT only).
  const findings = collectFloorFindings(dir);
  console.log('');
  console.log(`  raccolti ${findings.length} finding dal floor (gitleaks working-tree)`);

  // (6) pickSeed LP-S1.
  const seedLPS1 = pickSeedLPS1(findings);
  assert('finding LP-S1 raccolto dagli oracoli del floor (secret working-tree config/services.php)',
    Boolean(seedLPS1),
    seedLPS1 ? `cat=${seedLPS1.category} rule=${seedLPS1.source_oracle.rule_id} file=${posix(seedLPS1.location.file)}` : 'ASSENTE');

  // (7) Esegui il loop per LP-S1 col fix-provider deterministico (eval-mode).
  const provider = deterministicFixProvider();
  const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
  console.log('');
  console.log('  esecuzione del verify-fix loop per LP-S1 (eval-mode):');
  if (seedLPS1) {
    const res = runFindingLoop(seedLPS1, { dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    results['LP-S1'] = res;
    console.log(`    LP-S1: fix_state=${res.fix_state} — ${String(res.reason || '').slice(0, 120)}`);
  } else {
    results['LP-S1'] = { fix_state: 'MISSING' };
  }

  // (8) ASSERZIONE di stato-fix (FATTO dell'oracolo rieseguito dal loop).
  console.log('');
  console.log('  Stato-fix (promozione = FATTO dell oracolo, L-COL-002):');
  assert('LP-S1 -> verified (gitleaks working-tree PULITO su config/services.php)',
    results['LP-S1'] && results['LP-S1'].fix_state === 'verified',
    `fix_state=${results['LP-S1'] && results['LP-S1'].fix_state}`);

  // (9) RE-RUN INDIPENDENTE: gitleaks WT ri-eseguito sulla copia post-loop.
  console.log('');
  console.log('  RE-RUN INDIPENDENTE degli oracoli post-loop:');
  const gwt2 = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let gwtJson2 = null; try { gwtJson2 = JSON.parse(gwt2.stdout); } catch { /* */ }
  const secretsAfter = Array.isArray(gwtJson2)
    ? gwtJson2.filter((f) => f && /(^|\/)config\/services\.php$/.test(posix(String(f.File || f.file || ''))))
    : null;
  assert('gitleaks working-tree (ri-eseguito) NON segnala piu config/services.php',
    Array.isArray(gwtJson2) && secretsAfter !== null && secretsAfter.length === 0,
    secretsAfter === null ? 'gitleaks non rieseguibile' : (secretsAfter.length > 0 ? `ANCORA ${secretsAfter.length} finding (fix non efficace!)` : '0 finding su services.php'));

  // Verifica TESTUALE: il literal hardcoded sparito da config/services.php.
  const cfgAfter = readSafe(join(dir, 'config', 'services.php'));
  assert('secret LP-S1: il literal sk_live_ sparisce da config/services.php (lettura da env)',
    !/sk_live_4f3c9b2a17e84d05bb6e1c2d9f0a7e63d8a45c1b9f2e607/.test(cfgAfter),
    /sk_live_4f3c9b2a17e84d05bb6e1c2d9f0a7e63d8a45c1b9f2e607/.test(cfgAfter)
      ? 'literal ANCORA presente (fix non applicata!)'
      : 'literal rimosso');
  // Contrasto: la lettura da env('API_KEY') (o equivalente) e' presente.
  assert('contrasto: config/services.php legge la chiave da env() dopo la fix',
    /env\s*\(/.test(cfgAfter),
    /env\s*\(/.test(cfgAfter) ? 'env() presente' : 'env() ASSENTE (fix incomplete?)');
}

// (10) IGIENE: fixture ORIGINALE bit-identica + HEAD esterno invariato.
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
console.log(`=== GATE eco-F5a (laravel-php secret-verified) RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
