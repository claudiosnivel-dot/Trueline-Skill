#!/usr/bin/env node
// verify_fix_check.mjs — GATE di VERIFY (eco-F5a): il verify-fix LOOP promuove a
// `verified` la categoria secret del verified_set sulla fixture flutter-dart
// (Flutter/Dart + Supabase, authz-surface = route-authz via semgrep Dart
// sperimentale, NIENTE RLS-al-DB). Clone adattato di
// eval/ecosystems/firebase-jsts/verify_fix_check.mjs — solo secret (FD-S1).
// Scritto TEST-FIRST.
//
// Il "verde" e' un FATTO degli ORACOLI riesiguiti dal loop (gitleaks), MAI
// una frase dell'LLM (L-COL-002). Su una COPIA ISOLATA della fixture
// (eval/.tmp-verify-dart/<pid>-<n>, .git incluso) il gate, in 9 stadi:
//   1) SNAPSHOT d'integrita' (sola lettura) — repo ESTERNO + fixture INTERNA;
//   2) PRECONDIZIONE: se reference-app/.git manca -> banner + exit 2 (il
//      provisioning dell'inner-repo e' dell'ORCHESTRATORE, L-COL-024);
//   3) COPIA ISOLATA della fixture (eval/.tmp-verify-dart/<pid>-<n>, .git incluso);
//   4) createWorkBranch sul .git INTERNO della copia (come run_loop);
//   5) collectFloorFindings: gitleaks WT+history (secret);
//   6) pickSeed per l'ancora del registry (FD-S1: lib/config.dart, WT);
//   7) runFindingLoop col fix-provider deterministico (eval-mode: gate umano
//      auto-approvato, solo-eval, L-COL-021) per FD-S1;
//   8) ASSERISCE lo stato-fix atteso (FATTO dell'oracolo, non opinione):
//        FD-S1 (secret lib/config.dart, working-tree) -> verified (gitleaks WT pulito)
//      + RE-RUN INDIPENDENTE: gitleaks WT pulito (0 secret) post-fix;
//      + CONTRASTO testuale: literal _supabaseServiceKey sparisce da lib/config.dart;
//   9) IGIENE: temp pulito, fixture ORIGINALE bit-identica (status interno +
//      HEAD interno INVARIATI vs snapshot) e HEAD del repo ESTERNO INVARIATO.
//
// NIENTE dead-code (knip): non e' nel verified_set di flutter-dart.
// NIENTE authz (semgrep Dart sperimentale): non e' nel verified_set di flutter-dart.
// NIENTE secret-in-history: la fixture NON semina un FD-S6 history -> nessun
//   esito mitigated-residual atteso.
// NIENTE node:test GUARD: flutter-dart e' un progetto Dart puro; la suite di
//   caratterizzazione usa `dart test` (characterization_test.dart), non node:test.
//   Il gate non esegue dart (non disponibile nell'ambiente): omesso onestamente
//   (L-COL-006). Il contrasto testuale sul file e l'oracolo gitleaks sono la rete.
//
// FALSIFICABILITA': neutralizzando il fix del secret (no-op) questo gate DEVE
// fallire su FD-S1 (gitleaks continua a segnalare lib/config.dart). Il gate NON
// e' un timbro sempre-verde.
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
import { deterministicFixProvider } from '../../../trueline/scripts/loop/fix_provider.mjs';
import { runFindingLoop } from '../../../trueline/scripts/loop/loop.mjs';
import { createWorkBranch } from '../../../trueline/scripts/git/layered_git.mjs';
import { LOOP_BUDGET } from '../../../trueline/scripts/checkpoint/thresholds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// eval/ecosystems/flutter-dart -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify-dart');

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

// Crea una COPIA ISOLATA della fixture (eval/.tmp-verify-dart/<id>, .git incluso).
// Mirror di copyPackFixture: id unico per-run (pid + counter). Cleanup never-throw.
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_VERIFY_ROOT, `verify-fix-dart-pid${process.pid}-${__c}`);
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
// gitleaks WT+history (secret). NIENTE knip (dead-code non nel verified_set).
// NIENTE semgrep (authz Dart sperimentale non nel verified_set).
function collectFloorFindings(dir) {
  const out = [];
  const gwt = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let gwtJson = null; try { gwtJson = JSON.parse(gwt.stdout); } catch { /* */ }
  if (Array.isArray(gwtJson)) out.push(...norm('gitleaks', gwtJson, 'working-tree'));

  const gh = nodeRun(RUN_GITLEAKS, [dir, 'history'], dir);
  let ghJson = null; try { ghJson = JSON.parse(gh.stdout); } catch { /* */ }
  if (Array.isArray(ghJson)) out.push(...norm('gitleaks', ghJson, 'history'));

  return out;
}

