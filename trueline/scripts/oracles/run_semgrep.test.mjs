#!/usr/bin/env node
// run_semgrep.test.mjs — Task T2.0 (SP-1): 2do arg posizionale opzionale
// [rulesetPath] per run_semgrep.mjs. Default INVARIATO (ruleset condiviso
// trueline-ai-ruleset.yml). Test-first (L-COL-019): scritto PRIMA che il param
// sia usato, deve FALLIRE finche' run_semgrep non onora rulesetPath.
//
// Gate: node trueline/scripts/oracles/run_semgrep.test.mjs
// Atteso: OK + exit 0
//
// NON-TAUTOLOGICO (10 §3 del piano): con un ruleset DUMMY (che non combacia
// nulla) i finding su un sorgente noto (eval/reference-app) CAMBIANO rispetto al
// default (che trova S6/S7). Se il param fosse ignorato, il dummy troverebbe gli
// stessi finding del default -> il test fallirebbe. Cosi il verde e' un FATTO
// dell'oracolo (output reale), MAI una tautologia.
//
// Casi:
//   1. DEFAULT (no rulesetPath): JSON Semgrep valido; trova S6 (db.ts) e S7
//      (bookings.ts) come oggi — regressione del comportamento v1.
//   2. DUMMY ruleset (file .yml che non combacia nulla): JSON valido con 0
//      results -> i finding DIFFERISCONO dal default (param onorato, non tautologico).
//   3. rulesetPath INESISTENTE -> exit 2 (errore dichiarato, mai falso verde).
//   4. (no-docker) stderr del run espone il --config: col default punta al
//      trueline-ai-ruleset.yml; col dummy punta al file dummy. Asserzione
//      strutturale del cablaggio del param, indipendente da docker.
//
// Richiede docker + immagine semgrep pinnata per i casi 1/2 (differenziale). Se
// docker NON e' disponibile, quei casi NON si possono provare end-to-end: il
// test ESCE 2 (precondizione non soddisfatta — esito DISTINTO, MAI un falso
// verde, MAI uno skip silenzioso), come m3/m4/m5. Il caso 3 e 4 (cablaggio) non
// richiedono docker e si provano comunque.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const SCRIPT = resolve(__dirname, 'run_semgrep.mjs');
const REF_APP = 'eval/reference-app'; // relativo alla repo root (come l'arg di run_semgrep)
const SHARED_RULESET = resolve(
  ROOT, 'trueline', 'references', 'oracles', 'semgrep-ai-ruleset', 'trueline-ai-ruleset.yml',
);
const SEMGREP_IMAGE = 'semgrep/semgrep:latest';

