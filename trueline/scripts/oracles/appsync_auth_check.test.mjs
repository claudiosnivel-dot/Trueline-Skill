// appsync_auth_check.test.mjs — Unit test dell'oracolo AppSync/Amplify @auth.
//
// Gate: node --test trueline/scripts/oracles/appsync_auth_check.test.mjs
// Atteso: tutti i subtest verdi + exit 0.
//
// Casi OBBLIGATORI (dallo spec del deliverable):
//   1. @model + @auth(rules:[{allow: public}]) -> esattamente 1 APPSYNC001.
//   2. {allow: owner}                            -> 0 finding.
//   3. {allow: private}                          -> 0 finding.
//   4. type senza @model/@auth                   -> 0 finding.
//   5. SDL malformato (@auth non bilanciato)     -> parse_warning, no throw, exit 0.
//   6. nessun argomento                          -> exit 2.
// Casi di rinforzo:
//   7. @auth multiline con mix owner+public      -> 1 finding (robustezza whitespace).
//   8. file .graphql passato direttamente        -> funziona.
//   9. piu' @model (public + owner)              -> match_path distinti, conteggio corretto.
//  10. @model presente ma @auth assente          -> 0 finding.
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
const SCRIPT = resolve(__dirname, 'appsync_auth_check.mjs');

const tmpDirs = [];

