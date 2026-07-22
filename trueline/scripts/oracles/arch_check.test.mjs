import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerOf, evaluateContract } from './arch_check.mjs';

const layers = { ui: 'src/ui/**', domain: 'src/domain/**', data: 'src/data/**' };

test('layerOf: glob, più-specifico vince, non-assegnato -> null', () => {
  assert.equal(layerOf('src/ui/panel.ts', layers), 'ui');
  assert.equal(layerOf('src/data/db.ts', layers), 'data');
  assert.equal(layerOf('src/util/x.ts', layers), null);
});

test('violazione DIRETTA rilevata', () => {
  const graph = { 'src/ui/p.ts': ['src/data/db.ts'], 'src/data/db.ts': [] };
  const r = evaluateContract(graph, { layers, forbidden: [{ from: 'ui', to: 'data' }] });
  assert.equal(r.degraded, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].source_module, 'src/ui/p.ts');
});

test('laundering TRANSITIVO (default) rilevato; mode:direct lo IGNORA', () => {
  const graph = { 'src/ui/p.ts': ['src/domain/s.ts'], 'src/domain/s.ts': ['src/data/db.ts'], 'src/data/db.ts': [] };
  const trans = evaluateContract(graph, { layers, forbidden: [{ from: 'ui', to: 'data' }] });
  assert.equal(trans.violations.length, 1, 'transitive deve catturare ui->domain->data');
  const direct = evaluateContract(graph, { layers, forbidden: [{ from: 'ui', to: 'data', mode: 'direct' }] });
  assert.equal(direct.violations.length, 0, 'direct NON deve catturare il laundering');
});

test('conforme -> 0 violazioni (verde legittimo)', () => {
  const graph = { 'src/ui/p.ts': ['src/domain/s.ts'], 'src/domain/s.ts': ['src/data/db.ts'], 'src/data/db.ts': [] };
  const r = evaluateContract(graph, { layers, forbidden: [{ from: 'data', to: 'ui' }] });
  assert.equal(r.violations.length, 0);
  assert.equal(r.degraded, false);
});

test('vacuity: regola con strato che mappa 0 moduli -> degraded', () => {
  const graph = { 'src/ui/p.ts': [], 'src/domain/s.ts': [] }; // nessun modulo data
  const r = evaluateContract(graph, { layers, forbidden: [{ from: 'ui', to: 'data' }] });
  assert.equal(r.degraded, true);
});

test('allow-list: la violazione è marcata accepted_exception', () => {
  const graph = { 'src/ui/legacy.ts': ['src/data/db.ts'], 'src/data/db.ts': [] };
  const r = evaluateContract(graph, { layers, forbidden: [{ from: 'ui', to: 'data' }],
    allow: [{ from: 'ui', to: 'data', module: 'src/ui/legacy.ts' }] });
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].accepted_exception, true);
});
