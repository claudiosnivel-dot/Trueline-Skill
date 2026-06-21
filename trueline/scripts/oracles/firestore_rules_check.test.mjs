#!/usr/bin/env node
// firestore_rules_check.test.mjs — Unit test dell'oracolo Firestore Rules (T1.1).
//
// Gate: node trueline/scripts/oracles/firestore_rules_check.test.mjs
// Atteso: ultima riga "=== firestore_rules_check.test RESULT: PASS (N/N) ===" + exit 0.
//
// Casi:
//   1. allow read, write: if true; su una collection → esattamente 1 PUBLIC_ALLOW.
//   2. owner-scoped (request.auth != null && request.auth.uid == resource.data.ownerId) → 0 findings.
//   3. split allow read: if true; AND allow write: if true; → 2 PUBLIC_ALLOW.
//   4. match /{document=**}{ allow read, write: if true; } wildcard ricorsivo → caught.
//   5. malformato/troncato (allow read: if) → un parse_warnings, NO crash, exit 0.
//   6. invocazione senza argomenti → exit 2.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'firestore_rules_check.mjs');

let passed = 0;
let total = 0;
const failures = [];

function check(label, cond) {
  total++;
  if (cond) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failures.push(label);
    console.log(`  [FAIL] ${label}`);
  }
}

