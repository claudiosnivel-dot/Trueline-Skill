#!/usr/bin/env node
// verify_fix_check.mjs — GATE di VERIFY (eco-F5a): il verify-fix LOOP promuove a
// `verified` la categoria del verified_set (secret) sulla fixture dotnet-cs
// (ASP.NET Core + C#). Clone strutturale di eval/ecosystems/firebase-jsts/
// verify_fix_check.mjs, adattato alla fixture C# (niente knip/dead-code, niente
// firestore_rules_check; solo gitleaks working-tree per il secret CS-S1). Scritto
// TEST-FIRST.
//
// Il "verde" e' un FATTO degli ORACOLI riesiguiti dal loop (gitleaks), MAI
// una frase dell'LLM (L-COL-002). Su una COPIA ISOLATA della fixture
// (MAI l'originale: eval/.tmp-verify-cs/<id>, .git incluso) il gate, in 9 stadi:
//   1) SNAPSHOT d'integrita' (sola lettura) — repo ESTERNO + fixture INTERNA;
//   2) PRECONDIZIONE: se reference-app/.git manca -> banner + exit 2 (il
//      provisioning dell'inner-repo e' dell'ORCHESTRATORE, L-COL-024);
//   3) COPIA ISOLATA della fixture (eval/.tmp-verify-cs/<pid>-<n>, .git incluso);
//   4) createWorkBranch sul .git INTERNO della copia (come run_loop);
//   5) collectFloorFindings: gitleaks working-tree (secret CS-S1);
//   6) pickSeed per l'ancora del registry (CS-S1);
//   7) runFindingLoop col fix-provider deterministico (eval-mode: gate umano
//      auto-approvato, solo-eval, L-COL-021) per CS-S1;
//   8) ASSERISCE lo stato-fix atteso (FATTO dell'oracolo, non opinione):
//        CS-S1 (secret Controllers/ItemsController.cs, working-tree) -> verified
//             (gitleaks WT pulito: il literal sk_live_ non e' piu' nel sorgente);
//   9) RE-RUN INDIPENDENTE di gitleaks WT sulla copia post-loop: 0 secret;
//      + CONTRASTO testuale: literal hardcoded sparisce da Controllers/ItemsController.cs;
//  10) IGIENE: temp pulito, fixture ORIGINALE bit-identica (status interno +
//      HEAD interno INVARIATI vs snapshot) e HEAD del repo ESTERNO INVARIATO.
//
// NIENTE dead-code: dotnet-cs non ha knip (e' un progetto C#, non Node.js);
// dead-code NON e' nel verified_set.
// NIENTE authz: authz-verified richiede semgrep su C# (non disponibile nel
// sandbox in F5a, L-COL-006); authz NON e' nel verified_set (F5a = solo secret).
// NIENTE history-secret: CS-S1 e' working-tree; nessun CS-S6 history (la fixture
// NON semina un seed di history) -> nessun esito mitigated-residual atteso.
// NIENTE node:test GUARD: la fixture e' C# (ASP.NET Core), nessuna test suite
// Node.js disponibile; il guard di contratto e' il contrasto testuale sul file.
//
// FALSIFICABILITA: neutralizzando il fix del secret (no-op) questo gate DEVE
// fallire su CS-S1 (gitleaks continua a segnalare). Il gate NON e' un timbro
// sempre-verde.
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
// eval/ecosystems/dotnet-cs -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify-cs');

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

// Crea una COPIA ISOLATA della fixture (eval/.tmp-verify-cs/<id>, .git incluso).
// Mirror di copyPackFixture: id unico per-run (pid + counter). Cleanup never-throw.
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_VERIFY_ROOT, `verify-fix-cs-pid${process.pid}-${__c}`);
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
// gitleaks working-tree (secret CS-S1). NIENTE history-secret (nessun seed di
// history nella fixture dotnet-cs). NIENTE knip (progetto C#). NIENTE semgrep
// (authz non nel verified_set F5a).
function collectFloorFindings(dir) {
  const out = [];
  const gwt = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let gwtJson = null; try { gwtJson = JSON.parse(gwt.stdout); } catch { /* */ }
  if (Array.isArray(gwtJson)) out.push(...norm('gitleaks', gwtJson, 'working-tree'));
  return out;
}

