#!/usr/bin/env node
// run_semgrep.mjs — wrapper dell'oracolo Semgrep VIA DOCKER (03 §5.1).
//
// Node ESM, solo moduli built-in (fs, path, child_process, os, url): nessun
// npm install, nessuna dipendenza di rete oltre l'immagine docker gia presente.
//
// COSA FA
//   Prende la directory di un progetto (default: eval/reference-app), monta
//   quella dir come /src dentro il container Semgrep, esegue `semgrep scan` col
//   ruleset AI curato (in M0 il PLACEHOLDER, vedi sotto) ed emette su stdout il
//   JSON NATIVO di Semgrep (campo `results`, eventualmente vuoto). La
//   normalizzazione native->finding (03 §6, 04) e a valle, nell'adapter.
//
// INVOCAZIONE DOCKER (verificata su Windows / Git-Bash)
//   MSYS_NO_PATHCONV=1 docker run --rm \
//     -v "//c/Users/.../eval/reference-app:/src" \
//     semgrep/semgrep:latest \
//     semgrep scan --config /src/<rules-rel> --json --metrics=off /src .
//   MSYS_NO_PATHCONV=1 evita che MSYS riscriva i path "/src" lato Windows.
//   Il mount Windows usa la forma "//c/Users/..." (doppio slash iniziale).
//
// RULESET (PLACEHOLDER in M0; curato in M4 — 07 §4)
//   Il ruleset vive tracciato in
//     trueline/references/oracles/semgrep-ai-ruleset/placeholder.yml
//   Poiche il container vede solo /src (= la dir progetto, che e gitignorata),
//   lo script COPIA il ruleset in una sottocartella effimera dentro la dir
//   progetto (.trueline/semgrep-rules/, gitignorata) cosi da poterlo montare
//   come /src/.trueline/semgrep-rules/<file>. La cartella effimera viene
//   ripulita a fine run.
//
// SMOKE TEST (gate M0)
//   Il gate verifica SOLO che il wrapper giri ed emetta JSON Semgrep valido.
//   La DETECTION di S6 (injection) e S7 (authz) e DIFFERITA a M4 e NON e parte
//   del gate M0 (10 §3; vedi registry expected/registry.json).

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Radice del repo: trueline/scripts/oracles -> repo root e 3 livelli sopra.
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

// Immagine Semgrep PINNATA (semgrep 1.165.0). Non usare un tag mobile diverso:
// la riproducibilita dell'oracolo dipende dal pin (L-COL-002).
const SEMGREP_IMAGE = 'semgrep/semgrep:latest';

// Ruleset AI curato (07 §4), tracciato nel repo. In M0 era il placeholder.yml
// (solo smoke test); da M4 e' il ruleset CURATO trueline-ai-ruleset.yml, forma
// eseguibile dei pattern vietati (07 §4: secrets/injection/authz/crypto/sink).
const RULESET_SRC = resolve(
  REPO_ROOT,
  'trueline',
  'references',
  'oracles',
  'semgrep-ai-ruleset',
  'trueline-ai-ruleset.yml',
);

// Sottocartella EFFIMERA (gitignorata: .trueline/) dentro la dir progetto in
// cui copiare il ruleset, cosi da montarlo sotto /src.
const EPHEMERAL_ROOT = '.trueline';
const EPHEMERAL_RULES_SUBDIR = join(EPHEMERAL_ROOT, 'semgrep-rules');

/**
 * Converte un percorso assoluto Windows ("C:\\Users\\..." o "C:/Users/...")
 * nella forma di mount accettata da docker su Git-Bash: "//c/Users/...".
 * Se il percorso e gia in stile POSIX (inizia con "/"), lo restituisce com'e.
 */
function toDockerMountPath(absPath) {
  // Normalizza i separatori a "/".
  const slashed = absPath.replace(/\\/g, '/');
  // Drive letter Windows (es. "C:/Users/...") -> "//c/Users/...".
  const m = /^([A-Za-z]):\/(.*)$/.exec(slashed);
  if (m) {
    const drive = m[1].toLowerCase();
    const rest = m[2];
    return `//${drive}/${rest}`;
  }
  // Gia POSIX.
  return slashed;
}

/** Stampa un messaggio diagnostico su stderr (lo stdout resta JSON puro). */
function warn(msg) {
  process.stderr.write(`[run_semgrep] ${msg}\n`);
}

