#!/usr/bin/env node
// m1_gate_check.mjs — GATE M1 (checkpoint + verify-fix loop).
//
// Asserisce, in modo DETERMINISTICO (L-COL-002: verde = output reale di comando,
// mai una frase), i criteri di M1 (10 §3 criterio 2 + 10 §4 criterio 7):
//
//   A) SET IN-SCOPE verificato-a-zero -> fix_state = verified:
//        S1 (secret working-tree), S3/S4/S5 (rls), S8 (dead-code).
//   B) S2 (secret-in-history) -> fix_state ESATTAMENTE mitigated-residual,
//        MAI verified (rotazione simulata; history rewrite distruttiva = no auto).
//   C) GIT A STRATI esercitato:
//        - BUILD verde + non-coupled            -> merge autonomo
//        - BUILD verde + coupled / unknown      -> merge SOSPESO (human-gated)
//        - REMEDIATE                            -> merge human-gated
//        - operazione distruttiva               -> bloccata in autonomia
//   D) CHECKPOINT: controlli 1-2 verdi (delta), 3-4 DEGRADATI (M3, non falso verde).
//   E) INTEGRITA FIXTURE: dopo il loop, eval/reference-app e' INTATTO ->
//        i gate M0 (detection + present) escono ancora 0; nessuna copia temp
//        lasciata da QUESTO run sotto la radice temp PRIVATA per-pid, e il
//        run_loop figlio ha lavorato SOTTO quella radice (env ereditata).
//
// Esce 0 se TUTTI i criteri passano, 1 altrimenti.
//
// Node ESM, solo built-in + l'orchestratore del loop.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const RUN_LOOP = resolve(ROOT, 'trueline', 'scripts', 'loop', 'run_loop.mjs');
const RUN_EVAL = resolve(ROOT, 'eval', 'harness', 'run_eval.mjs');
// Radice temp PRIVATA per-invocazione (pattern BD-1, build_discipline_check r.83-90):
// elimina la CONTESA sulla radice CONDIVISA eval/.tmp-verify, la cui pulizia GLOBALE
// rade al suolo anche le copie VIVE di un altro processo (i falsi rossi storici su
// Windows). Forma "env se presente, altrimenti privata per-pid": i FIGLI (run_loop,
// gate ri-eseguiti) EREDITANO la radice del padre via env — sono lo STESSO run logico
// — mentre due run indipendenti hanno radici DIVERSE. Coperta da .gitignore "eval/.tmp-*/".
//
// PROPRIETA' della radice: e' NOSTRA solo se l'abbiamo creata noi (env ASSENTE
// all'avvio). Se l'abbiamo EREDITATA siamo un FIGLIO (es. m1 ri-eseguito da m4/m5) e
// sotto quella radice vivono le copie e i file del PADRE: raderla e' esattamente
// l'operazione che il pattern per-pid vuole eliminare (distrugge il lavoro E le prove
// d'igiene altrui). Il non-proprietario non spazza MAI la radice: rimuove solo cio'
// che ha creato lui.
const TMP_ROOT_INHERITED = Boolean(process.env.TRUELINE_TMP_VERIFY_ROOT);
const TMP_VERIFY_ROOT = TMP_ROOT_INHERITED
  ? resolve(process.env.TRUELINE_TMP_VERIFY_ROOT)
  : resolve(ROOT, 'eval', `.tmp-m1-${process.pid}`);
process.env.TRUELINE_TMP_VERIFY_ROOT = TMP_VERIFY_ROOT;
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

