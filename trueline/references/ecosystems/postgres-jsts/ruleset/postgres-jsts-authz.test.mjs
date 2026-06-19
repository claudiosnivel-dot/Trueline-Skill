#!/usr/bin/env node
// =============================================================================
// postgres-jsts-authz.test.mjs — GATE di T2.2 (SP-1).
//
// È il TEST-FIRST del ruleset route-authz del pack postgres-jsts. Scritto PRIMA
// del ruleset (L-COL-019/027); con la dir ruleset/ ancora vuota (solo .gitkeep)
// run_semgrep esce 2 (ruleset vuoto) e il gate FALLISCE — è quello che vogliamo
// prima di implementare. Una volta scritto postgres-jsts-authz.yml, il gate
// diventa VERDE.
//
// Il "verde" è un FATTO di un comando reale (L-COL-002): si esegue l'oracolo
// semgrep VIA DOCKER (run_semgrep.mjs col 2° arg ruleset path, T2.0) sulla
// fixture vulnerabile T1.2, si normalizza il NATIVO con normalize('semgrep',…)
// (stesso adapter di m5_gate_check.mjs) e si asseriscono i FATTI:
//
//   (1) DETECT PG-S3: ≥1 finding category=authz, file src/routes/bookings.ts,
//       cwe=CWE-862, owasp=A01:2025, dentro l'handler MUTANTE senza auth check
//       (router.post("/bookings") — SEED:PG-S3).
//   (2) 0 FP sulla rotta di CONTRASTO: nessun finding authz nell'handler
//       router.post("/bookings/secure") (che verifica verifyToken PRIMA di
//       scrivere) — controllo per RANGE DI RIGA dentro lo stesso file.
//   (3) 0 FP su health.ts: nessun finding authz in src/routes/health.ts
//       (GET, nessun sink di scrittura DB).
//   (4) PRECISIONE GLOBALE authz: ESATTAMENTE 1 finding authz su tutta la
//       fixture (solo PG-S3) — niente acchiappa-tutto.
//
// Richiede docker + immagine semgrep pinnata. Senza docker → exit 2
// (precondizione non soddisfatta, MAI un falso verde, mai uno skip silenzioso),
// mirror del preflight di m5_gate_check.mjs.
//
// Node ESM, solo built-in (PIÙ l'adapter normalize.mjs, anch'esso built-in).
// NON tocca git.
// =============================================================================

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize } from '../../../../scripts/findings/normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// .../trueline/references/ecosystems/postgres-jsts/ruleset -> repo root 5 su:
//   ruleset -> postgres-jsts -> ecosystems -> references -> trueline -> ROOT.
const ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

const RUN_SEMGREP = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_semgrep.mjs');
const FIXTURE = 'eval/ecosystems/postgres-jsts/reference-app';
const RULESET = 'trueline/references/ecosystems/postgres-jsts/ruleset/';
const SEMGREP_IMAGE = 'semgrep/semgrep:latest';

