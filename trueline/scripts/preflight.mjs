#!/usr/bin/env node
// preflight.mjs — rilevazione degli oracoli esterni e proposta di install (03 §4, 09 §6).
//
// Node ESM, SOLO moduli built-in (child_process, fs, path, os, url): nessun npm
// install, nessuna dipendenza di rete. Viaggia nel .skill (02 §4, 09 §2).
//
// COSA FA
//   Per ciascun tool esterno (semgrep via docker, gitleaks, osv-scanner, knip):
//     1. Rileva la PRESENZA del binario/canale di esecuzione.
//     2. Confronta la versione rilevata contro un MINIMO PINNATO.
//     3. Se il tool è assente o sotto versione, PROPONE il comando di install
//        adatto all'OS rilevato — non lo esegue (gate umano, L-COL-005).
//     4. Se il tool non ha un canale di install disponibile sull'OS corrente,
//        lo dichiara NON INSTALLABILE e il controllo DEGRADA a "not-run"
//        (mai un verde finto, L-COL-006).
//
//   rls_check NON è in questa tabella: è il nostro unico oracolo custom,
//   viaggia con la skill, dipende solo dal runtime Node/JS. Sempre disponibile.
//
// STRUTTURA JSON PER TOOL (--json)
//   {
//     "tool": "<nome>",
//     "channel": "<canale>",        // "docker" | "go-bin" | "npx" | "path" | "none"
//     "present": true|false,        // il tool è rilevabile ed eseguibile
//     "version": "<x.y.z>"|null,    // versione rilevata (null se non rilevabile)
//     "version_ok": true|false,     // version >= MINIMUM (false se present=false)
//     "installable": true|false,    // esiste un canale di install sull'OS corrente
//     "install_cmd": "<cmd>"|null,  // comando PROPOSTO (null se non installabile)
//     "status": "ok"|"missing"|"version-low"|"non-installable",
//     "note": "<stringa leggibile>"
//   }
//
// SEMANTICA DI "status"
//   ok              → presente E versione >= minimo.
//   missing         → binario assente; installabile → installa con install_cmd.
//   version-low     → presente ma versione < minimo; aggiorna con install_cmd.
//   non-installable → assente E nessun canale di install sull'OS corrente:
//                     il controllo che dipende da questo tool DEGRADA a "not-run"
//                     (L-COL-006 — mai un verde finto; l'assenza è dichiarata).
//
// DETERMINISMO (L-COL-002): il risultato dipende SOLO dall'output dei comandi
// di rilevazione, mai da un parere del modello.
//
// USO
//   node trueline/scripts/preflight.mjs [<project-dir>]         # report umano, exit 0/1
//   node trueline/scripts/preflight.mjs --json [<project-dir>]  # JSON su stdout, exit 0
//   node trueline/scripts/preflight.mjs --json --simulate-missing=gitleaks  # self-test

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, delimiter, resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Argomenti CLI -----------------------------------------------------------
const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');

// Strumento da simulare come mancante (self-test / gate di eval).
const SIMULATE_MISSING_ARG = argv.find((a) => a.startsWith('--simulate-missing='));
const SIMULATE_MISSING = SIMULATE_MISSING_ARG
  ? SIMULATE_MISSING_ARG.replace('--simulate-missing=', '').toLowerCase()
  : null;

// Argomento posizionale: directory del progetto target (per trovare knip locale).
const PROJECT_DIR_ARG = argv.find((a) => !a.startsWith('--')) || null;

// --- Costanti di piattaforma -------------------------------------------------
const IS_WIN = platform() === 'win32';
const IS_MAC = platform() === 'darwin';
const IS_LINUX = platform() === 'linux';

// go/bin dove vivono gitleaks e osv-scanner su questa macchina.
// Su Windows usiamo il percorso noto (go in USERPROFILE\go\bin);
// su POSIX usiamo $HOME/go/bin (go install standard).
const GO_BIN = IS_WIN
  ? join(process.env.USERPROFILE || 'C:/Users/claud', 'go', 'bin')
  : join(homedir(), 'go', 'bin');

