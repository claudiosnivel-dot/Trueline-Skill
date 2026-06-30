#!/usr/bin/env node
// verify_fix_check.mjs — GATE di T2.1 (SP-6): il verify-fix LOOP promuove a
// `verified` le 3 categorie del verified_set (secret, rls, dead-code) sulla
// fixture postgres-py (Postgres NON-Supabase, idioma current_setting), in PARITA
// con supabase-py. Scritto TEST-FIRST.
//
// Il "verde" e' un FATTO degli ORACOLI riesiguiti dal loop (gitleaks/rls_check/
// vulture), MAI una frase dell'LLM (L-COL-002). Su una COPIA ISOLATA della
// fixture (MAI l'originale: eval/.tmp-verify/<id>, .git incluso) il gate:
//   1) raccoglie i finding del FLOOR dagli oracoli legati (gli stessi del loop);
//   2) per OGNI finding esegue runFindingLoop col fix-provider deterministico
//      (eval-mode: gate umano auto-approvato, solo-eval, L-COL-021);
//   3) ASSERISCE gli stati-fix attesi (FATTI dell'oracolo, non opinioni):
//        PY-S1 (secret app/config.py, working-tree)  -> verified (gitleaks WT pulito)
//        PY-S3 (rls public.invoices, USING true)     -> verified (rls_check pulito,
//                                                       policy riscritta con current_setting)
//        PY-S5 (dead-code _unused_helper, vulture)   -> verified (vulture non lo segnala piu')
//        PY-S6 (secret-in-history legacy_credentials) -> mitigated-residual (MAI verified)
//   4) GUARD: la suite pytest di caratterizzazione resta VERDE post-fix sulla copia.
//   5) IGIENE: la fixture ORIGINALE resta bit-identica (status interno vuoto +
//      HEAD interno invariato) e l'HEAD del repo ESTERNO e' INVARIATO.
//
// MANIFEST-DRIVEN (O-COL-011 / L-COL-029): la dir delle migration NON e' cablata.
// La risolviamo via resolveRlsMigrationsDir col manifest postgres-py
// (oracles.rls.scan -> ['migrations', ...]) sia per raccogliere il floor RLS sia
// passandola al loop in runOpts.manifest (cosi' il re-run dell'oracolo RLS dentro
// il loop usa la STESSA dir 'migrations/', non 'supabase/migrations').
//
// FALSIFICABILITA: neutralizzando il transfer RLS o fixDeadcodeSymbol (no-op)
// questo gate DEVE fallire sul rispettivo seed (rls_check / vulture continuano a
// segnalare). Il gate NON e' un timbro sempre-verde.
//
// NOTA DI ONDATA (W1): il transfer RLS idioma-Postgres (current_setting) nel
// fix-provider e' fornito da T2.1 (W2). Se in questa ondata il fix-provider non
// e' ancora pronto per PY-S3, questo gate fallira' su PY-S3: e' atteso e va
// dichiarato. Il gate detection-level di T1.1 e' fixture_check.mjs; questo script
// e' costruito per essere esercitato in W3 dall'orchestratore.
//
// Gli oracoli gitleaks richiedono C:/Users/claud/go/bin sul PATH: lo arricchiamo
// per gli spawn (mirror dei wrapper / fixture_check). NON tocca MAI il git del
// repo ESTERNO se non in SOLA LETTURA (rev-parse/status). Tutte le mutazioni git
// avvengono sul .git INTERNO della COPIA (isolato, L-COL-024).
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
import { resolveRlsMigrationsDir } from '../../../trueline/scripts/loop/rls_scan.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// eval/ecosystems/postgres-py -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RLS_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'rls_check.mjs');
const RUN_DEADCODE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_deadcode.mjs');
const MANIFEST_PATH = resolve(ROOT, 'trueline', 'references', 'ecosystems', 'postgres-py', 'ecosystem.json');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify');

// Manifest postgres-py: serve a risolvere la migration-dir MANIFEST-DRIVEN
// (oracles.rls.scan) e a far usare al loop la stessa dir 'migrations/'.
let MANIFEST = null;
try { MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch { /* gestito sotto */ }

// runOpts deterministici: IDENTICI a quelli che il loop usa in rerunOracleFor
// (default di runFindingLoop) cosi' i fingerprint che raccogliamo qui combaciano
// con quelli che il loop ricalcola al re-run. Passiamo `manifest` cosi' il re-run
// dell'oracolo RLS dentro il loop usa la dir 'migrations/' (non 'supabase/migrations').
// NON passiamo `base`: gli oracoli su path ASSOLUTI vengono relativizzati a
// REPO_ROOT (base irrilevante), esattamente come fa il loop.
const RUN_OPTS = { runId: 'loop', createdAt: '1970-01-01T00:00:00.000Z', manifest: MANIFEST };

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
function readSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }

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

