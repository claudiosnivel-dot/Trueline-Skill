#!/usr/bin/env node
// verify_fix_check.mjs — GATE di VERIFY (eco-F3): il verify-fix LOOP promuove a
// `verified` le 3 categorie del verified_set (secret, dead-code, authz) sulla
// fixture hasura-jsts (Hasura metadata YAML + serviceAccount). MIRROR strutturale
// di eval/ecosystems/firebase-jsts/verify_fix_check.mjs, con il ramo authz
// dichiarativa Hasura (HS-S3) al posto di Firestore (FB-S3). Scritto TEST-FIRST.
//
// BLOCCO ENGINE (eco-F3): questo gate richiede che normalize.mjs abbia un ramo
// per 'hasura-metadata' (normalizeHasuraMetadata) e che loop.mjs/fix_provider.mjs
// abbiano i dispatch corrispondenti. Questi rami ADDITIVI sono parte del piano
// eco-F3 ENGINE (plan §ENGINE, BIT-invarianza) e DEVONO essere aggiunti prima di
// eseguire questo gate in modalita' completa. Il gate emette exit 2 (skip onesto)
// se l'inner-repo della fixture manca (provisioning dell'ORCHESTRATORE, L-COL-024).
//
// Il "verde" e' un FATTO degli ORACOLI riesiguiti dal loop (gitleaks/knip/
// hasura_metadata_check), MAI una frase dell'LLM (L-COL-002). Su una COPIA
// ISOLATA della fixture (MAI l'originale: eval/.tmp-verify-hs/<id>, .git incluso)
// il gate, in 10 stadi:
//   1) SNAPSHOT d'integrita' (sola lettura) — repo ESTERNO + fixture INTERNA;
//   2) PRECONDIZIONE: se reference-app/.git manca -> banner + exit 2;
//   3) COPIA ISOLATA della fixture (eval/.tmp-verify-hs/<pid>-<n>, .git incluso);
//   4) createWorkBranch sul .git INTERNO della copia (come run_loop);
//   5) collectFloorFindings: gitleaks WT+history (secret), knip (dead-code),
//      hasura_metadata_check -> normalize('hasura-metadata',...,'working-tree')
//      (authz Hasura);
//   6) pickSeed per le ancore del registry (HS-S1/HS-S4/HS-S3);
//   7) runFindingLoop col fix-provider deterministico (eval-mode, L-COL-021)
//      per OGNI seed;
//   8) ASSERISCE gli stati-fix attesi (FATTI dell'oracolo):
//        HS-S1 (secret serviceAccount.json, working-tree) -> verified
//        HS-S4 (dead-code unusedHelper, knip)             -> verified
//        HS-S3 (authz hasura metadata filter:{})          -> verified
//   9) RE-RUN INDIPENDENTE: gitleaks WT 0 secret, knip no unusedHelper,
//      hasura_metadata_check 0 finding; + GUARD node:test VERDE post-fix;
//  10) IGIENE: temp pulito, fixture ORIGINALE bit-identica, HEAD esterno invariato.
//
// SCOPING ONESTO authz (L-COL-006): authz-verified = hasura_metadata_check
// STATICO ri-eseguito pulito (la permission anonima rimossa o filter owner-scoped)
// — NON invarianza runtime (il Hasura engine non e' disponibile in questo sandbox).
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
// eval/ecosystems/hasura-jsts -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RUN_DEADCODE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_deadcode.mjs');
// authz Hasura (eco-F3): oracolo statico della metadata YAML Hasura.
const HASURA_METADATA_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'hasura_metadata_check.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify-hs');

// runOpts deterministici: IDENTICI a quelli che il loop usa in rerunOracleFor.
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