// PATH arricchito col go/bin (come negli altri wrapper della skill).
const ENV_WITH_GOBIN = {
  ...process.env,
  PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}`,
};

// --- Versioni MINIME PINNATE -------------------------------------------------
// Valori pin basati sulle feature usate nei wrapper (03 §4):
//   semgrep  1.60.0 → --metrics=off stabile + output JSON affidabile.
//   gitleaks 8.18.0 → --report-path - (stdout) + subcomando git per la history.
//   osv-scanner 1.6.0 → sottocomando "scan" + --lockfile relativo.
//   knip     5.0.0  → --reporter json stabile.
const MINIMUM_VERSIONS = {
  semgrep: [1, 60, 0],
  gitleaks: [8, 18, 0],
  'osv-scanner': [1, 6, 0],
  knip: [5, 0, 0],
};

// --- Parsing e confronto versioni --------------------------------------------

/**
 * Estrae la prima occorrenza di major.minor.patch da una stringa.
 * Restituisce null se il parsing fallisce.
 * Esempio: "gitleaks version version is set by build process" → null.
 */
function parseVersion(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/** true se actual >= required (tuple [major, minor, patch]). */
function versionAtLeast(actual, required) {
  if (!actual || !required) return false;
  for (let i = 0; i < 3; i++) {
    if (actual[i] > required[i]) return true;
    if (actual[i] < required[i]) return false;
  }
  return true;
}

function fmtVer(tuple) {
  return tuple ? tuple.join('.') : null;
}

// --- Helper di spawn sincrono ------------------------------------------------

/**
 * Esegue un comando e restituisce { ok, stdout, stderr, status }.
 *
 * Su Windows, i comandi come npm/pnpm/yarn/pipx sono script .cmd e NON sono
 * eseguibili direttamente via spawnSync senza shell. Usiamo shell:true solo
 * per i comandi che ne hanno bisogno (rilevabili dall'estensione .cmd o dalla
 * lista esplicita). Per i comandi con path assoluto o binari nativi (docker,
 * gitleaks, osv-scanner, node) usiamo shell:false per sicurezza.
 */
const WIN_CMD_SCRIPTS = new Set(['npm', 'pnpm', 'yarn', 'npx', 'pip', 'pip3', 'pipx', 'brew', 'winget', 'go']);

function runCmd(cmd, args, opts) {
  // Su Windows, i comandi della lista richiedono shell:true per funzionare
  // (sono script .cmd nel PATH, non eseguibili nativi).
  const needsShell = IS_WIN && WIN_CMD_SCRIPTS.has(cmd.split(/[\\/]/).pop().toLowerCase());
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 20_000,
    env: ENV_WITH_GOBIN,
    shell: needsShell,
    ...opts,
  });
  return {
    ok: !res.error && res.status !== null,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    status: res.status,
  };
}

// --- Proposta di install per OS ----------------------------------------------

/**
 * Determina il canale di install disponibile sull'OS e restituisce
 * { installable, channel, cmd }.
 *
 * Regole (03 §4):
 *   semgrep   → docker pull (cross-OS); pipx/pip fallback su Linux/Mac.
 *   gitleaks  → go install (se go presente); brew su Mac; binary release su Win/Linux.
 *   osv-scan  → go install (se go presente); binary release altrimenti.
 *   knip      → npm/pnpm/yarn --save-dev (per-progetto).
 */
function suggestInstall(toolName) {
  switch (toolName) {
    case 'semgrep': {
      const dockerOk = runCmd('docker', ['version', '--format', '{{.Server.Version}}']).ok;
      if (dockerOk) {
        return { installable: true, channel: 'docker', cmd: 'docker pull semgrep/semgrep:latest' };
      }
      const pipxOk = runCmd('pipx', ['--version']).ok;
      if (pipxOk) {
        return { installable: true, channel: 'pipx', cmd: 'pipx install semgrep' };
      }
      const pip3Ok = runCmd('pip3', ['--version']).ok;
      if (pip3Ok) {
        return { installable: true, channel: 'pip', cmd: 'pip3 install semgrep' };
      }
      const pipOk = runCmd('pip', ['--version']).ok;
      if (pipOk) {
        return { installable: true, channel: 'pip', cmd: 'pip install semgrep' };
      }
      return { installable: false, channel: 'none', cmd: null };
    }

    case 'gitleaks': {
      const goOk = runCmd('go', ['version']).ok;
      if (goOk) {
        return {
          installable: true,
          channel: 'go-install',
          cmd: 'go install github.com/zricethezav/gitleaks/v8@latest',
        };
      }
      if (IS_MAC) {
        const brewOk = runCmd('brew', ['--version']).ok;
        if (brewOk) {
          return { installable: true, channel: 'brew', cmd: 'brew install gitleaks' };
        }
      }
      if (IS_LINUX) {
        return {
          installable: true,
          channel: 'binary-release',
          cmd: 'curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/main/scripts/install.sh | sh -s -- v8.18.0',
        };
      }
      if (IS_WIN) {
        return {
          installable: true,
          channel: 'binary-release',
          cmd: 'winget install gitleaks  # oppure: scaricare da https://github.com/gitleaks/gitleaks/releases',
        };
      }
      return { installable: false, channel: 'none', cmd: null };
    }

    case 'osv-scanner': {
      const goOk = runCmd('go', ['version']).ok;
      if (goOk) {
        return {
          installable: true,
          channel: 'go-install',
          cmd: 'go install github.com/google/osv-scanner/cmd/osv-scanner@latest',
        };
      }
      // Binary release disponibile su tutti gli OS (non richiede Go).
      const releaseNote = IS_WIN
        ? 'https://github.com/google/osv-scanner/releases  (osv-scanner_windows_amd64.exe)'
        : IS_MAC
          ? 'https://github.com/google/osv-scanner/releases  (osv-scanner_macos_amd64 o _arm64)'
          : 'https://github.com/google/osv-scanner/releases  (osv-scanner_linux_amd64)';
      return {
        installable: true,
        channel: 'binary-release',
        cmd: `# Download binario da: ${releaseNote}`,
      };
    }

    case 'knip': {
      const npmOk = runCmd('npm', ['--version']).ok;
      if (npmOk) {
        return {
          installable: true,
          channel: 'npm',
          cmd: 'npm install --save-dev knip  # nella directory del progetto target',
        };
      }
      const pnpmOk = runCmd('pnpm', ['--version']).ok;
      if (pnpmOk) {
        return {
          installable: true,
          channel: 'pnpm',
          cmd: 'pnpm add --save-dev knip  # nella directory del progetto target',
        };
      }
      const yarnOk = runCmd('yarn', ['--version']).ok;
      if (yarnOk) {
        return {
          installable: true,
          channel: 'yarn',
          cmd: 'yarn add --dev knip  # nella directory del progetto target',
        };
      }
      return { installable: false, channel: 'none', cmd: null };
    }

    default:
      return { installable: false, channel: 'none', cmd: null };
  }
}

