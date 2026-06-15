// run_deadcode.mjs — oracolo dead-code (03 §5.5).
//
// Esegue knip (strumento primario) con "--reporter json" sulla directory del
// progetto target e restituisce su stdout il JSON NATIVO di knip.
//
// INVOCAZIONE
//   node trueline/scripts/oracles/run_deadcode.mjs <project-dir>
//
// <project-dir> deve contenere un knip.json (o knip.config.ts) e il binario
// knip deve essere presente in <project-dir>/node_modules/.bin/knip.
//
// OUTPUT: JSON nativo di knip (struttura { issues: [...] }) emesso su stdout.
// Lo stderr di knip e passato trasparente allo stderr del processo padre.
//
// EXIT CODE: 0 se knip gira senza errori di esecuzione (anche se trova issue;
// knip esce 1 quando trova dead code — questo e normale e NON un errore).
// 1 se il tool non e trovato, la directory non esiste, o il JSON e malformato.
//
// FALLBACK: knip e lo strumento primario e basta per questo scope.
// ts-prune (deprecato, non manutenuto da 2022) e depcheck (non analizza
// export inutilizzati a livello di simbolo) sono menzionati come fallback
// teorici ma NON implementati: knip copre tutti i casi richiesti in M0–M4.
// Se knip venisse rimosso dal progetto target, il wrapper segnala l'assenza
// con un messaggio chiaro su stderr invece di eseguire silenziosamente un
// fallback meno preciso.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Argomenti CLI ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 1) {
  process.stderr.write(
    'uso: node run_deadcode.mjs <project-dir>\n' +
    'esempio: node trueline/scripts/oracles/run_deadcode.mjs eval/reference-app\n'
  );
  process.exit(1);
}

const projectDir = resolve(args[0]);

if (!existsSync(projectDir)) {
  process.stderr.write(`ERRORE: la directory del progetto non esiste: ${projectDir}\n`);
  process.exit(1);
}

// ── Individua il binario knip ────────────────────────────────────────────────
// Cerca prima in <project-dir>/node_modules/.bin/knip (installazione locale al
// progetto target, preferita per riproducibilita).

// Su Windows, lo shebang di "knip" in node_modules/.bin non funziona
// direttamente con spawnSync. Utilizziamo il file JS di knip direttamente.
const knipBinSh   = join(projectDir, 'node_modules', '.bin', 'knip');
const knipBinJs   = join(projectDir, 'node_modules', 'knip', 'bin', 'knip.js');

let knipCmd   = 'node';
let knipArgs;

if (existsSync(knipBinJs)) {
  // Percorso stabile: node <knip.js> [flags]
  knipArgs = [knipBinJs, '--reporter', 'json'];
} else if (existsSync(knipBinSh)) {
  // Fallback: prova lo sh-wrapper (funziona su Linux/macOS)
  knipCmd = knipBinSh;
  knipArgs = ['--reporter', 'json'];
} else {
  process.stderr.write(
    `ERRORE: knip non trovato in ${projectDir}/node_modules/knip/bin/knip.js\n` +
    'Assicurarsi che knip sia installato come dipendenza locale del progetto target.\n' +
    'Fallback disponibili NON implementati: ts-prune (deprecato), depcheck (non analizza export).\n'
  );
  process.exit(1);
}

// ── Esegui knip ──────────────────────────────────────────────────────────────
// Flag fissi per riproducibilita: --reporter json.
// cwd = projectDir (knip legge knip.json dalla directory di lavoro).

const result = spawnSync(knipCmd, knipArgs, {
  cwd: projectDir,
  encoding: 'utf8',
  // knip puo impiegare qualche secondo su codebase grandi
  timeout: 120_000,
  // Passa le variabili d'ambiente del processo padre (PATH, NODE_PATH, ecc.)
  env: process.env,
});

// ── Gestione errori di avvio ─────────────────────────────────────────────────

if (result.error) {
  process.stderr.write(`ERRORE: impossibile avviare knip: ${result.error.message}\n`);
  process.exit(1);
}

// Propaga stderr di knip (avvisi, progress) allo stderr del padre
if (result.stderr) {
  process.stderr.write(result.stderr);
}

// ── Valida che l'output sia JSON ben formato ──────────────────────────────────
// knip esce con 1 quando trova issue — e NORMALE. L'unico modo per distinguere
// un'uscita 1 "legittima" da un errore reale e parsare stdout come JSON.
// Se stdout e vuoto o non parsabile -> errore reale.

const rawOutput = (result.stdout || '').trim();

if (!rawOutput) {
  process.stderr.write(
    `ERRORE: knip non ha emesso nulla su stdout (exit ${result.status}).\n` +
    'Verificare che knip.json esista nella directory target e che il progetto sia valido.\n'
  );
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(rawOutput);
} catch (err) {
  process.stderr.write(
    `ERRORE: l'output di knip non e JSON valido: ${err.message}\n` +
    `Output ricevuto (prime 500 car.): ${rawOutput.slice(0, 500)}\n`
  );
  process.exit(1);
}

// ── Emetti il JSON nativo su stdout ──────────────────────────────────────────
// Il chiamante (adapter, harness, ecc.) parsa questo JSON — non l'exit code.

process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');

// Esce sempre con 0 se il JSON e valido (il dead code trovato e informazione,
// non un errore del tool). Il chiamante decide se escalare in base al contenuto.
process.exit(0);