// Normalizza un output nativo nel finding model, identico al loop (norm in
// run_loop): tagga lo scope; scarta se lo schema non valida.
function norm(oracle, json, scope) {
  const f = normalize(oracle, json, { ...RUN_OPTS, scope });
  const v = validateMany(f);
  return (v.ok ? f : []).map((x) => ({ ...x, _scope: scope }));
}

// Crea una COPIA ISOLATA della fixture (eval/.tmp-verify/<id>, .git INCLUSO).
// Mirror di copyPackFixture (ecosystem_conformance): id unico per-run (pid +
// counter), niente Date.now/Math.random. Ritorna { dir, cleanup }.
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_VERIFY_ROOT, `verify-fix-py-pid${process.pid}-${__c}`);
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

const baseName = (p) => String(p).replace(/\\/g, '/').split('/').pop();
const posix = (p) => String(p).replace(/\\/g, '/');

// Raccoglie i finding del FLOOR dalla copia, con gli STESSI oracoli/scope del loop.
// La migration-dir RLS e' risolta MANIFEST-DRIVEN (oracles.rls.scan -> 'migrations/').
function collectFloorFindings(dir) {
  const out = [];
  const gwt = nodeRun(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  let gwtJson = null; try { gwtJson = JSON.parse(gwt.stdout); } catch { /* */ }
  if (Array.isArray(gwtJson)) out.push(...norm('gitleaks', gwtJson, 'working-tree'));

  const gh = nodeRun(RUN_GITLEAKS, [dir, 'history'], dir);
  let ghJson = null; try { ghJson = JSON.parse(gh.stdout); } catch { /* */ }
  if (Array.isArray(ghJson)) out.push(...norm('gitleaks', ghJson, 'history'));

  const migDir = resolveRlsMigrationsDir(dir, { manifest: MANIFEST });
  const rls = nodeRun(RLS_CHECK, [migDir], dir);
  let rlsJson = null; try { rlsJson = JSON.parse(rls.stdout); } catch { /* */ }
  if (rlsJson) out.push(...norm('rls-check', rlsJson, 'static-ddl'));

  const dc = nodeRun(RUN_DEADCODE, [dir, '--tool=vulture'], dir);
  let dcJson = null; try { dcJson = JSON.parse(dc.stdout); } catch { /* */ }
  if (dcJson) out.push(...norm('vulture', dcJson, 'working-tree'));

  return out;
}

// Seleziona, dai finding raccolti, il rappresentante atteso di ciascun seed del
// floor della fixture (PY-S1/S3/S5/S6). Selettore data-driven sull'ancora del
// registry (path/symbol), NON sul fingerprint (che ricaviamo dal finding reale).
function pickSeed(findings, kind) {
  if (kind === 'PY-S1') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'working-tree'
      && /(^|\/)app\/config\.py$/.test(posix(f.location.file)));
  }
  if (kind === 'PY-S6') {
    return findings.find((f) => f.category === 'secret' && f._scope === 'history'
      && /legacy_credentials\.py$/.test(posix(f.location.file)));
  }
  if (kind === 'PY-S3') {
    return findings.find((f) => f.category === 'rls'
      && f.source_oracle.rule_id === 'RLS003_PERMISSIVE_TRUE'
      && (f.location.symbol === 'invoices_select' || /invoices/.test(posix(f.location.file))));
  }
  if (kind === 'PY-S5') {
    return findings.find((f) => f.category === 'dead-code'
      && (f.location.symbol === '_unused_helper')
      && /(^|\/)app\/dead\.py$/.test(posix(f.location.file)));
  }
  return undefined;
}

// Riesegue vulture sulla copia e ritorna true se `symbol` in `relFile` e' ANCORA
// segnalato (per l'assert di azzeramento simbolo, indipendente dal loop).
function vultureStillFlags(dir, relFile, symbol) {
  const dc = nodeRun(RUN_DEADCODE, [dir, '--tool=vulture'], dir);
  let json = null; try { json = JSON.parse(dc.stdout); } catch { return null; }
  if (!json || !Array.isArray(json.issues)) return null;
  return json.issues.some((i) => i.name === symbol && baseName(i.file) === baseName(relFile));
}