// --- Costruttore del risultato strutturato -----------------------------------

function buildResult(tool, channel, present, versionTuple, versionOk, suggest) {
  const { installable, cmd } = suggest;
  const minVer = MINIMUM_VERSIONS[tool];
  const minStr = minVer ? fmtVer(minVer) : null;
  const verStr = versionTuple ? fmtVer(versionTuple) : null;

  let status;
  let note;

  if (present && versionOk) {
    status = 'ok';
    note = `${tool} presente, versione ${verStr} >= minimo richiesto ${minStr}.`;
  } else if (present && !versionOk) {
    if (versionTuple === null) {
      // Presente ma versione non parsabile (es. build dev senza tag git):
      // non possiamo garantire che soddisfi il minimo → non-installable per precauzione
      // (L-COL-006: mai un verde finto).
      status = 'non-installable';
      note =
        `${tool} presente ma la versione non è parsabile ` +
        `(build di sviluppo senza tag git). ` +
        `Impossibile verificare il rispetto del minimo ${minStr}. ` +
        `Installa una release ufficiale taggata.` +
        (installable && cmd ? ` Comando suggerito: ${cmd}` : '');
    } else {
      status = 'version-low';
      note =
        `${tool} presente ma versione ${verStr} < minimo richiesto ${minStr}. ` +
        `Aggiorna: ${cmd || '(nessun canale disponibile su questo OS)'}`;
    }
  } else if (!present && installable) {
    status = 'missing';
    note =
      `${tool} non trovato. ` +
      `Installa (gate umano richiesto — la skill non lo esegue da sola, L-COL-005): ${cmd}`;
  } else {
    // Non presente e non installabile.
    status = 'non-installable';
    note =
      `${tool} non trovato e nessun canale di install disponibile sull'OS corrente. ` +
      `Il controllo che dipende da ${tool} DEGRADA a "not-run" ` +
      `(mai un verde finto, L-COL-006 — l'assenza è dichiarata).`;
  }

  return {
    tool,
    channel,
    present,
    version: verStr,
    version_ok: present ? versionOk : false,
    installable,
    install_cmd: cmd,
    status,
    note,
  };
}

