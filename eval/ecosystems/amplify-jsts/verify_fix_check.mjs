#!/usr/bin/env node
// verify_fix_check.mjs — GATE di VERIFY (eco-F3): il verify-fix LOOP promuove a
// `verified` le 3 categorie del verified_set (secret, dead-code, authz) sulla
// fixture amplify-jsts (AWS Amplify Gen1 + AppSync SDL @auth). MIRROR strutturale
// di eval/ecosystems/appwrite-jsts/verify_fix_check.mjs, con il ramo authz
// dichiarativa AppSync (AM-S3). Scritto TEST-FIRST.
//
// Il "verde" è un FATTO degli ORACOLI rieseguiti dal loop (gitleaks/knip/
// appsync_auth_check), MAI una frase dell'LLM (L-COL-002). Su una COPIA
// ISOLATA della fixture (MAI l'originale: eval/.tmp-verify-am/<id>, .git incluso)
// il gate, in 10 stadi:
//   1) SNAPSHOT d'integrità (sola lettura) — repo ESTERNO + fixture INTERNA;
//   2) PRECONDIZIONE A: se oracle appsync_auth_check.mjs manca -> banner + exit 2
//      (il provisioning dell'oracle è dell'ENGINE integrator, L-COL-024);
//      PRECONDIZIONE B: se reference-app/.git manca -> banner + exit 2 (il
//      provisioning dell'inner-repo è dell'ORCHESTRATORE, L-COL-024);
//   3) COPIA ISOLATA della fixture (eval/.tmp-verify-am/<pid>-<n>, .git incluso);
//   4) createWorkBranch sul .git INTERNO della copia (come run_loop);
//   5) collectFloorFindings: gitleaks WT+history (secret), knip (dead-code),
//      appsync_auth_check -> normalize('appsync-auth',...,'working-tree')
//      (authz);
//   6) pickSeed per le ancore del registry (AM-S1/AM-S4/AM-S3);
//   7) runFindingLoop col fix-provider deterministico (eval-mode: gate umano
//      auto-approvato, solo-eval, L-COL-021) per OGNI seed;
//   8) ASSERISCE gli stati-fix attesi (FATTI dell'oracolo, non opinioni):
//        AM-S1 (secret serviceAccount.json, working-tree) -> verified (gitleaks WT pulito)
//        AM-S4 (dead-code unusedHelper, knip)             -> verified (knip non lo segnala più)
//        AM-S3 (authz schema.graphql allow:public)        -> verified (appsync_auth_check ri-eseguito 0 finding)
//   9) RE-RUN INDIPENDENTE degli oracoli sulla copia post-loop: gitleaks WT
//      pulito, knip non flagga unusedHelper, appsync_auth_check 0 finding;
//      + GUARD: la suite node:test di caratterizzazione resta VERDE post-fix;
//  10) IGIENE: temp pulito, fixture ORIGINALE bit-identica (status interno vuoto
//      + HEAD interno invariato) e HEAD del repo ESTERNO INVARIATO (0 contam).
//
// SCOPING ONESTO authz (L-COL-006): authz-verified = appsync_auth_check
// STATICO ri-eseguito pulito (lo schema.graphql non contiene più allow:public,
// passa a allow:owner) — NON invarianza d'isolamento a runtime (l'istanza
// AppSync non è disponibile nel sandbox). Analogo dichiarativo del transfer
// Firestore `if true`->owner-scoped, provato dall'oracolo statico.
//
// ⚠ GEN1 SOLTANTO: il floor SDL @auth copre Amplify Gen1; la sintassi Gen2
// (a.allow.publicApiKey() in TypeScript) resta detection-only.
//
// NIENTE RLS: amplify-jsts non ha RLS-al-DB; authz-surface = direttiva @auth SDL.
// Nessun DB-test runtime, nessuna migration-dir, nessun Docker.
// NIENTE secret-in-history: la fixture NON semina un AM-S5 history
// (il solo secret è AM-S1 working-tree) -> nessun esito mitigated-residual atteso.
//
// FALSIFICABILITÀ: neutralizzando il fix del secret, del dead-code o dell'authz
// (no-op) questo gate DEVE fallire sul rispettivo seed (gli oracoli continuano a
// segnalare). Il gate NON è un timbro sempre-verde.
//
// Gli oracoli gitleaks richiedono C:/Users/claud/go/bin sul PATH: lo arricchiamo
// per gli spawn. NON tocca MAI il git del repo ESTERNO se non in SOLA LETTURA. Le
// mutazioni git avvengono sul .git INTERNO della COPIA (isolato, L-COL-024).
//
// Node ESM, solo built-in + i moduli del loop (tutti dep-free). Esce 0 sse TUTTI
// i check passano; 1 altrimenti; 2 se l'oracle o l'inner-repo della fixture mancano
// (skip).

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
// eval/ecosystems/amplify-jsts -> root è 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RUN_DEADCODE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_deadcode.mjs');
// authz AppSync/Amplify Gen1 (eco-F3): oracolo statico delle direttive @auth SDL.
const APPSYNC_AUTH_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'appsync_auth_check.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify-am');