function main() {
  // 1) Risolvi la dir progetto (arg posizionale; default reference-app).
  const argProject = process.argv[2] ?? 'eval/reference-app';
  const projectDir = resolve(REPO_ROOT, argProject);

  if (!existsSync(projectDir)) {
    warn(`directory progetto non trovata: ${projectDir}`);
    process.exit(2);
  }
  if (!existsSync(RULESET_SRC)) {
    warn(`ruleset non trovato: ${RULESET_SRC}`);
    process.exit(2);
  }

  // 2) Copia effimera del ruleset dentro la dir progetto (per montarlo in /src).
  const ephemeralRootAbs = resolve(projectDir, EPHEMERAL_ROOT);
  const ephemeralDirAbs = resolve(projectDir, EPHEMERAL_RULES_SUBDIR);
  const ruleFileName = basename(RULESET_SRC);
  const ephemeralRuleAbs = join(ephemeralDirAbs, ruleFileName);
  // Percorso del ruleset COME VISTO nel container: /src/.trueline/semgrep-rules/<file>.
  const containerRulePath = `/src/${EPHEMERAL_RULES_SUBDIR.replace(/\\/g, '/')}/${ruleFileName}`;

  // Se .trueline/ non esisteva prima del run, e nostra e va rimossa intera a
  // fine run; se preesisteva (altra tooling trueline), rimuoviamo solo la
  // nostra sottocartella semgrep-rules per non distruggere stato altrui.
  const ephemeralRootPreexisted = existsSync(ephemeralRootAbs);

  try {
    mkdirSync(ephemeralDirAbs, { recursive: true });
    copyFileSync(RULESET_SRC, ephemeralRuleAbs);

    // 3) Costruisci il mount Windows ("//c/Users/...").
    const mountSrc = toDockerMountPath(projectDir);

    // 4) Esegui docker. MSYS_NO_PATHCONV=1 evita la riscrittura dei path POSIX.
    const dockerArgs = [
      'run',
      '--rm',
      '-v',
      `${mountSrc}:/src`,
      SEMGREP_IMAGE,
      'semgrep',
      'scan',
      '--config',
      containerRulePath,
      '--json',
      '--metrics=off',
      '/src',
    ];

    warn(`docker run ${SEMGREP_IMAGE} (mount ${mountSrc} -> /src, config ${containerRulePath})`);

    const res = spawnSync('docker', dockerArgs, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024, // l'output JSON puo essere ampio
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });

    if (res.error) {
      warn(`impossibile avviare docker: ${res.error.message}`);
      return 2;
    }

    const stdout = res.stdout ?? '';
    const stderr = res.stderr ?? '';

    // Semgrep esce con codice 0 (nessun finding) oppure 1 (finding trovati):
    // entrambi sono esiti VALIDI con JSON sullo stdout. Codici >1 sono errori.
    if (res.status !== 0 && res.status !== 1) {
      warn(`semgrep ha terminato con exit ${res.status}`);
      if (stderr) warn(`stderr: ${stderr.slice(0, 2000)}`);
      // Emetti comunque lo stdout (se presente) per il debug, ma fallisci.
      if (stdout) process.stdout.write(stdout);
      return res.status === null ? 2 : res.status;
    }

    // 5) Emetti il JSON NATIVO di Semgrep sullo stdout, invariato.
    process.stdout.write(stdout);
    if (!stdout.trim()) {
      warn('stdout vuoto: nessun JSON emesso da semgrep');
      if (stderr) warn(`stderr: ${stderr.slice(0, 2000)}`);
      return 2;
    }
    return 0;
  } finally {
    // 6) Pulizia della copia effimera del ruleset. Eseguita SEMPRE prima di
    //    uscire: la cleanup vive nel finally e l'exit avviene a valle di main(),
    //    perche process.exit() interromperebbe il finally se chiamato qui.
    //    Rimuove l'intera .trueline/ se l'abbiamo creata noi, altrimenti solo
    //    la sottocartella semgrep-rules.
    try {
      const target = ephemeralRootPreexisted ? ephemeralDirAbs : ephemeralRootAbs;
      rmSync(target, { recursive: true, force: true });
    } catch {
      // best-effort: la cartella e comunque gitignorata (.trueline/).
    }
  }
}

// L'exit avviene FUORI da main(): cosi il `finally` di cleanup gira prima che
// il processo termini (process.exit() salterebbe i finally pendenti).
const exitCode = main();
process.exit(exitCode);
