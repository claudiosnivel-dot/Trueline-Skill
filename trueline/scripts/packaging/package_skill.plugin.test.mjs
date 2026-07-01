// package_skill.plugin.test.mjs — Task 7 (Fase 2): il target --plugin assembla
// il layout-plugin Claude Code (manifest + hooks + skills/trueline) IN AGGIUNTA
// al .skill, senza alterare il .skill di default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'package_skill.mjs');

test('--plugin assembla .claude-plugin + hooks + skills/trueline', () => {
  const out = mkdtempSync(join(tmpdir(), 'tl-plugin-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--plugin', out, '--no-archive'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(existsSync(join(out, '.claude-plugin', 'plugin.json')));
  assert.ok(existsSync(join(out, 'hooks', 'hooks.json')));
  assert.ok(existsSync(join(out, 'skills', 'trueline', 'SKILL.md')));
  const mf = JSON.parse(readFileSync(join(out, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(mf.name, 'trueline');
});

test('--plugin NON contamina il layout: skills/trueline non contiene .claude-plugin/ né hooks/', () => {
  const out = mkdtempSync(join(tmpdir(), 'tl-plugin-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--plugin', out, '--no-archive'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  // i sorgenti plugin vivono al livello del plugin, MAI dentro skills/trueline
  assert.ok(!existsSync(join(out, 'skills', 'trueline', '.claude-plugin')));
  assert.ok(!existsSync(join(out, 'skills', 'trueline', 'hooks')));
});