// Scrive uno schema.graphql in una tempdir nuova e ritorna { dir, file }.
function writeSchema(content) {
  const dir = mkdtempSync(join(tmpdir(), 'appsync-'));
  const file = join(dir, 'schema.graphql');
  writeFileSync(file, content, 'utf8');
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
    /* json=null: i casi che lo richiedono lo verificano */
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function countControl(json, controlId) {
  if (!json || !Array.isArray(json.findings)) return 0;
  return json.findings.filter((f) => f.control_id === controlId).length;
}

after(() => {
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

// ─── Caso 1: allow: public → 1 APPSYNC001 (+ shape) ─────────────────────────
test('caso 1: @model + @auth allow:public -> esattamente 1 APPSYNC001 (HIGH, authz)', () => {
  const { dir } = writeSchema(
    [
      'type Todo @model @auth(rules: [{ allow: public }]) {',
      '  id: ID!',
      '  name: String!',
      '}',
      '',
    ].join('\n')
  );
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido su stdout');
  assert.equal(json.oracle, 'appsync-auth', "oracle = 'appsync-auth'");
  assert.equal(countControl(json, 'APPSYNC001_PUBLIC_AUTH'), 1, 'esattamente 1 finding');

  const f = json.findings.find((x) => x.control_id === 'APPSYNC001_PUBLIC_AUTH');
  assert.ok(f, 'finding presente');
  assert.equal(f.severity, 'HIGH', 'severity HIGH (floor)');
  assert.equal(f.category, 'authz', "category 'authz'");
  assert.equal(f.heuristic, undefined, 'deterministico (non euristico)');
  assert.equal(f.match_path, 'Todo@auth', 'match_path = <TypeName>@auth');
  assert.equal(f.type_name, 'Todo', 'type_name portatore-di-simbolo');
  assert.equal(typeof f.snippet, 'string', 'snippet presente');
  assert.ok(Number.isInteger(f.location.start_line) && f.location.start_line > 0, 'start_line popolata');
});

// ─── Caso 2: allow: owner → 0 ───────────────────────────────────────────────
test('caso 2: @auth allow:owner -> 0 finding', () => {
  const { dir } = writeSchema(
    [
      'type Note @model @auth(rules: [{ allow: owner }]) {',
      '  id: ID!',
      '  body: String!',
      '}',
    ].join('\n')
  );
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(json.findings.length, 0, 'owner non e\' pubblico -> 0 finding');
});

// ─── Caso 3: allow: private → 0 ─────────────────────────────────────────────
test('caso 3: @auth allow:private -> 0 finding', () => {
  const { dir } = writeSchema(
    [
      'type Secret @model @auth(rules: [{ allow: private }]) {',
      '  id: ID!',
      '  value: String!',
      '}',
    ].join('\n')
  );
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(json.findings.length, 0, 'private non e\' pubblico -> 0 finding');
});

// ─── Caso 4: type senza @model/@auth → 0 ────────────────────────────────────
test('caso 4: type senza @model/@auth -> 0 finding', () => {
  const { dir } = writeSchema(
    [
      'type Plain {',
      '  id: ID!',
      '  label: String',
      '}',
    ].join('\n')
  );
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(json.findings.length, 0, 'nessuna direttiva @model/@auth -> 0 finding');
});

// ─── Caso 5: SDL malformato → parse_warning, no throw, exit 0 ───────────────
test('caso 5: @auth con parentesi non bilanciate -> parse_warning, no crash, exit 0', () => {
  // `@auth(` aperta e mai chiusa: SDL troncato/malformato.
  const { dir } = writeSchema(
    'type Broken @model @auth(rules: [ { allow: public }\n'
  );
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0 (mai crash)');
  assert.ok(json, 'JSON di report valido nonostante input malformato');
  assert.ok(
    Array.isArray(json.parse_warnings) && json.parse_warnings.length >= 1,
    'almeno un parse_warning'
  );
  assert.equal(json.findings.length, 0, 'blocco @auth non fidato -> nessun finding');
});

// ─── Caso 6: nessun argomento → exit 2 ──────────────────────────────────────
test('caso 6: nessun argomento -> exit 2', () => {
  const { status } = runOracle([]);
  assert.equal(status, 2, 'exit 2 senza argomenti');
});

// ─── Caso 7: @auth multiline con mix owner+public → 1 finding ───────────────
test('caso 7: @auth multiline (owner + public) -> 1 finding (robustezza whitespace)', () => {
  const { dir } = writeSchema(
    [
      'type Article',
      '  @model',
      '  @auth(',
      '    rules: [',
      '      { allow: owner }',
      '      { allow: public, operations: [read] }',
      '    ]',
      '  ) {',
      '  id: ID!',
      '  title: String!',
      '}',
    ].join('\n')
  );
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'APPSYNC001_PUBLIC_AUTH'), 1, 'una rule public -> 1 finding');
  assert.equal(json.findings[0].match_path, 'Article@auth', 'match_path corretto');
});

// ─── Caso 8: file passato direttamente (non la directory) ───────────────────
test('caso 8: schema.graphql passato come file diretto -> funziona', () => {
  const { file } = writeSchema(
    'type Doc @model @auth(rules: [{ allow: public }]) { id: ID! }\n'
  );
  const { status, json } = runOracle([file]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'APPSYNC001_PUBLIC_AUTH'), 1, '1 finding anche con file diretto');
  assert.equal(json.findings[0].match_path, 'Doc@auth', 'match_path corretto');
});

// ─── Caso 9: piu' @model (public + owner) → match_path distinti ─────────────
test('caso 9: piu\' @model -> solo i type public segnalati, match_path distinti', () => {
  const { dir } = writeSchema(
    [
      'type PublicA @model @auth(rules: [{ allow: public }]) {',
      '  id: ID!',
      '}',
      '',
      'type OwnerB @model @auth(rules: [{ allow: owner }]) {',
      '  id: ID!',
      '}',
      '',
      'type PublicC @model @auth(rules: [{ allow: public }]) {',
      '  id: ID!',
      '}',
    ].join('\n')
  );
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'APPSYNC001_PUBLIC_AUTH'), 2, 'due type public -> 2 finding');
  const paths = json.findings.map((f) => f.match_path).sort();
  assert.deepEqual(paths, ['PublicA@auth', 'PublicC@auth'], 'match_path distinti e corretti');
});

// ─── Caso 10: @model presente ma @auth assente → 0 ──────────────────────────
test('caso 10: @model senza @auth -> 0 finding', () => {
  const { dir } = writeSchema(
    [
      'type Untagged @model {',
      '  id: ID!',
      '  name: String',
      '}',
    ].join('\n')
  );
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(json.findings.length, 0, '@model senza @auth -> nessun finding');
});
