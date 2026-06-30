#!/usr/bin/env node
// verify_fix_check.mjs — GATE di VERIFY (eco-F1): il verify-fix LOOP promuove a
// `verified` le 3 categorie del verified_set (secret, dead-code, authz) sulla
// fixture firebase-py (firebase-admin Python + Firestore rules). Clonato da
// firebase-jsts/verify_fix_check.mjs con adattamenti per Python (vulture per
// dead-code, pytest per il GUARD, seed FB-S4 al posto di FB-S5). Scritto
// TEST-FIRST.
//
// Il "verde" e' un FATTO degli ORACOLI rieseguiti dal loop (gitleaks/vulture/
// firestore_rules_check), MAI una frase dell'LLM (L-COL-002). Su una COPIA
// ISOLATA della fixture (MAI l'originale: eval/.tmp-verify-fb-py/<id>, .git
// incluso) il gate, in 10 stadi:
//   1) SNAPSHOT d'integrita' (sola lettura) — repo ESTERNO + fixture INTERNA;
//   2) PRECONDIZIONE: se reference-app/.git manca -> banner + exit 2 (il
//      provisioning dell'inner-repo e' dell'ORCHESTRATORE, L-COL-024);
//   3) COPIA ISOLATA della fixture (eval/.tmp-verify-fb-py/<pid>-<n>, .git incluso);
//   4) createWorkBranch sul .git INTERNO della copia (come run_loop);
//   5) collectFloorFindings: gitleaks WT+history (secret), vulture (dead-code),
//      firestore_rules_check -> normalize('firestore-rules',...,'working-tree')
//      (authz);
//   6) pickSeed per le ancore del registry (FB-S1/FB-S4/FB-S3);
//   7) runFindingLoop col fix-provider deterministico (eval-mode: gate umano
//      auto-approvato, solo-eval, L-COL-021) per OGNI seed;
//   8) ASSERISCE gli stati-fix attesi (FATTI dell'oracolo, non opinioni):
//        FB-S1 (secret serviceAccount.json, working-tree) -> verified (gitleaks WT pulito)
//        FB-S4 (dead-code _unused_helper, vulture)         -> verified (vulture non lo segnala piu')
//        FB-S3 (authz firestore.rules allow if true)       -> verified (firestore_rules_check ri-eseguito 0 finding)
//   9) RE-RUN INDIPENDENTE degli oracoli sulla copia post-loop: gitleaks WT
//      pulito, vulture non flagga _unused_helper, firestore_rules_check 0 finding;
//      + GUARD: la suite pytest di caratterizzazione resta VERDE post-fix;
//  10) IGIENE: temp pulito, fixture ORIGINALE bit-identica (status interno vuoto
//      + HEAD interno invariato) e HEAD del repo ESTERNO INVARIATO (0 contam).
//
// SCOPING ONESTO authz (L-COL-006): authz-verified = firestore_rules_check
// STATICO ri-eseguito pulito (la regola testuale non concede piu' `if true`,
// passa a owner-scoped) — NON invarianza d'isolamento a runtime (l'emulatore
// Firestore non e' disponibile). Analogo dichiarativo del transfer RLS
// USING(true)->predicato reale, provato dall'oracolo statico.
//
// NIENTE RLS: firebase-py non ha RLS-al-DB (la sua authz-surface sono le
// Firestore Security Rules), quindi rls NON e' nel verified_set: nessun DB-test
// runtime, nessuna migration-dir, nessun Docker.
// NIENTE secret-in-history: la fixture firebase-py NON semina un secret-history
// -> nessun esito mitigated-residual atteso.
//
// FALSIFICABILITA: neutralizzando il fix del secret, del dead-code o dell'authz
// (no-op) questo gate DEVE fallire sul rispettivo seed (gli oracoli continuano a
// segnalare). Il gate NON e' un timbro sempre-verde.
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
// eval/ecosystems/firebase-py -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RUN_DEADCODE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_deadcode.mjs');
// authz Firestore: oracolo statico delle Security Rules (riuso da firebase-jsts).
const FIRESTORE_RULES_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'firestore_rules_check.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify-fb-py');

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
const baseName = (p) => String(p).replace(/\\/g, '/').split('/').pop();

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

