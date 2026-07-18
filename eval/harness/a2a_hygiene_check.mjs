#!/usr/bin/env node
// a2a_hygiene_check.mjs — keystone A2a. Verita' = FATTO d'oracolo (L-COL-002).
//
// Il gate falsificabile dei tre oracoli d'igiene strutturale del controllo 1
// (multi-oracolo, manifest-driven): dup_check (jscpd), cycle_check (madge) e
// twin_check (custom). Ogni sotto-test e' ancorato al FATTO che l'oracolo produce
// sul relativo fixture, non a una frase dell'LLM:
//   - dup:red            il controllo 1 e' ROSSO con >=1 blocker duplication (jscpd).
//   - delta:preexisting  lo stesso clone, gia' in baseline, NON blocca (delta-gate,
//                        04 §6): un difetto d'igiene PRE-ESISTENTE e' segnalato, mai
//                        gate. E' la prova che il gate guarda il DELTA, non l'assoluto.
//   - cycle:red          il controllo 1 e' ROSSO con >=1 blocker architecture prodotto
//                        dall'oracolo `cycle` (madge; ondata 1 sostituisce depcruise).
//   - clean:green        contrasto: senza difetti d'igiene il controllo 1 e' VERDE.
//   - twin:signal-not-gate  il fixture con dir parallele resta VERDE (twin e'
//                        detection-only, DETECTION_ONLY_ORACLES) MA emette >=1 finding
//                        twin: un SEGNALE ispezionabile, mai un gate.
//
// PRECONDIZIONE (passo d'ORCHESTRATORE, L-COL-024): ogni fixture-leaf ha bisogno di
//   - un inner .git (gitleaks working-tree / driver verify-fix; provision_fixtures.sh),
//   - node_modules/knip risolvibile (run_deadcode NON ha fallback npx: knip e' il
//     controllo 1 sempre-attivo). jscpd/madge si risolvono via la cache di npx
//     (nessun node_modules richiesto), ma provisionarli project-local li rende
//     deterministici e veloci.
// Senza queste precondizioni il controllo 1 DEGRADA/ERRORE (mai un falso verde,
// L-COL-006) e i sotto-test falliscono: il keystone lo dichiara, non lo maschera.
//
// Node ESM, solo built-in. Exit 0 se tutti i sotto-test passano, 1 altrimenti, 2 su
// precondizione mancante (fixture assente).
import { control1Hygiene } from '../../trueline/scripts/checkpoint/checkpoint.mjs';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ecosystems', '_a2a-fixtures');
const RUN = { runId: 'a2a', createdAt: '1970-01-01T00:00:00.000Z' };

// Manifest SINTETICO che dichiara i due oracoli-gate d'igiene. In v1 NESSUN pack
// reale porta questi binding (attivarli su un pack di produzione farebbe girare
// dup/cycle sul suo reference-app — con debito esistente — e romperebbe il suo gate,
// es. m5 su supabase-jsts). Gli oracoli sono spediti e testati QUI; l'attivazione
// per-pack (con baseline che assorbe il debito) e' un follow-up. twin_check gira
// SEMPRE (ecosystem-agnostic, detection-only), senza bisogno di binding.
const SYNTH_MANIFEST = { oracles: { duplication: { tool: 'jscpd', min_tokens: 50 }, architecture: { tool: 'madge' } } };

let fails = 0;
const check = (name, cond, detail) => {
  if (!cond) { fails++; console.log(`  [FAIL] ${name} — ${detail}`); }
  else console.log(`  [ok]   ${name}`);
};

// Ritorna il controllo 1 (igiene) del checkpoint sul fixture. baseline opzionale
// (Set<fingerprint>) per esercitare il delta-gate.
const control1 = (dir, baseline = new Set()) =>
  control1Hygiene(dir, { manifest: SYNTH_MANIFEST, runOpts: RUN, baseline });

const requireFixture = (name) => {
  const dir = resolve(FIX, name);
  if (!existsSync(dir)) { console.error(`precondizione: fixture ${dir} assente`); process.exit(2); }
  return dir;
};

// --- dup:red + delta:preexisting-ok -----------------------------------------
const dupDir = requireFixture('dup');
const hDup = control1(dupDir);
check('dup:red',
  hDup.green === false && hDup.blockers.some((b) => b.category === 'duplication'),
  `atteso controllo 1 ROSSO con blocker duplication, visto green=${hDup.green} status=${hDup.status} detail=${hDup.detail}`);

// delta: lo stesso clone gia' in baseline non deve bloccare (04 §6).
const dupFps = new Set(hDup.findings.filter((f) => f.category === 'duplication').map((f) => f.fingerprint));
const hDelta = dupFps.size > 0 ? control1(dupDir, dupFps) : null;
check('delta:preexisting-ok',
  hDelta && hDelta.green === true,
  `col clone in baseline il controllo 1 deve tornare VERDE (delta-gate), visto green=${hDelta && hDelta.green} detail=${hDelta && hDelta.detail}`);

// --- cycle:red --------------------------------------------------------------
const cycleDir = requireFixture('cycle');
const hCycle = control1(cycleDir);
check('cycle:red',
  hCycle.green === false && hCycle.blockers.some((b) => b.category === 'architecture' && b.source_oracle.oracle === 'cycle'),
  `atteso controllo 1 ROSSO con blocker architecture (oracle=cycle), visto green=${hCycle.green} status=${hCycle.status} detail=${hCycle.detail}`);

// --- clean:green ------------------------------------------------------------
const cleanDir = requireFixture('clean');
const hClean = control1(cleanDir);
check('clean:green',
  hClean.green === true,
  `atteso controllo 1 VERDE (nessun difetto d'igiene), visto green=${hClean.green} status=${hClean.status} detail=${hClean.detail}`);

// --- twin:signal-not-gate ---------------------------------------------------
const twinDir = requireFixture('twin');
const hTwin = control1(twinDir);
check('twin:signal-not-gate',
  hTwin.green === true && hTwin.findings.some((f) => f.source_oracle.oracle === 'twin'),
  `atteso VERDE con >=1 finding twin (segnale, non gate), visto green=${hTwin.green} detail=${hTwin.detail}`);

console.log(fails === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