// Seleziona, dai finding raccolti, il rappresentante del seed FD-S1:
// categoria secret, scope working-tree, file lib/config.dart.
function pickSeed(findings, kind) {
  if (kind === 'FD-S1') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'working-tree'
      && /(^|\/)lib\/config\.dart$/.test(posix(f.location.file)));
  }
  return undefined;
}

// Riesegue gitleaks working-tree sulla copia e ritorna il numero di secret nel
// working tree (0 = pulito). null se non eseguibile/JSON invalido.
function gitleaksWtCount(dir) {
  const g = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let json = null; try { json = JSON.parse(g.stdout); } catch { return null; }
  return Array.isArray(json) ? json.length : null;
}

console.log('============================================================');
console.log(' GATE VERIFY (eco-F5a) — verify-fix LOOP su flutter-dart (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : FD-S1 -> verified (secret lib/config.dart, gitleaks WT pulito)');
console.log('   SOLO secret: verified_set = [secret] (dead-code/authz detection-only)');
console.log('   NIENTE node:test GUARD: progetto Dart puro (no JS test suite)');
console.log('============================================================');
console.log('');

// (2) PRECONDIZIONE — l'inner-repo della fixture e' provisioning dell'ORCHESTRATORE
// (L-COL-024). Se .git manca, il gate NON puo' isolare ne' branchare: skip onesto
// con exit 2 (NON un falso verde, NON un fallimento del codice del gate).
const FIXTURE_GIT = resolve(FIXTURE, '.git');
if (!existsSync(FIXTURE_GIT)) {
  console.log('------------------------------------------------------------');
  console.log(' SKIP (exit 2): inner-repo della fixture ASSENTE.');
  console.log(`   atteso: ${FIXTURE_GIT}`);
  console.log('   Il provisioning dell\'inner .git e\' dell\'ORCHESTRATORE (L-COL-024).');
  console.log('   Esegui il provisioning del pack flutter-dart, poi ri-lancia il gate.');
  console.log('------------------------------------------------------------');
  process.exit(2);
}

// (1) SNAPSHOT d'integrita' (sola lettura) — repo ESTERNO + fixture INTERNA.
const outerHeadBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
const innerHeadBefore = gitRead(FIXTURE, ['rev-parse', 'HEAD']).stdout;
const innerStatusBefore = gitRead(FIXTURE, ['status', '--porcelain']).stdout;

assert('la fixture reference-app esiste', existsSync(FIXTURE), FIXTURE);