// Crea una COPIA ISOLATA della fixture (eval/.tmp-verify-hs/<id>, .git incluso).
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_VERIFY_ROOT, `verify-fix-hs-pid${process.pid}-${__c}`);
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
// gitleaks WT+history (secret), knip (dead-code), hasura_metadata_check (authz).
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

  // authz Hasura (eco-F3): l'oracolo cammina `metadata/` e `.` per file YAML ed
  // emette { oracle:'hasura-metadata', findings:[...] } (category 'authz').
  // normalize('hasura-metadata', ...) richiede il ramo ENGINE additivo in
  // normalize.mjs (eco-F3 ENGINE): se assente, norm ritorna [] (gate onesto).
  const metadataDir = join(dir, 'metadata');
  const hmArgs = existsSync(metadataDir) ? [metadataDir, dir] : [dir];
  const hm = nodeRun(HASURA_METADATA_CHECK, hmArgs, dir);
  let hmJson = null; try { hmJson = JSON.parse(hm.stdout); } catch { /* */ }
  if (hmJson && Array.isArray(hmJson.findings)) {
    out.push(...norm('hasura-metadata', hmJson, 'working-tree'));
  }

  return out;
}

// Seleziona, dai finding raccolti, il rappresentante atteso di ciascun seed del
// floor (HS-S1/HS-S4/HS-S3). Selettore data-driven sull'ancora del registry.
function pickSeed(findings, kind) {
  if (kind === 'HS-S1') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'working-tree'
      && /(^|\/)serviceAccount\.json$/.test(posix(f.location.file)));
  }
  if (kind === 'HS-S4') {
    return findings.find((f) => f.category === 'dead-code'
      && (f.location.symbol === 'unusedHelper')
      && /(^|\/)src\/dead\.ts$/.test(posix(f.location.file)));
  }
  if (kind === 'HS-S3') {
    // match_path='posts.select.anonymous' -> location.symbol (post-normalize)
    return findings.find((f) => f.category === 'authz'
      && (f.source_oracle.rule_id === 'HASURA001_PUBLIC_PERMISSION')
      && (f.location.symbol === 'posts.select.anonymous')
      && /(^|\/)metadata\/tables\.yaml$/.test(posix(f.location.file)));
  }
  return undefined;
}

// Riesegue knip sulla copia e ritorna true se `symbol` e' ANCORA segnalato.
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

// Riesegue gitleaks working-tree sulla copia e ritorna il numero di secret.
function gitleaksWtCount(dir) {
  const g = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let json = null; try { json = JSON.parse(g.stdout); } catch { return null; }
  return Array.isArray(json) ? json.length : null;
}

// Riesegue hasura_metadata_check sulla copia e ritorna il numero di finding.
function hasuraFindingsCount(dir) {
  const metadataDir = join(dir, 'metadata');
  const hmArgs = existsSync(metadataDir) ? [metadataDir, dir] : [dir];
  const r = nodeRun(HASURA_METADATA_CHECK, hmArgs, dir);
  let json = null; try { json = JSON.parse(r.stdout); } catch { return null; }
  if (!json || !Array.isArray(json.findings)) return null;
  return json.findings.length;
}

console.log('============================================================');
console.log(' GATE VERIFY (eco-F3) — verify-fix LOOP su hasura-jsts (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : HS-S1/HS-S4/HS-S3 -> verified (secret, dead-code, authz)');
console.log('   authz   : hasura_metadata_check STATICO ri-eseguito pulito (L-COL-006, no runtime)');
console.log('   NOTE    : richiede ENGINE eco-F3 (normalize hasura-metadata + loop dispatch)');
console.log('============================================================');
console.log('');

// (2) PRECONDIZIONE — l'inner-repo della fixture e' provisioning dell'ORCHESTRATORE.
const FIXTURE_GIT = resolve(FIXTURE, '.git');
if (!existsSync(FIXTURE_GIT)) {
  console.log('------------------------------------------------------------');
  console.log(' SKIP (exit 2): inner-repo della fixture ASSENTE.');
  console.log(`   atteso: ${FIXTURE_GIT}`);
  console.log('   Il provisioning dell\'inner .git e\' dell\'ORCHESTRATORE (L-COL-024).');
  console.log('   Esegui il provisioning del pack hasura-jsts, poi ri-lancia il gate.');
  console.log('------------------------------------------------------------');
  process.exit(2);
}

