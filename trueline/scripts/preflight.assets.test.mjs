import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAsset } from './preflight.mjs';

test('gitleaks asset linux x64 -> tar.gz con url della release pinnata', () => {
  const a = resolveAsset('gitleaks', 'linux', 'x64');
  assert.match(a.url, /gitleaks\/releases\/download\/v8\.18\.0\/.*linux.*x64.*\.tar\.gz/);
  assert.equal(a.archive, 'tar.gz');
  assert.equal(a.binName, 'gitleaks');
});
test('osv win x64 -> binario grezzo .exe', () => {
  const a = resolveAsset('osv-scanner', 'win32', 'x64');
  assert.match(a.url, /osv-scanner\/releases\/download\/.*windows.*amd64\.exe/);
  assert.equal(a.archive, 'raw');
  assert.equal(a.binName, 'osv-scanner.exe');
});
test('osv usa un tag reale (>=1.6.0) e include la versione nel nome asset', () => {
  // v1.6.0 NON esiste come tag (i tag saltano da v1.5.0 a v1.6.1/v1.6.2);
  // inoltre il nome asset deve includere il segmento versione, altrimenti 404.
  const a = resolveAsset('osv-scanner', 'win32', 'x64');
  assert.match(a.url, /releases\/download\/v1\.6\.2\/osv-scanner_1\.6\.2_windows_amd64\.exe$/);
});
test('osv linux x64 -> nome asset con versione e amd64', () => {
  const a = resolveAsset('osv-scanner', 'linux', 'x64');
  assert.match(a.url, /releases\/download\/v1\.6\.2\/osv-scanner_1\.6\.2_linux_amd64$/);
  assert.equal(a.archive, 'raw');
  assert.equal(a.binName, 'osv-scanner');
});
test('gitleaks asset win32 x64 -> zip (Windows non distribuisce tar.gz)', () => {
  const a = resolveAsset('gitleaks', 'win32', 'x64');
  assert.match(a.url, /releases\/download\/v8\.18\.0\/gitleaks_8\.18\.0_windows_x64\.zip$/);
  assert.equal(a.archive, 'zip');
  assert.equal(a.binName, 'gitleaks.exe');
});
test('tool senza asset noto -> null', () => assert.equal(resolveAsset('semgrep', 'linux', 'x64'), null));