console.log('============================================================');
console.log(' GATE T2.1 (SP-6) — verify-fix LOOP su postgres-py (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   atteso  : PY-S1/S3/S5 -> verified ; PY-S6 -> mitigated-residual (mai verified)');
console.log('   RLS idioma: current_setting (Postgres non-Supabase) ; migration-dir MANIFEST-DRIVEN');
console.log('============================================================');
console.log('');

assert('manifest postgres-py caricato (oracles.rls.scan presente)',
  Boolean(MANIFEST && MANIFEST.oracles && MANIFEST.oracles.rls && Array.isArray(MANIFEST.oracles.rls.scan)),
  MANIFEST && MANIFEST.oracles && MANIFEST.oracles.rls ? `scan=[${(MANIFEST.oracles.rls.scan || []).join(', ')}]` : 'manifest assente');

// Snapshot d'integrita' (sola lettura) — repo ESTERNO + fixture INTERNA.
const outerHeadBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
const innerHeadBefore = gitRead(FIXTURE, ['rev-parse', 'HEAD']).stdout;
const innerStatusBefore = gitRead(FIXTURE, ['status', '--porcelain']).stdout;

assert('la fixture reference-app esiste', existsSync(FIXTURE), FIXTURE);

let ws = null;
let dir = null;
try {
  ws = copyFixture();
  dir = ws.dir;
} catch (e) {
  assert('copia ISOLATA della fixture creata', false, e.message);
}
assert('copia ISOLATA della fixture creata (eval/.tmp-verify, .git incluso)',
  Boolean(dir) && existsSync(dir), dir || 'assente');

// ISOLAMENTO: la copia NON deve risolvere al repo esterno ne' alla fixture orig.
if (dir) {
  const top = gitRead(dir, ['rev-parse', '--show-toplevel']).stdout;
  const isIsolated = posix(resolve(top || dir)).toLowerCase() !== posix(resolve(ROOT)).toLowerCase()
    && posix(resolve(top || dir)).toLowerCase() !== posix(resolve(FIXTURE)).toLowerCase();
  assert('la copia e ISOLATA (toplevel != repo esterno e != fixture originale)', isIsolated,
    `toplevel=${posix(top)}`);
}

// La dir risolta sulla copia DEVE essere 'migrations/' (MANIFEST-DRIVEN), NON
// 'supabase/migrations': falsificabile se il resolver/manifest regredisce.
if (dir) {
  const migDir = resolveRlsMigrationsDir(dir, { manifest: MANIFEST });
  const isMigrations = /(^|[\\/])migrations$/.test(migDir) && !/supabase[\\/]migrations$/.test(migDir);
  assert('migration-dir risolta MANIFEST-DRIVEN = migrations/ (non supabase/migrations)', isMigrations,
    posix(migDir));
}

let results = {};
let s5Symbol = '_unused_helper';
let s5RelFile = 'app/dead.py';

