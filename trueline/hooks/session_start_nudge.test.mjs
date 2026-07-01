import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const NUDGE = join(HERE, 'session_start_nudge.mjs');

test('session_start_nudge cita trueline + i trigger', () => {
  const r = spawnSync(process.execPath, [NUDGE], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /trueline/i);
  assert.match(r.stdout, /audit|secur|remediat|RLS|blueprint/i);
});