// runOpts deterministici: IDENTICI a quelli che il loop usa in rerunOracleFor
// (default di runFindingLoop) così i fingerprint che raccogliamo qui combaciano
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

// Crea una COPIA ISOLATA della fixture (eval/.tmp-verify-am/<id>, .git incluso).
// Mirror di copyPackFixture: id unico per-run (pid + counter). Cleanup never-throw.
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_VERIFY_ROOT, `verify-fix-am-pid${process.pid}-${__c}`);
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
// gitleaks WT+history (secret), knip (dead-code), appsync_auth_check (authz).
// NIENTE rls (non nel verified_set di amplify-jsts).
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

  // authz AppSync Gen1 (eco-F3): l'oracolo cammina `dir` per schema.graphql ed emette
  // { findings:[...] } (category 'authz'). Additivo: senza schema.graphql nessun
  // finding entra. Scope STATICO 'working-tree' (prova statica, non runtime).
  const ap = nodeRun(APPSYNC_AUTH_CHECK, [dir], dir);
  let apJson = null; try { apJson = JSON.parse(ap.stdout); } catch { /* */ }
  if (apJson && Array.isArray(apJson.findings)) out.push(...norm('appsync-auth', apJson, 'working-tree'));

  return out;
}

// Seleziona, dai finding raccolti, il rappresentante atteso di ciascun seed del
// floor (AM-S1/AM-S4/AM-S3). Selettore data-driven sull'ancora del registry.
function pickSeed(findings, kind) {
  if (kind === 'AM-S1') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'working-tree'
      && /(^|\/)serviceAccount\.json$/.test(posix(f.location.file)));
  }
  if (kind === 'AM-S4') {
    return findings.find((f) => f.category === 'dead-code'
      && (f.location.symbol === 'unusedHelper')
      && /(^|\/)src\/dead\.ts$/.test(posix(f.location.file)));
  }
  if (kind === 'AM-S3') {
    return findings.find((f) => f.category === 'authz'
      && (f.source_oracle.rule_id === 'APPSYNC001_PUBLIC_AUTH')
      && /(^|\/)schema\.graphql$/.test(posix(f.location.file)));
  }
  return undefined;
}

// Riesegue knip sulla copia e ritorna true se `symbol` è ANCORA segnalato (per
// l'assert di azzeramento simbolo, indipendente dal loop). null se non eseguibile.
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

// Riesegue gitleaks working-tree sulla copia e ritorna il numero di secret nel
// working tree (0 = pulito). null se non eseguibile/JSON invalido.
function gitleaksWtCount(dir) {
  const g = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let json = null; try { json = JSON.parse(g.stdout); } catch { return null; }
  return Array.isArray(json) ? json.length : null;
}

// Riesegue appsync_auth_check sulla copia e ritorna il numero di finding
// (0 = tutti i type @model hanno @auth owner-scoped). null se non eseguibile/JSON invalido.
function appsyncFindingsCount(dir) {
  const r = nodeRun(APPSYNC_AUTH_CHECK, [dir], dir);
  let json = null; try { json = JSON.parse(r.stdout); } catch { return null; }
  if (!json || !Array.isArray(json.findings)) return null;
  return json.findings.length;
}

console.log('============================================================');
console.log(' GATE VERIFY (eco-F3) — verify-fix LOOP su amplify-jsts (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : AM-S1/AM-S4/AM-S3 -> verified (secret, dead-code, authz)');
console.log('   authz   : appsync_auth_check STATICO ri-eseguito pulito (L-COL-006, no runtime)');
console.log('   NIENTE RLS / NIENTE history-secret: verified_set = [secret, dead-code, authz]');
console.log('   ⚠ GEN1 SOLTANTO: floor SDL @auth; Gen2 (TypeScript) -> detection-only');
console.log('============================================================');
console.log('');

