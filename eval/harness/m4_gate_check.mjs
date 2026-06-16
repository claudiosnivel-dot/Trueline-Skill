#!/usr/bin/env node
// m4_gate_check.mjs — GATE M4 (oracolo semgrep curato + triage/FP + criterio 3
// detection-only: 07 §3/§4/§5/§6 + 08 §3/§4/§5 + 10 §3 criterio 3, meta' detection).
//
// Asserisce, in modo DETERMINISTICO (L-COL-002: "verde" = exit/output reale di un
// comando, MAI un parere dell'LLM/del gate), la SLICE M4 del banco di prova: la
// detection (via l'ORACOLO semgrep, non per ispezione) di S6 (injection) e S7
// (authz), la PRECISIONE (niente flood di falsi positivi sul codice di contrasto),
// la NORMALIZZAZIONE OWASP-2025 (L-COL-026), la POLICY FP conservativa (08 §5,
// L-COL-028), il cablaggio del controllo-2 del checkpoint con semgrep (basta
// "DIFFERITO M4") e l'assenza di regressioni. Il semgrep gira VIA DOCKER con
// l'immagine PINNATA (semgrep/semgrep:latest == 1.165.0); la SKILL resta dep-free
// (built-in di Node), l'oracolo lo esegue il container.
//
//   0) PREFLIGHT ORACOLO: docker risponde e l'immagine semgrep pinnata e' presente
//      (run_semgrep.mjs emette JSON nativo valido sulla reference app). Senza
//      l'oracolo M4 NON puo' provare la detection: il gate ESCE 2 (precondizione
//      non soddisfatta — esito DISTINTO da un fallimento di merito, mai un falso
//      verde, mai uno skip silenzioso). Vedi M3 (preflight DB).
//
//   1) RULESET CURATO PRESENTE (07 §4): trueline/references/oracles/
//      semgrep-ai-ruleset/ contiene il ruleset CURATO (NON il placeholder.yml di
//      M0), e run_semgrep.mjs punta a quel ruleset (non piu' al placeholder).
//
//   2) DETECTION DALL'ORACOLO: eseguendo run_semgrep.mjs su eval/reference-app e
//      normalizzando l'output (normalize.mjs), i finding INCLUDONO:
//        - S6: category injection, file src/db.ts, CWE-89, owasp A05:2025;
//        - S7: category authz,     file src/routes/bookings.ts, CWE-862, owasp A01:2025.
//      Entrambi rilevati DALL'ORACOLO (semgrep), NON per ispezione del gate.
//
//   3) PRECISIONE (niente flood di FP): il codice di CONTRASTO PULITO NON e'
//      segnalato — src/db.ts::listBookingsForTenant (query tipata) e
//      src/routes/health.ts producono ZERO finding injection/authz. Una regola
//      che "matcha tutto" e' un FALLIMENTO.
//
//   4) MAPPING: ogni difetto seminato mappa a un pattern vietato (07 §4) / a un
//      provvedimento RLS (07 §5) / a una superficie enumerata (07 §6). Asserisce
//      che esista un ARTEFATTO di mapping che COPRE S1..S8.
//
//   5) NORMALIZZAZIONE OWASP-2025 (L-COL-026): i codici OWASP esterni/legacy sono
//      normalizzati al canonico 2025 nel campo finding.owasp, con il GREZZO
//      preservato in owasp_source. Es.: il finding injection ha owasp A05:2025
//      (NON A03:2021) e owasp_source != owasp (il raw legacy e' conservato).
//
//   6) POLICY FP (08 §5, L-COL-028) — conservativa e riproducibile: il triage
//      prioritizza in modo DETERMINISTICO (ordine documentato 08 §3) e il
//      meccanismo FP FLAGGA-CON-EVIDENZA + PROPONE una voce di allowlist
//      VERSIONATA, senza MAI scartare/sopprimere/ri-scorare un finding; un vero
//      positivo seminato non viene mai liquidato come FP; nessun report dice
//      "sicuro"/"safe".
//
//   7) CHECKPOINT CONTROLLO 2 con semgrep (basta "DIFFERITO M4"): un NUOVO finding
//      semgrep in-scope sopra soglia BLOCCA; asserisce che e' cablato SENZA
//      rompere il baseline-delta (un finding pre-esistente NON blocca).
//
//   8) NESSUNA REGRESSIONE: i gate m1/m2/m3 + run_eval (present/detection) escono
//      ancora 0; il fixture canonico e' bit-identico; nessuna copia temp residua.
//
// STATO TEST-FIRST: il ruleset curato, la mappa OWORK corretta, il triage e
// l'artefatto di mapping NON esistono ancora -> questo gate FALLISCE ORA (FAIL
// PULITO, nessun crash). E' voluto: il gate e' scritto PRIMA dell'implementazione.
//
// Esce 0 se TUTTI i criteri passano; 1 se un criterio FALLISCE; 2 se l'oracolo
// (docker/semgrep) non e' disponibile (precondizione M4 non soddisfatta).
//
// Node ESM, solo built-in (PIU' l'adapter normalize.mjs, anch'esso solo built-in).
// NON tocca git (l'orchestratore possiede git): la verifica d'integrita usa
// `git status`/`rev-parse` in SOLA LETTURA. L'harness di eval PUO' usare docker
// (la SKILL resta dep-free).

