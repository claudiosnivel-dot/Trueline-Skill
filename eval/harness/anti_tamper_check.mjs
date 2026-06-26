#!/usr/bin/env node
// anti_tamper_check.mjs — GATE D'ACCETTAZIONE AT-1 Fase A (KEYSTONE, T3.1.2).
//
// E' il gate parametrico del "controllo 4 = test d'accettazione dell'AC" per BUILD
// (spec docs/superpowers/specs/2026-06-25-anti-tamper-control4-design.md §7). Driva
// il binario SPEDITO `run_checkpoint.mjs --in-place <copia> --blueprint <bp> --mode
// build` sui 4 fixture di `eval/anti-tamper/`, e ASSERISCE — su FATTI di oracoli,
// MAI un parere dell'LLM (L-COL-002) — i sotto-test falsificabili della Fase A:
//
//   (1) faithful      — target_test reale (node:test) che esegue >=1 test e PASSA →
//                       `controls[3].green===true` (status 'green'). E' il ramo
//                       AC-acceptance del controllo 4: il test-gate dell'AC e' REALE.
//
//   (2) failing       — target_test taggato ma con asserzione che FALLISCE →
//                       `controls[3].green===false` (detail menziona "test rosso").
//                       L'oracolo e' l'exit reale del file (L-COL-002), non una frase.
//
//   (3) empty         — target_test SENZA alcun test() (suite vuota) → FLOOR
//                       ANTI-VACUO: `testCount<1` ⇒ `controls[3].green===false`
//                       (detail "vacuo"/"alcun test"), anche se il processo esce 0.
//
//   (4) partial       — BUILD incrementale: il blueprint dichiara 2 target_test ma
//                       solo tests/a.test.mjs e' materializzato (tests/b.test.mjs =
//                       task non costruito → SALTATO, mai RED); a/ passa →
//                       `controls[3].green===true`. Lo skip del mancante non maschera.
//
//   (5) not-built     — IN-SCOPE VUOTO: una copia di `faithful` SENZA la dir tests/
//                       (nessun target_test materializzato) → `controls[3].status===
//                       'degraded'` (onesto, NON verde, NON un falso verde).
//
//   (6) flag-not-disk — ATTIVAZIONE via FLAG (non via disco): sul fixture `faithful`,
//                       `run_checkpoint --in-place <copia>` SENZA `--blueprint` →
//                       controllo 4 LEGACY (degraded, nessun runner) ≠ CON `--blueprint`
//                       → green AC-acceptance. Si asserisce che DIFFERISCONO: prova che
//                       commuta il FLAG, non l'auto-detect su disco (BIT-invarianza).
//
// 0-CONTAMINAZIONE (L-COL-024): ogni sotto-test lavora su una COPIA ISOLATA sotto la
// radice temp PRIVATA per-pid eval/.tmp-at-<pid> (`.git` incluso); assertIsolatedRepo
// inline (toplevel copia ≠ ROOT e ≠ reference-app originale). A fine run: HEAD interno
// di OGNI fixture INVARIATO, HEAD ESTERNO INVARIATO, fixture bit-identica (snapshot
// `git status --porcelain` invariato), e nessun residuo .tmp-at-*. Le copie sono
// SOLO-LETTURA per il binario (--in-place: gli oracoli del checkpoint non mutano).
//
// MANIFEST/AC-BRANCH (onesto): il ramo AC-acceptance del controllo 4 si attiva solo se
// `mode==='build' && --blueprint && manifest.test_runner.run_file`. Nello SPEDITO solo
// l'ecosistema `supabase-jsts` dichiara `run_file` (= "node --test {file}"), e si
// classifica `supabase-jsts` quando esiste `supabase/config.toml`. I fixture sono app
// node:test minimali: per ATTIVARE il ramo AC, l'harness DEPONE un `supabase/config.toml`
// minimale SOLO nella COPIA isolata (mai nel fixture originale → 0-contaminazione intatta).
// E' setup di fixture legittimo: il fixture E' concettualmente un'app supabase-jsts (il
// suo target_test gira col run_file di supabase-jsts). Senza, il ramo cade al legacy
// (degraded) e il test-gate dell'AC non sarebbe esercitabile.
//
// PRECONDIZIONE (robustezza — il gap che blocca il gate): in testa verifichiamo che
//   (i)   ogni eval/anti-tamper/<fix>/reference-app/.git esista (provisionato
//         dall'orchestratore via eval/anti-tamper/provision_fixtures.sh, L-COL-024:
//         gli agenti NON toccano git);
//   (ii)  ogni seeded-blueprint esista;
//   (iii) node sia eseguibile;
//   (iv)  il binario run_checkpoint.mjs + l'esecutore run_file.mjs esistano;
//   (v)   l'ecosistema supabase-jsts dichiari test_runner.run_file (senza il quale il
//         ramo AC NON si attiva → il gate non sarebbe esercitabile).
// Se una manca → banner '(precondizione mancante)' e process.exit(2): MAI un falso
// verde, MAI un exit 0/1 ambiguo.
//
// ESITO (mai un falso verde — "verde" = exit/output reale, L-COL-002):
//   exit 0 — i sotto-test (1)..(6) PASS + 0-contaminazione;
//   exit 1 — un sotto-test FALLISCE;
//   exit 2 — PRECONDIZIONE mancante (.git/seeded-blueprint/node/run_file assenti).
//
// FUORI SCOPE (deliberato): la no-regressione integrale pesante (m1..m5 /
// ecosystem_conformance / run_eval / package_skill) e' un passo SERIALE
// dell'orchestratore (T3.1.3), NON in questo harness (lezione BD-1: evita falsi-rossi
// da contesa sui temp). Anche i sotto-test trace-check (tampered-untagged / tag-in-
// stringa / multi-file …) sono la Fase B (plan successivo), non Fase A.
//
// SPECCHIA build_discipline_check.mjs: shebang + import built-in, ROOT da __dirname,
// radice temp PRIVATA per-pid (cleanAtTmp never-throw), helper nodeRun (spawnSync con
// PATH+GO_BIN), copyFixture isolata (.git incluso), assert(name, ok, detail) che
// accumula in checks[], tally finale + process.exit(...). Node ESM, solo built-in. NON
// tocca git del repo ESTERNO: le uniche `git` sono in SOLA LETTURA (rev-parse/status/
// show-toplevel) su fixture/copia, mai mutazioni.
//
// DETERMINISMO back-to-back (L-COL-002): radice temp PRIVATA eval/.tmp-at-<pid> →
// nessuna contesa con altri harness/run. La pulizia (cleanAtTmp) NON lancia mai: un
// fallimento ambientale diventa un exit-2 ONESTO, MAI un falso rosso exit-1.

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readdirSync, rmSync, cpSync, writeFileSync, readFileSync,
} from 'node:fs';
import { resolve, dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const RUN_CHECKPOINT = resolve(ROOT, 'trueline', 'scripts', 'checkpoint', 'run_checkpoint.mjs');
const RUN_FILE = resolve(ROOT, 'trueline', 'scripts', 'checkpoint', 'run_file.mjs');
const SUPABASE_ECO = resolve(ROOT, 'trueline', 'references', 'ecosystems', 'supabase-jsts', 'ecosystem.json');
const FIX_ROOT = resolve(ROOT, 'eval', 'anti-tamper');
// Radice temp PRIVATA per-invocazione (pid): elimina la CONTESA sui temp (lezione
// BD-1). Coperta da .gitignore "eval/.tmp-*/". Nessun'altra esecuzione la tocca.
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', `.tmp-at-${process.pid}`);
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

// I 4 fixture, ciascuno con la sua reference-app (inner-repo) e il seeded-blueprint.
const FIXTURES = {
  faithful: {
    referenceApp: resolve(FIX_ROOT, 'faithful', 'reference-app'),
    blueprint: resolve(FIX_ROOT, 'faithful', 'seeded-blueprint'),
  },
  failing: {
    referenceApp: resolve(FIX_ROOT, 'failing', 'reference-app'),
    blueprint: resolve(FIX_ROOT, 'failing', 'seeded-blueprint'),
  },
  empty: {
    referenceApp: resolve(FIX_ROOT, 'empty', 'reference-app'),
    blueprint: resolve(FIX_ROOT, 'empty', 'seeded-blueprint'),
  },
  partial: {
    referenceApp: resolve(FIX_ROOT, 'partial', 'reference-app'),
    blueprint: resolve(FIX_ROOT, 'partial', 'seeded-blueprint'),
  },
};

// supabase/config.toml minimale deposto nella COPIA per attivare il ramo AC
// (classify -> supabase-jsts -> manifest.test_runner.run_file). NON deve contenere
// segreti (control2 gitleaks scansiona il working-tree della copia): solo un marker.
const SUPABASE_CONFIG_TOML = 'project_id = "anti-tamper-fixture"\n';

// ---------------------------------------------------------------------------
// Helper di esecuzione/IO (mirror di build_discipline_check.mjs).
// ---------------------------------------------------------------------------
function nodeRun(script, args, cwd = ROOT) {
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

// git in SOLA LETTURA (rev-parse/status/show-toplevel). Non muta nulla.
function gitRead(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: res.status, stdout: (res.stdout || '').trim() };
}

const normSlash = (p) => String(p).replace(/\\/g, '/');

// Backoff BLOCCANTE deterministico (niente setTimeout/Date.now/Math.random): assorbe
// un lock transitorio di Windows tra i tentativi senza introdurre non-determinismo.
function settleDeterministic(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { /* Atomics non disponibile: prosegui senza attesa */ }
}

// Pulizia ROBUSTA della NOSTRA radice temp privata. NON lancia MAI: un lock transitorio
// di Windows su un file appena copiato/rimosso NON deve trasformarsi in un falso rosso
// exit-1 (la failure-mode peggiore).
function cleanAtTmp() {
  for (let i = 0; i < 6; i += 1) {
    try {
      if (!existsSync(TMP_VERIFY_ROOT)) return;
      rmSync(TMP_VERIFY_ROOT, { recursive: true, force: true, maxRetries: 4, retryDelay: 60 });
      if (!existsSync(TMP_VERIFY_ROOT)) return;
    } catch { /* lock transitorio: ritenta col backoff sotto */ }
    if (i < 5) settleDeterministic(80 * (i + 1));
  }
  /* esaurito: NON lanciamo. assertHygiene tollera una radice vuota-ma-locked. */
}

// ---------------------------------------------------------------------------
// COPIA ISOLATA per-fixture (mirror copyFixture di build_discipline_check):
// id = pid+contatore monotono (NO Date.now/Math.random), `.git` INCLUSO, dentro
// eval/.tmp-at-<pid> (gitignorata). Deponiamo supabase/config.toml nella copia per
// attivare il ramo AC (vedi header). `dropTests` rimuove la dir tests/ (sotto-test
// not-built / in-scope vuoto). Ritorna { dir, cleanup }.
// ---------------------------------------------------------------------------
let __copyCounter = 0;
function copyFixture(label, sourceApp, { dropTests = false } = {}) {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __copyCounter += 1;
  const safe = String(label).replace(/[^A-Za-z0-9._-]/g, '-');
  const dir = join(TMP_VERIFY_ROOT, `at-${safe}-pid${process.pid}-${__copyCounter}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  cpSync(sourceApp, dir, { recursive: true, dereference: false });
  // Attiva il ramo AC: la copia si classifica supabase-jsts (run_file presente).
  try { mkdirSync(join(dir, 'supabase'), { recursive: true }); } catch { /* esiste */ }
  writeFileSync(join(dir, 'supabase', 'config.toml'), SUPABASE_CONFIG_TOML);
  if (dropTests) {
    try { rmSync(join(dir, 'tests'), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
    catch { /* best-effort */ }
  }
  const cleanup = () => {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* best-effort */ }
    try {
      if (existsSync(TMP_VERIFY_ROOT) && readdirSync(TMP_VERIFY_ROOT).length === 0) {
        rmSync(TMP_VERIFY_ROOT, { recursive: true, force: true });
      }
    } catch { /* best-effort: radice non vuota o lock concorrente non è un errore */ }
  };
  return { dir, cleanup };
}

// assertIsolatedRepo inline (L-COL-024): il toplevel della copia NON deve risolvere
// al repo ESTERNO né alla reference-app originale (sarebbe contaminazione).
function isIsolatedCopy(copyDir, originalApp) {
  if (!copyDir) return false;
  const top = gitRead(copyDir, ['rev-parse', '--show-toplevel']).stdout || copyDir;
  const a = normSlash(resolve(top)).toLowerCase();
  return a !== normSlash(resolve(ROOT)).toLowerCase()
    && a !== normSlash(resolve(originalApp)).toLowerCase();
}

// Driva il binario SPEDITO run_checkpoint.mjs --in-place su una COPIA. `blueprintDir`
// null → run SENZA --blueprint (ramo legacy del controllo 4). Ritorna il report JSON
// parsato + il controllo 4 (controls[3]).
function driveCheckpoint(appDir, blueprintDir) {
  const args = [appDir, '--in-place', '--mode', 'build', '--no-osv'];
  if (blueprintDir) { args.push('--blueprint', blueprintDir); }
  const r = nodeRun(RUN_CHECKPOINT, args);
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* gestito dal chiamante */ }
  const c4 = report && Array.isArray(report.controls) ? report.controls[3] : null;
  return { status: r.status, report, c4, stderr: r.stderr };
}

// Drive STABILIZZATO (lezione BD-1, k=2): su Windows un handle ancora aperto da un
// oracolo appena terminato puo' degradare/crashare la lettura. Ritentiamo SOLO su
// indicatori AMBIENTALI (niente JSON / forma degradata / controls[3] assente), MAI su
// un rosso/degraded reale dell'oracolo. `requireGreen` innesca retry se controls[3]
// non e' verde (per i sotto-test che attendono il verde). Cap K piccolo: un esito
// persistente resta tale (l'oracolo e' il giudice).
function driveCheckpointStable(appDir, blueprintDir, { requireGreen = false } = {}, K = 2) {
  let last = null;
  for (let attempt = 1; attempt <= K; attempt += 1) {
    const r = driveCheckpoint(appDir, blueprintDir);
    const wellFormed = r.report && Array.isArray(r.report.controls)
      && r.report.controls.length >= 4 && r.c4;
    last = { ...r, attempts: attempt, wellFormed: Boolean(wellFormed) };
    const clean = wellFormed && (!requireGreen || (r.c4 && r.c4.green === true));
    if (clean) return { ...last, stabilized: true };
    if (attempt < K) settleDeterministic(150 * attempt);
  }
  return { ...last, stabilized: false };
}

// ---------------------------------------------------------------------------
// Banco di asserzioni (stesso stile di build_discipline_check).
// ---------------------------------------------------------------------------
const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// ===========================================================================
// PRECONDIZIONE (robustezza): .git di ogni fixture + seeded-blueprint + node +
// run_checkpoint/run_file + supabase-jsts.run_file. Manca → banner + exit 2.
// ===========================================================================
function checkPreconditions() {
  const missing = [];
  for (const [id, fx] of Object.entries(FIXTURES)) {
    const gitDir = resolve(fx.referenceApp, '.git');
    if (!existsSync(gitDir)) missing.push(`${id}: reference-app/.git assente (${gitDir}) — esegui eval/anti-tamper/provision_fixtures.sh (orchestratore, L-COL-024)`);
    if (!existsSync(fx.blueprint)) missing.push(`${id}: seeded-blueprint assente (${fx.blueprint})`);
  }
  // node eseguibile: lancia `node --version` (process.execPath) e pretende exit 0.
  const nodeProbe = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
  if (nodeProbe.error || nodeProbe.status !== 0) {
    missing.push(`node NON eseguibile (${process.execPath}): ${nodeProbe.error ? nodeProbe.error.message : `exit=${nodeProbe.status}`}`);
  }
  // Il binario SPEDITO + l'esecutore single-file devono esistere su disco.
  for (const [label, p] of [['run_checkpoint.mjs', RUN_CHECKPOINT], ['run_file.mjs', RUN_FILE]]) {
    if (!existsSync(p)) missing.push(`script ${label} assente (${p})`);
  }
  // L'ecosistema supabase-jsts deve dichiarare test_runner.run_file: senza, il ramo
  // AC del controllo 4 non si attiva e il gate non e' esercitabile.
  if (!existsSync(SUPABASE_ECO)) {
    missing.push(`ecosystem.json supabase-jsts assente (${SUPABASE_ECO})`);
  } else {
    let runFileTpl = null;
    try {
      const eco = JSON.parse(readFileSync(SUPABASE_ECO, 'utf8'));
      runFileTpl = eco && eco.test_runner && eco.test_runner.run_file;
    } catch (e) { missing.push(`ecosystem.json supabase-jsts non leggibile: ${e.message}`); }
    if (!runFileTpl) missing.push('supabase-jsts: test_runner.run_file assente (ramo AC non attivabile)');
  }
  return missing;
}

// ===========================================================================
// (1) faithful — controls[3].green === true (test-gate AC reale, verde).
// ===========================================================================
function subTestFaithful() {
  console.log('');
  console.log('(1) faithful — il controllo 4 esegue il target_test reale e PASSA (controls[3].green):');
  const fx = FIXTURES.faithful;
  const copy = copyFixture('faithful', fx.referenceApp);
  try {
    assert('(1) copia isolata (toplevel ≠ repo esterno e ≠ reference-app originale)',
      isIsolatedCopy(copy.dir, fx.referenceApp), copy.dir);
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: true });
    assert('(1) run_checkpoint --in-place --blueprint emette JSON ben formato (controls[4])',
      d.wellFormed, d.report ? `exit=${d.status} controls=${d.report.controls ? d.report.controls.length : 0}` : `exit=${d.status} (no JSON)`);
    if (!d.c4) return;
    assert('(1) controls[3].name === \'conformance\' (il controllo 4)', d.c4.name === 'conformance', `name=${d.c4.name}`);
    assert('(1) controls[3].green === true (target_test reale eseguito e verde)', d.c4.green === true,
      `green=${d.c4.green} status=${d.c4.status} detail="${d.c4.detail}"`);
    assert('(1) controls[3].status === \'green\'', d.c4.status === 'green', `status=${d.c4.status}`);
  } finally { copy.cleanup(); }
}

// ===========================================================================
// (2) failing — controls[3].green === false (esecuzione: test rosso).
// ===========================================================================
function subTestFailing() {
  console.log('');
  console.log('(2) failing — target_test taggato ma l\'asserzione FALLISCE (controls[3] RED, "test rosso"):');
  const fx = FIXTURES.failing;
  const copy = copyFixture('failing', fx.referenceApp);
  try {
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: false });
    assert('(2) run_checkpoint --in-place --blueprint emette JSON ben formato (controls[4])',
      d.wellFormed, d.report ? `exit=${d.status}` : `exit=${d.status} (no JSON)`);
    if (!d.c4) return;
    assert('(2) controls[3].green === false (asserzione che fallisce → RED)', d.c4.green === false,
      `green=${d.c4.green} status=${d.c4.status}`);
    assert('(2) detail del controllo 4 menziona "test rosso" (esecuzione, non vacuo)',
      /test rosso/i.test(String(d.c4.detail || '')), `detail="${d.c4.detail}"`);
  } finally { copy.cleanup(); }
}

// ===========================================================================
// (3) empty — controls[3].green === false (floor anti-vacuo: testCount < 1).
// ===========================================================================
function subTestEmpty() {
  console.log('');
  console.log('(3) empty — target_test SENZA alcun test() → floor anti-vacuo (controls[3] RED, "vacuo"):');
  const fx = FIXTURES.empty;
  const copy = copyFixture('empty', fx.referenceApp);
  try {
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: false });
    assert('(3) run_checkpoint --in-place --blueprint emette JSON ben formato (controls[4])',
      d.wellFormed, d.report ? `exit=${d.status}` : `exit=${d.status} (no JSON)`);
    if (!d.c4) return;
    assert('(3) controls[3].green === false (zero test eseguiti → RED)', d.c4.green === false,
      `green=${d.c4.green} status=${d.c4.status}`);
    assert('(3) detail del controllo 4 menziona "vacuo"/"alcun test" (floor anti-vacuo)',
      /vacuo|alcun test/i.test(String(d.c4.detail || '')), `detail="${d.c4.detail}"`);
  } finally { copy.cleanup(); }
}

// ===========================================================================
// (4) partial — controls[3].green === true (il file mancante e' SALTATO).
// ===========================================================================
function subTestPartial() {
  console.log('');
  console.log('(4) partial — 2 target_test, solo tests/a.test.mjs su disco (b/ saltato, a/ passa → verde):');
  const fx = FIXTURES.partial;
  const copy = copyFixture('partial', fx.referenceApp);
  try {
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: true });
    assert('(4) run_checkpoint --in-place --blueprint emette JSON ben formato (controls[4])',
      d.wellFormed, d.report ? `exit=${d.status}` : `exit=${d.status} (no JSON)`);
    if (!d.c4) return;
    assert('(4) controls[3].green === true (il file mancante e\' saltato, non RED; a/ passa)',
      d.c4.green === true, `green=${d.c4.green} status=${d.c4.status} detail="${d.c4.detail}"`);
  } finally { copy.cleanup(); }
}

// ===========================================================================
// (5) not-built — in-scope VUOTO → controls[3].status === 'degraded' (non verde).
// ===========================================================================
function subTestNotBuilt() {
  console.log('');
  console.log('(5) not-built — copia di faithful SENZA tests/ (in-scope vuoto) → controls[3] DEGRADATO:');
  const fx = FIXTURES.faithful;
  const copy = copyFixture('not-built', fx.referenceApp, { dropTests: true });
  try {
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: false });
    assert('(5) run_checkpoint --in-place --blueprint emette JSON ben formato (controls[4])',
      d.wellFormed, d.report ? `exit=${d.status}` : `exit=${d.status} (no JSON)`);
    if (!d.c4) return;
    assert('(5) controls[3].status === \'degraded\' (nessun target_test materializzato, NON verde)',
      d.c4.status === 'degraded' && d.c4.green === false,
      `status=${d.c4.status} green=${d.c4.green} detail="${d.c4.detail}"`);
  } finally { copy.cleanup(); }
}

// ===========================================================================
// (6) flag-not-disk — ATTIVAZIONE via FLAG: senza --blueprint (legacy/degraded) ≠
//     con --blueprint (green AC). Prova che commuta il FLAG, non il disco.
// ===========================================================================
function subTestFlagNotDisk() {
  console.log('');
  console.log('(6) flag-not-disk — faithful: SENZA --blueprint (legacy) ≠ CON --blueprint (green AC):');
  const fx = FIXTURES.faithful;
  const copy = copyFixture('flag-not-disk', fx.referenceApp);
  try {
    // SENZA --blueprint: ramo legacy del controllo 4 (nessun runner → degraded).
    const noFlag = driveCheckpointStable(copy.dir, null, { requireGreen: false });
    // CON --blueprint: ramo AC-acceptance (target_test reale → green).
    const withFlag = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: true });
    assert('(6) entrambe le run emettono JSON ben formato (controls[4])',
      noFlag.wellFormed && withFlag.wellFormed,
      `noFlag.exit=${noFlag.status} withFlag.exit=${withFlag.status}`);
    if (!noFlag.c4 || !withFlag.c4) return;
    assert('(6) SENZA --blueprint: controllo 4 NON verde (ramo legacy, degraded)',
      noFlag.c4.green === false, `status=${noFlag.c4.status} green=${noFlag.c4.green}`);
    assert('(6) CON --blueprint: controllo 4 verde (ramo AC-acceptance)',
      withFlag.c4.green === true, `status=${withFlag.c4.status} green=${withFlag.c4.green}`);
    // Il cuore del sotto-test: i due esiti DIFFERISCONO → commuta il FLAG, non il disco
    // (sul medesimo identico stato su disco). BIT-invarianza provata per costruzione.
    assert('(6) gli esiti DIFFERISCONO sullo stesso disco (flag, non auto-detect): degraded ≠ green',
      noFlag.c4.green !== withFlag.c4.green && noFlag.c4.status !== withFlag.c4.status,
      `noFlag=${noFlag.c4.status} withFlag=${withFlag.c4.status}`);
  } finally { copy.cleanup(); }
}

// ===========================================================================
// 0-CONTAMINAZIONE: HEAD interno di OGNI fixture + HEAD esterno invariati,
// fixture bit-identica (snapshot status interno invariato), nessun residuo temp.
// ===========================================================================
function assertHygiene(snapshots, outerHeadBefore) {
  console.log('');
  console.log('0-contaminazione — HEAD interno/esterno invariati, fixture bit-identica, nessun residuo .tmp-at:');
  for (const [id, fx] of Object.entries(FIXTURES)) {
    const snap = snapshots[id];
    const headAfter = gitRead(fx.referenceApp, ['rev-parse', 'HEAD']).stdout;
    const statusAfter = gitRead(fx.referenceApp, ['status', '--porcelain']).stdout;
    assert(`[${id}] fixture INTERNA bit-identica (HEAD + git status --porcelain INVARIATI)`,
      headAfter === snap.head && statusAfter === snap.status,
      headAfter === snap.head && statusAfter === snap.status
        ? `HEAD=${snap.head.slice(0, 10)} (invariato)`
        : `HEAD before=${snap.head.slice(0, 10)} after=${headAfter.slice(0, 10)} status-mutato=${statusAfter !== snap.status}`);
  }
  const outerHeadAfter = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
  assert('HEAD del repo ESTERNO INVARIATO (0 contaminazione)', outerHeadAfter === outerHeadBefore,
    outerHeadAfter === outerHeadBefore ? `${outerHeadBefore.slice(0, 10)} (invariato)` : 'MUTATO (vietato!)');
  // Nessuna SOTTOCARTELLA residua sotto la radice temp privata (tolleriamo una radice
  // vuota-ma-locked di Windows: NON e' contaminazione). readdirSync in try/catch.
  let residual = [];
  try { residual = existsSync(TMP_VERIFY_ROOT) ? readdirSync(TMP_VERIFY_ROOT) : []; }
  catch { residual = []; }
  assert('nessuna copia temp residua sotto la radice temp privata (eval/.tmp-at-<pid>)', residual.length === 0,
    residual.length === 0 ? 'nessun residuo (radice vuota, assente o lockata)' : `residui: ${residual.join(', ')}`);
}

// ---------------------------------------------------------------------------
function main() {
  console.log('============================================================');
  console.log(' GATE ANTI-TAMPER (AT-1 Fase A, T3.1.2) — il controllo 4 = test d\'accettazione AC (spec §7)');
  console.log(`   fixture root : ${FIX_ROOT}`);
  console.log('   (1) faithful      — controls[3].green === true (test-gate AC reale)');
  console.log('   (2) failing       — controls[3].green === false (test rosso)');
  console.log('   (3) empty         — controls[3].green === false (floor anti-vacuo)');
  console.log('   (4) partial       — controls[3].green === true (file mancante saltato)');
  console.log('   (5) not-built     — controls[3].status === degraded (in-scope vuoto)');
  console.log('   (6) flag-not-disk — senza --blueprint (legacy) ≠ con --blueprint (green AC)');
  console.log('============================================================');

  // --- PRECONDIZIONE: .git/seeded-blueprint/node/run_file ------------------
  const missing = checkPreconditions();
  if (missing.length) {
    console.log('');
    console.log('------------------------------------------------------------');
    console.log('=== GATE ANTI-TAMPER: (precondizione mancante) ===');
    for (const m of missing) console.log(`  - ${m}`);
    console.log('Una precondizione del gate non è soddisfatta: i 4 fixture devono avere un');
    console.log('.git interno provisionato (eval/anti-tamper/provision_fixtures.sh — orchestratore,');
    console.log('L-COL-024) + un seeded-blueprint; node/run_checkpoint/run_file devono esistere;');
    console.log('supabase-jsts deve dichiarare test_runner.run_file.');
    console.log('(exit 2 = precondizione; mai un falso verde, mai un exit 0/1 ambiguo.)');
    console.log('------------------------------------------------------------');
    process.exit(2);
  }
  console.log('');
  console.log('[PASS] precondizione: ogni fixture ha reference-app/.git + seeded-blueprint; node/run_checkpoint/run_file presenti; supabase-jsts.run_file dichiarato.');

  // Sweep di copie temp orfane.
  cleanAtTmp();

  // Snapshot d'integrità (sola lettura) PRIMA dei sotto-test — criterio 0-contam.
  const outerHeadBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
  const snapshots = {};
  for (const [id, fx] of Object.entries(FIXTURES)) {
    snapshots[id] = {
      head: gitRead(fx.referenceApp, ['rev-parse', 'HEAD']).stdout,
      status: gitRead(fx.referenceApp, ['status', '--porcelain']).stdout,
    };
  }

  // --- I sotto-test --------------------------------------------------------
  subTestFaithful();
  subTestFailing();
  subTestEmpty();
  subTestPartial();
  subTestNotBuilt();
  subTestFlagNotDisk();

  // --- 0-contaminazione ----------------------------------------------------
  cleanAtTmp();
  assertHygiene(snapshots, outerHeadBefore);

  // --- Esito ---------------------------------------------------------------
  const allOk = checks.every((c) => c.ok);
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(`=== GATE ANTI-TAMPER RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check; sotto-test (1)..(6) + 0-contaminazione)`);
  console.log('------------------------------------------------------------');
  process.exit(allOk ? 0 : 1);
}

main();
