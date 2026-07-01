// preflight.download.test.mjs — Task 2: downloadBinaryRelease project-local.
//
// Usa un server node:http LOCALE che serve un finto asset (raw + tar.gz):
// NESSUNA rete esterna. Verifica che il binario venga scritto nel destDir e,
// per i tar.gz, che l'estrazione via `tar` di sistema produca il binario atteso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadBinaryRelease } from './preflight.mjs';

test('downloadBinaryRelease (raw) scrive il binario nel destDir', async () => {
  const srv = createServer((_q, r) => { r.writeHead(200); r.end('#!/bin/sh\necho fake 1.6.0\n'); });
  await new Promise((res) => srv.listen(0, res));
  const port = srv.address().port;
  const dest = mkdtempSync(join(tmpdir(), 'tl-dl-'));
  const out = await downloadBinaryRelease('osv-scanner', dest, { urlOverride: `http://127.0.0.1:${port}/osv`, archive: 'raw', binName: 'osv-scanner' });
  srv.close();
  assert.equal(out.ok, true);
  assert.ok(existsSync(out.path));
  assert.match(readFileSync(out.path, 'utf8'), /fake 1\.6\.0/);
});

test('downloadBinaryRelease segue i redirect 30x', async () => {
  const srv = createServer((q, r) => {
    if (q.url === '/redir') { r.writeHead(302, { location: '/final' }); r.end(); return; }
    r.writeHead(200); r.end('redirected-bytes\n');
  });
  await new Promise((res) => srv.listen(0, res));
  const port = srv.address().port;
  const dest = mkdtempSync(join(tmpdir(), 'tl-dl-redir-'));
  const out = await downloadBinaryRelease('osv-scanner', dest, { urlOverride: `http://127.0.0.1:${port}/redir`, archive: 'raw', binName: 'osv-scanner' });
  srv.close();
  assert.equal(out.ok, true);
  assert.match(readFileSync(out.path, 'utf8'), /redirected-bytes/);
});

test('downloadBinaryRelease (tar.gz) estrae il binario via tar di sistema', async () => {
  // Salta se `tar` non e' disponibile sull'host (l'estrazione dipende da tar).
  const hasTar = !spawnSync('tar', ['--version'], { encoding: 'utf8' }).error;
  if (!hasTar) return;

  // Prepara un tar.gz reale contenente un binario fittizio "gitleaks".
  // Creiamo l'archivio con cwd=stage e nomi RELATIVI per evitare che il
  // drive-letter `C:\` venga interpretato come host remoto da GNU tar.
  const stage = mkdtempSync(join(tmpdir(), 'tl-stage-'));
  const exeName = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  writeFileSync(join(stage, exeName), '#!/bin/sh\necho gitleaks 8.18.0\n');
  const mk = spawnSync('tar', ['-czf', 'asset.tgz', exeName], { encoding: 'utf8', cwd: stage });
  assert.equal(mk.status, 0, mk.stderr || 'tar -czf fallita');
  const tgzBytes = readFileSync(join(stage, 'asset.tgz'));

  const srv = createServer((_q, r) => { r.writeHead(200); r.end(tgzBytes); });
  await new Promise((res) => srv.listen(0, res));
  const port = srv.address().port;
  const dest = mkdtempSync(join(tmpdir(), 'tl-dl-tgz-'));
  const out = await downloadBinaryRelease('gitleaks', dest, { urlOverride: `http://127.0.0.1:${port}/gitleaks.tgz`, archive: 'tar.gz', binName: process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks' });
  srv.close();
  assert.equal(out.ok, true, out.detail);
  assert.ok(existsSync(out.path));
  assert.match(readFileSync(out.path, 'utf8'), /gitleaks 8\.18\.0/);
});

test('downloadBinaryRelease senza asset risolvibile -> ok:false dichiarato', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'tl-dl-none-'));
  const out = await downloadBinaryRelease('semgrep', dest, {});
  assert.equal(out.ok, false);
  assert.equal(out.path, null);
  assert.ok(typeof out.detail === 'string' && out.detail.length > 0);
});
