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
// Sintassi:
//   node run_deadcode.mjs <project-dir> [--tool=<nome>]
//
// --tool=<nome>  Seleziona il dead-code tool. Default: knip.
//                Valori supportati: knip, vulture (Python — SP-2)
//                Tool sconosciuto: esce con JSON vuoto + nota (mai falso verde).

const args = process.argv.slice(2);

// Estrai --tool=<nome> (flag opzionale; posizione libera dopo il primo arg)
const toolFlagArg = args.find((a) => a.startsWith('--tool='));
const toolName = toolFlagArg ? toolFlagArg.slice('--tool='.length) : 'knip';

// Filtra i flag per ottenere i positional args
const positionalArgs = args.filter((a) => !a.startsWith('--'));

if (positionalArgs.length < 1) {
  process.stderr.write(
    'uso: node run_deadcode.mjs <project-dir> [--tool=<nome>]\n' +
    'esempio: node trueline/scripts/oracles/run_deadcode.mjs eval/reference-app\n'
  );
  process.exit(1);
}

const projectDir = resolve(positionalArgs[0]);

// ── Dispatch: tool sconosciuto → JSON vuoto + nota (mai falso verde) ─────────
// I tool concreti supportati sono knip (JS/TS, primario) e vulture (Python, SP-2).
// Un tool non supportato non deve mai sembrare "nessun dead code trovato" —
// per questo si emette una nota esplicita accanto all'array vuoto.

const SUPPORTED_TOOLS = new Set(['knip', 'vulture']);

if (!SUPPORTED_TOOLS.has(toolName)) {
  const safeNote = `tool ${toolName} non supportato`;
  process.stdout.write(
    JSON.stringify({ issues: [], note: safeNote }, null, 2) + '\n'
  );
  process.exit(0);
}

if (!existsSync(projectDir)) {
  process.stderr.write(`ERRORE: la directory del progetto non esiste: ${projectDir}\n`);
  process.exit(1);
}

// ── Ramo vulture (Python — SP-2) ─────────────────────────────────────────────
// vulture analizza l'AST Python e stampa su stdout una riga per simbolo morto:
//   <path>:<line>: unused <type> '<name>' (<NN>% confidence)
// Le issue trovate sono INFORMAZIONE, non un errore: vulture esce 3 quando trova
// dead code, 0 quando pulito — NON usiamo l'exit code per il verdetto, ma il
// parsing dello stdout. EXIT 1 solo se il processo non parte (python assente /
// spawn error). Emettiamo { tool: "vulture", issues: [...] } (+ note se vuoto).

if (toolName === 'vulture') {
  // Eseguiamo "python -m vulture <project-dir>" (NON il bare `vulture`, che
  // potrebbe non essere sul PATH). cwd = projectDir per path relativi puliti.
  const vultureRes = spawnSync('python', ['-m', 'vulture', projectDir], {
    encoding: 'utf8',
    timeout: 120_000,
    env: process.env,
  });

  // Spawn error reale (python assente, ecc.) → EXIT 1.
  if (vultureRes.error) {
    process.stderr.write(
      `ERRORE: impossibile avviare vulture: ${vultureRes.error.message}\n` +
      'Verificare che python sia installato e che il modulo vulture sia presente (pip install vulture).\n'
    );
    process.exit(1);
  }

  // Propaga lo stderr di vulture (warning di sintassi, ecc.) al padre.
  if (vultureRes.stderr) {
    process.stderr.write(vultureRes.stderr);
  }

  // python introvabile dal launcher: spawnSync NON pone result.error ma esce con
  // status 9009 (Windows) e nessuno stdout. Distinguiamo dal "clean" (0 issue,
  // status 0, nessuno stdout) controllando lo status quando lo stdout e vuoto.
  const rawVulture = (vultureRes.stdout || '');
  if (!rawVulture.trim() && vultureRes.status !== 0 && vultureRes.status !== 3) {
    process.stderr.write(
      `ERRORE: vulture non e stato eseguito correttamente (exit ${vultureRes.status}, nessuno stdout).\n` +
      'Verificare che "python -m vulture" sia disponibile.\n'
    );
    process.exit(1);
  }

  // Parsing: una issue per riga.
  //   path:line: unused <type> '<name>' (NN% confidence)
  // Regex robusta: cattura file, line, type (parola/e dopo "unused"), name e
  // confidence. Tolleriamo path con ':' (es. drive Windows "C:") ancorando
  // sull'ultimo ":<digits>: unused" tramite componenti non-greedy mirati.
  const lineRe = /^(.*?):(\d+):\s*unused\s+([a-zA-Z ]+?)\s+'([^']+)'\s*\((\d+)%\s*confidence\)\s*$/;

  const issues = [];
  for (const rawLine of rawVulture.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = lineRe.exec(line);
    if (!m) continue; // righe non conformi: ignorate (robustezza)
    issues.push({
      file: m[1],
      line: Number(m[2]),
      type: m[3].trim(),
      name: m[4],
      confidence: Number(m[5]),
    });
  }

  const out = { tool: 'vulture', issues };
  if (issues.length === 0) {
    out.note = 'vulture non ha trovato dead-code (o nessuna riga parsabile)';
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  // EXIT 0: vulture e stato eseguito e lo stdout e parsabile. Le issue sono
  // informazione, non errore — il chiamante decide se escalare.
  process.exit(0);
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
