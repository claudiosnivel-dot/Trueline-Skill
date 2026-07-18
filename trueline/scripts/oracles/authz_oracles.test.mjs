// authz_oracles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHZ_ORACLES, AUTHZ_TOOL_NAMES, authzScanTarget } from './authz_oracles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('mappa: 5 oracoli, chiavi = nomi-tool del manifest', () => {
  assert.deepEqual([...AUTHZ_TOOL_NAMES].sort(), [
    'appsync_auth_check','appwrite_perms_check','firestore_rules_check',
    'hasura_metadata_check','pocketbase_rules_check',
  ]);
});

test('ogni normalizeKey e la source_oracle attesa dal normalize', () => {
  assert.equal(AUTHZ_ORACLES.firestore_rules_check.normalizeKey, 'firestore-rules');
  assert.equal(AUTHZ_ORACLES.appwrite_perms_check.normalizeKey, 'appwrite-perms');
  assert.equal(AUTHZ_ORACLES.pocketbase_rules_check.normalizeKey, 'pocketbase-rules');
  assert.equal(AUTHZ_ORACLES.hasura_metadata_check.normalizeKey, 'hasura-metadata');
  assert.equal(AUTHZ_ORACLES.appsync_auth_check.normalizeKey, 'appsync-auth');
});

test('authzScanTarget: default "." quando il binding non ha scan', () => {
  assert.equal(authzScanTarget('/x', {}), resolve('/x', '.'));
});

test('COERENZA: ogni normalizeKey e dispatchata da loop.mjs::rerunOracleFor', () => {
  // il gate batch e il re-run del loop DEVONO eseguire lo stesso oracolo (L-COL-002).
  const loopSrc = readFileSync(resolve(HERE, '..', 'loop', 'loop.mjs'), 'utf8');
  for (const { normalizeKey } of Object.values(AUTHZ_ORACLES)) {
    assert.ok(loopSrc.includes(`'${normalizeKey}'`), `loop.mjs non dispatcha ${normalizeKey}`);
  }
});
