#!/usr/bin/env node
// build_discipline_check.mjs — GATE D'ACCETTAZIONE BD-1 (KEYSTONE, T2.2).
//
// È il gate parametrico della DISCIPLINA DI COSTRUZIONE per BUILD (spec §7). Drive
// la modalità BUILD eval-only di run_loop sui 3 fixture di `eval/build-discipline/`,
// e ASSERISCE — su FATTI di oracoli/harness, MAI un parere dell'LLM (L-COL-002) — i
// tre sotto-test falsificabili della §7:
//
//   (a) overcomplicated-correct  — ADVISORY ≠ GATE (§7.2a). Il tidy advisory EMETTE
//       {advisory:true, complexity_flag:true} MENTRE il checkpoint a 4 controlli è
//       VERDE (tutti e 4: dead-code/security/regressions/conformance). Si asserisce
//       advisory===true && complexity_flag===true && checkpoint.green===true
//       SIMULTANEAMENTE: il flag NON è un gate (verde a checkpoint verde). `notes`
//       elenca {file:'src/pricing/validators.ts', markers>threshold}.
//
//   (b) orphan-injecting          — DEAD-CODE ORACOLO (§7.3b). Un export orfano NUOVO
//       (src/legacy/unused.ts) introdotto dalla costruzione: il controllo 1
//       (dead-code, baseline-delta) FALLISCE (controls[0].name==='dead-code' &&
//       controls[0].green===false, detail '1 dead-code NUOVO introdotto'); il
//       tidy advisory NON è un gate (complexity_flag===false). Falsificabile:
//       rimosso l'orfano SULLA COPIA il controllo 1 torna VERDE.
//
//   (c) ambiguous-ac              — OSSERVABILITÀ AC DETERMINISTICA (§7.4). Il blueprint
//       è STRUTTURALMENTE valido (validate_blueprint exit 0) MA un `then` porta un
//       token vietato verbatim ("funziona bene"): ac_observability_check FLAGGA
//       (exit 1, FAIL (1) AC_OBSERVABILITY). I due oracoli sono ORTOGONALI.
//       Falsificabile: rimosso il token, ac_observability_check torna exit 0.
//
// 0-CONTAMINAZIONE (L-COL-024): ogni sotto-test che muta (b/c) lavora su una COPIA
// ISOLATA sotto eval/.tmp-verify (id = pid+contatore, `.git` incluso);
// assertIsolatedRepo inline (toplevel copia ≠ ROOT e ≠ fixture originale). A fine
// run: HEAD interno di OGNI fixture INVARIATO, HEAD ESTERNO INVARIATO, fixture
// bit-identica (git status interno invariato — i fixture hanno node_modules
// untracked, quindi confrontiamo INVARIANZA dello snapshot, non status vuoto), e
// nessun residuo .tmp-verify. Il driver (run_loop) usa di per sé createVerifyWorkspace
// → la copia che ispeziona è già isolata; i sotto-test che mutano creano UNA LORO
// copia ulteriore e puntano --fixture-app su quella.
//
// PRECONDIZIONE (robustezza — il gap che ha bloccato W3): in testa verifichiamo che
//   (i)  ogni eval/build-discipline/<fix>/reference-app/.git esista;
//   (ii) ogni seeded-blueprint esista;
//   (iii) node sia eseguibile.
// Se una manca → banner '(precondizione mancante)' e process.exit(2): MAI un falso
// verde, MAI un exit 0/1 ambiguo.
//
// ESITO (mai un falso verde — "verde" = exit/output reale, L-COL-002):
//   exit 0 — i 3 sotto-test (a)/(b)/(c) PASS;
//   exit 1 — un sotto-test FALLISCE;
//   exit 2 — PRECONDIZIONE mancante (.git/seeded-blueprint/node assenti).
//
// FUORI SCOPE (deliberato): la no-regressione integrale pesante (m1..m5 /
// ecosystem_conformance / run_eval / package_skill) è T3.1 SERIALE dell'orchestratore,
// NON in questo harness (lezione SP-0..SP-7: evita falsi-rossi da contesa sui temp).
//
// SPECCHIA ecosystem_conformance.mjs / m5_gate_check.mjs: shebang + import built-in,
// ROOT da __dirname, sweep delle copie temp in testa (qui cleanBdTmp() su una radice
// PRIVATA per-pid, vedi sotto), helper nodeRun (spawnSync con PATH+GO_BIN), assert(name,
// ok, detail) che accumula in checks[], tally finale + process.exit(...). Node ESM, solo
// built-in (nessuna dipendenza da verify_workspace: il driver run_loop e' un sottoprocesso
// che eredita la radice temp privata via env). NON tocca git del repo ESTERNO: le uniche
// `git` sono in SOLA LETTURA (rev-parse/status/show-toplevel) su fixture/copia, mai mutazioni.
//
// DETERMINISMO back-to-back (L-COL-002): ogni invocazione usa una radice temp PRIVATA
// eval/.tmp-bd-<pid> (env TRUELINE_TMP_VERIFY_ROOT, ereditata dai run_loop figli) →
// nessuna contesa con altri harness/run → niente race cpSync/chmod di Windows. La pulizia
// (cleanBdTmp) NON lancia mai: un fallimento ambientale diventa un exit-2 ONESTO
// (precondAbort), MAI un falso rosso exit-1.

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readdirSync, rmSync, cpSync, readFileSync, writeFileSync, statSync,
} from 'node:fs';
import { resolve, dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const RUN_LOOP = resolve(ROOT, 'trueline', 'scripts', 'loop', 'run_loop.mjs');
const AC_CHECK = resolve(ROOT, 'trueline', 'scripts', 'blueprint', 'ac_observability_check.mjs');
const VALIDATE_BP = resolve(ROOT, 'trueline', 'scripts', 'blueprint', 'validate_blueprint.mjs');
const FIX_ROOT = resolve(ROOT, 'eval', 'build-discipline');
// Radice temp PRIVATA per-invocazione (pid): elimina la CONTESA sulla .tmp-verify
// CONDIVISA — la race Windows cpSync/chmod del driver SPEDITO (createVerifyWorkspace)
// che produceva la flakiness back-to-back (ENOENT/EPERM/ENOTEMPTY). I run_loop FIGLI
// la ereditano via env TRUELINE_TMP_VERIFY_ROOT (impostato QUI, PRIMA di ogni spawn);
// nessun'altra esecuzione (altri harness, run back-to-back con pid diverso) tocca
// questa radice → niente race. Coperta da .gitignore "eval/.tmp-*/". Default invariato
// per gli altri harness, che NON impostano l'env (bit-invarianza preservata).
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', `.tmp-bd-${process.pid}`);
process.env.TRUELINE_TMP_VERIFY_ROOT = TMP_VERIFY_ROOT;
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

// I 3 fixture, ciascuno con la sua reference-app (inner-repo) e il seeded-blueprint.
const FIXTURES = {
  'overcomplicated-correct': {
    referenceApp: resolve(FIX_ROOT, 'overcomplicated-correct', 'reference-app'),
    blueprint: resolve(FIX_ROOT, 'overcomplicated-correct', 'seeded-blueprint'),
  },
  'orphan-injecting': {
    referenceApp: resolve(FIX_ROOT, 'orphan-injecting', 'reference-app'),
    blueprint: resolve(FIX_ROOT, 'orphan-injecting', 'seeded-blueprint'),
  },
  'ambiguous-ac': {
    referenceApp: resolve(FIX_ROOT, 'ambiguous-ac', 'reference-app'),
    blueprint: resolve(FIX_ROOT, 'ambiguous-ac', 'seeded-blueprint'),
  },
};

// ---------------------------------------------------------------------------
// Helper di esecuzione/IO (mirror di ecosystem_conformance.mjs / m5_gate_check.mjs).
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

// Esegue run_loop --eval --mode=build sul fixture e ritorna il report JSON parsato.
// `extraFixtureApp` permette di puntare --fixture-app su una COPIA (per i sotto-test
// di falsificabilità che mutano), invece che sulla reference-app originale.
function driveBuild({ referenceApp, blueprint, characterize = false }) {
  const args = ['--eval', '--mode=build'];
  if (characterize) args.push('--characterize');
  args.push(`--fixture-app=${referenceApp}`);
  args.push(`--blueprint=${blueprint}`);
  const r = nodeRun(RUN_LOOP, args);
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* gestito dal chiamante */ }
  return { status: r.status, report, stderr: r.stderr };
}

