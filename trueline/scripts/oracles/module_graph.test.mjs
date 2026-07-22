import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCycles } from './module_graph.mjs';

test('findCycles trova un ciclo elementare e lo deduplica per set', () => {
  const graph = { 'a.ts': ['b.ts'], 'b.ts': ['a.ts'], 'c.ts': [] };
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 1);
  assert.deepEqual([...cycles[0]].sort(), ['a.ts', 'b.ts']);
});

test('findCycles: DAG pulito -> nessun ciclo', () => {
  assert.equal(findCycles({ 'a.ts': ['b.ts'], 'b.ts': [] }).length, 0);
});
