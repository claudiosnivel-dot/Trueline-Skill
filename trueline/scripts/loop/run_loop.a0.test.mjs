// run_loop.a0.test.mjs — A0 ride-along: collectFindings semina l'oracolo authz
// del MANIFEST attivo (non solo firestore), cosi' la baseline pre-fix del loop ha
// un finding authz su cui rerunOracleFor puo' girare anche sui 4 backend
// non-Firebase (L-COL-002). Senza manifest = comportamento firestore invariato (BIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFindings } from './run_loop.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const FIX = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'eval', 'ecosystems', '_a0-fixtures');

test('collectFindings semina authz per un pack Appwrite (non solo firestore)', () => {
  const manifest = { oracles: { authz: { tool: 'appwrite_perms_check', role: 'authz-surface', scan: ['.'] } } };
  const found = collectFindings(resolve(FIX, 'appwrite-jsts', 'open'), manifest);
  assert.ok(found.some((f) => f.category === 'authz'), 'atteso >=1 finding authz dalla baseline');
});

test('collectFindings senza manifest = comportamento firestore invariato', () => {
  const found = collectFindings(resolve(FIX, 'firebase-jsts', 'open'));
  assert.ok(found.some((f) => f.category === 'authz'));
});
