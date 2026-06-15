#!/usr/bin/env node
// validate_blueprint.mjs (harness) — SHIM di delega, NON una copia.
//
// Riconciliazione M2: l'oracolo strutturale del blueprint (11 §5.1, L-COL-019)
// ha UNA SOLA sorgente — trueline/scripts/blueprint/validate_blueprint.mjs —
// che è l'artefatto di runtime della skill (02 §4) e viaggia nel .skill.
//
// Questo file restava dai milestone precedenti come copia duplicata del
// validator. Per eliminare la duplicazione mantenendo stabile il percorso
// storicamente referenziato (README dell'harness, run_eval), qui NON si
// reimplementa nulla: si delega alla sorgente unica, inoltrando gli argomenti
// e propagando exit code, stdout e stderr inalterati.
//
// run_eval.mjs invoca direttamente la sorgente unica; questo shim copre solo
// l'uso diretto `node eval/harness/validate_blueprint.mjs [dir] [--json]`.
//
// Node ESM, solo moduli built-in: nessun npm install, nessuna rete.

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// La sorgente unica: ../../trueline/scripts/blueprint/validate_blueprint.mjs
const SOURCE = resolve(
  __dirname, '..', '..', 'trueline', 'scripts', 'blueprint', 'validate_blueprint.mjs',
);

const res = spawnSync(process.execPath, [SOURCE, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

process.exit(res.status === null ? 1 : res.status);
