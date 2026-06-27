#!/usr/bin/env node
// pocketbase_rules_check.test.mjs — Unit test dell'oracolo PocketBase rules.
//
// Gate: node --test trueline/scripts/oracles/pocketbase_rules_check.test.mjs
// Atteso: tutti i subtest verdi + exit 0.
//
// Casi OBBLIGATORI:
//   1. listRule:""                       -> esattamente 1 POCKETBASE001.
//   2. viewRule:null                     -> 0 finding  (⚠ TEST CRITICO null=SAFE).
//   3. createRule:"@request.auth.id != \"\""  -> 0 finding (regola autenticata).
//   4. piu' rule "" (su collection diverse) -> N finding DISTINTI (match_path).
//   5. JSON malformato                   -> parse_warning, no throw, exit 0.
// Casi di rinforzo:
//   6. nessun argomento                  -> exit 2.
//   7. field ASSENTE                     -> 0 finding (non=public).
//   8. forma { collections: [...] }      -> riconosciuta come la forma array.
//   9. shape del finding (match_path, severity HIGH, category authz, non euristico).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'pocketbase_rules_check.mjs');

const tmpDirs = [];

// Scrive un pb_schema.json (oggetto o stringa grezza) in una tempdir nuova e
// ritorna la directory (passata all'oracolo per esercitare il walk ricorsivo).
function writeSchema(content) {
  const dir = mkdtempSync(join(tmpdir(), 'pbrules-'));
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  writeFileSync(join(dir, 'pb_schema.json'), body, 'utf8');
  tmpDirs.push(dir);
  return dir;
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

// ─── Caso 1: listRule:"" → 1 POCKETBASE001 ──────────────────────────────────
test('caso 1: listRule:"" -> esattamente 1 POCKETBASE001 (HIGH, authz)', () => {
  const dir = writeSchema([
    { name: 'posts', id: 'col_posts', listRule: '' },
  ]);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(countControl(json, 'POCKETBASE001_PUBLIC_RULE'), 1, 'esattamente 1 finding');
  const f = json.findings.find((x) => x.control_id === 'POCKETBASE001_PUBLIC_RULE');
  assert.equal(f.match_path, 'posts.listRule', 'match_path = <collection>.<ruleField>');
  assert.equal(f.severity, 'HIGH', 'severity HIGH');
  assert.equal(f.category, 'authz', 'category authz');
  assert.equal(f.heuristic, undefined, 'NON euristico (floor deterministico)');
  assert.equal(typeof f.snippet, 'string', 'snippet presente');
});

// ─── Caso 2: viewRule:null → 0 (⚠ TEST CRITICO null=SAFE) ───────────────────
test('caso 2 (CRITICO): viewRule:null -> 0 finding (null = LOCKED = SAFE)', () => {
  const dir = writeSchema([
    { name: 'secrets', id: 'col_secrets', viewRule: null },
  ]);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(json.findings.length, 0, 'null NON deve mai produrre finding (LOCKED=SAFE)');
});

// ─── Caso 3: createRule autenticato → 0 ─────────────────────────────────────
test('caso 3: createRule:"@request.auth.id != \\"\\"" -> 0 finding', () => {
  const dir = writeSchema([
    { name: 'notes', id: 'col_notes', createRule: '@request.auth.id != ""' },
  ]);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(json.findings.length, 0, 'regola non vuota -> nessun floor');
});

// ─── Caso 4: piu' rule "" → N finding distinti ──────────────────────────────
test('caso 4: piu\' rule "" -> N finding DISTINTI per match_path', () => {
  const dir = writeSchema([
    { name: 'alpha', id: 'col_a', listRule: '', viewRule: '' },
    { name: 'beta', id: 'col_b', deleteRule: '' },
  ]);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.ok(json, 'JSON valido');
  assert.equal(countControl(json, 'POCKETBASE001_PUBLIC_RULE'), 3, 'tre rule vuote -> 3 finding');
  const paths = json.findings.map((f) => f.match_path).sort();
  assert.deepEqual(
    paths,
    ['alpha.listRule', 'alpha.viewRule', 'beta.deleteRule'],
    'match_path distinti e corretti'
  );
});

// ─── Caso 5: JSON malformato → parse_warning, no throw ──────────────────────
test('caso 5: JSON malformato -> parse_warning, no crash, exit 0', () => {
  const dir = writeSchema('{ collections: [ this is not valid json ');
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0 (mai crash)');
  assert.ok(json, 'JSON di report valido nonostante input malformato');
  assert.ok(Array.isArray(json.parse_warnings) && json.parse_warnings.length >= 1, 'almeno un parse_warning');
  assert.equal(json.findings.length, 0, 'nessun finding da input non parsabile');
});

// ─── Caso 6: nessun argomento → exit 2 ──────────────────────────────────────
test('caso 6: nessun argomento -> exit 2', () => {
  const { status } = runOracle([]);
  assert.equal(status, 2, 'exit 2');
});

// ─── Caso 7: field assente → 0 (non = public) ───────────────────────────────
test('caso 7: rule field ASSENTE -> 0 finding', () => {
  const dir = writeSchema([
    { name: 'plain', id: 'col_plain', createRule: '@request.auth.id != ""' },
  ]);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(json.findings.length, 0, 'i rule field assenti non sono pubblici');
});

// ─── Caso 8: forma { collections: [...] } ───────────────────────────────────
test('caso 8: forma { collections: [...] } riconosciuta come array', () => {
  const dir = writeSchema({
    collections: [{ name: 'wrapped', id: 'col_w', updateRule: '' }],
  });
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(countControl(json, 'POCKETBASE001_PUBLIC_RULE'), 1, '1 finding dalla forma wrapper');
  assert.equal(json.findings[0].match_path, 'wrapped.updateRule', 'match_path corretto');
});

// ─── Caso 9: mix null/""/assente sulla stessa collection ────────────────────
test('caso 9: mix null + "" + assente -> solo "" genera finding', () => {
  const dir = writeSchema([
    {
      name: 'mixed',
      id: 'col_mixed',
      listRule: '', // pubblico  -> finding
      viewRule: null, // bloccato  -> niente
      createRule: '@request.auth.id != ""', // autenticato -> niente
      // updateRule, deleteRule assenti -> niente
    },
  ]);
  const { status, json } = runOracle([dir]);
  assert.equal(status, 0, 'exit 0');
  assert.equal(json.findings.length, 1, 'solo listRule:"" genera un finding');
  assert.equal(json.findings[0].match_path, 'mixed.listRule', 'finding sul solo campo pubblico');
});