const results = [];
const check = (n, ok, detail) => {
  results.push({ n, ok: Boolean(ok) });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${detail ? ` — ${detail}` : ''}`);
};

// Esegue run_semgrep.mjs (args posizionali) e ritorna { status, stdout, stderr }.
function runSemgrep(args = [], timeoutMs = 240_000) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024, env: process.env,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// docker disponibile + immagine semgrep pinnata presente?
function dockerReady() {
  const v = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (v.error || v.status !== 0) return false;
  const img = spawnSync('docker', ['images', '-q', SEMGREP_IMAGE], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  return !img.error && img.status === 0 && Boolean((img.stdout || '').trim());
}

// Numero di results Semgrep dal JSON nativo (0 se assente/malformato).
function countResults(stdout) {
  try {
    const j = JSON.parse(stdout);
    return Array.isArray(j.results) ? j.results.length : 0;
  } catch { return null; } // null = JSON non valido
}

// Un dummy ruleset Semgrep VALIDO che non combacia nulla nella reference-app:
// cerca una CHIAMATA a una funzione inventata che non esiste nei sorgenti JS/TS.
// languages:[js,ts] (NON generic): cosi semgrep NON scansiona il .yml stesso (un
// matcher generic auto-combacerebbe il token letterale nel file di regole) e il
// confronto col default resta pulito (0 finding sul sorgente).
const DUMMY_RULESET_YAML = `rules:
  - id: trueline-test-dummy-never-matches
    languages: [js, ts]
    severity: INFO
    message: dummy rule che non combacia nulla nella reference-app
    pattern: __trueline_dummy_call_that_never_appears__(...)
`;

const HAVE_DOCKER = dockerReady();

// ─── Caso 4 (no-docker): cablaggio del --config sul ruleset dato ───────────
// Indipendente da docker: anche se docker non e' presente, run_semgrep stampa su
// stderr la riga "config <path>" PRIMA di eseguire docker. Verifichiamo che il
// param cambi davvero il path passato a --config.
let tmpDir = null;
let dummyRuleset = null;
try {
  tmpDir = mkdtempSync(join(tmpdir(), 'tl-semgrep-test-'));
  dummyRuleset = join(tmpDir, 'dummy.yml');
  writeFileSync(dummyRuleset, DUMMY_RULESET_YAML, 'utf8');

  console.log('\n[T2.0] Caso 4: il --config riflette il rulesetPath (no-docker, via stderr)');
  {
    const rDef = runSemgrep([REF_APP], 240_000);
    const rDum = runSemgrep([REF_APP, dummyRuleset], 240_000);
    // stderr contiene la riga diagnostica "config <containerRulePath>".
    const defUsesShared = /trueline-ai-ruleset\.yml/.test(rDef.stderr);
    check('caso-4 default: --config menziona trueline-ai-ruleset.yml', defUsesShared,
      defUsesShared ? '' : `stderr=${rDef.stderr.slice(0, 300)}`);
    const dumUsesDummy = /dummy\.yml/.test(rDum.stderr) && !/trueline-ai-ruleset\.yml/.test(rDum.stderr);
    check('caso-4 dummy: --config menziona dummy.yml e NON il ruleset condiviso', dumUsesDummy,
      dumUsesDummy ? '' : `stderr=${rDum.stderr.slice(0, 300)}`);
  }

  // ─── Caso 3 (no-docker): rulesetPath inesistente -> exit 2 ────────────────
  console.log('\n[T2.0] Caso 3: rulesetPath inesistente → exit 2 (errore dichiarato, mai falso verde)');
  {
    const missing = join(tmpDir, 'does-not-exist.yml');
    const r = runSemgrep([REF_APP, missing], 30_000);
    check('caso-3 exit 2 su ruleset inesistente', r.status === 2, `exit=${r.status}`);
    // Nessun JSON di finding "vuoto" spacciato per verde: stdout non e' un report 0-finding.
    const noFalseGreen = countResults(r.stdout) === null; // nessun JSON valido emesso
    check('caso-3 nessun JSON di finding emesso (no falso verde)', noFalseGreen,
      `results=${countResults(r.stdout)}`);
  }

  // ─── Caso 5 (no-docker): IGIENE — nessun residuo .trueline/ + sweep orfani ──
  // run_semgrep COPIA il ruleset in una sottocartella effimera .trueline/semgrep-rules/
  // DENTRO la dir progetto e DEVE ripulirla a fine run (anche su exit != 0). Un
  // run_semgrep KILLATO (SIGKILL durante il loop) non raggiunge il proprio finally
  // e lascia un GUSCIO .trueline/ ORFANO che AVVELENA i gate m4/m5 (asserzione
  // "nessun residuo .trueline/ nel fixture canonico"). Questo caso prova, come FATTO
  // di filesystem (non un parere), che:
  //   (a) un'esecuzione normale NON lascia alcun .trueline/ (neppure un guscio vuoto);
  //   (b) un .trueline/semgrep-rules/ ORFANO pre-seminato viene SPAZZATO dal run
  //       successivo (sweep all'avvio) e non sopravvive nel finally.
  // Indipendente da docker: la copia effimera + il cleanup girano comunque (anche se
  // docker manca, run_semgrep esce 2 ma passa per mkdir effimero e finally).
  console.log('\n[T2.0] Caso 5: IGIENE — niente residuo .trueline/ + sweep di un orfano pre-esistente');
  {
    // Dir progetto usa-e-getta: copia minima della reference-app (sorgenti JS/TS),
    // sotto tmp (NON tocca il fixture canonico).
    const proj = join(tmpDir, 'proj-hygiene');
    mkdirSync(join(proj, 'src'), { recursive: true });
    writeFileSync(join(proj, 'src', 'noop.ts'), 'export const x = 1;\n', 'utf8');

    // (a) run normale -> nessun .trueline/ residuo.
    const r1 = runSemgrep([proj], 240_000);
    const noShellAfterRun = !existsSync(join(proj, '.trueline'));
    check('caso-5a nessun .trueline/ residuo dopo un run normale (finally pulisce)', noShellAfterRun,
      noShellAfterRun ? `exit=${r1.status}` : `.trueline/ residuo (cleanup mancato), exit=${r1.status}`);

    // (b) semina un ORFANO (come lo lascerebbe un run killato) e verifica lo sweep.
    const orphanSub = join(proj, '.trueline', 'semgrep-rules');
    mkdirSync(orphanSub, { recursive: true });
    writeFileSync(join(orphanSub, 'stale.yml'), 'rules: []\n', 'utf8');
    const r2 = runSemgrep([proj], 240_000);
    // Dopo il run successivo, ne' lo stale.yml ne' un guscio .trueline/ devono restare.
    const orphanGone = !existsSync(join(orphanSub, 'stale.yml')) && !existsSync(join(proj, '.trueline'));
    check('caso-5b orfano .trueline/ pre-esistente SPAZZATO dal run successivo (no guscio)', orphanGone,
      orphanGone ? `exit=${r2.status}` : `orfano sopravvissuto, exit=${r2.status}`);
  }

  // ─── Casi 1/2 (docker): differenziale default vs dummy ────────────────────
  if (!HAVE_DOCKER) {
    console.log('\n[T2.0] docker/semgrep NON disponibile: casi 1/2 (differenziale) non provabili end-to-end.');
    console.log('       ESCO 2 (precondizione non soddisfatta) — i casi 3/4 (cablaggio) sono passati sopra.');
    const failedNow = results.filter((r) => !r.ok);
    if (failedNow.length > 0) {
      console.log(`\nFAIL — ${results.length - failedNow.length}/${results.length} (cablaggio rotto)`);
      process.exit(1);
    }
    process.exit(2);
  }

  console.log('\n[T2.0] Caso 1: DEFAULT (no rulesetPath) → JSON valido, trova S6 (db.ts) + S7 (bookings.ts)');
  let defaultCount = null;
  {
    const r = runSemgrep([REF_APP], 240_000);
    check('caso-1 exit 0 o 1 (finding trovati)', r.status === 0 || r.status === 1, `exit=${r.status}`);
    defaultCount = countResults(r.stdout);
    check('caso-1 stdout JSON Semgrep valido', defaultCount !== null,
      defaultCount === null ? `stdout=${r.stdout.slice(0, 200)}` : `results=${defaultCount}`);
    const raw = r.stdout;
    const hasS6 = /db\.ts/.test(raw);
    const hasS7 = /bookings\.ts/.test(raw);
    check('caso-1 trova S6 (src/db.ts) — ruleset condiviso onorato di default', hasS6,
      hasS6 ? '' : 'db.ts non nei results');
    check('caso-1 trova S7 (src/routes/bookings.ts) — ruleset condiviso onorato di default', hasS7,
      hasS7 ? '' : 'bookings.ts non nei results');
    check('caso-1 default trova >=2 finding (S6+S7)', (defaultCount || 0) >= 2, `results=${defaultCount}`);
  }

  console.log('\n[T2.0] Caso 2: DUMMY ruleset → 0 results (i finding DIFFERISCONO dal default, non tautologico)');
  {
    const r = runSemgrep([REF_APP, dummyRuleset], 240_000);
    check('caso-2 exit 0 (nessun finding col dummy)', r.status === 0, `exit=${r.status}`);
    const dummyCount = countResults(r.stdout);
    check('caso-2 stdout JSON Semgrep valido', dummyCount !== null,
      dummyCount === null ? `stdout=${r.stdout.slice(0, 200)}` : `results=${dummyCount}`);
    check('caso-2 dummy trova 0 results (ruleset dato onorato)', dummyCount === 0, `results=${dummyCount}`);
    // L'ASSERZIONE NON-TAUTOLOGICA: dummy != default. Se il param fosse ignorato,
    // dummyCount === defaultCount e questo fallirebbe.
    check('caso-2 i finding del dummy DIFFERISCONO dal default (param non ignorato)',
      defaultCount !== null && dummyCount !== null && dummyCount !== defaultCount,
      `dummy=${dummyCount} default=${defaultCount}`);
  }
} finally {
  if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
}

// ─── Riepilogo ──────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
if (failed.length > 0) {
  console.log('Test falliti:');
  failed.forEach((r) => console.log(`  - ${r.n}`));
}
process.exit(failed.length === 0 ? 0 : 1);