// (1) SNAPSHOT d'integrita' (sola lettura).
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
assert('copia ISOLATA della fixture creata (eval/.tmp-verify-hs, .git incluso)',
  Boolean(dir) && existsSync(dir), dir || 'assente');

if (dir) {
  const top = gitRead(dir, ['rev-parse', '--show-toplevel']).stdout;
  const isIsolated = posix(resolve(top || dir)).toLowerCase() !== posix(resolve(ROOT)).toLowerCase()
    && posix(resolve(top || dir)).toLowerCase() !== posix(resolve(FIXTURE)).toLowerCase();
  assert('la copia e ISOLATA (toplevel != repo esterno e != fixture originale)', isIsolated,
    `toplevel=${posix(top)}`);
}

let results = {};

if (dir) {
  // (4) Branch di lavoro autonomo sul .git INTERNO della copia.
  createWorkBranch(dir, 'trueline/remediate/verify-fix-hs');

  // (5) Raccogli i finding del floor dalla copia.
  const findings = collectFloorFindings(dir);
  console.log('');
  console.log(`  raccolti ${findings.length} finding dal floor (gitleaks WT+history, knip, hasura_metadata_check)`);

  // (6) pickSeed per le ancore del registry.
  const seeds = {
    'HS-S1': pickSeed(findings, 'HS-S1'),
    'HS-S4': pickSeed(findings, 'HS-S4'),
    'HS-S3': pickSeed(findings, 'HS-S3'),
  };
  for (const [id, f] of Object.entries(seeds)) {
    assert(`finding ${id} raccolto dagli oracoli del floor`, Boolean(f),
      f ? `cat=${f.category} rule=${f.source_oracle.rule_id} file=${posix(f.location.file)} sym=${f.location.symbol || '-'}` : 'ASSENTE');
  }

  // (7) Esegui il loop per OGNI seed col fix-provider deterministico (eval-mode).
  const provider = deterministicFixProvider();
  const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
  console.log('');
  console.log('  esecuzione del verify-fix loop per ciascun seed del floor (eval-mode):');
  for (const id of ['HS-S1', 'HS-S4', 'HS-S3']) {
    const f = seeds[id];
    if (!f) { results[id] = { fix_state: 'MISSING' }; continue; }
    const res = runFindingLoop(f, { dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    results[id] = res;
    console.log(`    ${id}: fix_state=${res.fix_state} — ${String(res.reason || '').slice(0, 120)}`);
  }

  // (8) ASSERZIONI di stato-fix (FATTI dell'oracolo riesiguito dal loop).
  console.log('');
  console.log('  Stati-fix (promozione = FATTO dell oracolo, L-COL-002):');
  assert('HS-S1 -> verified (gitleaks working-tree PULITO su serviceAccount.json)',
    results['HS-S1'] && results['HS-S1'].fix_state === 'verified',
    `fix_state=${results['HS-S1'] && results['HS-S1'].fix_state}`);
  assert('HS-S4 -> verified (knip non segnala piu il simbolo unusedHelper)',
    results['HS-S4'] && results['HS-S4'].fix_state === 'verified',
    `fix_state=${results['HS-S4'] && results['HS-S4'].fix_state}`);
  assert('HS-S3 -> verified (hasura_metadata_check ri-eseguito 0 finding: filter:{} -> owner-scoped)',
    results['HS-S3'] && results['HS-S3'].fix_state === 'verified',
    `fix_state=${results['HS-S3'] && results['HS-S3'].fix_state}`);

  // (9) VERIFICA INDIPENDENTE: re-run degli oracoli sulla copia post-loop.
  console.log('');
  console.log('  Re-run INDIPENDENTE degli oracoli sulla copia post-fix:');
  const wtCount = gitleaksWtCount(dir);
  assert('gitleaks (ri-girato) working-tree PULITO (0 secret) dopo il fix HS-S1',
    wtCount === 0,
    wtCount === null ? 'gitleaks non rieseguibile' : `secret-WT=${wtCount}`);
  const stillFlags = knipStillFlags(dir, 'unusedHelper');
  assert('knip (ri-girato) NON segnala piu il simbolo unusedHelper',
    stillFlags === false,
    stillFlags === null ? 'knip non rieseguibile' : (stillFlags ? 'ANCORA segnalato (fix non efficace!)' : 'azzerato'));
  const hmCount = hasuraFindingsCount(dir);
  assert('hasura_metadata_check (ri-girato) 0 finding (permission non piu pubblica)',
    hmCount === 0,
    hmCount === null ? 'oracolo non rieseguibile' : `findings=${hmCount}`);

  // (9b) CONTRASTI testuali.
  const deadAfter = readSafe(join(dir, 'src', 'dead.ts'));
  assert('contrasto: usedHelper resta definito in src/dead.ts dopo la rimozione del dead-code',
    /export\s+function\s+usedHelper\s*\(/.test(deadAfter),
    /export\s+function\s+usedHelper\s*\(/.test(deadAfter) ? 'presente' : 'RIMOSSA (fix ha rotto il modulo!)');
  assert('contrasto: unusedHelper rimosso da src/dead.ts',
    !/export\s+function\s+unusedHelper\s*\(/.test(deadAfter),
    /export\s+function\s+unusedHelper\s*\(/.test(deadAfter) ? 'ANCORA presente' : 'rimosso');
  const saAfter = readSafe(join(dir, 'serviceAccount.json'));
  assert('secret HS-S1: il PEM private_key sparisce da serviceAccount.json (placeholder)',
    !/BEGIN PRIVATE KEY/.test(saAfter),
    /BEGIN PRIVATE KEY/.test(saAfter) ? 'PEM ANCORA presente (fix non applicata!)' : 'neutralizzato');
  // authz: nessun filter: {} su ruolo anonimo nella metadata (contrasto testuale).
  const tablesAfter = readSafe(join(dir, 'metadata', 'tables.yaml'));
  const tablesLines = tablesAfter.split('\n');
  // Cerca pattern "role: anonymous" in prossimita' di "filter: {}" (heuristica
  // testuale, il giudice autorevole resta hasura_metadata_check gia a 0 finding).
  let anonWithEmptyFilter = false;
  for (let i = 0; i < tablesLines.length; i++) {
    if (/role:\s*anonymous/.test(tablesLines[i])) {
      // cerca filter: {} nelle prossime 5 righe
      for (let j = i + 1; j < Math.min(i + 6, tablesLines.length); j++) {
        if (/filter:\s*\{\}/.test(tablesLines[j])) {
          anonWithEmptyFilter = true;
          break;
        }
      }
    }
  }
  assert('authz HS-S3: nessun filter:{} in prossimita di role:anonymous nel metadata post-fix',
    !anonWithEmptyFilter && /FIX:HS-S3/.test(tablesAfter),
    anonWithEmptyFilter ? 'filter:{} ANCORA presente per anonymous' : (/FIX:HS-S3/.test(tablesAfter) ? 'owner-scoped (FIX:HS-S3)' : 'marker FIX:HS-S3 assente'));

  // (9c) GUARD: la suite node:test di caratterizzazione resta VERDE post-fix.
  console.log('');
  console.log('  GUARD — node:test di caratterizzazione VERDE post-fix:');
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
assert('fixture ORIGINALE bit-identica (status interno + HEAD interno INVARIATI vs snapshot)',
  innerStatusAfter === innerStatusBefore && innerHeadAfter === innerHeadBefore,
  innerStatusAfter === innerStatusBefore && innerHeadAfter === innerHeadBefore
    ? 'invariata' : `status="${innerStatusAfter}" (prima="${innerStatusBefore}") head=${innerHeadAfter.slice(0, 10)}`);
const outerHeadAfter = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
assert('HEAD del repo ESTERNO INVARIATO (0 contaminazione)', outerHeadAfter === outerHeadBefore,
  outerHeadAfter === outerHeadBefore ? `${outerHeadBefore.slice(0, 10)} (invariato)` : 'MUTATO (vietato!)');

// --- Esito ---------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE VERIFY (eco-F3) hasura-jsts RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
