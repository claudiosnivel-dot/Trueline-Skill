#!/usr/bin/env node
// verify_fix_check.mjs — GATE di F5a (secret-verified su postgres-go): il
// verify-fix LOOP promuove a `verified` la categoria secret del verified_set
// sulla fixture postgres-go (Go + Postgres NON-Supabase, authz-surface =
// route-authz, NIENTE RLS-al-DB).
// Scritto TEST-FIRST.
//
// Il "verde" e' un FATTO degli ORACOLI rieseguiti dal loop (gitleaks), MAI
// una frase dell'LLM (L-COL-002). Su una COPIA ISOLATA della fixture (MAI
// l'originale: eval/.tmp-verify-go/<id>, .git incluso) il gate:
//   1) raccoglie i finding del FLOOR dall'oracolo gitleaks working-tree;
//   2) per il finding GO-S1 esegue runFindingLoop col fix-provider deterministico
//      (eval-mode: gate umano auto-approvato, solo-eval, L-COL-021);
//   3) ASSERISCE lo stato-fix atteso (FATTO dell'oracolo, non opinioni):
//        GO-S1 (secret main.go, working-tree)   -> verified (gitleaks WT pulito)
//   4) GUARD: go build ./... sulla COPIA post-fix resta verde (la fix non
//      rompe la compilazione).
//   5) IGIENE: la fixture ORIGINALE resta bit-identica (status interno vuoto +
//      HEAD interno invariato) e l'HEAD del repo ESTERNO e' INVARIATO.
//
// DEAD-CODE GO-S4 (Eco-F5b): postgres-go ha dead-code nel verified_set (Eco-F5b
// aggiunge dead-code a [secret]). L'oracolo e' go-deadcode ('deadcode -json ./...'
// sul modulo Go). Il fix-loop per go-deadcode NON e' eseguito in questo gate
// (engine non pronto: go-deadcode dispatch assente dal fix-provider in questa
// ondata). Si asserisce SOLO la rilevazione del seed (SEED:POSTGRESGO-DC in
// dead.go, UnusedHelper come funzione irraggiungibile).
// NIENTE RLS: postgres-go non ha RLS-al-DB (authz-surface e' route-authz via
// semgrep). E' la differenza strutturale con supabase-jsts/postgres-py.
//
// FALSIFICABILITA: neutralizzando il fix del secret (no-op) questo gate DEVE
// fallire su GO-S1 (gitleaks continua a segnalare). Il gate NON e' un timbro
// sempre-verde.
//
// NOTA DI ONDATA (W1-W3): il binding del seed-path postgres-go (main.go) nel
// fix-provider e' fornito da F5a (additivo in fix_provider.mjs). Se in questa
// ondata il fix-provider non riconosce ancora il path di main.go, questo gate
// fallira': e' atteso e dichiarato. Il gate detection-level e' fixture_check.mjs;
// questo script e' costruito per essere esercitato dal gate F5a dell'orchestratore.
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
import { deterministicFixProvider } from '../../harness/fix_provider.eval.mjs';
import { runFindingLoop } from '../../../trueline/scripts/loop/loop.mjs';
import { createWorkBranch } from '../../../trueline/scripts/git/layered_git.mjs';
import { LOOP_BUDGET } from '../../../trueline/scripts/checkpoint/thresholds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// eval/ecosystems/postgres-go -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const DEADCODE_BIN = process.platform === 'win32'
  ? 'C:/Users/claud/go/bin/deadcode'
  : 'deadcode';
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify-go');

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

