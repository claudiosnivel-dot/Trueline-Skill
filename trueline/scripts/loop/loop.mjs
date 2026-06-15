// loop.mjs — la MACCHINA del verify-fix loop (05 §3-§4). Il CUORE di Trueline.
//
// Per ogni finding fixabile, in ordine:
//   PROPONI -> [GATE UMANO] -> APPLICA (commit isolato sul branch della COPIA,
//   additivo/reversibile) -> RIESEGUI LO STESSO ORACOLO (stesso rule_id) +
//   RIESEGUI i test -> se pulito+verde: fix_state=verified (SOLO l'oracolo
//   promuove, L-COL-002); se flagga ancora o test rotto: verification-failed ->
//   RETRY entro O-COL-006 (cap 2 retry = 3 tentativi; REVERT la patch prima del
//   retry; patch MATERIALMENTE diversa, rifiuta ri-sottomissione byte-identica)
//   -> esauriti: terminale all'umano (accepted-risk/fix manuale/rinvio), MAI
//   scarto silenzioso, MAI verified.
//
// HUMAN-GATE: nella skill reale ogni applicazione e' human-gated (L-COL-005,
// L-COL-021 dead-code mai automatico). In EVAL-MODE (--eval) il gate e'
// auto-approvato in modo DETERMINISTICO (solo-eval). Il loop accetta un FIX
// PROVIDER iniettabile: skill reale = LLM propone; eval = tabella deterministica.
//
// *** INTEGRITA DEL FIXTURE ***: il loop opera SOLO su una COPIA TEMPORANEA
// (verify_workspace). Il fixture canonico NON viene mai mutato.
//
// CASO SPECIALE S2 (secret-in-history, 05 §7): la rotazione e' fuori dal codice
// e la riscrittura di history e' distruttiva (mai autonoma) -> stato terminale
// = mitigated-residual, MAI verified.
//
// Node ESM, solo built-in + oracoli M0 + checkpoint + git a strati.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize } from '../findings/normalize.mjs';
import { validateMany } from '../findings/validate_finding.mjs';
import { LOOP_BUDGET } from '../checkpoint/thresholds.mjs';
import { commitOnBranch, revertToRef, headSha } from '../git/layered_git.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORACLES = resolve(__dirname, '..', 'oracles');
const RUN_GITLEAKS = resolve(ORACLES, 'run_gitleaks.mjs');
const RLS_CHECK = resolve(ORACLES, 'rls_check.mjs');
const RUN_DEADCODE = resolve(ORACLES, 'run_deadcode.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

// --- Re-run dell'oracolo per-categoria (stesso oracolo, stesso rule_id) ------
//
// Riesegue, sulla COPIA, lo STESSO oracolo che ha prodotto il finding e ritorna
// i finding normalizzati. La verifica per-finding (05 §6) cerca se il finding
// (per fingerprint) e' ancora presente.
function rerunOracleFor(finding, dir, runOpts) {
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const run = (script, args, cwd = dir) => {
    const res = spawnSync(process.execPath, [script, ...args], {
      cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error) return { ok: false, json: null, detail: `spawn: ${res.error.message}` };
    const raw = (res.stdout || '').trim();
    if (!raw) return { ok: false, json: null, detail: `nessun JSON (exit=${res.status})` };
    try { return { ok: true, json: JSON.parse(raw) }; }
    catch (e) { return { ok: false, json: null, detail: `JSON invalido: ${e.message}` }; }
  };

  let oracle; let res; let scope;
  switch (finding.category) {
    case 'secret':
      oracle = 'gitleaks';
      // scope: working-tree per S1; history per S2 (file solo in history).
      scope = /legacy\/credentials\.ts$/.test(finding.location.file) ? 'history' : 'working-tree';
      res = run(RUN_GITLEAKS, [dir, scope]);
      break;
    case 'rls':
      oracle = 'rls-check'; scope = 'static-ddl';
      res = run(RLS_CHECK, [resolve(dir, 'supabase', 'migrations')]);
      break;
    case 'dead-code':
      oracle = 'knip'; scope = 'working-tree';
      res = run(RUN_DEADCODE, [dir]);
      break;
    default:
      return { ok: false, findings: [], detail: `categoria non rieseguibile: ${finding.category}` };
  }
  if (!res.ok) return { ok: false, findings: [], detail: res.detail };
  let findings;
  try { findings = normalize(oracle, res.json, { ...runOpts, scope }); }
  catch (e) { return { ok: false, findings: [], detail: `normalize: ${e.message}` }; }
  const v = validateMany(findings);
  if (!v.ok) return { ok: false, findings, detail: `schema KO: ${v.errors[0]}` };
  return { ok: true, findings, detail: `${findings.length} finding`, scope };
}

// Il finding e' ancora presente? Match per fingerprint (identita stabile, 04 §6).
function stillPresent(finding, findings) {
  return findings.some((f) => f.fingerprint === finding.fingerprint);
}

// --- Esegue i test pertinenti sulla copia (se esiste un runner) --------------
function runTests(dir) {
  const pkgPath = resolve(dir, 'package.json');
  if (!existsSync(pkgPath)) return { ran: false, green: true, detail: 'nessun package.json' };
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { return { ran: false, green: true, detail: 'package.json illeggibile' }; }
  const t = pkg.scripts && pkg.scripts.test;
  if (!t || /no test specified/i.test(t)) {
    // FORWARD-DEP M3: senza characterization test (06) la parte "RIESEGUI i
    // test" del loop e' DEGRADATA, non un falso verde. Non blocca la
    // promozione dell'oracolo, ma il checkpoint resta degradato sui controlli
    // 3/4 (vedi checkpoint.mjs). // TODO M3.
    return { ran: false, green: true, degraded: true, detail: 'nessun test runner: parte test DEGRADATA (M3)' };
  }
  const res = spawnSync('npm', ['run', 'test', '--silent'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: true,
  });
  const green = !res.error && res.status === 0;
  return { ran: true, green, detail: green ? 'test verdi' : `test rossi (exit=${res.status})` };
}

// =============================================================================
// LOOP per-finding (05 §3). Ritorna il record di esito del finding.
// =============================================================================
//
// finding   il finding triaged da correggere (gia' normalizzato, 04).
// ctx       { dir, runOpts, fixProvider, evalMode, gate, budget }
//   dir         directory della COPIA TEMPORANEA (mai il fixture canonico)
//   fixProvider provider iniettabile: propose(finding, attempt, lastReason)
//   evalMode    true => gate auto-approvato deterministicamente (solo-eval)
//   gate        funzione di gate umano (default: rifiuta se !evalMode)
//   budget      stato condiviso del budget globale { startedAt, deadlineMs }
//
// Esiti di fix_state possibili (04 §5):
//   verified              oracolo riesieguito pulito + test verdi/degradati
//   mitigated-residual    SOLO secret-in-history (rotazione, no rewrite) — terminale
//   verification-failed   terminale all'umano dopo budget/tentativi esauriti
export function runFindingLoop(finding, ctx) {
  const {
    dir, fixProvider, evalMode = false, runOpts = { runId: 'loop', createdAt: '1970-01-01T00:00:00.000Z' },
    gate = defaultGate(evalMode), budget,
  } = ctx;

  const triage = { ...finding, fix_state: 'triaged' };
  const attempts = [];
  const seenSignatures = new Set(); // rifiuta ri-sottomissione byte-identica (05 §3)
  let lastFailureReason = null;

  // PRE-CHECK (05 §6, autorita' = oracolo): un finding puo' essere gia' stato
  // azzerato da una fix SORELLA dello stesso round (es. due regole gitleaks
  // sullo STESSO literal di config.ts: la fix di S1 ne cancella entrambe).
  // Riesegui lo stesso oracolo: se il finding e' GIA' assente, e' verified per
  // fatto dell'oracolo, senza ri-applicare nulla (L-COL-002). NON si applica al
  // caso history (S2): la history non si "pulisce" senza riscrittura distruttiva.
  if (triage.category !== 'secret' || !/legacy\/credentials\.ts$/.test(triage.location.file)) {
    const pre = rerunOracleFor(triage, dir, runOpts);
    if (pre.ok && !stillPresent(triage, pre.findings)) {
      const tests = runTests(dir);
      if (tests.green) {
        return terminal('verified', triage, attempts,
          `gia' azzerato da una fix sorella; oracolo riesieguito pulito + test ${tests.detail}`,
          { verified: true, resolvedBySibling: true });
      }
    }
  }

  const maxAttempts = LOOP_BUDGET.MAX_RETRIES_PER_FINDING + 1; // proposta + retry

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Budget globale (05 §4): se il tempo di parete e' esaurito -> terminale.
    if (budget && Date.now() > budget.deadlineMs) {
      return terminal('verification-failed', triage, attempts,
        'budget globale (tempo di parete) esaurito prima del tentativo', { budgetExhausted: true });
    }

    // PROPONI (fix-proposed).
    const patch = fixProvider.propose(triage, attempt, lastFailureReason);
    if (!patch) {
      // Nessuna fix proposta: categoria detection-only fuori scope, o provider
      // esaurito. Non e' verified, non e' uno scarto silenzioso: terminale.
      return terminal('verification-failed', triage, attempts,
        'nessuna fix proposta dal provider', { noFix: true });
    }

    // Rifiuto ri-sottomissione byte-identica (05 §3): patch MATERIALMENTE diversa.
    if (seenSignatures.has(patch.signature)) {
      return terminal('verification-failed', triage, attempts,
        `ri-sottomissione byte-identica rifiutata (signature=${patch.signature})`, { duplicatePatch: true });
    }
    seenSignatures.add(patch.signature);

    // [GATE UMANO] sull'APPLICAZIONE (L-COL-005; dead-code mai automatico,
    // L-COL-021). In eval e' auto-approvato deterministicamente (solo-eval).
    const gateDecision = gate({ finding: triage, patch, attempt });
    if (!gateDecision.approved) {
      return terminal('accepted-risk', triage, attempts,
        `gate umano NON approvato: ${gateDecision.reason || 'rifiutato'}`, { gateRejected: true });
    }

    // CASO SPECIALE S2 (secret-in-history): rotazione, no history rewrite.
    // Terminale: mitigated-residual, MAI verified (05 §7).
    if (patch.kind === 'secret-history') {
      const applied = patch.apply(dir);
      attempts.push({ attempt, signature: patch.signature, kind: patch.kind, applied });
      // Nessun re-run che possa "pulire" la history senza riscriverla: lo stato
      // e' per costruzione mitigated-residual.
      return terminal('mitigated-residual', triage, attempts,
        applied.detail || 'rotazione dichiarata; history non riscritta (distruttiva, gate umano)',
        { mitigatedResidual: true });
    }

    // APPLICA sulla COPIA + commit isolato sul branch (additivo, reversibile).
    const preSha = headSha(dir);
    const applied = patch.apply(dir);
    if (!applied.ok) {
      attempts.push({ attempt, signature: patch.signature, applied, verified: false });
      lastFailureReason = `applicazione fallita: ${applied.detail}`;
      // Revert prima di riprovare (anche se l'apply ha fallito, normalizziamo lo
      // stato del branch).
      revertToRef(dir, preSha);
      continue;
    }
    const commitMsg =
      `fix(loop): ${triage.category} ${shortFp(triage)} tentativo ${attempt} `
      + `[${patch.signature}]`;
    const commit = commitOnBranch(dir, commitMsg);

    // RIESEGUI lo stesso oracolo (stesso rule_id) + RIESEGUI i test.
    const rerun = rerunOracleFor(triage, dir, runOpts);
    const tests = runTests(dir);

    const oracleClean = rerun.ok && !stillPresent(triage, rerun.findings);
    const testsOk = tests.green; // degradato (M3) conta come non-rosso

    attempts.push({
      attempt, signature: patch.signature, kind: patch.kind,
      applied, commit: commit.sha || null,
      oracleClean, oracleDetail: rerun.detail,
      testsOk, testsDetail: tests.detail, testsDegraded: Boolean(tests.degraded),
    });

    if (oracleClean && testsOk) {
      // SOLO l'oracolo promuove (L-COL-002): verified.
      return terminal('verified', triage, attempts,
        `oracolo riesieguito pulito (${rerun.scope || ''}) + test ${tests.detail}`,
        { verified: true });
    }

    // verification-failed: residui o test rotto. REVERT la patch prima del retry.
    lastFailureReason = !oracleClean
      ? `oracolo flagga ancora il finding (${rerun.detail})`
      : `test rotto: ${tests.detail}`;
    revertToRef(dir, preSha);

    // Loop continua (retry) finche' restano tentativi (cap O-COL-006).
  }

  // Tentativi esauriti: terminale all'umano. MAI verified, MAI scarto silenzioso.
  return terminal('verification-failed', triage, attempts,
    `tentativi esauriti (${maxAttempts}); ultimo motivo: ${lastFailureReason}`,
    { attemptsExhausted: true });
}

// Gate di default: in eval auto-approva deterministicamente; fuori eval rifiuta
// (la skill reale fornisce un gate umano vero).
function defaultGate(evalMode) {
  return ({ /* finding, patch, attempt */ }) =>
    evalMode
      ? { approved: true, reason: 'EVAL-MODE: gate auto-approvato (solo-eval, deterministico)' }
      : { approved: false, reason: 'gate umano richiesto (nessun auto-approve fuori da --eval)' };
}

function terminal(fixState, finding, attempts, reason, flags = {}) {
  return {
    fingerprint: finding.fingerprint,
    category: finding.category,
    rule_id: finding.source_oracle.rule_id,
    location: finding.location,
    fix_state: fixState,
    reason,
    attempts,
    ...flags,
  };
}

function shortFp(f) { return f.fingerprint.slice(0, 8); }