// Crea una COPIA ISOLATA della fixture (eval/.tmp-verify-fb-py/<id>, .git incluso).
// Mirror di copyPackFixture: id unico per-run (pid + counter). Cleanup never-throw.
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_VERIFY_ROOT, `verify-fix-fb-py-pid${process.pid}-${__c}`);
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
// gitleaks WT+history (secret), vulture (dead-code), firestore_rules_check (authz).
// NIENTE rls (non nel verified_set di firebase-py).
function collectFloorFindings(dir) {
  const out = [];
  const gwt = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let gwtJson = null; try { gwtJson = JSON.parse(gwt.stdout); } catch { /* */ }
  if (Array.isArray(gwtJson)) out.push(...norm('gitleaks', gwtJson, 'working-tree'));

  const gh = nodeRun(RUN_GITLEAKS, [dir, 'history'], dir);
  let ghJson = null; try { ghJson = JSON.parse(gh.stdout); } catch { /* */ }
  if (Array.isArray(ghJson)) out.push(...norm('gitleaks', ghJson, 'history'));

  // dead-code Python: vulture via run_deadcode --tool=vulture
  const dc = nodeRun(RUN_DEADCODE, [dir, '--tool=vulture'], dir);
  let dcJson = null; try { dcJson = JSON.parse(dc.stdout); } catch { /* */ }
  if (dcJson) out.push(...norm('vulture', dcJson, 'working-tree'));

  // authz Firestore: l'oracolo cammina `dir` per firestore.rules ed emette
  // { findings:[...] } (category 'authz'). Scope STATICO 'working-tree'.
  const fr = nodeRun(FIRESTORE_RULES_CHECK, [dir], dir);
  let frJson = null; try { frJson = JSON.parse(fr.stdout); } catch { /* */ }
  if (frJson && Array.isArray(frJson.findings)) out.push(...norm('firestore-rules', frJson, 'working-tree'));

  return out;
}

// Seleziona, dai finding raccolti, il rappresentante atteso di ciascun seed del
// floor (FB-S1/FB-S4/FB-S3). Selettore data-driven sull'ancora del registry.
function pickSeed(findings, kind) {
  if (kind === 'FB-S1') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'working-tree'
      && /(^|\/)serviceAccount\.json$/.test(posix(f.location.file)));
  }
  if (kind === 'FB-S4') {
    // dead-code Python (vulture): simbolo _unused_helper in app/dead.py
    return findings.find((f) => f.category === 'dead-code'
      && (f.location.symbol === '_unused_helper')
      && /(^|\/)app\/dead\.py$/.test(posix(f.location.file)));
  }
  if (kind === 'FB-S3') {
    return findings.find((f) => f.category === 'authz'
      && (f.source_oracle.rule_id === 'FIRESTORE001_PUBLIC_ALLOW')
      && (f.location.symbol === '/databases/{database}/documents/public_notes/{noteId}')
      && /(^|\/)firestore\.rules$/.test(posix(f.location.file)));
  }
  return undefined;
}

// Riesegue vulture sulla copia e ritorna true se `symbol` in `relFile` e' ANCORA
// segnalato (per l'assert di azzeramento simbolo, indipendente dal loop).
// null se non eseguibile/JSON invalido.
function vultureStillFlags(dir, relFile, symbol) {
  const dc = nodeRun(RUN_DEADCODE, [dir, '--tool=vulture'], dir);
  let json = null; try { json = JSON.parse(dc.stdout); } catch { return null; }
  if (!json || !Array.isArray(json.issues)) return null;
  return json.issues.some((i) => i.name === symbol && baseName(i.file) === baseName(relFile));
}

// Riesegue gitleaks working-tree sulla copia e ritorna il numero di secret nel
// working tree (0 = pulito). null se non eseguibile/JSON invalido.
function gitleaksWtCount(dir) {
  const g = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let json = null; try { json = JSON.parse(g.stdout); } catch { return null; }
  return Array.isArray(json) ? json.length : null;
}

// Riesegue firestore_rules_check sulla copia e ritorna il numero di finding
// (0 = regola pulita/owner-scoped). null se non eseguibile/JSON invalido.
function firestoreFindingsCount(dir) {
  const r = nodeRun(FIRESTORE_RULES_CHECK, [dir], dir);
  let json = null; try { json = JSON.parse(r.stdout); } catch { return null; }
  if (!json || !Array.isArray(json.findings)) return null;
  return json.findings.length;
}