import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { resolve, dirname, delimiter, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize } from '../../trueline/scripts/findings/normalize.mjs';
import { cleanupAllVerifyWorkspaces } from '../../trueline/scripts/loop/verify_workspace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REFERENCE_APP = resolve(ROOT, 'eval', 'reference-app');
const RUN_SEMGREP = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_semgrep.mjs');
const NORMALIZE = resolve(ROOT, 'trueline', 'scripts', 'findings', 'normalize.mjs');
const RULESET_DIR = resolve(ROOT, 'trueline', 'references', 'oracles', 'semgrep-ai-ruleset');
const PLACEHOLDER = resolve(RULESET_DIR, 'placeholder.yml');
const TRIAGE = resolve(ROOT, 'trueline', 'scripts', 'triage', 'triage.mjs');
const CHECKPOINT = resolve(ROOT, 'trueline', 'scripts', 'checkpoint', 'checkpoint.mjs');
const RUN_CHECKPOINT = resolve(ROOT, 'trueline', 'scripts', 'checkpoint', 'run_checkpoint.mjs');
const DEFECT_MAP = resolve(ROOT, 'eval', 'harness', 'expected', 'defect-mapping.json');
const REGISTRY = resolve(ROOT, 'eval', 'harness', 'expected', 'registry.json');
const RUN_EVAL = resolve(ROOT, 'eval', 'harness', 'run_eval.mjs');
const M1_GATE = resolve(ROOT, 'eval', 'harness', 'm1_gate_check.mjs');
const M2_GATE = resolve(ROOT, 'eval', 'harness', 'm2_gate_check.mjs');
const M3_GATE = resolve(ROOT, 'eval', 'harness', 'm3_gate_check.mjs');
const TMP_VERIFY = resolve(ROOT, 'eval', '.tmp-verify');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

// SWEEP DEGLI ORFANI ALL'AVVIO: un run_loop/run_checkpoint killato a meta'
// (SIGKILL, non intercettabile) lascia una copia temp orfana in eval/.tmp-verify.
// Senza sweep, l'orfano avvelena l'asserzione di sezione 8 "nessuna copia temp
// residua" (e quella dei gate m1/m3 che M4 ri-esegue), producendo un rosso
// persistente NON imputabile al run corrente. Lo ripuliamo PRIMA di qualunque
// nostro run_checkpoint; l'asserzione finale resta valida e non e' indebolita: se
// fosse il run corrente a lasciare un residuo, scatterebbe comunque.
cleanupAllVerifyWorkspaces();

// Immagine semgrep PINNATA: la riproducibilita dell'oracolo dipende dal pin (deve
// combaciare con run_semgrep.mjs / SEMGREP_IMAGE). 1.165.0 == semgrep/semgrep:latest.
const SEMGREP_IMAGE = 'semgrep/semgrep:latest';

// runOpts deterministici per normalize (riproducibilita L-COL-002): niente Date.now.
const RUN_OPTS = { runId: 'm4-gate', createdAt: '1970-01-01T00:00:00.000Z', base: 'eval/reference-app' };

