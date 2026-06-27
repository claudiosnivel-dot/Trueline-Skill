// appwrite_perms_check.test.mjs — Unit test dell'oracolo Appwrite permissions.
//
// Gate: node --test trueline/scripts/oracles/appwrite_perms_check.test.mjs
//
// Casi (dallo spec del deliverable):
//   1. public read("any")                       → esattamente 1 APPWRITE001 (shape verificata)
//   2. owner read("users") + documentSecurity   → 0 findings
//   3. JSON malformato                          → parse_warnings, NO throw, exit 0
//   4. $permissions assente / null              → 0 findings
//   5. nessun argomento                         → exit 2
//   6. piu' scope `any` (read/create/delete)    → N findings distinti
//   7. ruolo non-`any` misto a `any`            → solo l'`any` segnalato
//   8. file passato direttamente (non la dir)   → funziona
//
// Solo built-in; tempdir os.tmpdir() mkdtemp, ripulita a fine suite.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'appwrite_perms_check.mjs');

const tmpDirs = [];

// Scrive un appwrite.json (oggetto o stringa grezza) in una tempdir nuova.
function writeAppwrite(content) {
  const dir = mkdtempSync(join(tmpdir(), 'awperms-'));
  const file = join(dir, 'appwrite.json');
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  writeFileSync(file, text, 'utf8');
  tmpDirs.push(dir);
  return { dir, file };
}

// Esegue l'oracolo e ritorna { status, stdout, stderr, json }.
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
    /* json=null: i singoli casi verificano la validita' dove serve */
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function countControl(json, controlId) {
  if (!json || !Array.isArray(json.findings)) return 0;
  return json.findings.filter((f) => f.control_id === controlId).length;
}

// ─── Caso 1: public read("any") → 1 APPWRITE001 (+ shape) ───────────────────
test('caso 1: read("any") → esattamente 1 APPWRITE001 con shape corretta', () => {
  const { dir } = writeAppwrite({
    projectId: 'p',
    collections: [
      {
        $id: 'posts',
        name: 'Posts',
        documentSecurity: false,
        $permissions: ['read("any")'],
      },
    ],
  });
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido su stdout');
  assert.equal(json.oracle, 'appwrite-perms', "oracle = 'appwrite-perms'");
  assert.equal(countControl(json, 'APPWRITE001_PUBLIC_PERMISSION'), 1, 'esattamente 1 finding');

  const f = json.findings.find((x) => x.control_id === 'APPWRITE001_PUBLIC_PERMISSION');
  assert.ok(f, 'finding presente');
  assert.equal(f.severity, 'HIGH', 'severity HIGH (floor)');
  assert.equal(f.category, 'authz', "category 'authz'");
  assert.equal(f.heuristic, undefined, 'deterministico (non euristico)');
  assert.equal(typeof f.match_path, 'string');
  assert.ok(f.match_path.includes('posts#'), 'match_path = <collectionId>#<permission>');
  assert.ok(f.match_path.includes('read("any")'), 'match_path porta la permission');
  assert.ok(Number.isInteger(f.location.start_line) && f.location.start_line > 0, 'start_line popolata');
});

// ─── Caso 2: owner read("users") + documentSecurity:true → 0 ────────────────
test('caso 2: read("users") + documentSecurity:true → 0 findings', () => {
  const { dir } = writeAppwrite({
    collections: [
      {
        $id: 'profiles',
        name: 'Profiles',
        documentSecurity: true,
        $permissions: ['read("users")', 'create("users")'],
      },
    ],
  });
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(json.findings.length, 0, 'zero findings (nessun ruolo any)');
});

// ─── Caso 3: JSON malformato → parse_warnings, no throw, exit 0 ─────────────
test('caso 3: JSON malformato → parse_warnings, no throw, exit 0', () => {
  const { dir } = writeAppwrite('{ "collections": [ { "$id": "x", ');
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0 (mai crash)');
  assert.ok(json, 'JSON valido su stdout nonostante input malformato');
  assert.ok(Array.isArray(json.parse_warnings) && json.parse_warnings.length >= 1, 'almeno un parse_warning');
  assert.equal(json.findings.length, 0, 'nessun finding da input illeggibile');
});

// ─── Caso 4: $permissions assente / null → 0 ────────────────────────────────
test('caso 4: $permissions assente o null → 0 findings', () => {
  const { dir } = writeAppwrite({
    collections: [
      { $id: 'no_perms_key', name: 'NoPermsKey', documentSecurity: false },
      { $id: 'null_perms', name: 'NullPerms', documentSecurity: false, $permissions: null },
    ],
  });
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(json.findings.length, 0, 'permissions assenti/null → nessun finding');
});

// ─── Caso 5: nessun argomento → exit 2 ──────────────────────────────────────
test('caso 5: nessun argomento → exit 2', () => {
  const { status } = runOracle([]);
  assert.equal(status, 2, 'exit 2 senza argomenti');
});

// ─── Caso 6: piu' scope `any` → N findings distinti ─────────────────────────
test('caso 6: read/create/delete("any") → 3 findings distinti', () => {
  const { dir } = writeAppwrite({
    collections: [
      {
        $id: 'open',
        $permissions: ['read("any")', 'create("any")', 'delete("any")'],
      },
    ],
  });
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'APPWRITE001_PUBLIC_PERMISSION'), 3, '3 finding (uno per permission any)');
  const paths = new Set(json.findings.map((f) => f.match_path));
  assert.equal(paths.size, 3, 'match_path distinti per permission');
});

// ─── Caso 7: ruolo non-`any` misto a `any` → solo l'`any` ───────────────────
test('caso 7: mix users/team/any → solo la permission any segnalata', () => {
  const { dir } = writeAppwrite({
    collections: [
      {
        $id: 'mixed',
        documentSecurity: true,
        $permissions: ['read("users")', 'update("team:admins")', 'write("any")'],
      },
    ],
  });
  const { json } = runOracle([dir]);
  assert.equal(countControl(json, 'APPWRITE001_PUBLIC_PERMISSION'), 1, 'solo 1 finding (write any)');
  const f = json.findings[0];
  assert.ok(f.match_path.includes('write("any")'), 'segnala la permission any corretta');
});

// ─── Caso 8: file passato direttamente (non la directory) ───────────────────
test('caso 8: appwrite.json passato come file diretto → funziona', () => {
  const { file } = writeAppwrite({
    collections: [{ $id: 'c', $permissions: ['read("any")'] }],
  });
  const { status, json } = runOracle([file]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'APPWRITE001_PUBLIC_PERMISSION'), 1, '1 finding anche con file diretto');
});

// ─── Cleanup ────────────────────────────────────────────────────────────────
after(() => {
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});
