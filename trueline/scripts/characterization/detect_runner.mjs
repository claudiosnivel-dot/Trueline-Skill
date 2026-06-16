// detect_runner.mjs — rilevatore del test runner di un progetto target (06 §5).
//
// GENERICO sopra un progetto utente qualunque (NON hardcoded alla reference app).
// Ispeziona package.json per capire quale runner di test e' gia' dichiarato, in
// ordine di preferenza: vitest > jest > node:test. Se il progetto NON dichiara
// alcun runner, il generatore (generate.mjs) puo' impalcare un runner basato su
// `node:test` (sempre disponibile col Node toolchain, zero dipendenze npm). Se
// nemmeno questo e' possibile, si DICHIARA la degradazione — MAI un falso verde
// (06 §3, L-COL-006).
//
// Node ESM, solo built-in.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Legge e parsa il package.json del progetto. Ritorna null se assente/illeggibile.
function readPkg(projectDir) {
  const p = resolve(projectDir, 'package.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch { return null; }
}

// Un test script "placeholder" ("no test specified") NON conta come runner reale.
function isPlaceholder(script) {
  return !script || /no test specified/i.test(script);
}

// Cerca un runner tra le dipendenze dichiarate (dev + prod) e gli script.
function detectDeclared(pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const testScript = (pkg.scripts && pkg.scripts.test) || '';

  // vitest: dipendenza o invocato nello script test.
  if (deps.vitest || /\bvitest\b/.test(testScript)) return 'vitest';
  // jest: dipendenza o invocato nello script test.
  if (deps.jest || /\bjest\b/.test(testScript)) return 'jest';
  // node:test: invocato esplicitamente (node --test) nello script.
  if (/node\s+--test\b/.test(testScript) || /\bnode:test\b/.test(testScript)) return 'node:test';
  return null;
}

// detectRunner(projectDir) -> { present, runner, degraded, detail }
//
//   present   true se un runner REALE e' gia' dichiarato dal progetto.
//   runner    'vitest' | 'jest' | 'node:test' | null
//   degraded  true se NON c'e' runner reale E nemmeno e' impalcabile node:test
//             (es. nessun package.json) -> il generatore deve dichiarare il limite.
//   detail    spiegazione leggibile (per il report di copertura).
//
// Politica: se il progetto NON dichiara un runner ma esiste un package.json
// scrivibile, NON e' degradato: il generatore puo' impalcare `node:test`
// (runner='node:test', present=false). La degradazione vera scatta solo quando
// non c'e' nemmeno un package.json su cui agganciare lo script test.
export function detectRunner(projectDir) {
  const pkg = readPkg(projectDir);
  if (!pkg) {
    return {
      present: false,
      runner: null,
      degraded: true,
      detail: 'nessun package.json: impossibile rilevare o impalcare un test runner (degradato, NON verde)',
    };
  }

  const declared = detectDeclared(pkg);
  if (declared) {
    return {
      present: true,
      runner: declared,
      degraded: false,
      detail: `runner gia' dichiarato dal progetto: ${declared}`,
    };
  }

  const testScript = (pkg.scripts && pkg.scripts.test) || '';
  const placeholder = isPlaceholder(testScript);
  return {
    present: false,
    runner: 'node:test',
    degraded: false,
    detail: placeholder
      ? "nessun runner dichiarato (script test placeholder/assente): impalcabile node:test (zero dipendenze npm)"
      : `script test presente ma runner non riconosciuto (${testScript.slice(0, 40)}): fallback node:test impalcabile`,
  };
}

export default detectRunner;
