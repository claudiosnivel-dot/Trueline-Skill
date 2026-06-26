// run_checkpoint_args.test.mjs — micro-test di parsing del flag --blueprint
// (AT-1 Fase A, Task A5). Verifica SOLO il parsing degli argomenti: l'attivazione
// end-to-end del ramo AC e' esercitata dall'harness anti_tamper_check (Task A8).
// Node ESM, solo built-in (node:test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './run_checkpoint.mjs';

test('--blueprint e\' parsato (forma separata)', () => {
  const { flags } = parseArgs(['--in-place', '--blueprint', '/tmp/bp', '--mode', 'build']);
  assert.equal(flags.blueprint, '/tmp/bp');
});

test('--blueprint=<dir> e\' parsato (forma inline)', () => {
  const { flags } = parseArgs(['--blueprint=/tmp/bp2']);
  assert.equal(flags.blueprint, '/tmp/bp2');
});

test('senza --blueprint il default e\' null (BIT-invarianza)', () => {
  const { flags } = parseArgs(['--in-place', '--mode', 'build']);
  assert.equal(flags.blueprint, null);
});
