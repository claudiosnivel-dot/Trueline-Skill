#!/usr/bin/env node
// verify_fix_check.mjs — GATE di VERIFY (eco-F5b): il verify-fix LOOP promuove a
// `verified` le categorie del verified_set sulla fixture flutter-dart
// (Flutter/Dart + Supabase, authz-surface = route-authz via semgrep Dart
// sperimentale, NIENTE RLS-al-DB). Clone adattato di
// eval/ecosystems/firebase-jsts/verify_fix_check.mjs — secret (FD-S1) e
// dead-code (FD-S4). Scritto TEST-FIRST.
//
// Il "verde" e' un FATTO degli ORACOLI riesiguiti dal loop (gitleaks, dart
// analyze), MAI una frase dell'LLM (L-COL-002). Su una COPIA ISOLATA della
// fixture (eval/.tmp-verify-dart/<pid>-<n>, .git incluso) il gate, in 10 stadi:
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
//   8d) DEAD-CODE FD-S4 — dart analyze (SEED:FLUTTERDART-DC):
//      + PRE-FIX: dart analyze rileva UNUSED_ELEMENT per _unusedHelper in dead.dart;
//      + FIX diretto: rimuove _unusedHelper da lib/dead.dart;
//      + POST-FIX: dart analyze NON segnala piu' _unusedHelper (0 UNUSED_ELEMENT su dead.dart);
//      + CONTRASTO testuale: usedHelper ancora presente in dead.dart;
//   9) IGIENE: temp pulito, fixture ORIGINALE bit-identica (status interno +
//      HEAD interno INVARIATI vs snapshot) e HEAD del repo ESTERNO INVARIATO.
//
// NIENTE authz (semgrep Dart sperimentale): non e' nel verified_set di flutter-dart.
// NIENTE secret-in-history: la fixture NON semina un FD-S6 history -> nessun
//   esito mitigated-residual atteso.
// NIENTE node:test GUARD: flutter-dart e' un progetto Dart puro; la suite di
//   caratterizzazione usa `dart test` (characterization_test.dart), non node:test.
//   Il gate non esegue dart test (scope fuori dal verified_set): omesso onestamente
//   (L-COL-006). Gli oracoli gitleaks e dart analyze sono la rete.
//
// FALSIFICABILITA': neutralizzando il fix del secret (no-op) questo gate DEVE
// fallire su FD-S1 (gitleaks continua a segnalare lib/config.dart). Neutralizzando
// il fix dead-code (no-op) questo gate DEVE fallire su FD-S4 (dart analyze
// continua a segnalare _unusedHelper). Il gate NON e' un timbro sempre-verde.
//
// Gli oracoli gitleaks richiedono C:/Users/claud/go/bin sul PATH: lo arricchiamo
// per gli spawn. dart analyze usa il PATH di sistema (dart nel PATH di Windows).
// NON tocca MAI il git del repo ESTERNO se non in SOLA LETTURA. Le
// mutazioni git avvengono sul .git INTERNO della COPIA (isolato, L-COL-024).
//
// Node ESM, solo built-in + i moduli del loop (tutti dep-free). Esce 0 sse TUTTI
// i check passano; 1 altrimenti; 2 se l'inner-repo della fixture manca (skip).

import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync, readdirSync,
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