// Seleziona, dai finding raccolti, il rappresentante atteso del seed CS-S1.
// Selettore data-driven sull'ancora del registry (file Controllers/ItemsController.cs,
// scope working-tree, categoria secret).
function pickSeed(findings, kind) {
  if (kind === 'CS-S1') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'working-tree'
      && /(^|\/)Controllers\/ItemsController\.cs$/.test(posix(f.location.file)));
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
console.log(' GATE VERIFY (eco-F5a) — verify-fix LOOP su dotnet-cs (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : CS-S1 -> verified (secret, gitleaks WT pulito)');
console.log('   verified_set = [secret] (dead-code/authz non verificati in F5a)');
console.log('   NIENTE history-secret / NIENTE knip / NIENTE semgrep C#');
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
  console.log('   Esegui il provisioning del pack dotnet-cs, poi ri-lancia il gate.');
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
assert('copia ISOLATA della fixture creata (eval/.tmp-verify-cs, .git incluso)',
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
  createWorkBranch(dir, 'trueline/remediate/verify-fix-cs');

  // (5) raccogli i finding del floor dalla copia.
  const findings = collectFloorFindings(dir);
  console.log('');
  console.log(`  raccolti ${findings.length} finding dal floor (gitleaks working-tree)`);

  // (6) pickSeed per l'ancora del registry.
  const seeds = {
    'CS-S1': pickSeed(findings, 'CS-S1'),
  };
  for (const [id, f] of Object.entries(seeds)) {
    assert(`finding ${id} raccolto dagli oracoli del floor`, Boolean(f),
      f ? `cat=${f.category} rule=${f.source_oracle.rule_id} file=${posix(f.location.file)} sym=${f.location.symbol || '-'}` : 'ASSENTE');
  }

  // (7) esegui il loop per CS-S1 col fix-provider deterministico (eval-mode).
  const provider = deterministicFixProvider();
  const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
  console.log('');
  console.log('  esecuzione del verify-fix loop per CS-S1 (eval-mode):');
  for (const id of ['CS-S1']) {
    const f = seeds[id];
    if (!f) { results[id] = { fix_state: 'MISSING' }; continue; }
    const res = runFindingLoop(f, { dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    results[id] = res;
    console.log(`    ${id}: fix_state=${res.fix_state} — ${String(res.reason || '').slice(0, 120)}`);
  }

  // (8) ASSERZIONE di stato-fix (FATTO dell'oracolo riesiguito dal loop).
  console.log('');
  console.log('  Stato-fix (promozione = FATTO dell oracolo, L-COL-002):');
  assert('CS-S1 -> verified (gitleaks working-tree PULITO su Controllers/ItemsController.cs)',
    results['CS-S1'] && results['CS-S1'].fix_state === 'verified',
    `fix_state=${results['CS-S1'] && results['CS-S1'].fix_state}`);

  // (9) VERIFICA INDIPENDENTE: re-run degli oracoli sulla copia post-loop.
  console.log('');
  console.log('  Re-run INDIPENDENTE degli oracoli sulla copia post-fix:');
  // gitleaks WT pulito (il secret CS-S1 e' neutralizzato).
  const wtCount = gitleaksWtCount(dir);
  assert('gitleaks (ri-girato) working-tree PULITO (0 secret) dopo il fix CS-S1',
    wtCount === 0,
    wtCount === null ? 'gitleaks non rieseguibile' : `secret-WT=${wtCount}`);

  // (9b) CONTRASTO testuale (FATTO sul file, in aggiunta al verdetto dell'oracolo):
  // il literal hardcoded sk_live_ deve sparire da Controllers/ItemsController.cs.
  // La lettura da env (Environment.GetEnvironmentVariable o _config[]) resta presente.
  const controllerAfter = readSafe(join(dir, 'Controllers', 'ItemsController.cs'));
  assert('secret CS-S1: il literal sk_live_ hardcoded sparisce da Controllers/ItemsController.cs',
    !/sk_live_[A-Za-z0-9]+/.test(controllerAfter),
    /sk_live_[A-Za-z0-9]+/.test(controllerAfter) ? 'literal ANCORA presente (fix non applicata!)' : 'literal rimosso');
  // Il contrasto pulito (lettura da config) NON deve essere toccato dalla fix.
  assert('contrasto: GetApiKeyFromConfig() o lettura da _config resta in Controllers/ItemsController.cs',
    /GetApiKeyFromConfig|_config\[|GetEnvironmentVariable/.test(controllerAfter),
    /GetApiKeyFromConfig|_config\[|GetEnvironmentVariable/.test(controllerAfter)
      ? 'presente (lettura da env/config intatta)' : 'ASSENTE (fix ha rimosso il contrasto!)');
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
// "bit-identica" = il gate NON ha mutato la fixture ORIGINALE: lo stato git e la
// HEAD interna sono INVARIATI rispetto allo SNAPSHOT pre-run. NON si pretende uno
// status VUOTO: in-workflow l'inner-repo porta legittimamente il GUARD di T6 (tests/)
// ancora non committato (il commit nell'inner .git e' dell'ORCHESTRATORE a T8,
// L-COL-024); cio' che conta e' che questa esecuzione non lasci residui.
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
console.log(`=== GATE VERIFY (eco-F5a) dotnet-cs RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