function nodeRun(script, args) {
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}`,
    TRUELINE_TMP_VERIFY_ROOT: TMP_VERIFY_ROOT,
  };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

// Backoff BLOCCANTE deterministico (niente setTimeout/Date.now/Math.random): assorbe
// un lock transitorio di Windows tra i tentativi senza introdurre non-determinismo.
function settleDeterministic(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { /* Atomics non disponibile: prosegui senza attesa */ }
}

// Pulizia ROBUSTA della SOLA radice temp PRIVATA (stessa forma di cleanBdTmp). NON
// lancia MAI: un lock transitorio di Windows su un file appena scritto/rimosso NON
// deve trasformarsi in un falso rosso exit-1. Sostituisce il cleanup GLOBALE della
// radice condivisa, che cancellava anche le copie vive di altri processi.
// SOLO IL PROPRIETARIO SPAZZA: se la radice e' EREDITATA appartiene al padre (le sue
// copie sono VIVE li' sotto mentre noi giriamo).
function cleanM1Tmp() {
  if (TMP_ROOT_INHERITED) return;
  for (let i = 0; i < 6; i += 1) {
    try {
      if (!existsSync(TMP_VERIFY_ROOT)) return;
      rmSync(TMP_VERIFY_ROOT, { recursive: true, force: true, maxRetries: 4, retryDelay: 60 });
      if (!existsSync(TMP_VERIFY_ROOT)) return;
    } catch { /* lock transitorio: ritenta col backoff sotto */ }
    if (i < 5) settleDeterministic(80 * (i + 1));
  }
  /* esaurito: NON lanciamo. L'igiene tollera una radice vuota-ma-locked. */
}

// Voci presenti sotto la radice PRIVATA. Su Windows la RADICE puo' restare (vuota ma)
// momentaneamente LOCKED da un figlio appena terminato: NON e' un residuo, ma NON e'
// nemmeno "pulito PROVATO". `null` = radice presente e NON leggibile (stato IGNOTO):
// ritornare [] farebbe puntare al verde ANCHE la via d'uscita dell'eccezione (L-COL-006).
// (Nel NUOVO ordine la lettura NON e' preceduta da alcun rm della radice: lo stato
// 'delete pending' di Windows che motivava la tolleranza non si presenta piu'.)
function tmpEntries() {
  if (!existsSync(TMP_VERIFY_ROOT)) return [];
  try { return readdirSync(TMP_VERIFY_ROOT); }
  catch { return null; }
}

// SWEEP DEGLI ORFANI ALL'AVVIO (solo se la radice e' NOSTRA: un run precedente con lo
// stesso pid, killato a meta', puo' averci lasciato una copia) + FOTOGRAFIA di cio' che
// c'era GIA'. Il residuo che asseriremo e' il DELTA rispetto a questa fotografia: cosi'
// l'igiene e' IMPUTABILE a questo run (un orfano di un terzo o le copie VIVE del padre,
// su una radice EREDITATA, non ci appartengono) senza dover spazzare la radice PRIMA di
// guardarla — lo sweep che precede l'asserzione ne distruggerebbe la prova.
cleanM1Tmp();
const TMP_AT_START = new Set(tmpEntries() || []);

// Residuo IMPUTABILE A QUESTO RUN: le voci comparse DOPO l'avvio e sopravvissute.
function residualTmp() {
  const now = tmpEntries();
  if (now === null) return ['<radice presente ma NON leggibile: igiene non provata>'];
  return now.filter((e) => !TMP_AT_START.has(e));
}

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// baseName robusto (i path della copia temp possono variare per scope).
const bn = (p) => String(p).replace(/\\/g, '/').split('/').pop();

console.log('============================================================');
console.log(' GATE M1 — checkpoint + verify-fix loop');
console.log(`   reference-app : ${resolve(ROOT, 'eval', 'reference-app')}`);
console.log('   set in-scope  : S1,S3,S4,S5,S8 -> verified; S2 -> mitigated-residual');
console.log('============================================================');
console.log('');

// --- Esegui il loop in EVAL-MODE su una COPIA TEMP ---------------------------
console.log('1) Esecuzione loop (--eval --mode=remediate) su copia temporanea:');
const loop = nodeRun(RUN_LOOP, ['--eval', '--mode=remediate']);
let report = null;
try { report = JSON.parse(loop.stdout); } catch { /* gestito sotto */ }
assert('run_loop esce 0 ed emette JSON', loop.status === 0 && report, `exit=${loop.status}`);

if (!report) {
  console.log('\nRESULT: FAIL — il loop non ha prodotto un report parsabile');
  console.log((loop.stderr || loop.stdout || '').split('\n').slice(-5).join('\n'));
  process.exit(1);
}

const F = report.findings || [];
// Helper: trova un finding per categoria + predicato sul file.
const find = (cat, fileBn, scope) => F.find((f) =>
  f.category === cat
  && bn(f.location.file) === fileBn
  && (scope ? true : true));

// --- A) SET IN-SCOPE -> verified ---------------------------------------------
console.log('');
console.log('2) Set in-scope verificato-a-zero -> fix_state=verified:');

// S1: secret working-tree su config.ts. (Possono esserci 2 regole sullo stesso
// literal: tutte le occorrenze su config.ts devono essere verified.)
const s1 = F.filter((f) => f.category === 'secret' && bn(f.location.file) === 'config.ts');
assert('S1 secret (config.ts) -> verified',
  s1.length > 0 && s1.every((f) => f.fix_state === 'verified'),
  `${s1.length} finding, stati=[${s1.map((f) => f.fix_state).join(',')}]`);

// S3/S4/S5: rls.
const rlsByRule = (rule) => F.find((f) => f.category === 'rls' && f.rule_id === rule);
for (const [label, rule] of [
  ['S3', 'RLS001_MISSING_RLS'],
  ['S4', 'RLS003_PERMISSIVE_TRUE'],
  ['S5', 'RLS004_MISSING_TENANT_PREDICATE'],
]) {
  const f = rlsByRule(rule);
  assert(`${label} rls (${rule}) -> verified`, f && f.fix_state === 'verified',
    f ? `fix_state=${f.fix_state}` : 'finding assente');
}

// S8: dead-code su unused.ts.
const s8 = find('dead-code', 'unused.ts');
assert('S8 dead-code (unused.ts) -> verified', s8 && s8.fix_state === 'verified',
  s8 ? `fix_state=${s8.fix_state}` : 'finding assente');

// --- B) S2 -> ESATTAMENTE mitigated-residual, MAI verified -------------------
console.log('');
console.log('3) S2 secret-in-history -> ESATTAMENTE mitigated-residual (MAI verified):');
const s2 = F.filter((f) => f.category === 'secret' && bn(f.location.file) === 'credentials.ts');
assert('S2 secret (credentials.ts) presente', s2.length > 0, `${s2.length} finding`);
assert('S2 -> tutti mitigated-residual', s2.length > 0 && s2.every((f) => f.fix_state === 'mitigated-residual'),
  `stati=[${s2.map((f) => f.fix_state).join(',')}]`);
assert('S2 -> NESSUNO verified (asserzione dura 05 §7)',
  s2.every((f) => f.fix_state !== 'verified'), 'nessun finding S2 e\' verified');

// --- C) GIT A STRATI ---------------------------------------------------------
console.log('');
console.log('4) Git a strati esercitato:');
const m = (report.git && report.git.merge) || {};
assert('BUILD verde + non-coupled -> merge AUTONOMO',
  m.build_noncoupled && m.build_noncoupled.autonomous_merge_allowed === true,
  m.build_noncoupled && m.build_noncoupled.gate);
assert('BUILD verde + coupled -> merge SOSPESO (human-gated)',
  m.build_coupled && m.build_coupled.autonomous_merge_allowed === false,
  m.build_coupled && m.build_coupled.gate);
assert('BUILD verde + unknown non confermato -> SOSPESO (fail-safe)',
  m.build_unknown_unconfirmed && m.build_unknown_unconfirmed.autonomous_merge_allowed === false,
  m.build_unknown_unconfirmed && m.build_unknown_unconfirmed.gate);
assert('REMEDIATE -> merge human-gated',
  m.remediate && m.remediate.autonomous_merge_allowed === false,
  m.remediate && m.remediate.gate);
const dst = report.git && report.git.destructive;
assert('Operazione distruttiva -> bloccata in autonomia',
  dst && dst.allowed === false && dst.requires_human_gate === true, dst && dst.op);

// --- D) CHECKPOINT (controlli 1-2 verdi, 3-4 degradati onesti) ---------------
console.log('');
console.log('5) Checkpoint (1-2 verdi via delta; 3-4 DEGRADATI = M3, non falso verde):');
const cp = report.checkpoint || { controls: [] };
const ctl = (id) => (cp.controls || []).find((c) => c.id === id) || {};
assert('Controllo 1 (dead-code) VERDE', ctl(1).green === true, ctl(1).detail);
assert('Controllo 2 (sicurezza) VERDE', ctl(2).green === true, ctl(2).detail);
assert('Controllo 3 (regressioni) DEGRADATO (M3, NON verde)',
  ctl(3).status === 'degraded' && ctl(3).green === false, ctl(3).detail);
assert('Controllo 4 (conformita) DEGRADATO (M3, NON verde)',
  ctl(4).status === 'degraded' && ctl(4).green === false, ctl(4).detail);

// --- E) INTEGRITA DEL FIXTURE ------------------------------------------------
console.log('');
console.log('6) Integrita del fixture canonico (eval/reference-app intatto):');
// Igiene, MISURATA PRIMA DI SPAZZARE: uno sweep immediatamente prima dell'asserzione
// ne distruggerebbe la prova (il controllo non potrebbe piu' fallire). Si asserisce
//   (a) nessuna copia temp lasciata da QUESTO run sotto la radice PRIVATA, e
//   (b) il run_loop FIGLIO ha lavorato SOTTO la NOSTRA radice: prova DIRETTA che l'env
//       TRUELINE_TMP_VERIFY_ROOT e' stata ereditata, attribuibile a questo run.
// NB: NON si osserva l'esistenza di eval/.tmp-verify. E' stato GLOBALE di terzi — un
// orfano altrui renderebbe questo gate ROSSO in permanenza (vietato: h1_perpid_check
// r.743-747) — ed e' per giunta CIECO, perche' verify_workspace POTA la radice appena
// si svuota: un figlio ricaduto sulla CONDIVISA la creerebbe, ci lavorerebbe e la
// rimuoverebbe, lasciando la sonda verde.
const m1Residual = residualTmp();
const posixLower = (p) => String(p).replace(/\\/g, '/').toLowerCase();
const loopWs = String(report.workspace || '');
const loopWsPrivate = loopWs !== '' && posixLower(loopWs).startsWith(`${posixLower(TMP_VERIFY_ROOT)}/`);
assert('Nessuna copia temp residua di QUESTO run sotto la radice PRIVATA (eval/.tmp-m1-<pid>) e run_loop FIGLIO sulla NOSTRA radice',
  m1Residual.length === 0 && loopWsPrivate,
  `residui=[${m1Residual.join(', ')}] preesistenti=${TMP_AT_START.size} workspace-figlio=${loopWs || 'assente'} sotto-radice-privata=${loopWsPrivate}`);
// Sweep DOPO la misura (e solo se la radice e' NOSTRA).
cleanM1Tmp();

const det = nodeRun(RUN_EVAL, ['--mode=detection']);
assert('Gate M0 detection ancora EXIT 0 (fixture intatto)', det.status === 0, `exit=${det.status}`);
const pres = nodeRun(RUN_EVAL, ['--mode=present']);
assert('Gate M0 present ancora EXIT 0 (fixture intatto)', pres.status === 0, `exit=${pres.status}`);

// --- Esito ------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE M1 RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
