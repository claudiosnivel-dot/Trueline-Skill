// checkpoint.trace.test.mjs — wiring della precondizione trace nel controllo 4 (Fase B).
// Niente DB/semgrep: chiama control4Conformance direttamente con un manifest fittizio
// (test_runner.run_file) e fixture su disco. Prova: (1) BIT-invarianza — senza
// blueprintDir il ramo legacy resta degraded (immutato); (2) con --blueprint su un
// fixture tampered-untagged → RED con detail di trace ("non tracciabile"), PRIMA
// dell'esecuzione (il file passerebbe). Solo built-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { control4Conformance } from './checkpoint.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const FIX = resolve(ROOT, 'eval', 'anti-tamper');
const MANIFEST = { test_runner: { run_file: 'node --test {file}' } };

test('BIT-invarianza: senza blueprintDir il controllo 4 resta legacy (degraded)', () => {
  const app = resolve(FIX, 'faithful', 'reference-app');
  const r = control4Conformance(app, { mode: 'build', manifest: MANIFEST }); // niente blueprintDir
  assert.equal(r.id, 4);
  assert.equal(r.green, false);
  assert.equal(r.status, 'degraded'); // ramo legacy invariato
});

test('trace RED prima dell\'esecuzione: tampered-untagged → red con detail di trace', () => {
  const app = resolve(FIX, 'tampered-untagged', 'reference-app');
  const bp = resolve(FIX, 'tampered-untagged', 'seeded-blueprint');
  const r = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(r.green, false);
  assert.equal(r.status, 'red');
  assert.match(r.detail, /non tracciabile|oracolo non valido/i);
  // Prova che NON e' un fallimento d'esecuzione (il file passerebbe): il detail e' di trace.
  assert.doesNotMatch(r.detail, /test rosso|vacuo/i);
});

test('trace OK → il controllo 4 procede ed e\' verde (faithful, taggato)', () => {
  const app = resolve(FIX, 'faithful', 'reference-app');
  const bp = resolve(FIX, 'faithful', 'seeded-blueprint');
  const r = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(r.green, true);
  assert.equal(r.status, 'green');
});
