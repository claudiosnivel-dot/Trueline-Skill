// twin_check.test.mjs — oracolo custom, deterministico, senza tool esterni.
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

test('twin_check: due dir sorelle con file paralleli -> segnale', () => {
  const d = mkdtempSync(join(tmpdir(), 'twin-'));
  for (const [ent, files] of [['commesse', ['useAccontoCommessa', 'useElencoCommessa', 'DettaglioCommessa']],
                              ['preventivi', ['useAccontoPreventivo', 'useElencoPreventivo', 'DettaglioPreventivo']]]) {
    mkdirSync(join(d, ent), { recursive: true });
    for (const f of files) writeFileSync(join(d, ent, `${f}.ts`), 'export const x = 1;');
  }
  const r = run('twin_check.mjs', d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.out);
  assert.ok(j.twins.length >= 1, 'atteso >=1 twin');
  assert.deepEqual(j.twins[0].parallelFiles.sort(), ['DettaglioPreventivo.ts', 'useAccontoPreventivo.ts', 'useElencoPreventivo.ts'].sort());
});

test('twin_check: dir NON parallele -> nessun segnale (contrasto anti-vacuo)', () => {
  const d = mkdtempSync(join(tmpdir(), 'twin2-'));
  mkdirSync(join(d, 'auth'), { recursive: true }); writeFileSync(join(d, 'auth', 'login.ts'), 'export const x=1;');
  mkdirSync(join(d, 'billing'), { recursive: true }); writeFileSync(join(d, 'billing', 'invoice.ts'), 'export const y=1;');
  const r = run('twin_check.mjs', d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(JSON.parse(r.out).twins.length, 0);
});