// Esegue `dart analyze --format=machine lib/dead.dart` sulla copia (cwd=dir).
// Ritorna { stdout, stderr, status, error }. L'output machine-readable e' su stdout.
// Exit 0 = nessun problema; exit 2 = warning; exit 3 = hint. NON e' un errore.
function dartAnalyze(dir) {
  const res = spawnSync('dart', ['analyze', '--format=machine', 'lib/dead.dart'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

// Controlla se dart analyze ha segnalato UNUSED_ELEMENT per `symbol` nello stdout
// del format=machine. Formato riga: severity|type|UNUSED_ELEMENT|file|...|message
// dove message contiene "'<symbol>' isn't referenced".
function dartFlagsUnused(output, symbol) {
  const lines = output.split(/\r?\n/);
  return lines.some((line) => {
    const parts = line.split('|');
    if (parts.length < 4) return false;
    const code = parts[2];
    const msg = parts[parts.length - 1];
    return code === 'UNUSED_ELEMENT'
      && (msg.includes(`'${symbol}'`) || msg.includes(`"${symbol}"`));
  });
}

// Applica il fix FD-S4: rimuove la riga/linee della definizione di `symbol`
// (funzione privata top-level) da `relFile` nella copia `dir`.
// Pattern: `String _unusedHelper() => 'dead'; // SEED:FLUTTERDART-DC`
// La regex cattura l'intera riga (anche con commento in coda) terminata da \n.
function fixDartDeadcode(dir, relFile, symbol) {
  const p = resolve(dir, relFile);
  if (!existsSync(p)) return { ok: false, detail: `file assente: ${relFile}` };
  const before = readFileSync(p, 'utf8');
  // Rimuove la riga della definizione della funzione morta: qualsiasi tipo di
  // ritorno Dart, seguito dal nome del simbolo, la firma e il corpo (=>...).
  // Il commento SEED: in coda e' opzionale. Cattura fino a \n incluso.
  const re = new RegExp(
    '^[^\n]*\\b' + symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\([^)]*\\)[^\n]*\\n?',
    'm',
  );
  const after = before.replace(re, '');
  if (after === before) {
    return { ok: false, detail: `${symbol}: pattern non trovato in ${relFile} (fix non applicabile)` };
  }
  writeFileSync(p, after, 'utf8');
  return { ok: true, detail: `${symbol} rimosso da ${relFile}` };
}

console.log('============================================================');
console.log(' GATE VERIFY (eco-F5b) — verify-fix LOOP su flutter-dart (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : FD-S1 -> verified (secret lib/config.dart, gitleaks WT pulito)');
console.log('             FD-S4 -> verified (dead-code _unusedHelper lib/dead.dart, dart analyze)');
console.log('   verified_set = [secret, dead-code] (authz detection-only)');
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

  // (8d) DEAD-CODE FD-S4 — dart analyze (SEED:FLUTTERDART-DC, eco-F5b).
  // Sequenza: PRE-FIX (detection) -> FIX diretto -> POST-FIX (zero UNUSED_ELEMENT) +
  // contrasto testuale. Non usa il loop/normalize: dart non e' ancora nel dispatcher
  // engine (BIT-invariante). L'oracolo dart analyze e' il FATTO: NON un parere LLM.
  console.log('');
  console.log('  DEAD-CODE FD-S4 — dart analyze (SEED:FLUTTERDART-DC, eco-F5b):');

  const FD_S4_SYMBOL = '_unusedHelper';
  const FD_S4_FILE = 'lib/dead.dart';

  // PRE-FIX: dart analyze deve rilevare UNUSED_ELEMENT per _unusedHelper.
  const daPreFix = dartAnalyze(dir);
  const fdS4Detected = !daPreFix.error && dartFlagsUnused(daPreFix.stdout, FD_S4_SYMBOL);
  assert(
    `FD-S4 PRE-FIX: dart analyze rileva UNUSED_ELEMENT per ${FD_S4_SYMBOL} in ${FD_S4_FILE}`,
    fdS4Detected,
    fdS4Detected
      ? `UNUSED_ELEMENT rilevato (dart analyze exit=${daPreFix.status})`
      : daPreFix.error
        ? `dart analyze non avviato: ${daPreFix.error.message}`
        : `UNUSED_ELEMENT NON trovato (stdout=${daPreFix.stdout.trim().slice(0, 120)})`,
  );

  // FIX diretto: rimuove _unusedHelper da lib/dead.dart (BIT-invariante engine).
  const fixResult = fixDartDeadcode(dir, FD_S4_FILE, FD_S4_SYMBOL);
  assert(
    `FD-S4 FIX: ${FD_S4_SYMBOL} rimosso da ${FD_S4_FILE}`,
    fixResult.ok,
    fixResult.detail,
  );

  // POST-FIX: dart analyze NON deve piu' segnalare _unusedHelper (0 UNUSED_ELEMENT).
  const daPostFix = dartAnalyze(dir);
  const fdS4Gone = !daPostFix.error && !dartFlagsUnused(daPostFix.stdout, FD_S4_SYMBOL);
  assert(
    `FD-S4 POST-FIX: dart analyze NON segnala piu' ${FD_S4_SYMBOL} (UNUSED_ELEMENT azzerato)`,
    fdS4Gone,
    fdS4Gone
      ? `UNUSED_ELEMENT rimosso (dart analyze exit=${daPostFix.status})`
      : daPostFix.error
        ? `dart analyze non avviato: ${daPostFix.error.message}`
        : `UNUSED_ELEMENT ANCORA presente (stdout=${daPostFix.stdout.trim().slice(0, 120)})`,
  );

  // CONTRASTO testuale: usedHelper ancora presente in dead.dart (contrasto pulito intatto).
  const deadAfter = readSafe(join(dir, FD_S4_FILE));
  assert(
    `contrasto: ${FD_S4_FILE} contiene ancora usedHelper (contrasto pulito intatto)`,
    /\busedHelper\b/.test(deadAfter),
    /\busedHelper\b/.test(deadAfter) ? 'presente' : 'MANCANTE (fix ha rimosso anche il contrasto!)',
  );
  assert(
    `contrasto: ${FD_S4_SYMBOL} NON compare piu' in ${FD_S4_FILE} (definizione rimossa)`,
    !/\b_unusedHelper\b/.test(deadAfter),
    !/\b_unusedHelper\b/.test(deadAfter) ? 'rimosso' : 'ANCORA presente (fix non applicata!)',
  );
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
console.log(`=== GATE VERIFY (eco-F5b) flutter-dart RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