// --- Rilevazione per tool ----------------------------------------------------

// semgrep — VIA DOCKER (il canale usato dal wrapper run_semgrep.mjs, 03 §5.1).
// Non cerca semgrep sul PATH: la skill lo esegue sempre tramite docker per
// garantire la versione pinnata (determinismo, L-COL-002).
function detectSemgrep(simMissing) {
  const tool = 'semgrep';
  const min = MINIMUM_VERSIONS[tool];

  if (simMissing) {
    return buildResult(tool, 'docker', false, null, false, suggestInstall(tool));
  }

  // 1) docker disponibile?
  const dockerCheck = runCmd('docker', ['version', '--format', '{{.Server.Version}}']);
  if (!dockerCheck.ok || dockerCheck.status !== 0) {
    return buildResult(tool, 'docker', false, null, false, suggestInstall(tool));
  }

  // 2) Immagine pinnata presente localmente?
  const imgCheck = runCmd('docker', ['images', '-q', 'semgrep/semgrep:latest']);
  const imgId = (imgCheck.stdout || '').trim();
  if (!imgId) {
    // Immagine non presente: propone docker pull.
    const suggest = { installable: true, channel: 'docker', cmd: 'docker pull semgrep/semgrep:latest' };
    return buildResult(tool, 'docker', false, null, false, suggest);
  }

  // 3) Versione dall'immagine.
  const verRun = runCmd(
    'docker',
    ['run', '--rm', 'semgrep/semgrep:latest', 'semgrep', '--version'],
    { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, timeout: 60_000 },
  );
  const raw = (verRun.stdout || '').trim();
  const parsed = parseVersion(raw);
  const vOk = versionAtLeast(parsed, min);
  return buildResult(tool, 'docker', true, parsed, vOk, suggestInstall(tool));
}

// gitleaks — binario nel go/bin noto o sul PATH.
function detectGitleaks(simMissing) {
  const tool = 'gitleaks';
  const min = MINIMUM_VERSIONS[tool];

  if (simMissing) {
    return buildResult(tool, 'go-bin', false, null, false, suggestInstall(tool));
  }

  // Prova prima via PATH arricchito.
  let verRun = runCmd('gitleaks', ['version']);
  if (!verRun.ok) {
    // Prova il percorso assoluto noto.
    const exeName = IS_WIN ? 'gitleaks.exe' : 'gitleaks';
    const knownPath = join(GO_BIN, exeName);
    if (!existsSync(knownPath)) {
      return buildResult(tool, 'go-bin', false, null, false, suggestInstall(tool));
    }
    verRun = runCmd(knownPath, ['version']);
    if (!verRun.ok) {
      return buildResult(tool, 'go-bin', false, null, false, suggestInstall(tool));
    }
  }

  // gitleaks version output: "gitleaks version <semver>" oppure
  // "version is set by build process" (build dev senza tag git).
  const raw = (verRun.stdout || '').trim();
  const parsed = parseVersion(raw);
  const vOk = versionAtLeast(parsed, min);
  return buildResult(tool, 'go-bin', true, parsed, vOk, suggestInstall(tool));
}