// runOpts deterministici per normalize (riproducibilità L-COL-002).
const RUN_OPTS = {
  runId: 't22-gate',
  createdAt: '1970-01-01T00:00:00.000Z',
  base: FIXTURE,
};

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// docker disponibile + immagine semgrep pinnata presente (preflight come m5).
function dockerReady() {
  const v = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (v.error || v.status !== 0) return { ok: false, why: 'docker non risponde' };
  const img = spawnSync('docker', ['images', '-q', SEMGREP_IMAGE], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (img.error || img.status !== 0 || !(img.stdout || '').trim()) {
    return { ok: false, why: `immagine ${SEMGREP_IMAGE} assente` };
  }
  return { ok: true };
}

const fileOf = (f) => (f.location && f.location.file) || '';
const lineOf = (f) => (f.location && f.location.start_line) || 0;
const isAuthz = (f) => f.category === 'authz';

console.log('============================================================');
console.log(' GATE T2.2 — ruleset route-authz postgres-jsts (semgrep, via docker)');
console.log(`   fixture : ${FIXTURE}`);
console.log(`   ruleset : ${RULESET}`);
console.log('============================================================');
console.log('');

// 0) PREFLIGHT docker/semgrep — senza → exit 2 (precondizione non soddisfatta).
const dr = dockerReady();
if (!dr.ok) {
  console.log(`PRECONDIZIONE NON SODDISFATTA: ${dr.why}`);
  console.log(`Prepara l'oracolo: docker pull ${SEMGREP_IMAGE}`);
  process.exit(2);
}

// 1) Esegui l'oracolo semgrep col ruleset del pack (T2.0: 2° arg ruleset path).
console.log('Esecuzione run_semgrep (docker, ~1-3 min)…');
const res = spawnSync(process.execPath, [RUN_SEMGREP, FIXTURE, RULESET], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const exit = res.status;
let native = null;
try { native = JSON.parse(res.stdout); } catch { /* gestito sotto */ }

assert('run_semgrep esce 0/1 ed emette JSON nativo (ruleset path, T2.0)',
  (exit === 0 || exit === 1) && native && Array.isArray(native.results),
  native && Array.isArray(native.results)
    ? `exit=${exit} results=${native.results.length}`
    : `exit=${exit} (no JSON / ruleset vuoto?)`);

let findings = [];
try { findings = normalize('semgrep', native, RUN_OPTS); } catch { /* gestito */ }

const authzAll = findings.filter(isAuthz);
const inBookings = authzAll.filter((f) => /src\/routes\/bookings\.ts$/.test(fileOf(f)));
const inHealth = authzAll.filter((f) => /src\/routes\/health\.ts$/.test(fileOf(f)));

// (1) DETECT PG-S3: authz in bookings.ts, CWE-862, A01:2025, dentro l'handler
//     MUTANTE senza auth check (router.post("/bookings") — non /bookings/secure).
//     L'handler vulnerabile sta PRIMA della rotta di contrasto nel file: il
//     finding deve cadere nel range del primo handler (riga < inizio di
//     "/bookings/secure"). Identifichiamo il confine per contenuto al runtime
//     dalle righe note della fixture (POST /bookings ~32-40; secure ~45-57).
const pgS3 = inBookings.find((f) => f.cwe === 'CWE-862' && f.owasp === 'A01:2025');
assert('(1) DETECT PG-S3: authz in src/routes/bookings.ts (CWE-862/A01:2025)',
  Boolean(pgS3),
  pgS3 ? `line=${lineOf(pgS3)} rule=${pgS3.source_oracle.rule_id}` : 'assente');

// (2) 0 FP sulla rotta di CONTRASTO (/bookings/secure): nessun finding authz nel
//     range del secondo handler. Il primo handler (PG-S3) inizia a riga ~32 e
//     finisce a ~40; il contrasto inizia a ~45. Asseriamo che NESSUN finding
//     authz cada a riga >= 44 (dentro/dopo l'inizio del contrasto).
const CONTRAST_START_LINE = 44; // router.post("/bookings/secure") ~ riga 45
const fpContrast = inBookings.filter((f) => lineOf(f) >= CONTRAST_START_LINE);
assert('(2) 0 FP sulla rotta di CONTRASTO (/bookings/secure, auth check verifyToken)',
  fpContrast.length === 0,
  fpContrast.length ? `${fpContrast.length} FP (righe ${fpContrast.map(lineOf).join(',')})` : 'nessuno');

// (3) 0 FP su health.ts (GET, nessun sink).
assert('(3) 0 FP su src/routes/health.ts (GET, nessun sink di scrittura)',
  inHealth.length === 0,
  inHealth.length ? `${inHealth.length} FP` : 'nessuno');

// (4) PRECISIONE GLOBALE: esattamente 1 finding authz su tutta la fixture.
assert('(4) PRECISIONE: esattamente 1 finding authz su tutta la fixture (solo PG-S3)',
  authzAll.length === 1,
  `authz totali=${authzAll.length} (file: ${[...new Set(authzAll.map(fileOf))].join(', ') || 'nessuno'})`);

// --- Esito ------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE T2.2 RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