console.log('============================================================');
console.log(' GATE VERIFY (eco-F1) — verify-fix LOOP su firebase-py (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : FB-S1/FB-S4/FB-S3 -> verified (secret, dead-code, authz)');
console.log('   authz   : firestore_rules_check STATICO ri-eseguito pulito (L-COL-006, no runtime)');
console.log('   dead-code: vulture Python (non knip); NIENTE RLS / NIENTE history-secret');
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
  console.log('   Esegui il provisioning del pack firebase-py, poi ri-lancia il gate.');
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
assert('copia ISOLATA della fixture creata (eval/.tmp-verify-fb-py, .git incluso)',
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
let s4Symbol = '_unused_helper';
let s4RelFile = 'app/dead.py';

if (dir) {
  // (4) Branch di lavoro autonomo sul .git INTERNO della copia (come run_loop).
  createWorkBranch(dir, 'trueline/remediate/verify-fix-fb-py');

  // (5) raccogli i finding del floor dalla copia.
  const findings = collectFloorFindings(dir);
  console.log('');
  console.log(`  raccolti ${findings.length} finding dal floor (gitleaks WT+history, vulture, firestore_rules_check)`);

  // (6) pickSeed per le ancore del registry.
  const seeds = {
    'FB-S1': pickSeed(findings, 'FB-S1'),
    'FB-S4': pickSeed(findings, 'FB-S4'),
    'FB-S3': pickSeed(findings, 'FB-S3'),
  };
  for (const [id, f] of Object.entries(seeds)) {
    assert(`finding ${id} raccolto dagli oracoli del floor`, Boolean(f),
      f ? `cat=${f.category} rule=${f.source_oracle.rule_id} file=${posix(f.location.file)} sym=${f.location.symbol || '-'}` : 'ASSENTE');
  }
  if (seeds['FB-S4']) { s4Symbol = seeds['FB-S4'].location.symbol; s4RelFile = seeds['FB-S4'].location.file; }

  // (7) esegui il loop per OGNI seed col fix-provider deterministico (eval-mode).
  const provider = deterministicFixProvider();
  const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
  console.log('');
  console.log('  esecuzione del verify-fix loop per ciascun seed del floor (eval-mode):');
  for (const id of ['FB-S1', 'FB-S4', 'FB-S3']) {
    const f = seeds[id];
    if (!f) { results[id] = { fix_state: 'MISSING' }; continue; }
    const res = runFindingLoop(f, { dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    results[id] = res;
    console.log(`    ${id}: fix_state=${res.fix_state} — ${String(res.reason || '').slice(0, 120)}`);
  }

  // (8) ASSERZIONI di stato-fix (FATTI dell'oracolo rieseguito dal loop).
  console.log('');
  console.log('  Stati-fix (promozione = FATTO dell oracolo, L-COL-002):');
  assert('FB-S1 -> verified (gitleaks working-tree PULITO su serviceAccount.json)',
    results['FB-S1'] && results['FB-S1'].fix_state === 'verified',
    `fix_state=${results['FB-S1'] && results['FB-S1'].fix_state}`);
  assert('FB-S4 -> verified (vulture non segnala piu il simbolo _unused_helper)',
    results['FB-S4'] && results['FB-S4'].fix_state === 'verified',
    `fix_state=${results['FB-S4'] && results['FB-S4'].fix_state}`);
  assert('FB-S3 -> verified (firestore_rules_check ri-eseguito 0 finding: if true -> owner-scoped)',
    results['FB-S3'] && results['FB-S3'].fix_state === 'verified',
    `fix_state=${results['FB-S3'] && results['FB-S3'].fix_state}`);

  // (9) VERIFICA INDIPENDENTE: re-run degli oracoli sulla copia post-loop.
  console.log('');
  console.log('  Re-run INDIPENDENTE degli oracoli sulla copia post-fix:');
  // gitleaks WT pulito (il secret FB-S1 e' neutralizzato).
  const wtCount = gitleaksWtCount(dir);
  assert('gitleaks (ri-girato) working-tree PULITO (0 secret) dopo il fix FB-S1',
    wtCount === 0,
    wtCount === null ? 'gitleaks non rieseguibile' : `secret-WT=${wtCount}`);
  // vulture non flagga piu' _unused_helper.
  const stillFlags = vultureStillFlags(dir, s4RelFile, s4Symbol);
  assert(`vulture (ri-girato) NON segnala piu il simbolo ${s4Symbol}`,
    stillFlags === false,
    stillFlags === null ? 'vulture non rieseguibile' : (stillFlags ? 'ANCORA segnalato (fix non efficace!)' : 'azzerato'));
  // firestore_rules_check pulito (0 finding).
  const frCount = firestoreFindingsCount(dir);
  assert('firestore_rules_check (ri-girato) 0 finding (regola non piu pubblica)',
    frCount === 0,
    frCount === null ? 'oracolo non rieseguibile' : `findings=${frCount}`);

  // (9b) CONTRASTI testuali (FATTI sul file, in aggiunta al verdetto dell'oracolo).
  // dead-code: used_helper resta definito (il fix non ha rotto il modulo); _unused_helper rimosso.
  const deadAfter = readSafe(join(dir, 'app', 'dead.py'));
  assert('contrasto: used_helper resta definito in app/dead.py dopo la rimozione del dead-code',
    /def\s+used_helper\s*\(/.test(deadAfter),
    /def\s+used_helper\s*\(/.test(deadAfter) ? 'presente' : 'RIMOSSA (fix ha rotto il modulo!)');
  assert(`contrasto: ${s4Symbol} rimosso da app/dead.py`,
    !new RegExp(`def\\s+${s4Symbol}\\s*\\(`).test(deadAfter),
    new RegExp(`def\\s+${s4Symbol}\\s*\\(`).test(deadAfter) ? 'ANCORA presente' : 'rimosso');
  // secret: il PEM private_key e' neutralizzato in serviceAccount.json.
  const saAfter = readSafe(join(dir, 'serviceAccount.json'));
  assert('secret FB-S1: il PEM private_key sparisce da serviceAccount.json (placeholder)',
    !/BEGIN PRIVATE KEY/.test(saAfter),
    /BEGIN PRIVATE KEY/.test(saAfter) ? 'PEM ANCORA presente (fix non applicata!)' : 'neutralizzato');
  // authz: nessuna riga di CODICE concede piu' `if true`. Si ispeziona la sola
  // porzione di codice (scartando backtick e commenti `//`): la doc-comment in cima
  // al file CITA legittimamente la forma vulnerabile fra backtick, e non va contata
  // (il giudice autorevole resta firestore_rules_check, gia' a 0 finding sopra).
  const rulesAfter = readSafe(join(dir, 'firestore.rules'));
  const rulesCodeOnly = rulesAfter.split('\n')
    .map((l) => l.replace(/`[^`]*`/g, '').replace(/\/\/.*$/, '')).join('\n');
  const codeStillPublic = /allow\s+[\w,\s]+:\s*if\s+\(?\s*true\s*\)?\s*;/.test(rulesCodeOnly);
  assert('authz FB-S3: nessuna riga di codice concede piu allow ...: if true (owner-scoped)',
    !codeStillPublic && /FIX:FB-S3/.test(rulesAfter),
    codeStillPublic ? 'allow if true ANCORA in codice' : (/FIX:FB-S3/.test(rulesAfter) ? 'owner-scoped (FIX:FB-S3)' : 'marker FIX:FB-S3 assente'));

  // (9c) GUARD: la suite pytest di caratterizzazione resta VERDE post-fix.
  console.log('');
  console.log('  GUARD — pytest di caratterizzazione VERDE post-fix (la fix non rompe il contratto):');
  const pytest = spawnSync('python', ['-m', 'pytest', '-q'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const pyOut = `${pytest.stdout || ''}${pytest.stderr || ''}`;
  assert('python -m pytest sulla COPIA post-fix esce 0 (caratterizzazione verde)',
    pytest.status === 0,
    pytest.error ? `python non eseguibile: ${pytest.error.message}` : `exit=${pytest.status} — ${pyOut.trim().split('\n').slice(-1)[0] || '(no output)'}`);
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
console.log(`=== GATE VERIFY (eco-F1) firebase-py RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