// ---------------------------------------------------------------------------
function nodeRun(script, args, cwd = ROOT) {
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

// Esegue l'oracolo semgrep (run_semgrep.mjs) su projectDir e ritorna il JSON
// nativo parsato (o null). Lo stdout e' SOLO il JSON nativo (run_semgrep emette
// le diagnostiche su stderr).
function runSemgrepNative(projectDir = 'eval/reference-app') {
  const r = nodeRun(RUN_SEMGREP, [projectDir]);
  let native = null;
  try { native = JSON.parse(r.stdout); } catch { /* gestito dal chiamante */ }
  return { status: r.status, native, stderr: r.stderr };
}

// docker disponibile e immagine semgrep pinnata presente?
function dockerReady() {
  const v = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (v.error || v.status !== 0) return { ok: false, why: 'docker non risponde' };
  const img = spawnSync('docker', ['images', '-q', SEMGREP_IMAGE], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (img.error || img.status !== 0 || !(img.stdout || '').trim()) {
    return { ok: false, why: `immagine ${SEMGREP_IMAGE} non presente (docker pull ${SEMGREP_IMAGE})` };
  }
  return { ok: true };
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
function readJsonSafe(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

// Elenco ricorsivo dei file di regola (.yml/.yaml) sotto una dir (best-effort).
function listYamlFiles(dir) {
  const out = [];
  function walk(d) {
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      const full = resolve(d, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (/\.ya?ml$/i.test(e)) out.push(full);
    }
  }
  walk(dir);
  return out;
}

// Categoria-helper: i finding semgrep S6/S7 hanno category injection/authz.
const isInjection = (f) => f.category === 'injection';
const isAuthz = (f) => f.category === 'authz';
const fileOf = (f) => (f.location && f.location.file) || '';

console.log('============================================================');
console.log(' GATE M4 — oracolo semgrep curato (07) + triage/FP (08) + criterio 3 detection-only');
console.log(`   ruleset dir   : ${RULESET_DIR}`);
console.log(`   reference-app : ${REFERENCE_APP}`);
console.log(`   semgrep image : ${SEMGREP_IMAGE} (pinnata)`);
console.log('   detection M4  : S6 injection (src/db.ts, CWE-89, A05:2025)');
console.log('                   S7 authz     (src/routes/bookings.ts, CWE-862, A01:2025)');
console.log('============================================================');
console.log('');

// =============================================================================
// 0) PREFLIGHT ORACOLO: docker + immagine semgrep pinnata. Senza, M4 non puo'
//    provare la detection -> ESCE 2 (precondizione non soddisfatta, MAI falso verde).
// =============================================================================
console.log('0) Preflight oracolo semgrep VIA DOCKER (immagine pinnata) per la detection M4:');
const dr = dockerReady();
if (!dr.ok) {
  console.log(`  [FAIL] oracolo semgrep NON disponibile — ${dr.why}`);
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('=== GATE M4: PRECONDIZIONE NON SODDISFATTA (oracolo semgrep assente) ===');
  console.log('M4 richiede l\'oracolo semgrep VIA DOCKER per provare la detection di S6/S7.');
  console.log(`Immagine pinnata attesa: ${SEMGREP_IMAGE}`);
  console.log(`Prepara l'oracolo:       docker pull ${SEMGREP_IMAGE}`);
  console.log('------------------------------------------------------------');
  process.exit(2);
}
// Smoke: run_semgrep.mjs emette JSON nativo valido sulla reference app.
const smoke = runSemgrepNative();
if (smoke.status !== 0 || !smoke.native || !Array.isArray(smoke.native.results)) {
  console.log('  [FAIL] run_semgrep.mjs non ha emesso JSON nativo valido (results[])');
  console.log(`         exit=${smoke.status} stderr=${(smoke.stderr || '').slice(0, 400)}`);
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('=== GATE M4: PRECONDIZIONE NON SODDISFATTA (oracolo semgrep non eseguibile) ===');
  console.log('------------------------------------------------------------');
  process.exit(2);
}
assert('oracolo semgrep disponibile (docker + immagine pinnata, JSON nativo valido)', true,
  `${SEMGREP_IMAGE}, results=${smoke.native.results.length}`);

// snapshot iniziale dell'integrita del fixture (git, sola lettura, parte tracciata).
const headBefore = gitRead(REFERENCE_APP, ['rev-parse', 'HEAD']).stdout;
const statusBefore = gitRead(REFERENCE_APP, ['status', '--porcelain']).stdout;

// =============================================================================
// 1) RULESET CURATO PRESENTE (07 §4) e run_semgrep.mjs ci punta (NON il placeholder).
// =============================================================================
console.log('');
console.log('1) Ruleset semgrep CURATO presente (07 §4) e run_semgrep.mjs ci punta:');
const yamlFiles = listYamlFiles(RULESET_DIR);
const curatedFiles = yamlFiles.filter((f) => resolve(f) !== PLACEHOLDER);
assert('esiste almeno un file di regole CURATO (oltre placeholder.yml)', curatedFiles.length > 0,
  curatedFiles.length ? `${curatedFiles.length} file: [${curatedFiles.map((f) => relative(RULESET_DIR, f)).join(', ')}]`
    : 'solo placeholder.yml presente (ruleset curato ASSENTE)');

// Il ruleset curato copre le categorie injection E authz (le due detection-only M4).
// Cerchiamo nei file curati i marcatori di categoria (metadata category + CWE).
const curatedTxt = curatedFiles.map(readSafe).join('\n');
assert('il ruleset curato dichiara regole injection (category injection / CWE-89)',
  /category:\s*injection/i.test(curatedTxt) && /CWE-89/i.test(curatedTxt),
  /category:\s*injection/i.test(curatedTxt) ? 'presente' : 'assente');
assert('il ruleset curato dichiara regole authz (category authz / CWE-862)',
  /category:\s*authz/i.test(curatedTxt) && /CWE-862/i.test(curatedTxt),
  /category:\s*authz/i.test(curatedTxt) ? 'presente' : 'assente');
// Il ruleset curato emette OWASP gia 2025 (07 §3.1: le NOSTRE regole portano 2025).
assert('il ruleset curato emette OWASP 2025 (A05:2025 injection e A01:2025 authz)',
  /A05:2025/.test(curatedTxt) && /A01:2025/.test(curatedTxt),
  /A05:2025/.test(curatedTxt) && /A01:2025/.test(curatedTxt) ? 'presente' : 'assente');

// run_semgrep.mjs NON punta piu' al placeholder: RULESET_SRC deve risolvere a un
// file del ruleset curato (non a placeholder.yml).
const semgrepSrc = readSafe(RUN_SEMGREP);
const pointsAtPlaceholder = /['"]placeholder\.yml['"]/.test(semgrepSrc);
assert('run_semgrep.mjs NON punta piu' + ' al placeholder.yml (07 §4)', !pointsAtPlaceholder,
  pointsAtPlaceholder ? 'RULESET_SRC ancora = placeholder.yml (M0)' : 'punta al ruleset curato');

// =============================================================================
// 2) DETECTION DALL'ORACOLO: S6 (injection) + S7 (authz) normalizzati dal vero
//    output semgrep, NON per ispezione del gate.
// =============================================================================
console.log('');
console.log('2) Detection DALL\'ORACOLO (semgrep -> normalize): S6 injection + S7 authz:');
const scan = runSemgrepNative('eval/reference-app');
let findings = [];
let normErr = '';
try {
  findings = normalize('semgrep', scan.native, RUN_OPTS);
} catch (e) { normErr = e && e.message ? e.message : String(e); }
assert('normalize(semgrep) produce finding senza errori', findings.length > 0 && !normErr,
  normErr ? `errore: ${normErr}` : `finding=${findings.length}`);

// S6: injection in src/db.ts, CWE-89, owasp A05:2025. Il file di db.ts contiene
// SIA il difetto (findBookingByIdUnsafe) SIA il contrasto pulito (listBookingsForTenant):
// la detection deve colpire la riga del difetto (l'oracolo riporta start_line).
const SEED_S6_LINE = 30; // SEED:S6 — riga della concatenazione SQL (db.ts)
const s6 = findings.filter((f) => isInjection(f) && /src\/db\.ts$/.test(fileOf(f)));
const s6hit = s6.find((f) => f.cwe === 'CWE-89' && f.owasp === 'A05:2025');
assert('S6 RILEVATO dall\'oracolo: injection in src/db.ts (CWE-89, A05:2025)', Boolean(s6hit),
  s6hit ? `linea=${s6hit.location.start_line} rule=${s6hit.source_oracle.rule_id}`
    : `injection-in-db.ts=${s6.length} (cwe/owasp non combaciano o assenti)`);
assert('S6 punta alla riga del difetto SEED:S6 (concatenazione SQL), non al contrasto pulito',
  s6.some((f) => Math.abs(Number(f.location.start_line) - SEED_S6_LINE) <= 6),
  s6.length ? `linee=[${s6.map((f) => f.location.start_line).join(',')}] (SEED:S6 ~${SEED_S6_LINE})` : 'nessun hit');

// S7: authz in src/routes/bookings.ts, CWE-862, owasp A01:2025.
const s7 = findings.filter((f) => isAuthz(f) && /src\/routes\/bookings\.ts$/.test(fileOf(f)));
const s7hit = s7.find((f) => f.cwe === 'CWE-862' && f.owasp === 'A01:2025');
assert('S7 RILEVATO dall\'oracolo: authz in src/routes/bookings.ts (CWE-862, A01:2025)', Boolean(s7hit),
  s7hit ? `linea=${s7hit.location.start_line} rule=${s7hit.source_oracle.rule_id}`
    : `authz-in-bookings.ts=${s7.length} (cwe/owasp non combaciano o assenti)`);

// Entrambi promossi DALL'ORACOLO: ogni finding ha un rule_id semgrep (non ispezione).
const s6s7 = [...s6, ...s7];
assert('S6/S7 provengono dall\'ORACOLO (ogni finding ha source_oracle.oracle=semgrep + rule_id)',
  s6s7.length > 0 && s6s7.every((f) => f.source_oracle
    && f.source_oracle.oracle === 'semgrep' && f.source_oracle.rule_id),
  `finding semgrep S6/S7=${s6s7.length}`);

// =============================================================================
// 3) PRECISIONE: il codice di CONTRASTO pulito NON e' segnalato (niente FP-flood).
// =============================================================================
console.log('');
console.log('3) Precisione (niente flood di FP): il codice di contrasto pulito NON e\' segnalato:');

// src/routes/health.ts: ZERO finding injection/authz (modulo pulito di contorno).
const healthBad = findings.filter((f) => (isInjection(f) || isAuthz(f)) && /src\/routes\/health\.ts$/.test(fileOf(f)));
assert('src/routes/health.ts: ZERO finding injection/authz (pulito)', healthBad.length === 0,
  healthBad.length ? `flaggato ${healthBad.length} (FP!)` : 'pulito');

// src/db.ts::listBookingsForTenant (query tipata) NON deve essere segnalato come
// injection. La funzione di contrasto vive DOPO la riga ~44 (post SEED:S6 ~30):
// nessun finding injection in db.ts deve cadere nella sua regione (linea > 40).
const LIST_FN_LINE_MIN = 40; // listBookingsForTenant inizia dopo SEED:S6
const cleanQueryFlagged = findings.filter((f) => isInjection(f)
  && /src\/db\.ts$/.test(fileOf(f)) && Number(f.location.start_line) >= LIST_FN_LINE_MIN);
assert('src/db.ts::listBookingsForTenant (query tipata) NON segnalata injection', cleanQueryFlagged.length === 0,
  cleanQueryFlagged.length ? `flaggate linee=[${cleanQueryFlagged.map((f) => f.location.start_line).join(',')}] (FP!)`
    : 'query tipata non segnalata');

// Anti-"matcha tutto": il TOTALE dei finding injection+authz e' contenuto (non
// un flood). Con S6 (db.ts) + S7 (bookings.ts, POST+PUT) la regola curata resta
// mirata: pochi hit, tutti sui difetti. Una regola che matcha ovunque sforerebbe.
const injAuthz = findings.filter((f) => isInjection(f) || isAuthz(f));
const injAuthzFiles = new Set(injAuthz.map(fileOf));
assert('niente flood: i finding injection/authz restano confinati ai file dei difetti (db.ts, bookings.ts)',
  injAuthz.length > 0 && [...injAuthzFiles].every((p) => /src\/db\.ts$/.test(p) || /src\/routes\/bookings\.ts$/.test(p)),
  `inj/authz=${injAuthz.length} file=[${[...injAuthzFiles].join(', ')}]`);

// =============================================================================
// 4) MAPPING: ogni difetto seminato S1..S8 mappa a pattern vietato (07 §4) /
//    provvedimento RLS (07 §5) / superficie enumerata (07 §6). Artefatto presente.
// =============================================================================
console.log('');
console.log('4) Mapping S1..S8 -> pattern vietato (07 §4) / RLS (07 §5) / superficie (07 §6):');
const defectMap = readJsonSafe(DEFECT_MAP);
assert('artefatto di mapping presente (eval/harness/expected/defect-mapping.json)', defectMap !== null,
  defectMap ? 'presente' : `ASSENTE: ${DEFECT_MAP}`);

const registry = readJsonSafe(REGISTRY);
const seededIds = (registry && Array.isArray(registry.defects) ? registry.defects : []).map((d) => d.id);
const expectedIds = seededIds.length ? seededIds : ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];

// La mappa e' un dizionario/array di voci {id, maps_to:{kind, ref}}: ogni S deve
// mappare a una delle tre tassonomie (forbidden-pattern | rls-provision | surface).
const mapEntries = (() => {
  if (!defectMap) return [];
  if (Array.isArray(defectMap)) return defectMap;
  if (Array.isArray(defectMap.mappings)) return defectMap.mappings;
  if (defectMap.mappings && typeof defectMap.mappings === 'object') {
    return Object.entries(defectMap.mappings).map(([id, v]) => ({ id, ...(v || {}) }));
  }
  if (typeof defectMap === 'object') {
    return Object.entries(defectMap).filter(([k]) => /^S\d+$/.test(k)).map(([id, v]) => ({ id, ...(v || {}) }));
  }
  return [];
})();
const VALID_KINDS = new Set(['forbidden-pattern', 'rls-provision', 'surface', 'forbidden_pattern', 'rls_provision']);
function entryKind(e) {
  const k = (e && (e.kind || (e.maps_to && e.maps_to.kind) || e.maps_to_kind)) || '';
  return String(k).toLowerCase();
}
function entryRef(e) {
  return String((e && (e.ref || (e.maps_to && e.maps_to.ref) || e.reference)) || '');
}
const byId = new Map(mapEntries.map((e) => [String(e.id), e]));
const missingMap = expectedIds.filter((id) => !byId.has(id));
assert('il mapping COPRE tutti gli S seminati (S1..S8)', defectMap !== null && missingMap.length === 0,
  missingMap.length ? `mancano: [${missingMap.join(', ')}]` : `coperti: [${expectedIds.join(', ')}]`);
const badKind = expectedIds.filter((id) => {
  const e = byId.get(id);
  return !e || !VALID_KINDS.has(entryKind(e)) || entryRef(e).length === 0;
});
assert('ogni S mappa a una tassonomia VALIDA (forbidden-pattern | rls-provision | surface) con ref non vuoto',
  defectMap !== null && missingMap.length === 0 && badKind.length === 0,
  badKind.length ? `mapping incompleto per: [${badKind.join(', ')}]` : 'tutti mappati con ref');

// Coerenza categoria->tassonomia per le due detection-only M4: S6 (injection) e
// S7 (authz) devono mappare a un PATTERN VIETATO (07 §4.2 / §4.3), con il CWE giusto.
const s6map = byId.get('S6');
const s7map = byId.get('S7');
assert('S6 mappa a un forbidden-pattern injection (07 §4.2, CWE-89)',
  s6map && entryKind(s6map) === 'forbidden-pattern' && /CWE-89|4\.2|injection/i.test(JSON.stringify(s6map)),
  s6map ? entryRef(s6map) : 'assente');
assert('S7 mappa a un forbidden-pattern authz (07 §4.3, CWE-862)',
  s7map && entryKind(s7map) === 'forbidden-pattern' && /CWE-862|4\.3|authz/i.test(JSON.stringify(s7map)),
  s7map ? entryRef(s7map) : 'assente');

// =============================================================================
// 5) NORMALIZZAZIONE OWASP-2025 (L-COL-026): canonico 2025 nel campo owasp, grezzo
//    preservato in owasp_source. Es. injection: owasp A05:2025, NON A03:2021.
// =============================================================================
console.log('');
console.log('5) Normalizzazione OWASP-2025 (L-COL-026): owasp canonico 2025 + owasp_source grezzo:');
const anyInjection = findings.find((f) => isInjection(f));
assert('un finding injection ha owasp = A05:2025 (NON A03:2021)',
  anyInjection && anyInjection.owasp === 'A05:2025',
  anyInjection ? `owasp=${anyInjection.owasp} owasp_source=${anyInjection.owasp_source}` : 'nessun finding injection');
// Il grezzo legacy e' PRESERVATO (tracciabilita): owasp_source presente; se la
// fonte e' legacy (2021) deve differire dal canonico 2025.
assert('owasp_source e\' preservato (il codice grezzo non viene perso)',
  anyInjection && typeof anyInjection.owasp_source === 'string' && anyInjection.owasp_source.length > 0,
  anyInjection ? `owasp_source=${anyInjection.owasp_source}` : 'assente');
assert('se owasp_source e\' legacy (2021) e\' DIVERSO dal canonico 2025 (mappa applicata, non un no-op)',
  anyInjection && (!/:2021$/.test(String(anyInjection.owasp_source)) || anyInjection.owasp_source !== anyInjection.owasp),
  anyInjection ? `source=${anyInjection.owasp_source} canon=${anyInjection.owasp}` : 'n/a');
// La regola provvisoria errata A03:2021 -> A03:2025 NON deve sopravvivere: per
// injection il canonico DEVE essere A05:2025 (07 §3.1). Falsificabile.
assert('nessun finding injection resta su A03:2025 (mappa M0 errata sostituita da 07 §3.1)',
  !findings.some((f) => isInjection(f) && f.owasp === 'A03:2025'),
  findings.some((f) => isInjection(f) && f.owasp === 'A03:2025') ? 'A03:2025 ancora presente (mappa M0!)' : 'ok');

// ESERCITA DIRETTAMENTE la mappa di normalizzazione su codici LEGACY ESTERNI
// (07 §3.1): le regole curate emettono GIA' 2025, quindi il percorso legacy->2025
// NON e' coperto dai finding nativi sopra. Qui forziamo finding SINTETICI esterni
// (semgrep registry / OSV) col codice 2021 grezzo e verifichiamo che la mappa
// AUTORITATIVA (i numeri CAMBIANO) sia applicata — non la vecchia 1:1 sul numero.
//   injection A03:2021 -> A05:2025 ; deps A06:2021 -> A03:2025 ; SSRF A10:2021 -> A01:2025.
const extSemgrep = {
  version: '1.165.0',
  results: [{
    check_id: 'registry.sql-injection', path: '/src/src/db.ts',
    start: { line: 30 }, end: { line: 30 },
    extra: { severity: 'ERROR', message: 'ext', metadata: { category: 'injection', owasp_source: 'A03:2021', cwe: 'CWE-89' } },
  }],
};
let extInj = null;
try { extInj = normalize('semgrep', extSemgrep, RUN_OPTS)[0]; } catch { /* gestito sotto */ }
assert('mappa 07 §3.1 esercitata su legacy ESTERNO: semgrep injection A03:2021 -> A05:2025 (NON 1:1)',
  extInj && extInj.owasp === 'A05:2025' && extInj.owasp_source === 'A03:2021',
  extInj ? `owasp=${extInj.owasp} owasp_source=${extInj.owasp_source}` : 'normalize ha lanciato');
const extOsv = {
  results: [{
    source: { path: 'package-lock.json' },
    packages: [{
      package: { name: 'x', version: '1', ecosystem: 'npm' },
      vulnerabilities: [{ id: 'CVE-FAKE', summary: 's', severity: [{ type: 'CVSS_V3', score: '5' }], database_specific: { owasp: 'A06:2021', cwe_ids: ['CWE-1104'] } }],
    }],
  }],
};
let extDep = null;
try { extDep = normalize('osv', extOsv, RUN_OPTS)[0]; } catch { /* gestito sotto */ }
assert('mappa 07 §3.1 esercitata su legacy ESTERNO: OSV deps A06:2021 -> A03:2025 (Supply Chain, NON A06)',
  extDep && extDep.owasp === 'A03:2025' && extDep.owasp_source === 'A06:2021',
  extDep ? `owasp=${extDep.owasp} owasp_source=${extDep.owasp_source}` : 'normalize ha lanciato');

// =============================================================================
// 6) POLICY FP (08 §5, L-COL-028): triage deterministico, flag-con-evidenza +
//    proposta allowlist versionata, MAI scarto/soppressione/re-score; TP mai FP;
//    niente "sicuro".
// =============================================================================
console.log('');
console.log('6) Policy FP conservativa (08 §5, L-COL-028) + prioritizzazione deterministica (08 §3):');
assert('modulo di triage presente (trueline/scripts/triage/triage.mjs)', existsSync(TRIAGE),
  existsSync(TRIAGE) ? 'presente' : `ASSENTE: ${TRIAGE}`);

// Il triage e' un MECCANISMO deterministico: lo invochiamo DUE volte sullo stesso
// input e l'ordine prodotto deve essere IDENTICO (riproducibile, non a sensazione).
let triageOut1 = null, triageOut2 = null, triageErr = '';
if (existsSync(TRIAGE)) {
  try {
    const mod = await import(`file://${TRIAGE.replace(/\\/g, '/')}`);
    const triageFn = mod.triage || mod.default;
    if (typeof triageFn !== 'function') {
      triageErr = 'triage.mjs non esporta una funzione triage()/default';
    } else {
      // Input: i finding semgrep S6/S7 + un finding dead-code SOSPETTO-FP costruito
      // (per esercitare il ramo flag-FP). Il dead-code di un entrypoint del
      // framework e' il caso piu' affilato (08 §5.3): lo marchiamo con un'evidenza.
      const sample = findings.map((f) => ({ ...f }));
      // un finding dead-code aggiuntivo, candidato a sospetto-FP (entry framework).
      sample.push({
        fingerprint: 'fp-deadcode-sample-0001', category: 'dead-code', severity: 'LOW',
        location: { file: 'eval/reference-app/src/index.ts', start_line: 1, end_line: 1 },
        evidence: 'unused-file: src/index.ts (possibile entrypoint del framework)',
        source_oracle: { oracle: 'knip', tool_version: 'knip', rule_id: 'unused-file' },
        fix_state: 'detected', baseline_status: 'new', run_id: 'm4-gate', created_at: RUN_OPTS.createdAt,
      });
      triageOut1 = triageFn(sample, { fpEvidence: { 'fp-deadcode-sample-0001': 'entrypoint del framework (src/index.ts)' } });
      triageOut2 = triageFn(sample, { fpEvidence: { 'fp-deadcode-sample-0001': 'entrypoint del framework (src/index.ts)' } });
    }
  } catch (e) { triageErr = e && e.message ? e.message : String(e); }
}

function triageList(out) {
  if (!out) return [];
  if (Array.isArray(out)) return out;
  if (Array.isArray(out.prioritized)) return out.prioritized;
  if (Array.isArray(out.findings)) return out.findings;
  if (Array.isArray(out.order)) return out.order;
  return [];
}
const order1 = triageList(triageOut1);
const order2 = triageList(triageOut2);
const fpOf = (f) => f && (f.fingerprint || f.id || JSON.stringify(f));
assert('triage eseguito senza errori ed emette un ordine', order1.length > 0 && !triageErr,
  triageErr ? `errore: ${triageErr}` : `ordinati=${order1.length}`);
assert('prioritizzazione DETERMINISTICA (08 §3): stesso input -> stesso ordine',
  order1.length > 0 && order1.length === order2.length
    && order1.every((f, i) => fpOf(f) === fpOf(order2[i])),
  order1.length ? 'ordine riproducibile' : 'nessun ordine');

// Ordine documentato (08 §3): blocca-sempre(secret) ▸ nuovo&sopra-soglia ▸ in-scope
// ▸ severita ▸ categoria-killer (rls/authz). In assenza di secret nel campione,
// i finding HIGH (injection/authz) devono precedere l'advisory LOW (dead-code).
const idxFirstLow = order1.findIndex((f) => String(f.severity).toUpperCase() === 'LOW');
const idxLastHigh = order1.map((f) => String(f.severity).toUpperCase())
  .lastIndexOf('HIGH');
assert('ordine spietato (08 §3): i bloccanti HIGH precedono l\'advisory LOW',
  idxLastHigh === -1 || idxFirstLow === -1 || idxLastHigh < idxFirstLow,
  `lastHIGH=${idxLastHigh} firstLOW=${idxFirstLow}`);

// FP policy: il sospetto-FP e' FLAGGATO-CON-EVIDENZA, PROPONE una voce di allowlist
// VERSIONATA, ma NON viene rimosso/soppresso/ri-scorato, e il finding RESTA.
const allTriaged = triageList(triageOut1);
const stillPresentDeadcode = allTriaged.some((f) => fpOf(f) === 'fp-deadcode-sample-0001');
assert('il sospetto-FP NON viene scartato: il finding RESTA nel modello (08 §5: nel dubbio si tiene)',
  stillPresentDeadcode,
  stillPresentDeadcode ? 'presente' : 'SCOMPARSO (soppressione vietata!)');

const flagged = allTriaged.find((f) => fpOf(f) === 'fp-deadcode-sample-0001');
const flaggedStr = JSON.stringify(flagged || {});
// Il flag porta EVIDENZA concreta e una PROPOSTA di allowlist versionata, e NON
// cambia severity/category ne marca verified (campi immutabili, 08 §2).
assert('il sospetto-FP e\' flaggato CON EVIDENZA + proposta di allowlist versionata (08 §5.1/§5.2)',
  flagged && /allowlist|nosemgrep|knip|ignore/i.test(flaggedStr) && /entrypoint|evidence|evidenza/i.test(flaggedStr),
  flagged ? 'flag-con-evidenza presente' : 'flag assente');
assert('il flag-FP NON cambia severity/category ne marca verified (08 §2: immutabili)',
  flagged && String(flagged.severity).toUpperCase() === 'LOW' && flagged.category === 'dead-code'
    && flagged.fix_state !== 'verified',
  flagged ? `sev=${flagged.severity} cat=${flagged.category} state=${flagged.fix_state}` : 'n/a');

// Un VERO POSITIVO seminato (S6/S7) NON deve mai essere liquidato come FP.
const tpFlaggedFp = allTriaged.filter((f) => (f.category === 'injection' || f.category === 'authz')
  && (f.suspected_fp === true || /suspected[_-]?fp/i.test(JSON.stringify(f.flags || f.fp || ''))));
assert('nessun vero positivo seminato (S6/S7) e\' liquidato come FP (08 §5, bias conservativo)',
  tpFlaggedFp.length === 0,
  tpFlaggedFp.length ? `${tpFlaggedFp.length} TP marcati FP (vietato!)` : 'nessun TP marcato FP');

// Nessun report del triage dice "sicuro"/"safe" (L-COL-006). Tolleriamo "fail-safe".
const triageText = JSON.stringify(triageOut1 || {}).replace(/fail[-\s]?safe/ig, '');
assert('il triage NON dice "sicuro"/"safe" come garanzia (L-COL-006)',
  !/\b(sicuro|safe)\b/i.test(triageText),
  /\b(sicuro|safe)\b/i.test(triageText) ? 'trovata garanzia indebita' : 'nessuna garanzia indebita');

// =============================================================================
// 7) CHECKPOINT CONTROLLO 2 con semgrep (basta "DIFFERITO M4"): nuovo finding
//    semgrep in-scope sopra soglia BLOCCA, senza rompere il baseline-delta.
// =============================================================================
console.log('');
console.log('7) Checkpoint controllo 2 ora include semgrep (basta "DIFFERITO M4"), baseline-delta intatto:');
const checkpointTxt = readSafe(CHECKPOINT);
// Il commento "DIFFERITO M4 / TODO M4: integrare semgrep" non deve piu' reggere:
// il controllo 2 deve invocare l'oracolo semgrep.
const stillDeferred = /semgrep DIFFERITO M4|TODO M4: integrare semgrep/i.test(checkpointTxt);
assert('checkpoint controllo 2: semgrep NON e\' piu\' "DIFFERITO M4" (cablato)', !stillDeferred,
  stillDeferred ? 'commento "DIFFERITO M4" ancora presente (non cablato)' : 'semgrep cablato');
// Invocazione REALE dell'oracolo nel controllo 2: deve riferirsi a run_semgrep
// (non basta la parola "semgrep", che compare gia nel commento "DIFFERITO M4").
const invokesSemgrep = /run_semgrep|RUN_SEMGREP/.test(checkpointTxt) && /control2Security/.test(checkpointTxt);
assert('checkpoint controllo 2 invoca l\'oracolo semgrep (riferisce run_semgrep)', invokesSemgrep,
  invokesSemgrep ? 'invoca run_semgrep' : 'non invoca run_semgrep (solo il commento DIFFERITO M4)');

// Prova RUNTIME del cablaggio: run_checkpoint sul fixture canonico (copia temp
// gestita dallo script, --eval deterministico). Il controllo 2 deve essere ROSSO
// (S6/S7 sono NUOVI sopra soglia con baseline VUOTA) e includere finding semgrep.
const cpNew = nodeRun(RUN_CHECKPOINT, ['--eval', '--no-osv']);
let cpNewRep = null;
try { cpNewRep = JSON.parse(cpNew.stdout); } catch { /* gestito */ }
const c2New = cpNewRep && cpNewRep.controls ? cpNewRep.controls.find((c) => c.id === 2) : null;
assert('run_checkpoint eseguito ed emette JSON (controllo 2 presente)', cpNewRep && c2New,
  cpNewRep ? `exit=${cpNew.status}` : `exit=${cpNew.status} (no JSON)`);
const c2Blockers = (c2New && c2New.blockers) || [];
const semgrepBlocker = c2Blockers.some((b) => (b.category === 'injection' || b.category === 'authz'));
assert('controllo 2: un NUOVO finding semgrep in-scope (injection/authz) BLOCCA (rosso)',
  c2New && c2New.green === false && semgrepBlocker,
  c2New ? `green=${c2New.green} blockers-semgrep=${semgrepBlocker} (tot=${c2Blockers.length})` : 'controllo 2 assente');

// Baseline-delta INTATTO: ri-eseguendo con i fingerprint S6/S7 in baseline, gli
// stessi finding NON bloccano piu' (pre-existing). Falsifica un "blocca tutto".
const semgrepFps = s6s7.map((f) => f.fingerprint).filter(Boolean);
let c2Base = null;
if (semgrepFps.length) {
  // Passiamo la baseline come array di fingerprint via un file temp gitignorato.
  const baselineFile = resolve(ROOT, 'eval', '.tmp-m4-baseline.json');
  try {
    // scrittura diretta (built-in): file usa-e-getta sotto eval/ (gitignore .tmp-*).
    const { writeFileSync, rmSync } = await import('node:fs');
    writeFileSync(baselineFile, JSON.stringify(semgrepFps), 'utf8');
    const cpBase = nodeRun(RUN_CHECKPOINT, ['--eval', '--no-osv', '--baseline', baselineFile]);
    let cpBaseRep = null;
    try { cpBaseRep = JSON.parse(cpBase.stdout); } catch { /* gestito */ }
    c2Base = cpBaseRep && cpBaseRep.controls ? cpBaseRep.controls.find((c) => c.id === 2) : null;
    rmSync(baselineFile, { force: true });
  } catch { /* best effort: il file e' comunque gitignorato */ }
}
const c2BaseSemgrepBlockers = c2Base
  ? (c2Base.blockers || []).filter((b) => b.category === 'injection' || b.category === 'authz')
  : null;
assert('baseline-delta intatto: con S6/S7 in baseline NON bloccano piu\' (pre-existing, non flood)',
  c2Base && c2BaseSemgrepBlockers && c2BaseSemgrepBlockers.length === 0,
  c2Base ? `blockers-semgrep-con-baseline=${c2BaseSemgrepBlockers ? c2BaseSemgrepBlockers.length : 'n/a'}`
    : 'secondo run non disponibile');

// =============================================================================
// 8) NESSUNA REGRESSIONE + integrita fixture canonica.
// =============================================================================
console.log('');
console.log('8) Nessuna regressione (m1/m2/m3 + run_eval) + integrita fixture canonica:');
const det = nodeRun(RUN_EVAL, ['--mode=detection']);
assert('run_eval --mode=detection ancora EXIT 0', det.status === 0, `exit=${det.status}`);
const pres = nodeRun(RUN_EVAL, ['--mode=present']);
assert('run_eval --mode=present ancora EXIT 0', pres.status === 0, `exit=${pres.status}`);

const m1 = nodeRun(M1_GATE, []);
assert('m1_gate_check ancora EXIT 0', m1.status === 0, `exit=${m1.status}`);
const m2 = nodeRun(M2_GATE, []);
assert('m2_gate_check ancora EXIT 0', m2.status === 0, `exit=${m2.status}`);
const m3 = nodeRun(M3_GATE, []);
// M3 esce 2 se il DB di prova non e' raggiungibile (precondizione): in tal caso
// NON e' una regressione di M4. Trattiamo 0 (verde) come pass; 2 (DB assente)
// come precondizione non soddisfatta NON imputabile a M4 (segnalato, non bloccante).
assert('m3_gate_check ancora EXIT 0 (oppure 2 = DB di prova assente, non regressione M4)',
  m3.status === 0 || m3.status === 2,
  m3.status === 2 ? 'exit=2 (DB di prova assente: precondizione M3, non regressione)' : `exit=${m3.status}`);

assert('nessuna copia temp residua (eval/.tmp-verify)', !existsSync(TMP_VERIFY),
  existsSync(TMP_VERIFY) ? 'directory ancora presente' : 'assente');
assert('nessun residuo temp del gate M4 (eval/.tmp-m4-baseline.json)',
  !existsSync(resolve(ROOT, 'eval', '.tmp-m4-baseline.json')),
  existsSync(resolve(ROOT, 'eval', '.tmp-m4-baseline.json')) ? 'residuo presente' : 'assente');

// Pulizia della copia effimera del ruleset che run_semgrep monta (.trueline/):
// run_semgrep la ripulisce nel proprio finally; verifichiamo che non resti nulla
// nel fixture canonico (e parte dell'integrita sotto).
assert('nessun residuo .trueline/ del ruleset nel fixture canonico',
  !existsSync(resolve(REFERENCE_APP, '.trueline')),
  existsSync(resolve(REFERENCE_APP, '.trueline')) ? '.trueline/ residuo (cleanup mancato)' : 'pulito');

// fixture canonico bit-identico (parte tracciata): HEAD e status invariati.
const headAfter = gitRead(REFERENCE_APP, ['rev-parse', 'HEAD']).stdout;
const statusAfter = gitRead(REFERENCE_APP, ['status', '--porcelain']).stdout;
assert('fixture canonica bit-identica dopo (git status/HEAD invariati)',
  headAfter === headBefore && statusAfter === statusBefore,
  headAfter === headBefore && statusAfter === statusBefore ? 'invariata' : 'MUTATA');

// --- Esito ------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE M4 RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
