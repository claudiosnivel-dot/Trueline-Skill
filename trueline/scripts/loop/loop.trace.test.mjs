// loop.trace.test.mjs — rerunOracleFor sa rieseguire l'oracolo authz Firestore (SP-8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rerunOracleFor } from './loop.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const TMP = join(ROOT, 'eval', `.tmp-sp8-loop-${process.pid}`);

test('rerunOracleFor(authz) ri-esegue firestore_rules_check e ritorna finding authz', () => {
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, 'firestore.rules'),
    "service cloud.firestore { match /databases/{db}/documents { match /n/{id} { allow read: if true; } } }\n");
  const finding = { category: 'authz', location: { file: 'firestore.rules' }, source_oracle: { rule_id: 'FIRESTORE001_PUBLIC_ALLOW' } };
  const r = rerunOracleFor(finding, TMP, {});
  assert.equal(r.ok, true, r.detail);
  assert.ok(r.findings.some((f) => f.category === 'authz'), 'almeno un finding authz');
  rmSync(TMP, { recursive: true, force: true });
});

test('rerunOracleFor(authz) su regola owner-scoped → 0 finding (pulito)', () => {
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, 'firestore.rules'),
    "service cloud.firestore { match /databases/{db}/documents { match /n/{id} { allow read: if request.auth != null && request.auth.uid == resource.data.ownerId; } } }\n");
  const finding = { category: 'authz', location: { file: 'firestore.rules' }, source_oracle: { rule_id: 'FIRESTORE001_PUBLIC_ALLOW' } };
  const r = rerunOracleFor(finding, TMP, {});
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.findings.length, 0, 'regola owner-scoped → nessun finding');
  rmSync(TMP, { recursive: true, force: true });
});