if (dir) {
  // Branch di lavoro autonomo sul .git INTERNO della copia (come run_loop).
  createWorkBranch(dir, 'trueline/remediate/verify-fix-py');

  // (1) raccogli i finding del floor dalla copia.
  const findings = collectFloorFindings(dir);
  console.log('');
  console.log(`  raccolti ${findings.length} finding dal floor (gitleaks WT+history, rls_check, vulture)`);

  const seeds = {
    'PY-S1': pickSeed(findings, 'PY-S1'),
    'PY-S3': pickSeed(findings, 'PY-S3'),
    'PY-S5': pickSeed(findings, 'PY-S5'),
    'PY-S6': pickSeed(findings, 'PY-S6'),
  };
  for (const [id, f] of Object.entries(seeds)) {
    assert(`finding ${id} raccolto dagli oracoli del floor`, Boolean(f),
      f ? `cat=${f.category} rule=${f.source_oracle.rule_id} file=${posix(f.location.file)} sym=${f.location.symbol || '-'}` : 'ASSENTE');
  }
  if (seeds['PY-S5']) { s5Symbol = seeds['PY-S5'].location.symbol; s5RelFile = seeds['PY-S5'].location.file; }

  // (2) esegui il loop per OGNI seed col fix-provider deterministico (eval-mode).
  const provider = deterministicFixProvider();
  const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
  console.log('');
  console.log('  esecuzione del verify-fix loop per ciascun seed del floor (eval-mode):');
  // Ordine: prima i verified (mutano il working tree/migration), poi S6 (history,
  // nessuna mutazione). L'ordine non e' load-bearing (ogni finding e' indipendente),
  // ma teniamo S6 per ultimo per leggibilita' del log.
  for (const id of ['PY-S1', 'PY-S3', 'PY-S5', 'PY-S6']) {
    const f = seeds[id];
    if (!f) { results[id] = { fix_state: 'MISSING' }; continue; }
    const res = runFindingLoop(f, { dir, fixProvider: provider, evalMode: true, runOpts: RUN_OPTS, budget });
    results[id] = res;
    console.log(`    ${id}: fix_state=${res.fix_state} — ${String(res.reason || '').slice(0, 120)}`);
  }

  // (3) ASSERZIONI di stato-fix (FATTI dell'oracolo riesiguito dal loop).
  console.log('');
  console.log('  Stati-fix (promozione = FATTO dell oracolo, L-COL-002):');
  assert('PY-S1 -> verified (gitleaks working-tree PULITO su app/config.py)',
    results['PY-S1'] && results['PY-S1'].fix_state === 'verified',
    `fix_state=${results['PY-S1'] && results['PY-S1'].fix_state}`);
  assert('PY-S3 -> verified (rls_check PULITO su public.invoices, policy current_setting)',
    results['PY-S3'] && results['PY-S3'].fix_state === 'verified',
    `fix_state=${results['PY-S3'] && results['PY-S3'].fix_state}`);
  assert('PY-S5 -> verified (vulture non segnala piu il simbolo)',
    results['PY-S5'] && results['PY-S5'].fix_state === 'verified',
    `fix_state=${results['PY-S5'] && results['PY-S5'].fix_state}`);
  assert('PY-S6 -> mitigated-residual (MAI verified: history non riscritta)',
    results['PY-S6'] && results['PY-S6'].fix_state === 'mitigated-residual',
    `fix_state=${results['PY-S6'] && results['PY-S6'].fix_state}`);
  // RINFORZO L-COL-006/024: PY-S6 non puo' MAI essere verified.
  assert('PY-S6 NON e verified (mai un falso "sicuro")',
    !(results['PY-S6'] && results['PY-S6'].fix_state === 'verified'),
    results['PY-S6'] ? results['PY-S6'].fix_state : '-');

  // (3b) verifica INDIPENDENTE dell'azzeramento del simbolo dead-code: dopo il
  //   loop, vulture NON deve piu' segnalare _unused_helper in app/dead.py.
  const stillFlags = vultureStillFlags(dir, s5RelFile, s5Symbol);
  assert(`vulture (ri-girato) NON segnala piu il simbolo ${s5Symbol} in ${baseName(s5RelFile)}`,
    stillFlags === false,
    stillFlags === null ? 'vulture non rieseguibile' : (stillFlags ? 'ANCORA segnalato (fix non efficace!)' : 'azzerato'));
  // contrasto: used_helper resta definito (il fix non ha rotto il modulo).
  const deadAfter = readSafe(join(dir, 'app', 'dead.py'));
  assert('contrasto: used_helper resta definito in app/dead.py dopo la rimozione del dead-code',
    /def\s+used_helper\s*\(/.test(deadAfter),
    /def\s+used_helper\s*\(/.test(deadAfter) ? 'presente' : 'RIMOSSA (fix ha rotto il modulo!)');
  assert(`contrasto: ${s5Symbol} rimosso da app/dead.py`,
    !new RegExp(`def\\s+${s5Symbol}\\s*\\(`).test(deadAfter),
    new RegExp(`def\\s+${s5Symbol}\\s*\\(`).test(deadAfter) ? 'ANCORA presente' : 'rimosso');

  // (3c) RLS idioma-Postgres: la policy riscritta su public.invoices usa
  //   current_setting (isolamento reale), NON auth.uid() (idioma Supabase). FATTO
  //   testuale sulla migration fixata, in aggiunta al verdetto dell'oracolo.
  const migFileAfter = resolveRlsMigrationsDir(dir, { manifest: MANIFEST });
  let migSqlAfter = '';
  try {
    const sqls = readdirSync(migFileAfter).filter((f) => f.toLowerCase().endsWith('.sql')).sort();
    for (const s of sqls) migSqlAfter += readSafe(join(migFileAfter, s));
  } catch { /* dir assente */ }
  assert('RLS idioma-Postgres: la migration fixata contiene current_setting (non auth.uid)',
    /current_setting\s*\(/.test(migSqlAfter) && !/auth\.uid\s*\(/.test(migSqlAfter),
    /current_setting\s*\(/.test(migSqlAfter)
      ? (/auth\.uid\s*\(/.test(migSqlAfter) ? 'current_setting presente MA auth.uid anche (idioma misto!)' : 'current_setting (corretto)')
      : 'current_setting ASSENTE (fix RLS non applicata o idioma errato)');

  // (4) GUARD: la suite pytest di caratterizzazione resta VERDE post-fix.
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
console.log(`=== GATE T2.1 (SP-6) RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
