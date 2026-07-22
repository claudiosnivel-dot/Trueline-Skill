import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = resolve(HERE, 'validate_blueprint.mjs');
const TASK = [
  '```yaml', '- id: T-1', '  macrotask: m', '  objective: o',
  '  definition_of_done: [d]', '  acceptance_criteria:',
  '    - id: AC-1', '      given: g', '      when: w', '      then: t',
  '  target_tests:', '    - file: t.test.ts', '      covers: [AC-1]', '```',
].join('\n');

function bp(extraIndex) {
  const dir = mkdtempSync(join(tmpdir(), 'a2b-vb-'));
  writeFileSync(join(dir, '00-INDEX.md'), (extraIndex || '') + '\n' + TASK, 'utf8');
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [VALIDATE, dir], { encoding: 'utf8' });

test('blueprint senza blocco architecture: 5 controlli, exit 0', () => {
  const r = run(bp(''));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /ARCH_CONTRACT/);
});

test('blocco architecture ben formato: exit 0 con (6) ARCH_CONTRACT_WELL_FORMED OK', () => {
  const arch = ['```yaml', 'architecture:', '  layers:', '    ui: "src/ui/**"', '    data: "src/data/**"',
    '  forbidden:', '    - { from: ui, to: data }', '```'].join('\n');
  const r = run(bp(arch));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\[OK\] \(6\) ARCH_CONTRACT_WELL_FORMED/);
});

test('blocco architecture malformato (regola verso strato non dichiarato): exit 1', () => {
  const arch = ['```yaml', 'architecture:', '  layers:', '    ui: "src/ui/**"',
    '  forbidden:', '    - { from: ui, to: ghost }', '```'].join('\n');
  const r = run(bp(arch));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ARCH_CONTRACT_WELL_FORMED/);
});
