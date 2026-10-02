// run_gitleaks.test.mjs — l'oracolo secret legge le allowlist del `.gitleaks.toml`
// di progetto (03 §5.2, 08 §5.2: il FP confermato vive nella config che l'oracolo
// legge). Solo le allowlist: `[extend]` e `[[rules]]` del progetto non si applicano,
// cosi' un progetto non puo' spegnere le regole di Trueline. Senza `.gitleaks.toml`
// la config resta quella di Trueline (BIT-invariante).
//
// Node ESM, solo built-in. I casi end-to-end richiedono gitleaks: senza, sono
// SALTATI e dichiarati (mai un verde finto, L-COL-006).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractProjectAllowlists, projectConfigFor, resolveGitleaksBin } from './run_gitleaks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'run_gitleaks.mjs');
const TRUELINE_CONFIG = resolve(__dirname, 'gitleaks.toml');

// Segreto finto costruito a runtime (nessun literal nel sorgente, nessun formato
// di provider reale): accende `trueline-generic-assigned-secret`.
const FAKE = 'tlfix_' + 'zq7Xk2LmN9pR4sT8' + 'vW1yZ3bC6dF0gH5jKab';
const OTHER = 'tlfix_' + 'Hq2Vn8TwX4kPz9Lm' + 'R3sJ6cB1yD7fG0aQe';

const gitleaksAvailable = !spawnSync(resolveGitleaksBin(), ['version'], { encoding: 'utf8' }).error;
const e2e = gitleaksAvailable ? test : (name, fn) => test(name, { skip: 'gitleaks non disponibile: caso non eseguito (L-COL-006)' }, fn);

function makeProject(secret, projectToml) {
  const dir = mkdtempSync(join(tmpdir(), 'tl-gl-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'config.ts'), `export const SESSION_SECRET = "${secret}";\n`);
  if (projectToml !== undefined) writeFileSync(join(dir, '.gitleaks.toml'), projectToml);
  return dir;
}

function runOracle(dir) {
  const r = spawnSync(process.execPath, [SCRIPT, dir, 'working-tree'], { encoding: 'utf8' });
  return { status: r.status, findings: r.status === 0 ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

const ALLOW_FAKE = `[[allowlists]]
description = "valore finto della fixture"
regexTarget = "match"
regexes = ['''${FAKE}''']
`;

test('extractProjectAllowlists tiene solo [[allowlists]] e il legacy [allowlist]', () => {
  const toml = [
    'title = "progetto"',
    '[extend]',
    'useDefault = true',
    'disabledRules = ["trueline-generic-assigned-secret"]',
    '[[rules]]',
    'id = "regola-di-progetto"',
    "regex = '''x'''",
    '[[rules.allowlists]]',
    "regexes = ['''y''']",
    '[[allowlists]]  # commento in coda',
    'description = "uno"',
    "regexes = ['''a''']",
    '[allowlist]',
    'description = "legacy"',
    "regexes = ['''b''']",
    '[[allowlist]]',
    "regexes = ['''c''']",
  ].join('\r\n');

  const r = extractProjectAllowlists(toml);

  assert.equal(r.blocks.length, 2);
  assert.match(r.blocks[0], /^\[\[allowlists\]\]\n/);
  assert.match(r.blocks[0], /description = "uno"/);
  assert.match(r.blocks[1], /^\[\[allowlists\]\]\n/);
  assert.match(r.blocks[1], /description = "legacy"/);
  assert.ok(!r.blocks.join('\n').includes('disabledRules'));
  assert.ok(!r.blocks.join('\n').includes('regola-di-progetto'));
  assert.deepEqual(r.ignored, ['[extend]', '[[rules]]', '[[rules.allowlists]]', '[[allowlist]]']);
});

test('extractProjectAllowlists conta le allowlist con paths e senza targetRules', () => {
  const toml = [
    '[[allowlists]]',
    "paths = ['''^fixtures/''']",
    '[[allowlists]]',
    'targetRules = ["generic-api-key"]',
    "paths = ['''^fixtures/''']",
    '[[allowlists]]',
    "regexes = ['''z''']",
  ].join('\n');

  assert.equal(extractProjectAllowlists(toml).wholeFileSkips, 1);
});

test('senza .gitleaks.toml di progetto la config resta quella di Trueline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-gl-'));
  const p = projectConfigFor(dir);
  try {
    assert.equal(p.config, TRUELINE_CONFIG);
    assert.equal(p.applied, 0);
  } finally {
    p.cleanup();
  }
});

e2e('senza allowlist di progetto il segreto finto e un finding', () => {
  const r = runOracle(makeProject(FAKE));
  assert.equal(r.status, 0);
  assert.ok(r.findings.some((f) => f.RuleID === 'trueline-generic-assigned-secret'));
});

e2e("un'allowlist di progetto per il valore esatto spegne il finding", () => {
  const dir = makeProject(FAKE, ALLOW_FAKE);
  const before = readdirSync(dir).sort();

  const r = runOracle(dir);

  assert.equal(r.status, 0);
  assert.deepEqual(r.findings, []);
  assert.match(r.stderr, /allowlist di progetto: 1/);
  assert.deepEqual(readdirSync(dir).sort(), before); // la config unita non finisce nel progetto
});

e2e("l'allowlist di progetto non copre un valore diverso", () => {
  const r = runOracle(makeProject(OTHER, ALLOW_FAKE));
  assert.equal(r.status, 0);
  assert.ok(r.findings.some((f) => f.RuleID === 'trueline-generic-assigned-secret'));
});

e2e('il progetto non puo spegnere le regole di Trueline con [extend] disabledRules', () => {
  const toml = '[extend]\nuseDefault = true\ndisabledRules = ["trueline-generic-assigned-secret", "generic-api-key"]\n';
  const r = runOracle(makeProject(FAKE, toml));
  assert.equal(r.status, 0);
  assert.ok(r.findings.some((f) => f.RuleID === 'trueline-generic-assigned-secret'));
  assert.match(r.stderr, /\[extend\]/);
});

e2e('una tabella [[allowlist]] (non valida per gitleaks) e ignorata e dichiarata, non fatale', () => {
  const toml = `[[allowlist]]\nregexTarget = "match"\nregexes = ['''${FAKE}''']\n`;
  const r = runOracle(makeProject(FAKE, toml));
  assert.equal(r.status, 0);
  assert.ok(r.findings.some((f) => f.RuleID === 'trueline-generic-assigned-secret'));
  assert.match(r.stderr, /\[\[allowlist\]\]/);
});

e2e("un'allowlist con paths e senza targetRules e dichiarata come file non scansionati", () => {
  const toml = "[[allowlists]]\npaths = ['''src/''']\n";
  const r = runOracle(makeProject(FAKE, toml));
  assert.equal(r.status, 0);
  assert.match(r.stderr, /ATTENZIONE: 1 allowlist di progetto con paths e senza targetRules/);
});