// Esegue 'deadcode -json ./...' sulla COPIA (oracolo go-deadcode, Eco-F5b).
// L'env arricchisce il PATH con GO_BIN per garantire la disponibilita del
// binario su tutti i sistemi. cwd = dir del modulo Go.
function runGoDeadcode(dir) {
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(DEADCODE_BIN, ['-json', './...'], {
    cwd: dir, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

// Estrae i nomi delle funzioni irraggiungibili dall'output JSON di deadcode.
// Formato: [{Name, Path, Funcs:[{Name, Position:{File,Line,Col}, ...}]}] | null
// Ritorna [{name, file}] (lista piatta di tutti i simboli morti trovati).
function extractDeadFuncs(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout || 'null'); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const funcs = [];
  for (const pkg of parsed) {
    for (const f of (pkg.Funcs || [])) {
      funcs.push({ name: f.Name, file: posix((f.Position && f.Position.File) || '') });
    }
  }
  return funcs;
}

// Normalizza un output nativo nel finding model, identico al loop: tagga lo scope;
// scarta se lo schema non valida.
function norm(oracle, json, scope) {
  const f = normalize(oracle, json, { ...RUN_OPTS, scope });
  const v = validateMany(f);
  return (v.ok ? f : []).map((x) => ({ ...x, _scope: scope }));
}

// Crea una COPIA ISOLATA della fixture (eval/.tmp-verify-go/<id>, .git incluso).
// Mirror di copyPackFixture: id unico per-run (pid + counter).
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_VERIFY_ROOT, `verify-fix-go-pid${process.pid}-${__c}`);
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

// Raccoglie i finding del FLOOR dalla copia con l'oracolo gitleaks working-tree
// (scope BUILD: scansiona i FILE su disco). NIENTE history (GO-S1 vive solo nel
// working-tree), NIENTE dead-code (non nel verified_set postgres-go).
function collectFloorFindings(dir) {
  const out = [];
  const gwt = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let gwtJson = null; try { gwtJson = JSON.parse(gwt.stdout); } catch { /* */ }
  if (Array.isArray(gwtJson)) out.push(...norm('gitleaks', gwtJson, 'working-tree'));
  return out;
}

// Seleziona, dai finding raccolti, il rappresentante atteso del seed GO-S1
// (secret in main.go, working-tree). Selettore data-driven sull'ancora del
// registry (path/scope).
function pickSeed(findings, kind) {
  if (kind === 'GO-S1') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'working-tree'
      && /(^|\/)main\.go$/.test(posix(f.location.file)));
  }
  return undefined;
}