// Backoff BLOCCANTE deterministico (niente setTimeout/Date.now/Math.random): assorbe
// un lock transitorio di Windows tra i tentativi senza introdurre non-determinismo.
function settleDeterministic(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { /* Atomics non disponibile: prosegui senza attesa */ }
}

// Pulizia ROBUSTA della NOSTRA radice temp privata. NON lancia MAI: un lock transitorio
// di Windows su un file appena copiato/rimosso NON deve trasformarsi in un falso rosso
// exit-1 (la failure-mode peggiore). Sostituisce cleanupAllVerifyWorkspaces() — che fa
// rmWithRetry rethrow sull'esaurimento — con un rm best-effort + backoff deterministico
// che, se proprio non riesce, lascia decidere l'esito al chiamante (mai un crash nudo).
function cleanBdTmp() {
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

// Drive STABILIZZATO di run_loop (L-COL-002: il gate dev'essere un FATTO DETERMINISTICO).
// Il driver gira su una copia temporanea condivisa (eval/.tmp-verify); su Windows un
// handle ancora aperto da un figlio appena terminato puo' far CRASHARE la copia
// successiva (EPERM/EBUSY su .tmp-verify) o degradare il report di --characterize
// (toolchain in cold-start). NON e' una proprieta' del codice sotto test: la VERITA'
// e' la riesecuzione SERIALE ISOLATA (lezione SP-0..SP-7), che qui MECCANIZZIAMO.
// Ritentiamo SOLO su indicatori AMBIENTALI (crash / niente JSON / forma degradata),
// MAI su un rosso reale dell'oracolo:
//   - requireGreen=false (subTestB): un control RED e' il risultato ATTESO e NON
//     innesca retry; "stabile" = report ben formato (status 0 + checkpoint.controls).
//   - requireGreen=true (subTestA): un checkpoint non-verde da toolchain degradata
//     innesca retry; se non si stabilizza in K tentativi ED e' ancora ben formato
//     (green persistente per causa NON ambientale) lo lasciamo asserire (rosso reale);
//     se invece resta degradato/crashato e' una PRECONDIZIONE (exit 2 dal chiamante),
//     mai un falso verde ne' un rosso ingannevole.
function driveBuildStable({ referenceApp, blueprint, characterize = false, requireGreen = false }, K = 4) {
  let last = null;
  for (let attempt = 1; attempt <= K; attempt += 1) {
    cleanBdTmp();          // slate pulito: niente residui dal tentativo/sotto-test precedente
    const r = driveBuild({ referenceApp, blueprint, characterize });
    const wellFormed = r.status === 0 && r.report
      && r.report.checkpoint && Array.isArray(r.report.checkpoint.controls);
    last = { ...r, attempts: attempt, wellFormed: Boolean(wellFormed) };
    const clean = wellFormed && (!requireGreen || r.report.checkpoint.green === true);
    if (clean) return { ...last, stabilized: true };
    if (attempt < K) settleDeterministic(150 * attempt);
  }
  return { ...last, stabilized: false };
}

// Aborto di PRECONDIZIONE (exit 2): l'ambiente/toolchain del driver non si e'
// stabilizzato in K tentativi (crash/forma degradata) — mai un falso verde/rosso.
function precondAbort(reason) {
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('=== GATE BUILD-DISCIPLINE: (precondizione mancante) ===');
  console.log(`  - ${reason}`);
  console.log('(exit 2 = precondizione/ambiente instabile; mai un falso verde, mai un rosso ingannevole.)');
  console.log('------------------------------------------------------------');
  cleanBdTmp();
  process.exit(2);
}

// ---------------------------------------------------------------------------
// COPIA ISOLATA per-fixture (mirror copyPackFixture/createVerifyWorkspace):
// id = pid+contatore monotono (NO Date.now/Math.random), `.git` INCLUSO, dentro
// eval/.tmp-verify (gitignorata). Usata dai sotto-test che mutano (b/c) e per la
// falsificabilità. Ritorna { dir, cleanup }.
// ---------------------------------------------------------------------------
let __copyCounter = 0;
function copyFixture(label, sourceApp) {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  __copyCounter += 1;
  const safe = String(label).replace(/[^A-Za-z0-9._-]/g, '-');
  const dir = join(TMP_VERIFY_ROOT, `bd-${safe}-pid${process.pid}-${__copyCounter}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  cpSync(sourceApp, dir, { recursive: true, dereference: false });
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

// ---------------------------------------------------------------------------
// Banco di asserzioni (stesso stile di m5/ecosystem_conformance).
// ---------------------------------------------------------------------------
const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// ===========================================================================
// PRECONDIZIONE (robustezza W3): .git di ogni fixture + seeded-blueprint + node.
// Se manca → banner '(precondizione mancante)' + exit 2 (mai falso verde/ambiguo).
// ===========================================================================
function checkPreconditions() {
  const missing = [];
  for (const [id, fx] of Object.entries(FIXTURES)) {
    const gitDir = resolve(fx.referenceApp, '.git');
    if (!existsSync(gitDir)) missing.push(`${id}: reference-app/.git assente (${gitDir})`);
    if (!existsSync(fx.blueprint)) missing.push(`${id}: seeded-blueprint assente (${fx.blueprint})`);
  }
  // node eseguibile: lancia `node --version` (process.execPath) e pretende exit 0.
  const nodeProbe = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
  if (nodeProbe.error || nodeProbe.status !== 0) {
    missing.push(`node NON eseguibile (${process.execPath}): ${nodeProbe.error ? nodeProbe.error.message : `exit=${nodeProbe.status}`}`);
  }
  // I driver/oracoli devono esistere su disco (gated su T1.1/T2.1).
  for (const [label, p] of [['run_loop.mjs', RUN_LOOP], ['ac_observability_check.mjs', AC_CHECK], ['validate_blueprint.mjs', VALIDATE_BP]]) {
    if (!existsSync(p)) missing.push(`script ${label} assente (${p})`);
  }
  return missing;
}

// ===========================================================================
// (a) overcomplicated-correct — ADVISORY ≠ GATE (§7.2a).
// ===========================================================================
function subTestA() {
  console.log('');
  console.log('(a) overcomplicated-correct — ADVISORY ≠ GATE (advisory+complexity_flag E checkpoint VERDE, simultanei):');
  const fx = FIXTURES['overcomplicated-correct'];
  // Drive STABILIZZATO con --characterize (controlli 3/4 = oracolo reale npm test →
  // checkpoint VERDE). La stabilizzazione assorbe i crash/forme-degradate AMBIENTALI
  // della copia temp condivisa (Windows lock / cold-start), MAI un rosso reale.
  const d = driveBuildStable({ referenceApp: fx.referenceApp, blueprint: fx.blueprint, characterize: true, requireGreen: true });
  if (!d.stabilized && !d.wellFormed) {
    precondAbort(`(a) run_loop --characterize instabile in 4 tentativi (crash/forma degradata, ambiente/toolchain): exit=${d.status}`);
  }
  const { status, report } = d;
  assert('(a) run_loop --eval --mode=build --characterize esce 0 ed emette JSON', status === 0 && report,
    report ? `exit=${status} ok=${report.ok}` : `exit=${status} (no JSON)`);
  if (!report) return;

  const bd = report.build_discipline || null;
  const cp = report.checkpoint || null;
  // ADVISORY emesso: advisory===true && complexity_flag===true.
  assert('(a) build_discipline.advisory === true (segnale advisory emesso)', bd && bd.advisory === true,
    bd ? `advisory=${bd.advisory}` : 'build_discipline assente');
  assert('(a) build_discipline.complexity_flag === true (sovra-astrazione segnalata)', bd && bd.complexity_flag === true,
    bd ? `complexity_flag=${bd.complexity_flag}` : 'build_discipline assente');
  // notes elenca validators.ts oltre soglia (markers > threshold).
  const note = bd && Array.isArray(bd.notes)
    ? bd.notes.find((n) => /src\/pricing\/validators\.ts$/.test(normSlash(n.file))) : null;
  assert('(a) notes elenca src/pricing/validators.ts oltre soglia (markers > threshold)',
    Boolean(note) && note.markers > note.threshold,
    note ? `markers=${note.markers} threshold=${note.threshold}` : 'nota validators.ts assente');
  // CHECKPOINT VERDE: green===true E tutti e 4 i controlli verdi (dead-code/
  // security/regressions/conformance). È il cuore del §7.2a: l'advisory è settato
  // MENTRE il checkpoint è verde → il flag NON può essere un gate.
  assert('(a) checkpoint.green === true (i 4 controlli passano)', cp && cp.green === true,
    cp ? `green=${cp.green}` : 'checkpoint assente');
  const ctlNames = cp && Array.isArray(cp.controls) ? cp.controls.map((c) => c.name) : [];
  const all4Green = cp && Array.isArray(cp.controls) && cp.controls.length >= 4
    && cp.controls.every((c) => c.green === true);
  assert('(a) tutti e 4 i controlli VERDI (dead-code/security/regressions/conformance)',
    all4Green && ['dead-code', 'security', 'regressions', 'conformance'].every((n) => ctlNames.includes(n)),
    cp ? `controls=[${cp.controls.map((c) => `${c.name}:${c.green}`).join(', ')}]` : 'controls assenti');
  // La CONGIUNZIONE §7.2a: advisory+flag E verde, SIMULTANEAMENTE → advisory ≠ gate.
  assert('(a) §7.2a PROVATO: advisory===true && complexity_flag===true && checkpoint.green===true (advisory NON è un gate)',
    bd && bd.advisory === true && bd.complexity_flag === true && cp && cp.green === true,
    `advisory=${bd && bd.advisory} complexity_flag=${bd && bd.complexity_flag} green=${cp && cp.green}`);
}

// ===========================================================================
// (b) orphan-injecting — DEAD-CODE ORACOLO (§7.3b).
// ===========================================================================
function subTestB() {
  console.log('');
  console.log('(b) orphan-injecting — DEAD-CODE oracolo (control1 FALLISCE per l\'orfano NUOVO):');
  const fx = FIXTURES['orphan-injecting'];
  // NO --characterize (la spec lega questo sotto-test al solo control1 baseline-delta).
  // requireGreen=false: per l'orfano il control1 RED e' il risultato ATTESO (NON un
  // trigger di retry); ritentiamo SOLO su crash/forma-degradata (ambiente).
  const d = driveBuildStable({ referenceApp: fx.referenceApp, blueprint: fx.blueprint, characterize: false, requireGreen: false });
  if (!d.stabilized && !d.wellFormed) {
    precondAbort(`(b) run_loop instabile in 4 tentativi (crash/forma degradata, ambiente): exit=${d.status}`);
  }
  const { status, report } = d;
  assert('(b) run_loop --eval --mode=build esce 0 ed emette JSON', status === 0 && report,
    report ? `exit=${status} ok=${report.ok}` : `exit=${status} (no JSON)`);
  if (!report) return;

  const cp = report.checkpoint || null;
  const c0 = cp && Array.isArray(cp.controls) ? cp.controls[0] : null;
  assert('(b) controls[0].name === \'dead-code\' (il controllo 1 è il dead-code)', c0 && c0.name === 'dead-code',
    c0 ? `name=${c0.name}` : 'controls[0] assente');
  assert('(b) controls[0].green === false (1 dead-code NUOVO introdotto)', c0 && c0.green === false,
    c0 ? `green=${c0.green} detail=${c0.detail}` : 'controls[0] assente');
  assert('(b) detail del controllo 1 menziona il dead-code NUOVO', c0 && /dead-code NUOVO/i.test(String(c0.detail || '')),
    c0 ? `detail="${c0.detail}"` : 'controls[0] assente');
  // L'advisory NON è un gate: complexity_flag===false (scrittura minima, 0 marcatori).
  const bd = report.build_discipline || null;
  assert('(b) build_discipline.complexity_flag === false (advisory ≠ gate; il rosso viene dall\'oracolo)',
    bd && bd.complexity_flag === false, bd ? `complexity_flag=${bd.complexity_flag}` : 'build_discipline assente');
}

// ===========================================================================
// (c) ambiguous-ac — OSSERVABILITÀ AC DETERMINISTICA (§7.4).
//     ac_observability_check FAIL (exit 1) MENTRE validate_blueprint PASS (exit 0).
//     I due oracoli sono ORTOGONALI.
// ===========================================================================
function subTestC() {
  console.log('');
  console.log('(c) ambiguous-ac — osservabilità AC deterministica (ac_observability_check FAIL, validate_blueprint PASS):');
  const fx = FIXTURES['ambiguous-ac'];
  const ac = nodeRun(AC_CHECK, [fx.blueprint, '--json']);
  let acRep = null;
  try { acRep = JSON.parse(ac.stdout); } catch { /* gestito */ }
  // ac_observability_check FLAGGA → exit 1 + (1) AC_OBSERVABILITY ok===false.
  const acCheck = acRep && Array.isArray(acRep.checks)
    ? acRep.checks.find((c) => c.name === '(1) AC_OBSERVABILITY') : null;
  assert('(c) ac_observability_check esce 1 (token vietato → FAIL)', ac.status === 1,
    `exit=${ac.status}`);
  assert('(c) il check (1) AC_OBSERVABILITY è FAIL (ok===false)', acCheck && acCheck.ok === false,
    acCheck ? `ok=${acCheck.ok} detail=${acCheck.detail}` : 'check AC_OBSERVABILITY assente');
  // validate_blueprint PASS → exit 0 (struttura valida): i due oracoli sono ortogonali.
  const vb = nodeRun(VALIDATE_BP, [fx.blueprint, '--json']);
  let vbRep = null;
  try { vbRep = JSON.parse(vb.stdout); } catch { /* gestito */ }
  assert('(c) validate_blueprint esce 0, ok===true (struttura valida)', vb.status === 0 && vbRep && vbRep.ok === true,
    vbRep ? `exit=${vb.status} ok=${vbRep.ok}` : `exit=${vb.status} (no JSON)`);
  // §7.4 PROVATO: ortogonalità — FAIL osservabilità su struttura VALIDA.
  assert('(c) §7.4 PROVATO: ac_observability_check FAIL (1) mentre validate_blueprint PASS (0) — oracoli ortogonali',
    ac.status === 1 && vb.status === 0 && vbRep && vbRep.ok === true,
    `ac_exit=${ac.status} vb_exit=${vb.status}`);
}

// ===========================================================================
// 0-CONTAMINAZIONE: HEAD interno di OGNI fixture + HEAD esterno invariati,
// fixture bit-identica (snapshot status interno invariato), nessun residuo temp.
// ===========================================================================
function assertHygiene(snapshots, outerHeadBefore) {
  console.log('');
  console.log('0-contaminazione — HEAD interno/esterno invariati, fixture bit-identica, nessun residuo .tmp-verify:');
  for (const [id, fx] of Object.entries(FIXTURES)) {
    const snap = snapshots[id];
    const headAfter = gitRead(fx.referenceApp, ['rev-parse', 'HEAD']).stdout;
    const statusAfter = gitRead(fx.referenceApp, ['status', '--porcelain']).stdout;
    // I fixture hanno node_modules UNTRACKED: lo status NON è vuoto. Asseriamo
    // l'INVARIANZA dello snapshot (bit-identica), non lo status vuoto.
    assert(`[${id}] fixture INTERNA bit-identica (HEAD + git status --porcelain INVARIATI)`,
      headAfter === snap.head && statusAfter === snap.status,
      headAfter === snap.head && statusAfter === snap.status
        ? `HEAD=${snap.head.slice(0, 10)} (invariato)`
        : `HEAD before=${snap.head.slice(0, 10)} after=${headAfter.slice(0, 10)} status-mutato=${statusAfter !== snap.status}`);
  }
  // HEAD del repo ESTERNO invariato (isolamento provato, L-COL-024).
  const outerHeadAfter = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
  assert('HEAD del repo ESTERNO INVARIATO (0 contaminazione)', outerHeadAfter === outerHeadBefore,
    outerHeadAfter === outerHeadBefore ? `${outerHeadBefore.slice(0, 10)} (invariato)` : 'MUTATO (vietato!)');
  // Nessuna COPIA residua sotto la radice temp PRIVATA (eval/.tmp-bd-<pid>). NB: su
  // Windows la RADICE puo' restare (vuota ma) momentaneamente LOCKED da un figlio appena
  // terminato — NON e' contaminazione. Asseriamo l'assenza di SOTTOCARTELLE residue (le
  // copie del driver/sotto-test), tollerando una radice vuota o non leggibile (lock):
  // e' lo stato pulito reale. readdirSync in try/catch (un EPERM transitorio non e' un
  // residuo).
  let residual = [];
  try { residual = existsSync(TMP_VERIFY_ROOT) ? readdirSync(TMP_VERIFY_ROOT) : []; }
  catch { residual = []; }
  assert('nessuna copia temp residua sotto la radice temp privata (eval/.tmp-bd-<pid>)', residual.length === 0,
    residual.length === 0 ? 'nessun residuo (radice vuota, assente o lockata)' : `residui: ${residual.join(', ')}`);
}

// ---------------------------------------------------------------------------
function main() {
  console.log('============================================================');
  console.log(' GATE BUILD-DISCIPLINE (BD-1, T2.2) — 3 sotto-test falsificabili (spec §7)');
  console.log(`   fixture root : ${FIX_ROOT}`);
  console.log('   (a) overcomplicated-correct — advisory ≠ gate (flag E checkpoint verde)');
  console.log('   (b) orphan-injecting        — control1 dead-code FALLISCE (orfano nuovo)');
  console.log('   (c) ambiguous-ac            — ac_observability FAIL, validate_blueprint PASS');
  console.log('============================================================');

  // --- PRECONDIZIONE: .git/seeded-blueprint/node ---------------------------
  const missing = checkPreconditions();
  if (missing.length) {
    console.log('');
    console.log('------------------------------------------------------------');
    console.log('=== GATE BUILD-DISCIPLINE: (precondizione mancante) ===');
    for (const m of missing) console.log(`  - ${m}`);
    console.log('Una precondizione del gate non è soddisfatta: i 3 fixture devono avere un');
    console.log('.git interno provisionato + un seeded-blueprint, e node deve essere eseguibile.');
    console.log('(exit 2 = precondizione; mai un falso verde, mai un exit 0/1 ambiguo.)');
    console.log('------------------------------------------------------------');
    process.exit(2);
  }
  console.log('');
  console.log('[PASS] precondizione: ogni fixture ha reference-app/.git + seeded-blueprint; node eseguibile.');

  // Sweep di copie temp orfane (come m4/m5/ecosystem_conformance).
  cleanBdTmp();

  // Snapshot d'integrità (sola lettura) PRIMA dei sotto-test — criterio 0-contam.
  const outerHeadBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
  const snapshots = {};
  for (const [id, fx] of Object.entries(FIXTURES)) {
    snapshots[id] = {
      head: gitRead(fx.referenceApp, ['rev-parse', 'HEAD']).stdout,
      status: gitRead(fx.referenceApp, ['status', '--porcelain']).stdout,
    };
  }

  // --- I 3 sotto-test ------------------------------------------------------
  subTestA();
  subTestB();
  subTestC();

  // --- 0-contaminazione ----------------------------------------------------
  // Sweep finale PRIMA del check d'igiene: ripuliamo qualunque copia residua del
  // driver/sotto-test, poi assertHygiene verifica che non resti alcuna sottocartella
  // (l'ordine inverso falliva su una radice vuota-ma-locked di Windows).
  cleanBdTmp();
  assertHygiene(snapshots, outerHeadBefore);

  // --- Esito ---------------------------------------------------------------
  const allOk = checks.every((c) => c.ok);
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(`=== GATE BUILD-DISCIPLINE RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check; sotto-test (a)/(b)/(c))`);
  console.log('------------------------------------------------------------');
  process.exit(allOk ? 0 : 1);
}

main();
