#!/usr/bin/env node
// run_gitleaks.mjs — wrapper dell'oracolo gitleaks (03-ORACLES §5.2).
//
// Esegue gitleaks in modalita JSON REDATTA e supporta due scope di scansione
// (03 §5.2):
//   - working-tree (scope BUILD): scansiona i FILE su disco. Difetto seminato
//     S1 (segreto nel sorgente, src/lib/config.ts) vive qui.
//   - history (scope REMEDIATE): scansiona i COMMIT della git history. Difetto
//     seminato S2 (segreto solo in history, src/legacy/credentials.ts, rimosso
//     dal working tree) vive qui; in history riappare anche S1.
//
// CONTRATTO: lo script prende `<dir> <scope>`, esegue gitleaks e stampa su
// stdout il JSON NATIVO di gitleaks (array di finding). NON normalizza: la
// normalizzazione nel finding model (04) e compito di normalize.* a valle.
// Il valore del segreto resta sempre REDATTO (`--redact`): in chiaro non esce
// mai (ne in stdout ne in stderr/diagnostica).
//
// PRINCIPIO (03 §3): si parsa il REPORT JSON, non l'exit code. Gli exit code di
// gitleaks sono ambigui (un path inesistente esce 0, una config rotta esce 1
// come "findings trovati"). Quindi forziamo `--exit-code 0` e decidiamo l'esito
// dal report: JSON valido => run riuscito (anche con 0 finding); spawn fallito o
// stdout non parsabile come JSON => ERRORE DI ESECUZIONE (exit 3), che a monte
// NON va interpretato come "verde" (L-COL-006, nessun falso via libera).
//
// ALLOWLIST DI PROGETTO (03 §5.2, 08 §5.2): se `<dir>/.gitleaks.toml` esiste, le
// sue allowlist (`[[allowlists]]` e il legacy `[allowlist]`) si uniscono alla
// config di Trueline in una config temporanea che la estende. Le altre sezioni
// (`[extend]`, `[[rules]]`, ...) NON si applicano: un progetto puo' dichiarare un
// FP, non spegnere una regola. Senza `.gitleaks.toml` la config e' quella di
// Trueline e gli argomenti di gitleaks sono identici a prima (BIT-invariante).
//
// Node ESM, solo moduli built-in (niente dipendenze npm, niente rete).
//
// Uso:
//   node run_gitleaks.mjs <dir> <working-tree|history>
// Esempi:
//   node trueline/scripts/oracles/run_gitleaks.mjs eval/reference-app working-tree
//   node trueline/scripts/oracles/run_gitleaks.mjs eval/reference-app history

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Config gitleaks versionata, accanto a questo script (03 §5.2).
const GITLEAKS_CONFIG = resolve(__dirname, 'gitleaks.toml');

// Codici di uscita del wrapper.
const EXIT_OK = 0; // run completato (con o senza finding); JSON nativo su stdout
const EXIT_USAGE = 2; // uso scorretto degli argomenti
const EXIT_EXEC_ERROR = 3; // errore di esecuzione (gitleaks non gira / output non parsabile)

const SCOPES = new Set(['working-tree', 'history']);
const IS_WINDOWS = process.platform === 'win32';

// Diagnostica su stderr (mai segreti: solo metadati di esecuzione).
function diag(msg) {
  process.stderr.write(`[run_gitleaks] ${msg}\n`);
}

// Risolve l'eseguibile gitleaks. Precedenza (Task 4): binario project-local in
// `<dir>/.trueline/bin/` -> PATH -> percorsi noti (incl. go/bin di questo
// ambiente, che NON e sul PATH). ADDITIVO/BIT-INVARIANTE: se `.trueline/bin`
// e assente (o `dir` non passato), la risoluzione e identica a oggi.
function resolveGitleaksBin(dir) {
  const exe = IS_WINDOWS ? 'gitleaks.exe' : 'gitleaks';
  // 0) Project-local: `<dir>/.trueline/bin/<exe>`. Vince sui candidati globali.
  //    Assente -> si prosegue col flusso odierno (nessun cambio di comportamento).
  if (dir) {
    const local = join(dir, '.trueline', 'bin', exe);
    if (existsSync(local)) return local;
  }
  // 1) PATH: lascia che sia spawn a risolvere "gitleaks".
  //    Verifichiamo prima con `gitleaks version` in modo da poter ripiegare.
  const onPath = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
  if (!onPath.error) return 'gitleaks';

  // 2) Percorsi candidati noti (go install).
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    process.env.GITLEAKS_BIN, // override esplicito
    home ? join(home, 'go', 'bin', exe) : null,
    'C:/Users/claud/go/bin/gitleaks.exe',
    '/c/Users/claud/go/bin/gitleaks',
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // 3) Ultimo tentativo: estendi il PATH della env passata a spawn.
  return 'gitleaks';
}

