// baseline.a2c.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture, loadHygieneBaseline } from './baseline.mjs';

const OPTS = { runId: 'a2c', createdAt: '1970-01-01T00:00:00.000Z' };

test('capture con twin: due dir sorelle parallele -> snapshot con finding architecture(twin)', () => {
  const d = mkdtempSync(join(tmpdir(), 'a2c-cap-'));
  for (const [ent, files] of [['commesse', ['useAcconto', 'useElenco', 'Dettaglio']],
    ['preventivi', ['useAcconto', 'useElenco', 'Dettaglio']]]) {
    mkdirSync(join(d, ent), { recursive: true });
    for (const f of files) writeFileSync(join(d, ent, `${f}.ts`), 'export const x = 1;');
  }
  const res = capture(d, ['twin'], OPTS);
  rmSync(d, { recursive: true, force: true });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const twins = res.findings.filter((f) => f.source_oracle.oracle === 'twin');
  assert.ok(twins.length >= 1, 'atteso >=1 finding twin nello snapshot');
  assert.equal(twins[0].category, 'architecture');
  assert.ok(Array.isArray(res.snapshot.fingerprints) && res.snapshot.fingerprints.includes(twins[0].fingerprint));
});

test('capture con jscpd: due file con blocco identico -> finding duplication (skip se jscpd assente)', () => {
  const d = mkdtempSync(join(tmpdir(), 'a2c-dup-'));
  const block = Array.from({ length: 20 }, (_, i) => `  const v${i} = compute(${i}) + helper(${i}) * 2;`).join('\n');
  writeFileSync(join(d, 'a.ts'), `export function a(){\n${block}\n  return 1;\n}`);
  writeFileSync(join(d, 'b.ts'), `export function b(){\n${block}\n  return 2;\n}`);
  const res = capture(d, ['jscpd'], { ...OPTS, minTokens: 50 });
  rmSync(d, { recursive: true, force: true });
  // jscpd offline (npx non risolve) -> capture dichiara l'errore, NON falsifica.
  const dup = (res.findings || []).filter((f) => f.category === 'duplication');
  if (res.ok && dup.length >= 1) {
    assert.equal(dup[0].source_oracle.oracle, 'jscpd');
  } else {
    assert.ok(res.errors.some((e) => /jscpd/i.test(e)), `jscpd assente dichiarato: ${JSON.stringify(res.errors)}`);
  }
});