// osv-scanner — binario nel go/bin noto o sul PATH.
function detectOsvScanner(simMissing) {
  const tool = 'osv-scanner';
  const min = MINIMUM_VERSIONS[tool];

  if (simMissing) {
    return buildResult(tool, 'go-bin', false, null, false, suggestInstall(tool));
  }

  let verRun = runCmd('osv-scanner', ['--version']);
  if (!verRun.ok) {
    const exeName = IS_WIN ? 'osv-scanner.exe' : 'osv-scanner';
    const knownPath = join(GO_BIN, exeName);
    if (!existsSync(knownPath)) {
      return buildResult(tool, 'go-bin', false, null, false, suggestInstall(tool));
    }
    verRun = runCmd(knownPath, ['--version']);
    if (!verRun.ok) {
      return buildResult(tool, 'go-bin', false, null, false, suggestInstall(tool));
    }
  }

  // osv-scanner output: "osv-scanner version: 1.9.2\ncommit: ...\nbuilt at: ..."
  const raw = (verRun.stdout || '').trim();
  const parsed = parseVersion(raw);
  const vOk = versionAtLeast(parsed, min);
  return buildResult(tool, 'go-bin', true, parsed, vOk, suggestInstall(tool));
}

// knip — installato come devDependency nel progetto target (node_modules).
// Cerca knip.js nella directory del progetto passata o nella CWD.
function detectKnip(simMissing, projectDir) {
  const tool = 'knip';
  const min = MINIMUM_VERSIONS[tool];

  if (simMissing) {
    return buildResult(tool, 'npx', false, null, false, suggestInstall(tool));
  }

  // Ordine di ricerca: projectDir (se passata), poi CWD.
  const searchDirs = [
    projectDir ? resolve(projectDir) : null,
    process.cwd(),
  ].filter(Boolean);

  for (const dir of searchDirs) {
    const knipJs = join(dir, 'node_modules', 'knip', 'bin', 'knip.js');
    const knipPkg = join(dir, 'node_modules', 'knip', 'package.json');
    if (!existsSync(knipJs)) continue;

    // Versione da package.json (più veloce).
    let parsed = null;
    if (existsSync(knipPkg)) {
      try {
        const pkg = JSON.parse(readFileSync(knipPkg, 'utf8'));
        parsed = parseVersion(String(pkg.version || ''));
      } catch {
        // best-effort
      }
    }

    // Fallback: esegui node <knip.js> --version.
    if (!parsed) {
      const verRun = runCmd(process.execPath, [knipJs, '--version'], { cwd: dir });
      if (verRun.ok) {
        parsed = parseVersion((verRun.stdout || '').trim());
      }
    }

    const vOk = versionAtLeast(parsed, min);
    return buildResult(tool, 'npx', true, parsed, vOk, suggestInstall(tool));
  }

  // Prova npx --no-install knip --version (se knip è installato globalmente).
  const npxRun = runCmd('npx', ['--no-install', 'knip', '--version']);
  if (npxRun.ok && npxRun.status === 0) {
    const parsed = parseVersion((npxRun.stdout || '').trim());
    const vOk = versionAtLeast(parsed, min);
    return buildResult(tool, 'npx', true, parsed, vOk, suggestInstall(tool));
  }

  return buildResult(tool, 'npx', false, null, false, suggestInstall(tool));
}

