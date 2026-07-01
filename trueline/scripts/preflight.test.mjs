#!/usr/bin/env node
// =============================================================================
// preflight.test.mjs — self-test del flag --install consent-gated (09 §6 / L-COL-005).
//
// Proprieta' verificate (la skill PROPONE sempre, ESEGUE solo col consenso
// esplicito, MAI in autonomia):
//   A) REGRESSIONE: --json resta JSON valido (5 tool); il report umano PROPONE
//      il comando esatto per un tool mancante (AZIONE RICHIESTA).
//   B) CONSENSO (L-COL-005): --install SENZA consenso (non-TTY, niente --yes) NON
//      esegue nulla e dichiara che serve il consenso esplicito; --install --yes
//      raggiunge il path d'esecuzione (mostrato con --dry-run) ma con --dry-run
//      NON installa davvero; --dry-run da solo NON aggira il consenso.
//   C) CONFINI: rls_check non e' mai target d'install; --yes senza --install non
//      esegue nulla.
//
// NESSUN install reale: i path "consenso dato" usano --dry-run; i path "senza
// consenso" non eseguono. Niente rete/git. Solo built-in. Esce 0/1.
// =============================================================================

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREFLIGHT = resolve(__dirname, 'preflight.mjs');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// Esegue preflight con stdin NON-TTY (pipe vuota): simula l'uso da agente /
// non-interattivo — il path che NON deve mai installare senza --yes.
function run(args) {
  const r = spawnSync(process.execPath, [PREFLIGHT, ...args], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60_000, input: '',
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

// Marcatore che SOLO l'esecuzione reale di un install stampa: se compare in un
// test, vuol dire che e' stato lanciato un install vero -> FAIL (mai deve accadere).
const RAN = /\[install\][^\n]*eseguo:/i;

console.log('=== preflight.test — flag --install consent-gated (09 §6 / L-COL-005) ===\n');

console.log('A) regressione modalita esistenti');
{
  const { status, out } = run(['--json']);
  let json = null; try { json = JSON.parse(out); } catch { /* */ }
  check('T1 --json resta valido (5 tool, exit 0)',
    status === 0 && json && Array.isArray(json.tools) && json.tools.length === 5,
    json ? `tools=${json.tools.length} exit=${status}` : 'no JSON');
}
{
  // Nota (Task 3): il comando storico "go install" è il canale GLOBALE; con
  // --target=project (default) l'azione proposta diventa un download
  // project-local. Per asserire il canale di sistema invochiamo --target=global.
  const { status, out } = run(['--target=global', '--simulate-missing=gitleaks']);
  check('T2 report umano PROPONE il comando (AZIONE RICHIESTA + go install gitleaks, --target=global)',
    status === 1 && /AZIONE RICHIESTA/.test(out) && /go install/.test(out) && /gitleaks/.test(out),
    `exit=${status}`);
}
{
  // T2b (Task 3): col default (--target=project) l'azione proposta è un download
  // project-local in .trueline/bin/, NON il canale globale go install.
  const { status, out } = run(['--simulate-missing=gitleaks']);
  check('T2b default project-local PROPONE download in .trueline/bin (no go install)',
    status === 1 && /AZIONE RICHIESTA/.test(out) && /\.trueline[/\\]bin/.test(out) && !/go install/.test(out),
    `exit=${status}`);
}

console.log('\nB) consenso esplicito (L-COL-005)');
{
  const { status, out } = run(['--install', '--simulate-missing=gitleaks']);
  check('T3 --install SENZA consenso NON esegue (consenso esplicito richiesto, --yes)',
    !RAN.test(out) && /consenso esplicito/i.test(out) && /--yes/.test(out) && status !== 0,
    `exit=${status} ran=${RAN.test(out)}`);
}
{
  // Canale GLOBALE (--target=global): il dry-run mostra il comando di sistema
  // "go install" per gitleaks senza eseguirlo.
  const { out } = run(['--install', '--yes', '--target=global', '--dry-run', '--simulate-missing=gitleaks']);
  check('T4 --install --yes --dry-run --target=global mostra go install gitleaks SENZA eseguirlo',
    /\[dry-run\]/i.test(out) && /gitleaks/.test(out) && /go install/.test(out) && !RAN.test(out),
    `ran=${RAN.test(out)}`);
}
{
  // T4b (Task 3): col default (--target=project) il dry-run pianifica un download
  // project-local in .trueline/bin/, senza eseguire e senza canale globale.
  const { out } = run(['--install', '--yes', '--dry-run', '--simulate-missing=gitleaks', '--only=gitleaks']);
  check('T4b --install --yes --dry-run default project-local pianifica .trueline/bin (no go install)',
    /\[dry-run\]/i.test(out) && /gitleaks/.test(out) && /\.trueline[/\\]bin/.test(out) && !/go install/.test(out) && !RAN.test(out),
    `ran=${RAN.test(out)}`);
}
{
  const { out } = run(['--install', '--dry-run', '--simulate-missing=gitleaks']);
  check('T5 --dry-run senza --yes NON aggira il consenso (niente would-run per gitleaks)',
    !RAN.test(out) && !/\[dry-run\][^\n]*gitleaks/i.test(out) && /consenso esplicito/i.test(out),
    `ran=${RAN.test(out)}`);
}

console.log('\nC) confini');
{
  const { out } = run(['--install', '--yes', '--dry-run']);
  check('T6 rls_check mai target d\'install (built-in)',
    !/\[(dry-run|install)\][^\n]*rls_check/i.test(out), 'ok');
}
{
  const { out } = run(['--yes', '--simulate-missing=gitleaks']);
  check('T7 --yes senza --install non esegue alcun install',
    !RAN.test(out) && !/\[dry-run\]/i.test(out), 'ok');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length} check`);
if (failed.length) for (const f of failed) console.log(`  - FAIL: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
process.exit(failed.length === 0 ? 0 : 1);
