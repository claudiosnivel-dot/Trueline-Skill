#!/usr/bin/env node
// m3_gate_check.mjs — GATE M3 (characterization & criterio 3 onesto: 06 + 10 §5).
//
// Asserisce, in modo DETERMINISTICO (L-COL-002: verde = output reale di comando,
// mai una frase), i criteri di M3. A DIFFERENZA della versione precedente, questo
// gate ESERCITA il PERCORSO RLS A RUNTIME: non passa piu' `--db-url=` VUOTO (che
// degradava silenziosamente l'RLS allo static checker — il gaming). Risolve il
// comando psql del DB di prova e lo INIETTA nell'env di generate.mjs e
// run_loop.mjs, cosi' la characterization RLS gira contro un vero Postgres. Se il
// DB non e' raggiungibile il gate FALLISCE CHIARAMENTE (non un falso verde, non
// uno skip silenzioso): M3 richiede legittimamente il banco di prova (10 §2).
//
//   0) PREFLIGHT DB DI PROVA: il comando psql risolto (default docker; override
//      via env TRUELINE_TEST_PSQL) esegue 'SELECT 1' e ritorna 0. Altrimenti il
//      gate ESCE 2 con l'istruzione di lanciare eval/db-test/up.ps1.
//
//   1) MODULI di characterization PRESENTI e GENERICI (trueline/scripts/
//      characterization/*): detect_runner, generate, rls_characterize, partition,
//      coverage, stabilize. Viaggiano nella skill, non hardcoded alla reference app.
//
//   2) generate.mjs produce una suite VERDE PER COSTRUZIONE sul codice corrente
//      (06 §3 step 4) e CARATTERIZZA RLS A RUNTIME: su una COPIA della reference
//      app, `npm test` esce 0 e cattura endpoint deterministici + build-integrity
//      + RLS osservata dal VERO Postgres. Il PERCORSO RUNTIME E' PROVATO:
//        - genReport.rlsRuntime === true e rlsDegraded === false (non degradato);
//        - la baseline ha, per una tabella che PERDE (invoices), observed
//          sees_other_tenant === true (leak osservato), e per una tabella di
//          CONTRASTO (notes/profiles) sees_other_tenant === false (isolata).
//        Nessuna assertion RLS e' { static_flagged:true } (sarebbe il degrado).
//
//   3) CHECKPOINT (REMEDIATE, --eval, --characterize) con RLS a runtime: i
//      controlli 3 (regressioni) e 4 (conformita->invarianza) sono VERDI (non
//      degradati). Inoltre il LOOP PROVA la criterio-2 + 06 §4 A RUNTIME:
//        - post-fix INVARIANZA: la fix di un finding RLS IMPACTED (S4/S5) cambia
//          l'observed IMPACTED (isolamento ripristinato: sees_other_tenant
//          true->false) -> quella tabella entra nel set RE-BASELINED; mentre le
//          GUARD (tabella di contrasto, /health, build-integrity) restano
//          invarianti (NON re-baselined). Provato dai set partition() del loop.
//        - partition() ESERCITATA: i record per-finding espongono il set IMPACTED
//          re-baselined, e l'unione finale (report.rebaseline) e' NON-banale e
//          contiene almeno una tabella RLS che perdeva.
//
//   4) CRITERIO 3 ONESTO (10 §5): la copertura e' DICHIARATA (report.coverage);
//      injection(S6)/authz(S7) restano NON coperti (semgrep M4); il report NON
//      asserisce "sicuro"/"safe" come garanzia (L-COL-006); nessun S6/S7 portato a
//      verified; ogni finding verified e' stato promosso da un ORACOLO (rule_id).
//
//   5) NESSUNA REGRESSIONE: i gate M0 (detection+present) e M1/M2 escono ancora 0;
//      nessuna copia temp residua; il fixture canonico e' bit-identico (git
//      status/HEAD invariati per la parte tracciata).
//
// Esce 0 se TUTTI i criteri passano; 1 se un criterio FALLISCE; 2 se il banco di
// prova (DB) non e' raggiungibile (precondizione M3 non soddisfatta — esito
// distinto da un fallimento di merito, mai un falso verde).
//
// Node ESM, solo built-in. NON tocca git (l'orchestratore possiede git): la
// verifica d'integrita usa `git status`/`rev-parse` in SOLA LETTURA. L'harness di
// eval PUO' usare docker/psql (la SKILL resta dep-free).

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, cpSync, rmSync, readFileSync, readdirSync,
} from 'node:fs';
import { resolve, dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CHARZ_DIR = resolve(ROOT, 'trueline', 'scripts', 'characterization');
const GENERATE = resolve(CHARZ_DIR, 'generate.mjs');
const REFERENCE_APP = resolve(ROOT, 'eval', 'reference-app');
const RUN_LOOP = resolve(ROOT, 'trueline', 'scripts', 'loop', 'run_loop.mjs');
const RUN_EVAL = resolve(ROOT, 'eval', 'harness', 'run_eval.mjs');
const M1_GATE = resolve(ROOT, 'eval', 'harness', 'm1_gate_check.mjs');
const M2_GATE = resolve(ROOT, 'eval', 'harness', 'm2_gate_check.mjs');
const TMP_VERIFY = resolve(ROOT, 'eval', '.tmp-verify');
const TMP_M3 = resolve(ROOT, 'eval', '.tmp-m3-charz');
const DB_UP_SCRIPT = resolve(ROOT, 'eval', 'db-test', 'up.ps1');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

// -----------------------------------------------------------------------------
// Comando psql del banco di prova (eval-only; la SKILL resta generica).
//   - default: il container del DB di prova Supabase locale (docker exec ... psql).
//   - override: env TRUELINE_TEST_PSQL (es. su CI con un endpoint diverso).
// Lo iniettiamo nell'env passato a generate.mjs / run_loop.mjs cosi' la loro
// characterization RLS gira a RUNTIME (rls_characterize lo legge da TRUELINE_TEST_PSQL).
// -----------------------------------------------------------------------------
const DEFAULT_PSQL = 'docker exec -i supabase_db_trueline-db-test psql -U postgres -d postgres';
const TEST_PSQL = process.env.TRUELINE_TEST_PSQL || DEFAULT_PSQL;

// Esegue il comando psql risolto con i flag canonici (-v ON_ERROR_STOP=1 -At),
// passando l'SQL su STDIN (shell:true perche' il comando puo' essere una pipeline
// `docker exec ... psql ...`). Ritorna { status, stdout, stderr, error }.
function psqlRun(sql) {
  const full = `${TEST_PSQL} -v ON_ERROR_STOP=1 -At`;
  const res = spawnSync(full, {
    input: sql, shell: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

// Il banco di prova e' raggiungibile? 'SELECT 1' deve uscire 0 e stampare '1'.
function dbReachable() {
  const r = psqlRun('SELECT 1;');
  return !r.error && r.status === 0 && (r.stdout || '').trim().split('\n').includes('1');
}

// nodeRun con TRUELINE_TEST_PSQL iniettato nell'env: cosi' generate.mjs /
// run_loop.mjs caratterizzano RLS contro il vero Postgres (percorso RUNTIME).
function nodeRun(script, args, cwd = ROOT) {
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}`,
    TRUELINE_TEST_PSQL: TEST_PSQL,
  };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

function npmRun(cwd, args) {
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}`,
    TRUELINE_TEST_PSQL: TEST_PSQL,
  };
  const res = spawnSync('npm', args, {
    cwd, env, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

// git in SOLA LETTURA (status/rev-parse) per l'integrita del fixture. Non muta nulla.
function gitRead(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: res.status, stdout: (res.stdout || '').trim() };
}

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function readSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }

console.log('============================================================');
console.log(' GATE M3 — characterization (06) + criterio 3 onesto (10 §5)');
console.log(`   moduli        : ${CHARZ_DIR}`);
console.log(`   reference-app : ${REFERENCE_APP}`);
console.log(`   psql test-db  : ${TEST_PSQL}`);
console.log('   set in-scope  : S1,S3,S4,S5,S8 -> verified; S2 -> mitigated-residual');
console.log('   detection-only: S6 (injection) / S7 (authz) -> semgrep M4 (NON verified)');
console.log('============================================================');
console.log('');

// =============================================================================
// 0) PREFLIGHT: il banco di prova (DB) DEVE essere raggiungibile. M3 caratterizza
//    RLS A RUNTIME: senza DB il gate NON puo' provare il percorso runtime. Esce 2
//    con un'istruzione esplicita — NON un falso verde, NON uno skip silenzioso.
// =============================================================================
console.log('0) Preflight banco di prova (DB) per la characterization RLS a RUNTIME (10 §2):');
if (!dbReachable()) {
  console.log('  [FAIL] DB di prova NON raggiungibile via psql risolto');
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('=== GATE M3: PRECONDIZIONE NON SODDISFATTA (DB di prova assente) ===');
  console.log('M3 richiede il banco di prova per caratterizzare l\'RLS A RUNTIME.');
  console.log(`Comando psql tentato: ${TEST_PSQL}`);
  console.log(`Avvia il DB di prova:  pwsh -File "${DB_UP_SCRIPT}"`);
  console.log('(oppure imposta TRUELINE_TEST_PSQL su un endpoint psql raggiungibile).');
  console.log('------------------------------------------------------------');
  process.exit(2);
}
assert('DB di prova raggiungibile via psql (SELECT 1 -> 0)', true, 'runtime RLS abilitato');

// snapshot iniziale dell'integrita del fixture (git, sola lettura, parte tracciata).
const headBefore = gitRead(REFERENCE_APP, ['rev-parse', 'HEAD']).stdout;
const statusBefore = gitRead(REFERENCE_APP, ['status', '--porcelain']).stdout;

// =============================================================================
// 1) MODULI presenti e generici
// =============================================================================
console.log('');
console.log('1) Moduli di characterization presenti e GENERICI (viaggiano nella skill):');
const MODULES = ['detect_runner.mjs', 'generate.mjs', 'rls_characterize.mjs', 'partition.mjs', 'coverage.mjs', 'stabilize.mjs'];
for (const m of MODULES) {
  assert(`modulo presente: ${m}`, existsSync(resolve(CHARZ_DIR, m)), existsSync(resolve(CHARZ_DIR, m)) ? 'ok' : 'ASSENTE');
}
// Genericita': nessun riferimento hardcoded a nomi della reference app nei moduli
// (es. 'reference-app', 'bookings', 'invoices', 'config.ts'). I moduli devono
// essere generici sopra un progetto utente qualunque.
const HARDCODE_RE = /reference-app|bookings|findBookingByIdUnsafe|src\/lib\/config|unused\.ts|credentials\.ts/;
let generic = true; let offender = '';
for (const m of MODULES) {
  const txt = readSafe(resolve(CHARZ_DIR, m));
  if (HARDCODE_RE.test(txt)) { generic = false; offender = m; break; }
}
assert('moduli GENERICI (nessun nome hardcoded della reference app)', generic, generic ? 'ok' : `hardcoded in ${offender}`);

// =============================================================================
// 2) generate.mjs -> suite VERDE PER COSTRUZIONE + RLS A RUNTIME (non degradato)
// =============================================================================
console.log('');
console.log('2) generate.mjs: suite VERDE PER COSTRUZIONE + RLS caratterizzata a RUNTIME:');

// Copia isolata della reference app (NON il fixture canonico). includeGit serve
// solo a node_modules; qui basta una copia file-system.
rmSync(TMP_M3, { recursive: true, force: true });
mkdirSync(TMP_M3, { recursive: true });
const COPY = resolve(TMP_M3, 'app');
cpSync(REFERENCE_APP, COPY, { recursive: true, dereference: false });

let genReport = null;
// NB: NESSUN --db-url= vuoto. La ricetta psql del banco di prova arriva via env
// TRUELINE_TEST_PSQL (iniettato da nodeRun): rls_characterize la usa e caratterizza
// l'RLS a RUNTIME (rls_characterize §resolvePsqlCmd).
const gen = nodeRun(GENERATE, [COPY], COPY);
try { genReport = JSON.parse(gen.stdout); } catch { /* gestito */ }
assert('generate.mjs esce 0 ed emette JSON', gen.status === 0 && genReport, `exit=${gen.status}`);

// Helper: tabella nuda dal target/id di una assertion RLS ('...invoices' -> 'invoices').
const bareTable = (a) => String(a.target || a.id || '').toLowerCase().split('.').pop();

if (genReport) {
  const A = genReport.assertions || [];
  const rls = A.filter((a) => a.kind === 'rls');
  assert('suite con assertion endpoint/build-integrity/rls', A.length >= 3,
    `assertions=${A.length} kinds=[${[...new Set(A.map((a) => a.kind))].join(',')}]`);
  assert('script "test" cablato nel package.json della COPIA',
    typeof genReport.testScript === 'string' && /node --test/.test(genReport.testScript),
    genReport.testScript);

  // --- PROVA che il PERCORSO RUNTIME e' stato eseguito, non quello degradato ---
  assert('generate.mjs riporta RLS a RUNTIME (rlsRuntime=true, rlsDegraded=false)',
    genReport.rlsRuntime === true && genReport.rlsDegraded === false,
    `rlsRuntime=${genReport.rlsRuntime} rlsDegraded=${genReport.rlsDegraded}`);

  // Nessuna assertion RLS deve essere il segnale del DEGRADO statico.
  const anyStatic = rls.some((a) => a.degraded === true
    || (a.observed && a.observed.static_flagged === true));
  assert('nessuna assertion RLS e\' degradata/static_flagged (percorso runtime usato)',
    rls.length > 0 && !anyStatic,
    anyStatic ? 'trovata assertion DEGRADATA (gaming: RLS non a runtime!)' : `rls=${rls.length} tutte runtime`);

  // ASIMMETRIA falsificabile, dal VERO RLS di Postgres:
  //   - una tabella che PERDE (invoices, S5) -> observed.sees_other_tenant === true
  //   - una tabella di CONTRASTO (notes/profiles) -> observed.sees_other_tenant === false
  const leak = rls.find((a) => bareTable(a) === 'invoices');
  assert('baseline RLS: tabella che perde (invoices) ha sees_other_tenant === true (leak osservato)',
    leak && leak.observed && leak.observed.sees_other_tenant === true,
    leak ? JSON.stringify(leak.observed) : 'assertion invoices ASSENTE');

  const contrast = rls.find((a) => bareTable(a) === 'notes' || bareTable(a) === 'profiles');
  assert('baseline RLS: tabella di contrasto (notes/profiles) ha sees_other_tenant === false (isolata)',
    contrast && contrast.observed && contrast.observed.sees_other_tenant === false,
    contrast ? `${bareTable(contrast)}=${JSON.stringify(contrast.observed)}` : 'nessuna assertion di contrasto');

  // Esegui la suite generata: deve essere VERDE sul codice corrente (vulnerabile).
  // npmRun inietta TRUELINE_TEST_PSQL cosi' anche il recompute RLS gira a runtime.
  const t = npmRun(COPY, ['test', '--silent']);
  assert('npm test (suite generata) ESCE 0 — verde per costruzione', t.status === 0, `exit=${t.status}`);

  // Stabilizzazione: la suite NON deve lasciare artefatti di build sul disco
  // (dist/.trueline-charz-dist) — lo scan di sicurezza resterebbe pulito.
  const noDist = !existsSync(resolve(COPY, 'dist')) && !existsSync(resolve(COPY, '.trueline-charz-dist'));
  assert('nessun artefatto di build residuo dopo npm test (dist/.trueline-charz-dist)', noDist,
    noDist ? 'pulito' : 'artefatti residui presenti');
}

// =============================================================================
// 3) CHECKPOINT (REMEDIATE, --eval, --characterize) con RLS a RUNTIME: 3/4 verdi
//    + INVARIANZA post-fix provata + partition() esercitata.
// =============================================================================
console.log('');
console.log('3) CHECKPOINT (REMEDIATE, --eval, --characterize) con RLS a RUNTIME — 3/4 verdi + invarianza:');
// NB: nessun --db-url= vuoto. run_loop legge il banco di prova da TRUELINE_TEST_PSQL
// (iniettato da nodeRun), quindi la characterization (06) e il re-baseline post-fix
// girano a RUNTIME contro il vero Postgres.
const loop = nodeRun(RUN_LOOP, ['--eval', '--mode=remediate', '--characterize']);
let report = null;
try { report = JSON.parse(loop.stdout); } catch { /* gestito */ }
assert('run_checkpoint esce 0 ed emette JSON', loop.status === 0 && report, `exit=${loop.status}`);

const cp = (report && report.checkpoint) || { controls: [] };
const ctl = (id) => (cp.controls || []).find((c) => c.id === id) || {};
assert("controllo 3 (regressioni) ORA 'green' (NON degraded)", ctl(3).status === 'green' && ctl(3).green === true,
  `status=${ctl(3).status}`);
assert("controllo 4 (conformita->invarianza) ORA 'green' (NON degraded)", ctl(4).status === 'green' && ctl(4).green === true,
  `status=${ctl(4).status}`);
assert('nessun controllo del checkpoint resta degradato (// TODO M3 rimosso)',
  Array.isArray(cp.degraded) && cp.degraded.length === 0, `degraded=[${(cp.degraded || []).join(',')}]`);

// --- La characterization del loop e' a RUNTIME (le assertion RLS dalla COPIA) ---
const loopAssertions = (report && report.characterization && report.characterization.assertions) || [];
const loopRls = loopAssertions.filter((a) => a.kind === 'rls');
const loopRlsTables = loopRls.map((a) => String(a.target || a.id || '').toLowerCase().split('.').pop());
assert('la characterization del loop include le tabelle RLS (invoices + contrasto) a runtime',
  loopRlsTables.includes('invoices') && (loopRlsTables.includes('notes') || loopRlsTables.includes('profiles')),
  `rlsTables=[${loopRlsTables.join(',')}]`);

// GUARD anti-gaming sul loop: gli id delle assertion RLS provano il PERCORSO
// scelto. A runtime rls_characterize emette id 'rls:<schema-effimero>.<tabella>'
// (rls_characterize.mjs §runtimeSnapshot); il degrado statico emette invece
// 'rls-static:<tabella>:<ctrl>' (§degradedAssertions). Se anche UNA sola
// assertion RLS del loop fosse 'rls-static:' il loop avrebbe caratterizzato a
// secco (gaming) -> rosso. Cosi' il gate non puo' passare con il loop degradato.
const loopHasStaticRls = loopRls.some((a) => /^rls-static:/.test(String(a.id || '')));
const loopAllRuntimeRls = loopRls.length > 0
  && loopRls.every((a) => /^rls:[^.]+\.[^.]+$/.test(String(a.id || '')));
assert('il loop ha caratterizzato l\'RLS a RUNTIME (id rls:<schema>.<tabella>, nessun rls-static:)',
  loopAllRuntimeRls && !loopHasStaticRls,
  loopHasStaticRls ? 'trovata assertion rls-static: (loop DEGRADATO — gaming!)'
    : `rls-loop=${loopRls.length} tutte runtime`);

// --- INVARIANZA post-fix (criterio 2 + 06 §4) provata A RUNTIME --------------
// Dopo che il loop fissa S4/S5, l'observed delle assertion IMPACTED (documents/
// invoices) CAMBIA (isolamento ripristinato: sees_other_tenant true->false) ->
// quelle tabelle entrano nel set RE-BASELINED. Le GUARD (tabella di contrasto,
// /health, build-integrity) NON vengono mai re-baselined (restano invarianti).
const F = (report && report.findings) || [];
const rebaselineFinal = (report && report.rebaseline && report.rebaseline.rebaselined) || [];
const bare = (id) => String(id || '').toLowerCase().split('.').pop();
const rebaselinedTables = new Set(rebaselineFinal.map(bare));

// (a) almeno una tabella RLS che PERDEVA e' stata re-baselined (impacted cambiato).
const leakRebaselined = rebaselinedTables.has('invoices') || rebaselinedTables.has('documents');
assert('post-fix: una tabella RLS che perdeva (invoices/documents) e\' nel set RE-BASELINED (impacted cambiato true->false)',
  leakRebaselined, `rebaselined=[${rebaselineFinal.join(',')}]`);

// (b) le GUARD restano invarianti: nessuna tabella di contrasto e' re-baselined.
const contrastRebaselined = rebaselinedTables.has('notes') || rebaselinedTables.has('profiles');
const healthRebaselined = rebaselineFinal.some((id) => /endpoint:|\/health/i.test(String(id)));
assert('post-fix: le GUARD restano invarianti (nessuna tabella di contrasto / /health re-baselined)',
  !contrastRebaselined && !healthRebaselined,
  `contrastRebaselined=${contrastRebaselined} healthRebaselined=${healthRebaselined}`);

// (c) FALSIFICABILITA dell'invarianza: il set re-baselined e' un SOTTOINSIEME
// PROPRIO delle assertion (esistono GUARD non toccate) — un re-baseline "di tutto"
// sarebbe sospetto (cancellerebbe il senso di guard). guard = complemento != vuoto.
const allIds = new Set(loopAssertions.map((a) => a.id));
const guardIds = [...allIds].filter((id) => !rebaselineFinal.includes(id));
assert('post-fix: il set GUARD (complemento del re-baselined) e\' NON-vuoto (invarianza significativa)',
  allIds.size > rebaselineFinal.length && guardIds.length > 0,
  `assertions=${allIds.size} rebaselined=${rebaselineFinal.length} guard=${guardIds.length}`);

// --- partition() ESERCITATA dal loop per ogni finding RLS verified -----------
// Ogni finding RLS verified espone il suo set IMPACTED re-baselined; i due
// finding che fissano S4/S5 devono aver re-baselined la PROPRIA tabella. Cio'
// prova che partition(finding, assertions) e' stata calcolata per-finding (06 §4),
// non un re-baseline globale indiscriminato.
const rlsVerified = F.filter((f) => f.category === 'rls' && f.fix_state === 'verified');
const rlsImpactedPerFinding = rlsVerified
  .map((f) => (f.rebaselined || []).map(bare))
  .filter((arr) => arr.includes('invoices') || arr.includes('documents'));
assert('partition() esercitata: i finding RLS verified espongono il set IMPACTED per-finding (re-baselined sulla propria tabella)',
  rlsVerified.length >= 2 && rlsImpactedPerFinding.length >= 1,
  `rlsVerified=${rlsVerified.length} con-impacted-tabella=${rlsImpactedPerFinding.length}`);

// =============================================================================
// 4) CRITERIO 3 ONESTO: copertura dichiarata, niente "sicuro", nessun verified
//    senza oracolo, nessun S6/S7 a verified.
// =============================================================================
console.log('');
console.log('4) Criterio 3 ONESTO: copertura dichiarata, niente "sicuro", nessun verified senza oracolo:');
const coverage = (report && report.coverage) || null;
assert('copertura presente nel report (report.coverage)', coverage && Array.isArray(coverage.declared_uncovered),
  coverage ? 'coverage presente' : 'coverage ASSENTE');

const uncovered = (coverage && coverage.declared_uncovered) || [];
const hasUncovered = (re) => uncovered.some((u) => re.test(`${u.what} ${u.why}`));
assert('copertura dichiara injection(S6) NON ancora coperto (semgrep M4)',
  hasUncovered(/injection|S6/i) && /semgrep|M4/i.test(JSON.stringify(uncovered)),
  hasUncovered(/injection|S6/i) ? 'dichiarato' : 'NON dichiarato');
assert('copertura dichiara authz(S7) NON ancora coperto (semgrep M4)',
  hasUncovered(/authz|S7/i),
  hasUncovered(/authz|S7/i) ? 'dichiarato' : 'NON dichiarato');

// CRITERIO 3 ONESTO, lato RLS: poiche' l'RLS e' ora a RUNTIME, la copertura NON
// deve dichiarare l'RLS come "degradata allo static checker" (sarebbe il segnale
// del gaming che questo gate elimina).
const rlsDegradedDeclared = uncovered.some((u) =>
  /RLS behavior not characterized at runtime|static checker used/i.test(`${u.what} ${u.why}`));
assert('la copertura NON dichiara l\'RLS come degradata allo static (e\' a runtime)',
  !rlsDegradedDeclared,
  rlsDegradedDeclared ? 'RLS dichiarata DEGRADATA (gaming!)' : 'RLS a runtime, nessun degrado dichiarato');

// Il report NON deve asserire "sicuro"/"safe" come GARANZIA (L-COL-006). Tolleriamo
// "fail-safe"/"failsafe" (termine tecnico del modello git, non una garanzia).
const reportText = JSON.stringify({ coverage, characterization: report && report.characterization });
const guarantee = /\b(sicuro|safe)\b/i.test(reportText.replace(/fail[-\s]?safe/ig, ''));
assert('il report NON asserisce "sicuro"/"safe" come garanzia (L-COL-006)', !guarantee,
  guarantee ? 'trovata garanzia indebita' : 'nessuna garanzia indebita (fail-safe escluso)');

// Nessun S6/S7 (injection/authz) portato a verified (sarebbe un falso verde M4).
const s6s7verified = F.filter((f) => (f.category === 'injection' || f.category === 'authz') && f.fix_state === 'verified');
assert('nessun S6/S7 (injection/authz) portato a verified (sarebbe falso verde M4)', s6s7verified.length === 0,
  `verified injection/authz=${s6s7verified.length}`);

// Ogni finding verified e' stato promosso da un ORACOLO: deve avere un rule_id.
const verified = F.filter((f) => f.fix_state === 'verified');
const verifiedWithOracle = verified.filter((f) => f.rule_id && String(f.rule_id).length > 0);
assert("ogni finding verified e' stato promosso da un oracolo (rule_id presente)",
  verified.length > 0 && verifiedWithOracle.length === verified.length,
  `verified=${verified.length} con-oracolo=${verifiedWithOracle.length}`);

// =============================================================================
// 5) NESSUNA REGRESSIONE + integrita fixture canonica
// =============================================================================
console.log('');
console.log('5) Nessuna regressione (m1/m2/run_eval) + integrita fixture canonica:');

const det = nodeRun(RUN_EVAL, ['--mode=detection']);
assert('run_eval --mode=detection ancora EXIT 0', det.status === 0, `exit=${det.status}`);
const pres = nodeRun(RUN_EVAL, ['--mode=present']);
assert('run_eval --mode=present ancora EXIT 0', pres.status === 0, `exit=${pres.status}`);

const m1 = nodeRun(M1_GATE, []);
assert('m1_gate_check ancora EXIT 0', m1.status === 0, `exit=${m1.status}`);
const m2 = nodeRun(M2_GATE, []);
assert('m2_gate_check ancora EXIT 0', m2.status === 0, `exit=${m2.status}`);

assert('nessuna copia temp residua (eval/.tmp-verify)', !existsSync(TMP_VERIFY),
  existsSync(TMP_VERIFY) ? 'directory ancora presente' : 'assente');

// fixture canonico bit-identico (parte tracciata): HEAD e status invariati.
const headAfter = gitRead(REFERENCE_APP, ['rev-parse', 'HEAD']).stdout;
const statusAfter = gitRead(REFERENCE_APP, ['status', '--porcelain']).stdout;
assert('fixture canonica bit-identica dopo (git status/HEAD invariati)',
  headAfter === headBefore && statusAfter === statusBefore,
  headAfter === headBefore && statusAfter === statusBefore ? 'invariata' : 'MUTATA');

// cleanup della copia di lavoro del gate (eval/.tmp-m3-charz).
rmSync(TMP_M3, { recursive: true, force: true });

// --- Esito ------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE M3 RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