// (3) COPIA ISOLATA della fixture.
let ws = null;
let dir = null;
try { ws = copyFixture(); dir = ws.dir; } catch (e) {
  assert('copia ISOLATA della fixture creata', false, e.message);
}
assert('copia ISOLATA della fixture creata (eval/.tmp-verify-dart, .git incluso)',
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
  createWorkBranch(dir, 'trueline/remediate/verify-fix-dart');

  // (5) raccogli i finding del floor dalla copia.
  const findings = collectFloorFindings(dir);
  console.log('');
  console.log(`  raccolti ${findings.length} finding dal floor (gitleaks WT+history)`);

  // (6) pickSeed per l'ancora del registry.
  const seeds = {
    'FD-S1': pickSeed(findings, 'FD-S1'),
  };
  for (const [id, f] of Object.entries(seeds)) {
    assert(`finding ${id} raccolto dagli oracoli del floor`, Boolean(f),
      f ? `cat=${f.category} rule=${f.source_oracle.rule_id} file=${posix(f.location.file)} sym=${f.location.symbol || '-'}` : 'ASSENTE');
  }

  // (7) esegui il loop per FD-S1 col fix-provider deterministico (eval-mode).
  const provider = deterministicFixProvider();
  const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
  console.log('');
  console.log('  esecuzione del verify-fix loop per FD-S1 (eval-mode):');
  const f1 = seeds['FD-S1'];
  if (!f1) {
    results['FD-S1'] = { fix_state: 'MISSING' };
  } else {
    const res = runFindingLoop(f1, { dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    results['FD-S1'] = res;
    console.log(`    FD-S1: fix_state=${res.fix_state} — ${String(res.reason || '').slice(0, 120)}`);
  }

  // (8) ASSERZIONI di stato-fix (FATTI dell'oracolo riesiguito dal loop).
  console.log('');
  console.log('  Stati-fix (promozione = FATTO dell oracolo, L-COL-002):');
  assert('FD-S1 -> verified (gitleaks working-tree PULITO su lib/config.dart)',
    results['FD-S1'] && results['FD-S1'].fix_state === 'verified',
    `fix_state=${results['FD-S1'] && results['FD-S1'].fix_state}`);

  // (8b) VERIFICA INDIPENDENTE: re-run gitleaks WT sulla copia post-loop.
  console.log('');
  console.log('  Re-run INDIPENDENTE di gitleaks WT sulla copia post-fix:');
  const wtCount = gitleaksWtCount(dir);
  assert('gitleaks (ri-girato) working-tree PULITO (0 secret) dopo il fix FD-S1',
    wtCount === 0,
    wtCount === null ? 'gitleaks non rieseguibile' : `secret-WT=${wtCount}`);

  // (8c) CONTRASTO testuale: il literal hardcoded sparisce da lib/config.dart.
  // La fix deve sostituire il literal sk_live_fd1flutterdart con la lettura da
  // Platform.environment['SUPABASE_SERVICE_KEY'] (idioma Dart, L-COL-021).
  const cfgAfter = readSafe(join(dir, 'lib', 'config.dart'));
  assert('secret FD-S1: il literal hardcoded sparisce da lib/config.dart (legge da Platform.environment)',
    !/sk_live_fd1flutterdart/.test(cfgAfter),
    /sk_live_fd1flutterdart/.test(cfgAfter) ? 'literal ANCORA presente (fix non applicata!)' : 'literal rimosso');
  // contrasto: la lettura env e' presente (Platform.environment o env-read Dart).
  assert('contrasto: lib/config.dart contiene ancora una lettura da Platform.environment (env-read)',
    /Platform\.environment/.test(cfgAfter),
    /Platform\.environment/.test(cfgAfter) ? 'presente' : 'MANCANTE (fix ha rimosso anche il contrasto!)');
}

// (9) IGIENE: fixture ORIGINALE bit-identica + HEAD esterno invariato.
console.log('');
console.log('  IGIENE — fixture originale bit-identica + HEAD esterno invariato:');
let cleanupOk = true;
try { if (ws && ws.cleanup) ws.cleanup(); } catch { cleanupOk = false; }
assert('copia temp ripulita senza errori', cleanupOk, cleanupOk ? 'cleanup OK' : 'cleanup fallito');
assert('nessun residuo della copia temp (dir rimossa)', !dir || !existsSync(dir),
  dir && existsSync(dir) ? 'residuo presente' : 'rimossa');
const innerStatusAfter = gitRead(FIXTURE, ['status', '--porcelain']).stdout;
const innerHeadAfter = gitRead(FIXTURE, ['rev-parse', 'HEAD']).stdout;
// "bit-identica" = il gate NON ha mutato la fixture ORIGINALE: lo stato git e la
// HEAD interna sono INVARIATI rispetto allo SNAPSHOT pre-run.
assert('fixture ORIGINALE bit-identica (status interno + HEAD interno INVARIATI vs snapshot)',
  innerStatusAfter === innerStatusBefore && innerHeadAfter === innerHeadBefore,
  innerStatusAfter === innerStatusBefore && innerHeadAfter === innerHeadBefore
    ? 'invariata' : `status="${innerStatusAfter}" (prima="${innerStatusBefore}") head=${innerHeadAfter.slice(0, 10)}`);
const outerHeadAfter = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
assert('HEAD del repo ESTERNO INVARIATO (0 contaminazione)', outerHeadAfter === outerHeadBefore,
  outerHeadAfter === outerHeadBefore ? `${outerHeadBefore.slice(0, 10)} (invariato)` : 'MUTATO (vietato!)');

// --- Esito --------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE VERIFY (eco-F5a) flutter-dart RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