// (2A) PRECONDIZIONE — l'oracle appsync_auth_check.mjs è provisioning dell'ENGINE
// integrator (L-COL-024). Se l'oracle manca, il gate NON può collezionare authz
// findings: skip onesto con exit 2 (NON un falso verde, NON un fallimento del codice).
if (!existsSync(APPSYNC_AUTH_CHECK)) {
  console.log('------------------------------------------------------------');
  console.log(' SKIP (exit 2): oracle appsync_auth_check.mjs NON ancora disponibile.');
  console.log(`   atteso: ${APPSYNC_AUTH_CHECK}`);
  console.log('   Il provisioning dell\'oracle è dell\'ENGINE integrator (L-COL-024).');
  console.log('   Esegui l\'integrazione engine eco-F3, poi ri-lancia il gate.');
  console.log('------------------------------------------------------------');
  process.exit(2);
}

// (2B) PRECONDIZIONE — l'inner-repo della fixture è provisioning dell'ORCHESTRATORE
// (L-COL-024). Se .git manca, il gate NON può isolare né branchare: skip onesto
// con exit 2 (NON un falso verde, NON un fallimento del codice del gate).
const FIXTURE_GIT = resolve(FIXTURE, '.git');
if (!existsSync(FIXTURE_GIT)) {
  console.log('------------------------------------------------------------');
  console.log(' SKIP (exit 2): inner-repo della fixture ASSENTE.');
  console.log(`   atteso: ${FIXTURE_GIT}`);
  console.log('   Il provisioning dell\'inner .git è dell\'ORCHESTRATORE (L-COL-024).');
  console.log('   Esegui il provisioning del pack amplify-jsts, poi ri-lancia il gate.');
  console.log('------------------------------------------------------------');
  process.exit(2);
}

// (1) SNAPSHOT d'integrità (sola lettura) — repo ESTERNO + fixture INTERNA.
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
assert('copia ISOLATA della fixture creata (eval/.tmp-verify-am, .git incluso)',
  Boolean(dir) && existsSync(dir), dir || 'assente');

// ISOLAMENTO: la copia NON deve risolvere al repo esterno né alla fixture orig.
if (dir) {
  const top = gitRead(dir, ['rev-parse', '--show-toplevel']).stdout;
  const isIsolated = posix(resolve(top || dir)).toLowerCase() !== posix(resolve(ROOT)).toLowerCase()
    && posix(resolve(top || dir)).toLowerCase() !== posix(resolve(FIXTURE)).toLowerCase();
  assert('la copia è ISOLATA (toplevel != repo esterno e != fixture originale)', isIsolated,
    `toplevel=${posix(top)}`);
}

let results = {};