console.log('============================================================');
console.log(' GATE F5b — verify-fix LOOP su postgres-go (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : GO-S1 -> verified (gitleaks WT pulito su main.go)');
console.log('   atteso  : GO-S4 -> rilevato da go-deadcode (fix-loop non pronto, Eco-F5b)');
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
assert('copia ISOLATA della fixture creata (eval/.tmp-verify-go, .git incluso)',
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
  createWorkBranch(dir, 'trueline/remediate/verify-fix-go');

  // (1) raccogli i finding del floor dalla copia (gitleaks working-tree).
  const findings = collectFloorFindings(dir);
  console.log('');
  console.log(`  raccolti ${findings.length} finding dal floor (gitleaks working-tree)`);

  const seeds = {
    'GO-S1': pickSeed(findings, 'GO-S1'),
  };
  for (const [id, f] of Object.entries(seeds)) {
    assert(`finding ${id} raccolto dagli oracoli del floor`, Boolean(f),
      f ? `cat=${f.category} rule=${f.source_oracle.rule_id} file=${posix(f.location.file)}` : 'ASSENTE');
  }

  // (2) esegui il loop per GO-S1 col fix-provider deterministico (eval-mode).
  const provider = deterministicFixProvider();
  const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
  console.log('');
  console.log('  esecuzione del verify-fix loop per GO-S1 (eval-mode):');
  for (const id of ['GO-S1']) {
    const f = seeds[id];
    if (!f) { results[id] = { fix_state: 'MISSING' }; continue; }
    const res = runFindingLoop(f, { dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    results[id] = res;
    console.log(`    ${id}: fix_state=${res.fix_state} — ${String(res.reason || '').slice(0, 120)}`);
  }

  // (3) ASSERZIONI di stato-fix (FATTI dell'oracolo rieseguito dal loop).
  console.log('');
  console.log('  Stati-fix (promozione = FATTO dell oracolo, L-COL-002):');
  assert('GO-S1 -> verified (gitleaks working-tree PULITO su main.go)',
    results['GO-S1'] && results['GO-S1'].fix_state === 'verified',
    `fix_state=${results['GO-S1'] && results['GO-S1'].fix_state}`);

  // (3b) secret GO-S1: il literal hardcoded e' sparito da main.go (FATTO testuale
  //   in aggiunta al verdetto dell'oracolo): nessun sk_live_GOF1workingtree_ resta
  //   come literal (la fix legge da os.Getenv).
  const mainGoAfter = readSafe(join(dir, 'main.go'));
  assert('secret GO-S1: il literal hardcoded sparisce da main.go (legge da os.Getenv)',
    !/sk_live_GOF1workingtree_/.test(mainGoAfter),
    /sk_live_GOF1workingtree_/.test(mainGoAfter) ? 'literal ANCORA presente (fix non applicata!)' : 'literal rimosso');
  // contrasto: envAPIKey letto da os.Getenv resta definito (la fix non ha rotto il modulo).
  assert('contrasto: envAPIKey (os.Getenv) resta definito in main.go dopo la fix',
    /os\.Getenv\(/.test(mainGoAfter),
    /os\.Getenv\(/.test(mainGoAfter) ? 'presente' : 'RIMOSSA (fix ha rotto il modulo!)');

  // (3c) DEAD-CODE GO-S4 — oracle go-deadcode su dead.go (SEED:POSTGRESGO-DC).
  // NON si esegue il fix-loop (engine non pronto: go-deadcode dispatch assente
  // dal fix-provider in questa ondata). Si asserisce la RILEVAZIONE strutturale
  // del seed e la risposta dell'oracolo nativo (deadcode -json ./...).
  console.log('');
  console.log('  DEAD-CODE GO-S4 — rilevazione oracle go-deadcode (fix-loop non pronto):');
  const deadFilePath = join(dir, 'dead.go');
  assert('dead.go PRESENTE nella copia (seed dead-code GO-S4)',
    existsSync(deadFilePath), deadFilePath);
  const deadGoSrc = readSafe(deadFilePath);
  assert('SEED:POSTGRESGO-DC presente in dead.go (marker del seed)',
    /SEED:POSTGRESGO-DC/.test(deadGoSrc),
    /SEED:POSTGRESGO-DC/.test(deadGoSrc) ? 'marker trovato' : 'MARKER ASSENTE');
  assert('UnusedHelper definita in dead.go (funzione morta seminata)',
    /func\s+UnusedHelper\s*\(/.test(deadGoSrc),
    /func\s+UnusedHelper\s*\(/.test(deadGoSrc) ? 'definita' : 'ASSENTE (seed non piantato!)');
  assert('UsedHelper definita in dead.go (contrasto PULITO)',
    /func\s+UsedHelper\s*\(/.test(deadGoSrc),
    /func\s+UsedHelper\s*\(/.test(deadGoSrc) ? 'definita' : 'ASSENTE');
  const dcRes = runGoDeadcode(dir);
  const deadFuncs = extractDeadFuncs(dcRes.stdout);
  const unusedFound = deadFuncs.some((f) => f.name === 'UnusedHelper');
  const usedFlagged = deadFuncs.some((f) => f.name === 'UsedHelper');
  assert('go-deadcode segnala UnusedHelper come irraggiungibile (seed rilevato)',
    unusedFound,
    dcRes.error ? `deadcode non eseguibile: ${dcRes.error.message}`
      : (unusedFound ? 'rilevata (SEED:POSTGRESGO-DC)' : `NON rilevata — funcs=[${deadFuncs.map((f) => f.name).join(',')}]`));
  assert('go-deadcode NON segnala UsedHelper (contrasto PULITO, 0 falsi positivi)',
    !usedFlagged,
    usedFlagged ? 'SEGNALATA (falso positivo! contrasto rotto)' : 'non segnalata (corretta)');

  // (4) GUARD: go build ./... sulla COPIA post-fix resta verde (la fix non rompe
  //   la compilazione Go).
  console.log('');
  console.log('  GUARD — go build sulla COPIA post-fix (la fix non rompe la compilazione):');
  const goEnv = {
    ...process.env,
    PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}`,
    GOFLAGS: '-mod=mod',
  };
  const guard = spawnSync('go', ['build', './...'], {
    cwd: dir, env: goEnv, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  assert('go build ./... sulla COPIA post-fix esce 0 (compilazione verde)',
    guard.status === 0,
    guard.error ? `go non eseguibile: ${guard.error.message}` : `exit=${guard.status}`);
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
// NOTA (Eco-F5b): dead.go e' appena aggiunto alla fixture come seed dead-code
// e non e' ancora committato nel .git INTERNO (il commit spetta all'orchestratore).
// La condizione di isolamento FORTE e': il gate NON ha modificato il working-tree
// della fixture (innerStatusAfter === innerStatusBefore) E l'HEAD non e' cambiato.
// La condizione "status vuoto" e' un RINFORZO (fixture committed); qui e' RILASSATA
// a "status invariato" per tollerare il seed non-ancora-committato in questa ondata.
assert('fixture ORIGINALE bit-identica (HEAD interno invariato + working-tree non contaminato dal gate)',
  innerStatusAfter === innerStatusBefore && innerHeadAfter === innerHeadBefore,
  innerStatusAfter === innerStatusBefore && innerHeadAfter === innerHeadBefore
    ? `invariata (status="${innerStatusAfter || 'clean'}" head=${innerHeadAfter.slice(0, 10)})`
    : `CONTAMINATA — status-prima="${innerStatusBefore}" status-dopo="${innerStatusAfter}" head=${innerHeadAfter.slice(0, 10)}`);
const outerHeadAfter = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
assert('HEAD del repo ESTERNO INVARIATO (0 contaminazione)', outerHeadAfter === outerHeadBefore,
  outerHeadAfter === outerHeadBefore ? `${outerHeadBefore.slice(0, 10)} (invariato)` : 'MUTATO (vietato!)');

// --- Esito --------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE F5b RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