// Intestazione di tabella TOML con chiave semplice: `[nome]` o `[[nome]]`.
const TOML_HEADER = /^\s*(\[\[?)\s*([A-Za-z0-9_.-]+)\s*(\]\]?)\s*(?:#.*)?$/;

/**
 * Estrae dal testo di un `.gitleaks.toml` di progetto le sole allowlist.
 * `[[allowlists]]` e il legacy `[allowlist]` diventano blocchi `[[allowlists]]`;
 * ogni altra tabella e' riportata in `ignored`. Limite dichiarato: parser per
 * righe, una riga che sembra un'intestazione dentro una stringa multi-riga la
 * chiude; un blocco rotto fa fallire gitleaks, che il wrapper riporta come
 * ERRORE DI ESECUZIONE (exit 3), mai come verde.
 *
 * @returns {{ blocks: string[], ignored: string[], wholeFileSkips: number }}
 *   `wholeFileSkips`: allowlist con `paths` e senza `targetRules`, con cui
 *   gitleaks salta per intero i file che combaciano.
 */
export function extractProjectAllowlists(text) {
  const blocks = [];
  const ignored = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = TOML_HEADER.exec(line);
    if (!m) {
      if (current) current.push(line);
      continue;
    }
    const [, open, name, close] = m;
    const isArray = open === '[[' && close === ']]';
    const isTable = open === '[' && close === ']';
    if ((isArray && name === 'allowlists') || (isTable && name === 'allowlist')) {
      current = ['[[allowlists]]'];
      blocks.push(current);
    } else {
      current = null;
      ignored.push(`${open}${name}${close}`);
    }
  }
  const texts = blocks.map((b) => b.join('\n').trimEnd() + '\n');
  const wholeFileSkips = texts.filter((t) => /^\s*paths\s*=/m.test(t) && !/^\s*targetRules\s*=/m.test(t)).length;
  return { blocks: texts, ignored, wholeFileSkips };
}

/**
 * Config da passare a gitleaks per `dir`. Con allowlist di progetto scrive, fuori
 * dal progetto, una config temporanea che estende quella di Trueline; `cleanup()`
 * la rimuove.
 *
 * @returns {{ config: string, applied: number, ignored: string[], wholeFileSkips: number, cleanup: () => void }}
 */
export function projectConfigFor(dir) {
  const none = { config: GITLEAKS_CONFIG, applied: 0, ignored: [], wholeFileSkips: 0, cleanup: () => {} };
  const projectToml = join(dir, '.gitleaks.toml');
  if (!existsSync(projectToml)) return none;

  const { blocks, ignored, wholeFileSkips } = extractProjectAllowlists(readFileSync(projectToml, 'utf8'));
  if (blocks.length === 0) return { ...none, ignored };

  const tmp = mkdtempSync(join(tmpdir(), 'trueline-gitleaks-'));
  const config = join(tmp, 'gitleaks.toml');
  writeFileSync(
    config,
    '# Generata da run_gitleaks.mjs: config di Trueline + allowlist del progetto.\n' +
      'title = "trueline-gitleaks + allowlist di progetto"\n\n' +
      '[extend]\n' +
      `path = ${JSON.stringify(GITLEAKS_CONFIG.replace(/\\/g, '/'))}\n\n` +
      blocks.join('\n'),
  );
  return {
    config,
    applied: blocks.length,
    ignored,
    wholeFileSkips,
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

// Costruisce gli argomenti per uno scope, con un subcomando primario e un
// fallback (per coprire versioni diverse di gitleaks).
//   working-tree -> primario `dir <dir>`, fallback `detect --no-git --source <dir>`
//   history      -> primario `git <dir>`, fallback `detect --source <dir>`
// Flag comuni: report JSON su stdout, redazione, niente banner, exit forzato 0.
function buildInvocations(dir, scope, config = GITLEAKS_CONFIG) {
  const common = [
    '-c', config,
    '--report-format', 'json',
    '--report-path', '-', // stdout: evita problemi di path su Windows/MSYS
    '--redact',
    '--no-banner',
    '--exit-code', '0', // l'esito si decide dal report, non dall'exit code
  ];
  if (scope === 'working-tree') {
    return [
      { label: 'dir', args: ['dir', dir, ...common] },
      { label: 'detect --no-git', args: ['detect', '--no-git', '--source', dir, ...common] },
    ];
  }
  // history
  return [
    { label: 'git', args: ['git', dir, ...common] },
    { label: 'detect', args: ['detect', '--source', dir, ...common] },
  ];
}

// Esegue una singola invocazione di gitleaks. Ritorna { spawned, parsed, json,
// raw, stderr }:
//   - spawned=false  => gitleaks non e partito (binario assente, ecc.)
//   - parsed=true    => stdout e un array JSON valido (run riuscita)
//   - parsed=false   => stdout NON parsabile come array JSON (subcomando non
//                       riconosciuto da questa versione, o errore di config)
function runOnce(bin, args, env) {
  const res = spawnSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
  if (res.error) {
    return { spawned: false, parsed: false, json: null, raw: '', stderr: String(res.error.message || res.error) };
  }
  const raw = res.stdout || '';
  const stderr = res.stderr || '';
  let json = null;
  let parsed = false;
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      json = data;
      parsed = true;
    }
  } catch {
    parsed = false;
  }
  return { spawned: true, parsed, json, raw, stderr };
}

