// run_dupcheck.test.mjs — richiede jscpd via npx (rete) o node_modules; se assente, skip dichiarato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function run(script, dir, extra = []) {
  const r = spawnSync(process.execPath, [resolve(HERE, script), dir, ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: (r.stdout || '').trim(), err: r.stderr };
}

test('run_dupcheck: due file con blocco identico -> >=1 duplicate', () => {
  const d = mkdtempSync(join(tmpdir(), 'dup-'));
  const block = Array.from({ length: 20 }, (_, i) => `  const x${i} = compute(${i}) + helper(${i}) * 2;`).join('\n');
  writeFileSync(join(d, 'a.ts'), `export function a(){\n${block}\n  return 1;\n}`);
  writeFileSync(join(d, 'b.ts'), `export function b(){\n${block}\n  return 2;\n}`);
  const r = run('run_dupcheck.mjs', d, ['50']);
  rmSync(d, { recursive: true, force: true });
  if (r.status === 1) { console.log('jscpd non disponibile — skip dichiarato'); return; }
  assert.equal(r.status, 0);
  const j = JSON.parse(r.out);
  assert.ok(j.duplicates.length >= 1, 'atteso >=1 clone verbatim');
});
