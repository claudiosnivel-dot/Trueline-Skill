import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadArchContract, validateArchContract } from './arch_contract.mjs';

function bp(indexBody) {
  const dir = mkdtempSync(join(tmpdir(), 'a2b-bp-'));
  writeFileSync(join(dir, '00-INDEX.md'), indexBody, 'utf8');
  return dir;
}

const GOOD = [
  '# INDEX', '', '```yaml', 'architecture:', '  layers:',
  '    ui: "src/ui/**"', '    data: "src/data/**"', '  forbidden:',
  '    - { from: ui, to: data }', '    - { from: data, to: ui, mode: direct }',
  '  allow:', '    - { from: ui, to: data, module: "src/ui/legacy.ts", note: "TICKET-1" }',
  '```', '',
].join('\n');

test('loadArchContract parsa layers/forbidden/allow', () => {
  const c = loadArchContract(bp(GOOD));
  assert.deepEqual(c.layers, { ui: 'src/ui/**', data: 'src/data/**' });
  assert.equal(c.forbidden.length, 2);
  assert.deepEqual(c.forbidden[0], { from: 'ui', to: 'data' });
  assert.equal(c.forbidden[1].mode, 'direct');
  assert.equal(c.allow[0].module, 'src/ui/legacy.ts');
});

test('loadArchContract: nessun blocco architecture -> null', () => {
  assert.equal(loadArchContract(bp('# solo prosa, nessun yaml')), null);
});

test('validateArchContract accetta un contratto ben formato', () => {
  assert.equal(validateArchContract(loadArchContract(bp(GOOD))).ok, true);
});

test('validateArchContract rifiuta: 0 regole, glob vuoto, strato non dichiarato', () => {
  assert.equal(validateArchContract({ layers: {}, forbidden: [] }).ok, false);
  assert.equal(validateArchContract({ layers: { ui: '' }, forbidden: [{ from: 'ui', to: 'ui' }] }).ok, false);
  assert.equal(validateArchContract({ layers: { ui: 'a/**' }, forbidden: [{ from: 'ui', to: 'ghost' }] }).ok, false);
});
