// bin_lookup.test.mjs — Task 4: i wrapper cercano il binario in
// <dir>/.trueline/bin/ PRIMA del PATH/go-bin (project-local, additivo).
// Se .trueline/bin e' assente -> comportamento identico a oggi (BIT-invariante).
//
// Node ESM, solo built-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGitleaksBin } from './run_gitleaks.mjs';
import { resolveOsvBin } from './run_osv.mjs';

test('resolveGitleaksBin preferisce <dir>/.trueline/bin', () => {
  const d = mkdtempSync(join(tmpdir(), 'tl-bin-'));
  const bin = join(d, '.trueline', 'bin');
  mkdirSync(bin, { recursive: true });
  const exe = join(bin, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  writeFileSync(exe, '#!/bin/sh\n'); try { chmodSync(exe, 0o755); } catch {}
  assert.equal(resolveGitleaksBin(d), exe);
});

test('resolveOsvBin preferisce <dir>/.trueline/bin', () => {
  const d = mkdtempSync(join(tmpdir(), 'tl-bin-'));
  const bin = join(d, '.trueline', 'bin');
  mkdirSync(bin, { recursive: true });
  const exe = join(bin, process.platform === 'win32' ? 'osv-scanner.exe' : 'osv-scanner');
  writeFileSync(exe, '#!/bin/sh\n'); try { chmodSync(exe, 0o755); } catch {}
  assert.equal(resolveOsvBin(d), exe);
});

test('resolveOsvBin senza .trueline/bin ripiega su PATH (identico a oggi)', () => {
  const d = mkdtempSync(join(tmpdir(), 'tl-bin-'));
  assert.equal(resolveOsvBin(d), process.env.OSV_SCANNER_PATH ?? 'osv-scanner');
});
