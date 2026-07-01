import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const run = (args) => spawnSync(process.execPath, ['trueline/scripts/preflight.mjs', ...args], { encoding: 'utf8' });

test('--target=project pianifica download project-local per gitleaks', () => {
  const r = run(['--install', '--yes', '--target=project', '--dry-run', '--simulate-missing=gitleaks', '--only=gitleaks', '.']);
  assert.match(r.stdout, /\.trueline[/\\]bin/);
  assert.doesNotMatch(r.stdout, /go install/);
});
