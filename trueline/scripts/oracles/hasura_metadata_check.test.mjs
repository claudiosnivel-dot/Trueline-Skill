// hasura_metadata_check.test.mjs — Unit test dell'oracolo Hasura metadata.
//
// Gate: node --test trueline/scripts/oracles/hasura_metadata_check.test.mjs
// Atteso: tutti i subtest verdi + exit 0.
//
// Casi OBBLIGATORI (dallo spec del deliverable):
//   1. role: anonymous + filter: {}            -> esattamente 1 HASURA001 (shape).
//   2. role con filter: {user_id...}           -> 0 finding.
//   3. role: user + filter: {}                 -> 0 finding (non-anon, fuori floor).
//   4. YAML malformato                         -> parse_warning, NO throw, exit 0.
//   5. nessun argomento                        -> exit 2.
// Casi di rinforzo:
//   6. tables.yaml (sequenza aggregata)        -> N finding DISTINTI per match_path.
//   7. metadata.json (sources[].tables[])      -> JSON.parse fallback, 1 finding.
//   8. flow inline ({} vuoto + owner inline)   -> solo l'anon vuoto segnalato.
//   9. role: public e role: "*"                -> entrambi nel floor.
//  10. role: anonymous senza filter            -> 0 (conservativo).
//  11. file passato direttamente (non la dir)  -> funziona.
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
const SCRIPT = resolve(__dirname, 'hasura_metadata_check.mjs');

const tmpDirs = [];

// Scrive un singolo file di metadata in una tempdir nuova e ritorna { dir, file }.
function writeMeta(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'hasura-'));
  const file = join(dir, name);
  writeFileSync(file, content, 'utf8');
  tmpDirs.push(dir);
  return { dir, file };
}

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

// ─── Fixtures YAML (solo spazi nell'indentazione, mai tab salvo il caso 4) ───

// Tabella con un select per `anonymous` (filter: {}, pubblico) e uno per `user`
// (filter owner-scoped). Atteso: 1 solo finding (l'anonymous).
const TBL_ANON_EMPTY = `table:
  name: users
  schema: public
select_permissions:
  - role: anonymous
    permission:
      columns:
        - id
        - email
      filter: {}
  - role: user
    permission:
      columns:
        - id
        - email
      filter:
        id:
          _eq: X-Hasura-User-Id
`;

// Solo permessi owner-scoped (nessun ruolo pubblico): 0 finding.
const TBL_OWNER_ONLY = `table:
  name: profiles
  schema: public
select_permissions:
  - role: user
    permission:
      columns:
        - id
      filter:
        user_id:
          _eq: X-Hasura-User-Id
update_permissions:
  - role: user
    permission:
      columns:
        - bio
      filter:
        user_id:
          _eq: X-Hasura-User-Id
`;

// role: user + filter: {} -> NON pubblico, fuori dal floor deterministico: 0.
const TBL_USER_EMPTY = `table:
  name: notes
  schema: public
select_permissions:
  - role: user
    permission:
      columns:
        - id
      filter: {}
`;

// Sequenza aggregata (tables.yaml): due tabelle, ognuna con un permesso
// pubblico su scope diverso. Atteso: 2 finding distinti.
const TABLES_SEQ = `- table:
    name: orders
    schema: public
  select_permissions:
    - role: anonymous
      permission:
        columns:
          - id
        filter: {}
- table:
    name: invoices
    schema: public
  delete_permissions:
    - role: public
      permission:
        filter: {}
`;

// Flow inline: anon con filter: {} (vuoto) + user con filter owner inline.
const TBL_INLINE = `table:
  name: tags
  schema: public
select_permissions:
  - role: anonymous
    permission:
      columns: [id, label]
      filter: {}
  - role: user
    permission:
      columns: [id, label]
      filter: {id: {_eq: X-Hasura-User-Id}}
`;

// role: public e role: "*" su due scope: entrambi nel floor (2 finding).
const TBL_PUBLIC_STAR = `table:
  name: banners
  schema: public
select_permissions:
  - role: public
    permission:
      filter: {}
  - role: "*"
    permission:
      filter: {}
`;

// anonymous ma SENZA filter: conservativo -> 0 finding.
const TBL_NO_FILTER = `table:
  name: settings
  schema: public
select_permissions:
  - role: anonymous
    permission:
      columns:
        - id
`;

// metadata.json (forma v3 sources[].tables[]) per il fallback JSON.parse.
const METADATA_JSON = JSON.stringify(
  {
    version: 3,
    sources: [
      {
        name: 'default',
        kind: 'postgres',
        tables: [
          {
            table: { name: 'comments', schema: 'public' },
            select_permissions: [
              { role: 'anonymous', permission: { columns: ['id'], filter: {} } },
              {
                role: 'user',
                permission: {
                  columns: ['id'],
                  filter: { user_id: { _eq: 'X-Hasura-User-Id' } },
                },
              },
            ],
          },
        ],
      },
    ],
  },
  null,
  2
);