// Esegue l'oracolo su un percorso e ritorna { status, stdout, stderr, json }.
function runOracle(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: process.env,
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* lasciamo json=null: i singoli casi verificano la validita' dove serve */
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

// Scrive un file firestore.rules in una tempdir nuova e ritorna { dir, file }.
function writeRules(content) {
  const dir = mkdtempSync(join(tmpdir(), 'fsrules-'));
  const file = join(dir, 'firestore.rules');
  writeFileSync(file, content, 'utf8');
  return { dir, file };
}

const tmpDirs = [];
function makeRules(content) {
  const r = writeRules(content);
  tmpDirs.push(r.dir);
  return r;
}

function countControl(json, controlId) {
  if (!json || !Array.isArray(json.findings)) return 0;
  return json.findings.filter((f) => f.control_id === controlId).length;
}

// ─── Caso 1: allow read, write: if true; su una collection ──────────────────
console.log('\n[T1.1] Caso 1: allow read, write: if true; → 1 PUBLIC_ALLOW');
{
  const { file } = makeRules(`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /posts/{postId} {
      allow read, write: if true;
    }
  }
}
`);
  const { status, json } = runOracle([file]);
  check('caso-1 exit 0', status === 0);
  check('caso-1 JSON valido', json !== null);
  const c = countControl(json, 'FIRESTORE001_PUBLIC_ALLOW');
  check('caso-1 esattamente 1 PUBLIC_ALLOW', c === 1);
  if (json && Array.isArray(json.findings)) {
    const f = json.findings.find((x) => x.control_id === 'FIRESTORE001_PUBLIC_ALLOW');
    check('caso-1 finding ha match_path', !!f && typeof f.match_path === 'string' && f.match_path.length > 0);
    check('caso-1 finding ha allow', !!f && typeof f.allow === 'string' && f.allow.length > 0);
    check('caso-1 severity HIGH', !!f && f.severity === 'HIGH');
    check('caso-1 category authz', !!f && f.category === 'authz');
    check('caso-1 NON euristico (deterministico)', !!f && f.heuristic === undefined);
    check('caso-1 location.start_line popolata', !!f && Number.isInteger(f.location.start_line) && f.location.start_line > 0);
  }
}

// ─── Caso 2: owner-scoped → 0 findings ──────────────────────────────────────
console.log('\n[T1.1] Caso 2: owner-scoped (auth.uid == ownerId) → 0 findings');
{
  const { file } = makeRules(`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /docs/{docId} {
      allow read: if request.auth != null && request.auth.uid == resource.data.ownerId;
    }
  }
}
`);
  const { status, json } = runOracle([file]);
  check('caso-2 exit 0', status === 0);
  check('caso-2 JSON valido', json !== null);
  const n = json && Array.isArray(json.findings) ? json.findings.length : -1;
  check('caso-2 zero findings (regola pulita)', n === 0);
}

// ─── Caso 3: split allow read/write: if true; → 2 PUBLIC_ALLOW ──────────────
console.log('\n[T1.1] Caso 3: split allow read/write if true; → 2 PUBLIC_ALLOW');
{
  const { file } = makeRules(`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /items/{itemId} {
      allow read: if true;
      allow write: if true;
    }
  }
}
`);
  const { status, json } = runOracle([file]);
  check('caso-3 exit 0', status === 0);
  check('caso-3 JSON valido', json !== null);
  const c = countControl(json, 'FIRESTORE001_PUBLIC_ALLOW');
  check('caso-3 esattamente 2 PUBLIC_ALLOW', c === 2);
}

// ─── Caso 4: match /{document=**}{ allow read, write: if true; } wildcard ───
console.log('\n[T1.1] Caso 4: wildcard ricorsivo {document=**} if true; → caught');
{
  const { file } = makeRules(`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
`);
  const { status, json } = runOracle([file]);
  check('caso-4 exit 0', status === 0);
  check('caso-4 JSON valido', json !== null);
  const c = countControl(json, 'FIRESTORE001_PUBLIC_ALLOW');
  check('caso-4 wildcard ricorsivo segnalato (>=1 PUBLIC_ALLOW)', c >= 1);
  if (json && Array.isArray(json.findings)) {
    const f = json.findings.find((x) => x.control_id === 'FIRESTORE001_PUBLIC_ALLOW');
    check('caso-4 match_path contiene document=**', !!f && f.match_path.includes('document=**'));
  }
}

// ─── Caso 5: malformato/troncato (allow read: if) → parse_warnings, no crash ─
console.log('\n[T1.1] Caso 5: allow read: if (troncato) → parse_warnings, no crash, exit 0');
{
  const { file } = makeRules(`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /broken/{id} {
      allow read: if
    }
  }
}
`);
  const { status, json } = runOracle([file]);
  check('caso-5 exit 0 (mai crash)', status === 0);
  check('caso-5 JSON valido', json !== null);
  const warns = json && Array.isArray(json.parse_warnings) ? json.parse_warnings.length : 0;
  check('caso-5 almeno un parse_warnings', warns >= 1);
}

// ─── Caso 6: nessun argomento → exit 2 ──────────────────────────────────────
console.log('\n[T1.1] Caso 6: nessun argomento → exit 2');
{
  const { status } = runOracle([]);
  check('caso-6 exit 2', status === 2);
}

// ─── Caso 7: parentesi su `true` → PUBLIC_ALLOW (regressione if-(true)) ──────
// `if (true);`, `if ( true );`, `if ((true));` sono accesso pubblico identico a
// `if true;` e DEVONO entrare nel floor (falso-negativo trovato dai verifier k=2).
console.log('\n[T1.1] Caso 7: if (true) / ((true)) parentesizzato → PUBLIC_ALLOW');
{
  const variants = ['if (true)', 'if ( true )', 'if ((true))'];
  for (const v of variants) {
    const { file } = makeRules(`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /pub/{id} {
      allow read, write: ${v};
    }
  }
}
`);
    const { status, json } = runOracle([file]);
    check(`caso-7 [${v}] exit 0`, status === 0);
    const c = countControl(json, 'FIRESTORE001_PUBLIC_ALLOW');
    check(`caso-7 [${v}] esattamente 1 PUBLIC_ALLOW`, c === 1);
    const warns = json && Array.isArray(json.parse_warnings) ? json.parse_warnings.length : -1;
    check(`caso-7 [${v}] nessun parse_warning (parse pulito)`, warns === 0);
  }
}

// ─── Caso 8: parentesi NON avvolgenti → 0 (no falso positivo) ────────────────
// `(a) == (b)` ha parentesi ma non e' la costante true: NON deve essere colta.
console.log('\n[T1.1] Caso 8: condizione parentesizzata non-true → 0 (no FP)');
{
  const { file } = makeRules(`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /cmp/{id} {
      allow read: if (request.auth.uid) == (resource.data.ownerId);
    }
  }
}
`);
  const { status, json } = runOracle([file]);
  check('caso-8 exit 0', status === 0);
  const c = countControl(json, 'FIRESTORE001_PUBLIC_ALLOW');
  check('caso-8 zero PUBLIC_ALLOW (parentesi non avvolgenti true)', c === 0);
}

// ─── Cleanup ────────────────────────────────────────────────────────────────
for (const d of tmpDirs) {
  try {
    rmSync(d, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// ─── Riepilogo ──────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.log('\nTest falliti:');
  failures.forEach((f) => console.log(`  - ${f}`));
}
const verdict = failures.length === 0 ? 'PASS' : 'FAIL';
console.log(`\n=== firestore_rules_check.test RESULT: ${verdict} (${passed}/${total}) ===`);
process.exit(failures.length === 0 ? 0 : 1);