// --- rls_check: sempre disponibile, nessuna dipendenza esterna ---------------
const RLS_CHECK_ENTRY = {
  tool: 'rls_check',
  channel: 'built-in',
  present: true,
  version: null,
  version_ok: true,
  installable: true,
  install_cmd: null,
  status: 'ok',
  note: 'rls_check viaggia con la skill (03 §5.4). Dipende solo dal runtime Node/JS. Sempre disponibile.',
};

// --- Punto di ingresso -------------------------------------------------------

function main() {
  const results = [
    detectSemgrep(SIMULATE_MISSING === 'semgrep'),
    detectGitleaks(SIMULATE_MISSING === 'gitleaks'),
    detectOsvScanner(SIMULATE_MISSING === 'osv-scanner'),
    detectKnip(SIMULATE_MISSING === 'knip', PROJECT_DIR_ARG),
    RLS_CHECK_ENTRY,
  ];

  if (JSON_MODE) {
    const out = {
      schema_version: '1.0',
      platform: platform(),
      go_bin: GO_BIN,
      tools: results,
      summary: {
        ok: results.filter((r) => r.status === 'ok').length,
        missing: results.filter((r) => r.status === 'missing').length,
        version_low: results.filter((r) => r.status === 'version-low').length,
        non_installable: results.filter((r) => r.status === 'non-installable').length,
      },
      minimum_versions: Object.fromEntries(
        Object.entries(MINIMUM_VERSIONS).map(([k, v]) => [k, v.join('.')]),
      ),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    // JSON mode: exit 0 sempre (il chiamante legge il JSON e decide).
    process.exit(0);
  }

  // --- Report umano -----------------------------------------------------------
  const HR = '─'.repeat(64);
  console.log(HR);
  console.log(' TRUELINE — preflight rilevazione oracoli (03 §4 / 09 §6)');
  console.log(` OS: ${platform()}  |  go/bin atteso: ${GO_BIN}`);
  console.log(HR);
  console.log('');

  let anyProblem = false;

  for (const r of results) {
    const isBuiltIn = r.tool === 'rls_check';
    const icon = r.status === 'ok' ? '✓' : '✗';
    const minEntry = MINIMUM_VERSIONS[r.tool];
    const minLabel = minEntry ? `  (minimo: ${fmtVer(minEntry)})` : '';
    const verLabel = r.version ? ` v${r.version}` : '';
    console.log(`  [${icon}] ${r.tool}${verLabel}${minLabel}`);
    console.log(`       canale: ${r.channel}  |  status: ${r.status}`);
    console.log(`       ${r.note}`);

    if (r.status !== 'ok' && !isBuiltIn) {
      anyProblem = true;
      if (r.install_cmd) {
        console.log('');
        console.log('       AZIONE RICHIESTA (la skill NON installa da sola — gate umano, L-COL-005):');
        console.log(`         ${r.install_cmd}`);
      } else {
        console.log('');
        console.log('       TOOL NON INSTALLABILE su questo OS: il controllo dipendente DEGRADA a "not-run".');
        console.log('       Nessun verde finto (L-COL-006).');
      }
    }
    console.log('');
  }

  console.log(HR);
  const externalTotal = results.filter((r) => r.tool !== 'rls_check').length;
  const externalOk = results.filter((r) => r.tool !== 'rls_check' && r.status === 'ok').length;

  if (!anyProblem) {
    console.log(` PREFLIGHT OK — tutti i ${externalTotal} tool esterni pronti + rls_check built-in.`);
  } else {
    console.log(` PREFLIGHT: ${externalOk}/${externalTotal} tool esterni pronti.`);
    console.log(' Tool mancanti o sotto-versione: vedi AZIONI RICHIESTE sopra.');
    console.log(' I controlli che dipendono da tool assenti DEGRADANO a "not-run" (L-COL-006).');
  }
  console.log(HR);

  // Exit 1 se almeno un tool esterno è non-ok (per i chiamanti che usano l'exit code).
  process.exit(anyProblem ? 1 : 0);
}

main();