// ─── Caso 1: anonymous + filter:{} → 1 HASURA001 (+ shape) ──────────────────
test('caso 1: anonymous + filter:{} -> esattamente 1 HASURA001 (HIGH, authz)', () => {
  const { dir } = writeMeta('public_users.yaml', TBL_ANON_EMPTY);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido su stdout');
  assert.equal(json.oracle, 'hasura-metadata', "oracle = 'hasura-metadata'");
  assert.equal(countControl(json, 'HASURA001_PUBLIC_PERMISSION'), 1, 'esattamente 1 finding');

  const f = json.findings.find((x) => x.control_id === 'HASURA001_PUBLIC_PERMISSION');
  assert.ok(f, 'finding presente');
  assert.equal(f.severity, 'HIGH', 'severity HIGH (floor)');
  assert.equal(f.category, 'authz', "category 'authz'");
  assert.equal(f.heuristic, undefined, 'deterministico (non euristico)');
  assert.equal(f.match_path, 'users.select.anonymous', 'match_path = <table>.<permType>.<role>');
  assert.equal(f.role, 'anonymous', 'carrier role');
  assert.equal(f.perm_type, 'select', 'carrier perm_type');
  assert.equal(f.table, 'users', 'carrier table');
  assert.equal(typeof f.snippet, 'string', 'snippet presente');
  assert.ok(
    Number.isInteger(f.location.start_line) && f.location.start_line > 0,
    'start_line popolata (>0)'
  );
});

// ─── Caso 2: filter owner-scoped → 0 ────────────────────────────────────────
test('caso 2: filter owner-scoped (non vuoto) -> 0 finding', () => {
  const { dir } = writeMeta('public_profiles.yaml', TBL_OWNER_ONLY);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(json.findings.length, 0, 'nessun ruolo pubblico con filtro vuoto');
});

// ─── Caso 3: role:user + filter:{} → 0 (non-anon) ───────────────────────────
test('caso 3: role:user + filter:{} -> 0 finding (fuori dal floor)', () => {
  const { dir } = writeMeta('public_notes.yaml', TBL_USER_EMPTY);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(json.findings.length, 0, 'role non-pubblico -> nessun floor');
});

// ─── Caso 4: YAML malformato → parse_warning, no throw, exit 0 ──────────────
test('caso 4: YAML malformato (tab) -> parse_warning, no crash, exit 0', () => {
  const malformed = 'table:\n  name: x\nselect_permissions:\n\t- role: anonymous\n';
  const { dir } = writeMeta('broken.yaml', malformed);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0 (mai crash)');
  assert.ok(json, 'JSON di report valido nonostante input malformato');
  assert.ok(
    Array.isArray(json.parse_warnings) && json.parse_warnings.length >= 1,
    'almeno un parse_warning'
  );
  assert.equal(json.findings.length, 0, 'nessun finding da input non parsabile');
});

// ─── Caso 5: nessun argomento → exit 2 ──────────────────────────────────────
test('caso 5: nessun argomento -> exit 2', () => {
  const { status } = runOracle([]);
  assert.equal(status, 2, 'exit 2');
});

// ─── Caso 6: tables.yaml (sequenza) → 2 finding distinti ────────────────────
test('caso 6: tables.yaml sequenza -> 2 finding DISTINTI per match_path', () => {
  const { dir } = writeMeta('tables.yaml', TABLES_SEQ);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'HASURA001_PUBLIC_PERMISSION'), 2, 'due permessi pubblici');
  const paths = json.findings.map((f) => f.match_path).sort();
  assert.deepEqual(
    paths,
    ['invoices.delete.public', 'orders.select.anonymous'],
    'match_path distinti e corretti'
  );
});

// ─── Caso 7: metadata.json (sources/tables) → JSON.parse fallback ───────────
test('caso 7: metadata.json sources[].tables[] -> 1 finding (JSON fallback)', () => {
  const { dir } = writeMeta('metadata.json', METADATA_JSON);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'HASURA001_PUBLIC_PERMISSION'), 1, '1 finding dal JSON annidato');
  assert.equal(json.findings[0].match_path, 'comments.select.anonymous', 'match_path corretto');
});

// ─── Caso 8: flow inline {} + owner inline → solo l'anon vuoto ──────────────
test('caso 8: flow inline (filter:{} vuoto vs owner inline) -> solo l\'anon', () => {
  const { dir } = writeMeta('public_tags.yaml', TBL_INLINE);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'HASURA001_PUBLIC_PERMISSION'), 1, 'solo il filtro inline vuoto');
  assert.equal(json.findings[0].match_path, 'tags.select.anonymous', 'segnala il filtro vuoto, non l\'owner');
});

// ─── Caso 9: role: public e role: "*" → entrambi nel floor ──────────────────
test('caso 9: role public e "*" -> 2 finding (entrambi pubblici)', () => {
  const { dir } = writeMeta('public_banners.yaml', TBL_PUBLIC_STAR);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'HASURA001_PUBLIC_PERMISSION'), 2, 'public e * sono pubblici');
  const roles = json.findings.map((f) => f.role).sort();
  assert.deepEqual(roles, ['*', 'public'], 'ruoli pubblici riconosciuti');
});

// ─── Caso 10: anonymous senza filter → 0 (conservativo) ─────────────────────
test('caso 10: anonymous SENZA filter -> 0 finding (conservativo)', () => {
  const { dir } = writeMeta('public_settings.yaml', TBL_NO_FILTER);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(json.findings.length, 0, 'filtro assente != filtro vuoto -> nessun finding');
});

// ─── Caso 11: file passato direttamente → funziona ──────────────────────────
test('caso 11: file .yaml passato come file diretto -> funziona', () => {
  const { file } = writeMeta('public_users.yaml', TBL_ANON_EMPTY);
  const { status, json } = runOracle([file]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'HASURA001_PUBLIC_PERMISSION'), 1, '1 finding anche con file diretto');
});
