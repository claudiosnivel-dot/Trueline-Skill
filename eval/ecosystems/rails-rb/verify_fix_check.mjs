#!/usr/bin/env node
// verify_fix_check.mjs — GATE di F5a (eco-expansion): il verify-fix LOOP promuove a
// `verified` la categoria `secret` del verified_set per rails-rb (Ruby on Rails,
// authz-surface = route-authz, NIENTE RLS-al-DB). In parita con
// postgres-jsts/verify_fix_check.mjs (stesso schema, stesso loop, oracolo gitleaks).
// Scritto TEST-FIRST.
//
// Il "verde" e' un FATTO degli ORACOLI rieseguiti dal loop (gitleaks), MAI
// una frase dell'LLM (L-COL-002). Su una COPIA ISOLATA della fixture (MAI
// l'originale: eval/.tmp-verify-rb/<id>, .git incluso) il gate:
//   1) raccoglie i finding del FLOOR dagli oracoli legati (gitleaks WT);
//   2) per RB-S1 esegue runFindingLoop col fix-provider deterministico
//      (eval-mode: gate umano auto-approvato, solo-eval, L-COL-021);
//   3) ASSERISCE lo stato-fix atteso (FATTO dell'oracolo, non opinione):
//        RB-S1 (secret config/initializers/api_keys.rb, WT) -> verified (gitleaks WT pulito)
//   4) IGIENE: la fixture ORIGINALE resta bit-identica (status interno vuoto +
//      HEAD interno invariato) e l'HEAD del repo ESTERNO e' INVARIATO.
//
// NIENTE dead-code: rails-rb ha verified_set = [secret] (solo gitleaks).
// NIENTE node:test GUARD: la fixture e' Ruby (non Node); non c'e' suite --test.
//
// FALSIFICABILITA: neutralizzando il fix del secret (no-op) questo gate DEVE
// fallire su RB-S1 (gitleaks continua a segnalare). Il gate NON e' un timbro
// sempre-verde.
//
// NOTA DI ONDATA (F5a): il binding del seed-path rails-rb nel dispatch Ruby del
// fix-provider e' fornito dal task fix_provider di F5a. Se in questa ondata il
// fix-provider non riconosce ancora il path config/initializers/api_keys.rb
// (ramo `fixSecretRbS1`), questo gate fallira': e' atteso e va dichiarato. Il
// gate detection-level e' fixture_check.mjs; questo script e' costruito per
// essere esercitato in W3 dall'orchestratore dopo l'aggiunta del ramo Ruby.
//
// Gli oracoli gitleaks richiedono C:/Users/claud/go/bin sul PATH: lo arricchiamo
// per gli spawn. NON tocca MAI il git del repo ESTERNO se non in SOLA LETTURA.
// Le mutazioni git avvengono sul .git INTERNO della COPIA (isolato, L-COL-024).
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
// eval/ecosystems/rails-rb -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify-rb');

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

// Crea una COPIA ISOLATA della fixture (eval/.tmp-verify-rb/<id>, .git incluso).
// Mirror di copyPackFixture: id unico per-run (pid + counter).
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_VERIFY_ROOT, `verify-fix-rb-pid${process.pid}-${__c}`);
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
// gitleaks WT (secret). NIENTE dead-code (non nel verified_set rails-rb).
function collectFloorFindings(dir) {
  const out = [];
  const gwt = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let gwtJson = null; try { gwtJson = JSON.parse(gwt.stdout); } catch { /* */ }
  if (Array.isArray(gwtJson)) out.push(...norm('gitleaks', gwtJson, 'working-tree'));
  return out;
}

// Seleziona, dai finding raccolti, il rappresentante di RB-S1 (secret WT su
// config/initializers/api_keys.rb). Selettore data-driven sull'ancora del registry.
function pickSeed(findings, kind) {
  if (kind === 'RB-S1') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'working-tree'
      && /(^|\/)config\/initializers\/api_keys\.rb$/.test(posix(f.location.file)));
  }
  return undefined;
}

console.log('============================================================');
console.log(' GATE F5a (eco-expansion) — verify-fix LOOP su rails-rb (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : RB-S1 -> verified (gitleaks WT pulito su config/initializers/api_keys.rb)');
console.log('   verified_set = [secret] (route-authz e dep-vuln restano detection-only)');
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
assert('copia ISOLATA della fixture creata (eval/.tmp-verify-rb, .git incluso)',
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
  createWorkBranch(dir, 'trueline/remediate/verify-fix-rb');

  // (1) raccogli i finding del floor dalla copia.
  const findings = collectFloorFindings(dir);
  console.log('');
  console.log(`  raccolti ${findings.length} finding dal floor (gitleaks WT)`);

  const seeds = {
    'RB-S1': pickSeed(findings, 'RB-S1'),
  };
  for (const [id, f] of Object.entries(seeds)) {
    assert(`finding ${id} raccolto dagli oracoli del floor`, Boolean(f),
      f ? `cat=${f.category} rule=${f.source_oracle.rule_id} file=${posix(f.location.file)}` : 'ASSENTE');
  }

  // (2) esegui il loop per RB-S1 col fix-provider deterministico (eval-mode).
  const provider = deterministicFixProvider();
  const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
  console.log('');
  console.log('  esecuzione del verify-fix loop per RB-S1 (eval-mode):');
  for (const id of ['RB-S1']) {
    const f = seeds[id];
    if (!f) { results[id] = { fix_state: 'MISSING' }; continue; }
    const res = runFindingLoop(f, { dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    results[id] = res;
    console.log(`    ${id}: fix_state=${res.fix_state} — ${String(res.reason || '').slice(0, 120)}`);
  }

  // (3) ASSERZIONE di stato-fix (FATTO dell'oracolo rieseguito dal loop).
  console.log('');
  console.log('  Stato-fix (promozione = FATTO dell oracolo, L-COL-002):');
  assert('RB-S1 -> verified (gitleaks WT PULITO su config/initializers/api_keys.rb)',
    results['RB-S1'] && results['RB-S1'].fix_state === 'verified',
    `fix_state=${results['RB-S1'] && results['RB-S1'].fix_state}`);

  // (3b) Verifica TESTUALE: il literal hardcoded sparisce dal file dopo il fix
  //   (FATTO in aggiunta al verdetto dell'oracolo).
  const apiKeysAfter = readSafe(join(dir, 'config', 'initializers', 'api_keys.rb'));
  assert('secret RB-S1: il literal sk_live_RAILS4RbS1 sparisce da config/initializers/api_keys.rb (legge da ENV)',
    !/sk_live_RAILS4RbS1/.test(apiKeysAfter),
    /sk_live_RAILS4RbS1/.test(apiKeysAfter) ? 'literal ANCORA presente (fix non applicata!)' : 'literal rimosso');
}

// (4) IGIENE: fixture ORIGINALE bit-identica + HEAD esterno invariato.
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
console.log(`=== GATE F5a rails-rb RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