function main() {
  const [, , dirArg, scopeArg] = process.argv;

  if (!dirArg || !scopeArg) {
    diag('uso: node run_gitleaks.mjs <dir> <working-tree|history>');
    process.exit(EXIT_USAGE);
  }
  if (!SCOPES.has(scopeArg)) {
    diag(`scope non valido: "${scopeArg}". Ammessi: working-tree | history`);
    process.exit(EXIT_USAGE);
  }

  const dir = resolve(process.cwd(), dirArg);
  if (!existsSync(dir)) {
    diag(`directory di scansione assente: ${dir}`);
    process.exit(EXIT_EXEC_ERROR);
  }
  if (scopeArg === 'history' && !existsSync(join(dir, '.git'))) {
    diag(`scope=history ma ${dir} non e un repo git (.git assente)`);
    process.exit(EXIT_EXEC_ERROR);
  }
  if (!existsSync(GITLEAKS_CONFIG)) {
    diag(`config gitleaks assente: ${GITLEAKS_CONFIG}`);
    process.exit(EXIT_EXEC_ERROR);
  }

  // PATH arricchito col go/bin noto, nel caso gitleaks non sia sul PATH.
  const extraBin = IS_WINDOWS ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''}${delimiter}${extraBin}`,
  };

  // Allowlist del `.gitleaks.toml` di progetto: dichiarate su stderr, mai in silenzio
  // (L-COL-006). Senza il file nessuna riga in piu'.
  const project = projectConfigFor(dir);
  if (project.applied > 0) {
    diag(`allowlist di progetto: ${project.applied} da .gitleaks.toml, unite alla config di Trueline`);
  }
  if (project.ignored.length > 0) {
    diag(`sezioni del .gitleaks.toml di progetto NON applicate (solo le allowlist si uniscono): ${project.ignored.join(', ')}`);
  }
  if (project.wholeFileSkips > 0) {
    diag(
      `ATTENZIONE: ${project.wholeFileSkips} allowlist di progetto con paths e senza targetRules: ` +
        'gitleaks salta per intero i file che combaciano, che quindi NON sono scansionati',
    );
  }

  const bin = resolveGitleaksBin(dir);
  const invocations = buildInvocations(dir, scopeArg, project.config);

  let exitCode = EXIT_EXEC_ERROR;
  let lastDiag = '';
  try {
    for (const inv of invocations) {
      const r = runOnce(bin, inv.args, env);
      if (!r.spawned) {
        lastDiag = `gitleaks non eseguibile (subcomando "${inv.label}"): ${r.stderr}`;
        // Errore di spawn: prova comunque il fallback (potrebbe cambiare nulla,
        // ma manteniamo il ciclo uniforme).
        continue;
      }
      if (r.parsed) {
        // Run riuscita: emetti il JSON NATIVO di gitleaks su stdout (re-serializzato
        // per garantire un array pulito anche se gitleaks avesse aggiunto rumore).
        process.stdout.write(JSON.stringify(r.json, null, 2) + '\n');
        diag(`scope=${scopeArg} subcomando="${inv.label}" finding=${r.json.length} (segreti redatti)`);
        exitCode = EXIT_OK;
        break;
      }
      // Spawnato ma stdout non parsabile: subcomando ignoto o config rotta.
      // Tieni la diagnostica e prova il fallback.
      lastDiag =
        `subcomando "${inv.label}" non ha prodotto un array JSON valido ` +
        `(probabile subcomando non supportato o errore di config). ` +
        `stderr: ${r.stderr.trim().split('\n').slice(-1)[0] || '(vuoto)'}`;
    }
  } finally {
    project.cleanup();
  }

  if (exitCode !== EXIT_OK) {
    // Nessuna invocazione ha prodotto un report JSON valido => errore di esecuzione.
    diag(`ERRORE DI ESECUZIONE: ${lastDiag || 'gitleaks non ha prodotto output utilizzabile'}`);
  }
  process.exit(exitCode);
}

// Esegui main() SOLO da CLI. Importato (es. dal test del bin-lookup) NON deve
// partire (main() farebbe process.exit su argomenti mancanti).
const __isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (__isMain) main();

export { resolveGitleaksBin };