if (dir) {
  // (4) Branch di lavoro autonomo sul .git INTERNO della copia (come run_loop).
  createWorkBranch(dir, 'trueline/remediate/verify-fix-am');

  // (5) raccogli i finding del floor dalla copia.
  const findings = collectFloorFindings(dir);
  console.log('');
  console.log(`  raccolti ${findings.length} finding dal floor (gitleaks WT+history, knip, appsync_auth_check)`);

  // (6) pickSeed per le ancore del registry.
  const seeds = {
    'AM-S1': pickSeed(findings, 'AM-S1'),
    'AM-S4': pickSeed(findings, 'AM-S4'),
    'AM-S3': pickSeed(findings, 'AM-S3'),
  };
  for (const [id, f] of Object.entries(seeds)) {
    assert(`finding ${id} raccolto dagli oracoli del floor`, Boolean(f),
      f ? `cat=${f.category} rule=${f.source_oracle.rule_id} file=${posix(f.location.file)} sym=${f.location.symbol || '-'}` : 'ASSENTE');
  }

  // (7) esegui il loop per OGNI seed col fix-provider deterministico (eval-mode).
  const provider = deterministicFixProvider();
  const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
  console.log('');
  console.log('  esecuzione del verify-fix loop per ciascun seed del floor (eval-mode):');
  for (const id of ['AM-S1', 'AM-S4', 'AM-S3']) {
    const f = seeds[id];
    if (!f) { results[id] = { fix_state: 'MISSING' }; continue; }
    const res = runFindingLoop(f, { dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    results[id] = res;
    console.log(`    ${id}: fix_state=${res.fix_state} — ${String(res.reason || '').slice(0, 120)}`);
  }

  // (8) ASSERZIONI di stato-fix (FATTI dell'oracolo rieseguito dal loop).
  console.log('');
  console.log('  Stati-fix (promozione = FATTO dell\'oracolo, L-COL-002):');
  assert('AM-S1 -> verified (gitleaks working-tree PULITO su serviceAccount.json)',
    results['AM-S1'] && results['AM-S1'].fix_state === 'verified',
    `fix_state=${results['AM-S1'] && results['AM-S1'].fix_state}`);
  assert('AM-S4 -> verified (knip non segnala più il simbolo unusedHelper)',
    results['AM-S4'] && results['AM-S4'].fix_state === 'verified',
    `fix_state=${results['AM-S4'] && results['AM-S4'].fix_state}`);
  assert('AM-S3 -> verified (appsync_auth_check ri-eseguito 0 finding: allow:public -> allow:owner)',
    results['AM-S3'] && results['AM-S3'].fix_state === 'verified',
    `fix_state=${results['AM-S3'] && results['AM-S3'].fix_state}`);

  // (9) VERIFICA INDIPENDENTE: re-run degli oracoli sulla copia post-loop.
  console.log('');
  console.log('  Re-run INDIPENDENTE degli oracoli sulla copia post-fix:');
  // gitleaks WT pulito (il secret AM-S1 è neutralizzato).
  const wtCount = gitleaksWtCount(dir);
  assert('gitleaks (ri-girato) working-tree PULITO (0 secret) dopo il fix AM-S1',
    wtCount === 0,
    wtCount === null ? 'gitleaks non rieseguibile' : `secret-WT=${wtCount}`);
  // knip non flagga più unusedHelper.
  const stillFlags = knipStillFlags(dir, 'unusedHelper');
  assert('knip (ri-girato) NON segnala più il simbolo unusedHelper',
    stillFlags === false,
    stillFlags === null ? 'knip non rieseguibile' : (stillFlags ? 'ANCORA segnalato (fix non efficace!)' : 'azzerato'));
  // appsync_auth_check pulito (0 finding).
  const apCount = appsyncFindingsCount(dir);
  assert('appsync_auth_check (ri-girato) 0 finding (nessun allow:public rimasto nello schema)',
    apCount === 0,
    apCount === null ? 'oracolo non rieseguibile' : `findings=${apCount}`);

  // (9b) CONTRASTI testuali (FATTI sul file, in aggiunta al verdetto dell'oracolo).
  // dead-code: usedHelper resta definito (il fix non ha rotto il modulo); unusedHelper rimosso.
  const deadAfter = readSafe(join(dir, 'src', 'dead.ts'));
  assert('contrasto: usedHelper resta definito in src/dead.ts dopo la rimozione del dead-code',
    /export\s+function\s+usedHelper\s*\(/.test(deadAfter),
    /export\s+function\s+usedHelper\s*\(/.test(deadAfter) ? 'presente' : 'RIMOSSA (fix ha rotto il modulo!)');
  assert('contrasto: unusedHelper rimosso da src/dead.ts',
    !/export\s+function\s+unusedHelper\s*\(/.test(deadAfter),
    /export\s+function\s+unusedHelper\s*\(/.test(deadAfter) ? 'ANCORA presente' : 'rimosso');
  // secret: il PEM private_key è neutralizzato in serviceAccount.json.
  const saAfter = readSafe(join(dir, 'serviceAccount.json'));
  assert('secret AM-S1: il PEM private_key sparisce da serviceAccount.json (placeholder)',
    !/BEGIN PRIVATE KEY/.test(saAfter),
    /BEGIN PRIVATE KEY/.test(saAfter) ? 'PEM ANCORA presente (fix non applicata!)' : 'neutralizzato');
  // authz: nessun allow:public nello schema.graphql post-fix.
  const schemaAfter = readSafe(join(dir, 'schema.graphql'));
  const schemaCodeOnly = schemaAfter.split('\n')
    .map((l) => l.replace(/#.*$/, '')).join('\n');
  const codeStillPublic = /allow\s*:\s*public\b/.test(schemaCodeOnly);
  assert('authz AM-S3: nessun allow:public rimasto in schema.graphql (owner-scoped)',
    !codeStillPublic && /FIX:AM-S3/.test(schemaAfter),
    codeStillPublic ? 'allow:public ANCORA presente' : (/FIX:AM-S3/.test(schemaAfter) ? 'owner-scoped (FIX:AM-S3)' : 'marker FIX:AM-S3 assente'));

  // (9c) GUARD: la suite node:test di caratterizzazione resta VERDE post-fix.
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
console.log(`=== GATE VERIFY (eco-F3) amplify-jsts RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
