// verify_workspace.mjs — gestore della COPIA TEMPORANEA di verifica.
//
// *** REGOLA CRITICA — INTEGRITA DEL FIXTURE ***
// Il loop APPLICA fix (modifica codice/migration) e committa. NON deve MAI
// mutare il fixture canonico eval/reference-app: romperebbe i gate ripetibili
// di M-1/M0. Ogni esecuzione del loop/verify gira su una COPIA TEMPORANEA:
// copiamo eval/reference-app (INCLUSO .git — serve per lo scope history di S2)
// in una dir temp gitignorata (eval/.tmp-verify/<id>), operiamo li', e a fine
// ESEGUIAMO cleanup (rm -rf della temp). Dopo, il fixture canonico DEVE essere
// bit-identico (detection/present ancora EXIT 0).
//
// Node ESM, solo built-in (fs, path, url). Niente dipendenze npm, niente rete.

import {
  cpSync, rmSync, existsSync, mkdirSync, readdirSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// trueline/scripts/loop -> root e' 3 livelli sopra.
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

export const CANONICAL_REFERENCE_APP = resolve(REPO_ROOT, 'eval', 'reference-app');
// Radice delle copie temporanee (gitignorata: vedi .gitignore "eval/.tmp-verify/").
export const TMP_VERIFY_ROOT = resolve(REPO_ROOT, 'eval', '.tmp-verify');

// Cosa NON copiare: node_modules e' enorme e non serve agli oracoli del loop
// (rls_check/gitleaks/knip leggono i sorgenti). MA knip ha bisogno del suo
// binario locale (node_modules/.bin) — vedi nota in createVerifyWorkspace.
const SKIP_TOP_LEVEL = new Set([]);

// Crea una copia temporanea isolata della reference app canonica.
//
// Opzioni:
//   id            etichetta della copia (default: timestamp+random). La dir e'
//                 eval/.tmp-verify/<id>.
//   includeGit    copia anche .git (default true: necessario per lo scope
//                 history di S2 e per i commit isolati del loop).
//   linkNodeModules  se true, NON copia node_modules ma lo richiama via symlink
//                 (piu' veloce). Default: false (copia integrale, piu' robusta
//                 su Windows dove i symlink possono richiedere privilegi).
//
// Ritorna { dir, id, cleanup }.
export function createVerifyWorkspace(opts = {}) {
  const {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    includeGit = true,
  } = opts;

  if (!existsSync(CANONICAL_REFERENCE_APP)) {
    throw new Error(`reference-app canonica assente: ${CANONICAL_REFERENCE_APP}`);
  }

  mkdirSync(TMP_VERIFY_ROOT, { recursive: true });
  const dir = join(TMP_VERIFY_ROOT, id);

  // Copia pulita: se per qualche motivo la dir esiste gia', azzerala prima.
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

  // cpSync ricorsivo. Filtriamo via le entry indesiderate. NB: includiamo
  // node_modules perche' run_deadcode (knip) richiede il binario locale del
  // progetto target (node_modules/knip/bin/knip.js) — senza, l'oracolo
  // dead-code fallirebbe. Includiamo .git per lo scope history.
  cpSync(CANONICAL_REFERENCE_APP, dir, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const base = src.slice(CANONICAL_REFERENCE_APP.length + 1).split(/[\\/]/)[0];
      if (!includeGit && base === '.git') return false;
      if (SKIP_TOP_LEVEL.has(base)) return false;
      return true;
    },
  });

  const cleanup = () => destroyVerifyWorkspace(dir);
  return { dir, id, cleanup };
}

// Rimuove una copia temporanea (rm -rf). Idempotente: no-op se assente.
export function destroyVerifyWorkspace(dir) {
  if (!dir) return;
  const abs = resolve(dir);
  // Guardrail: non rimuovere mai nulla fuori da eval/.tmp-verify, e MAI il
  // fixture canonico. Errore esplicito se qualcuno passa un path sbagliato.
  if (abs === CANONICAL_REFERENCE_APP) {
    throw new Error('RIFIUTO: tentata rimozione del fixture canonico eval/reference-app');
  }
  if (!abs.startsWith(TMP_VERIFY_ROOT)) {
    throw new Error(`RIFIUTO: cleanup fuori da eval/.tmp-verify: ${abs}`);
  }
  if (existsSync(abs)) rmSync(abs, { recursive: true, force: true });
  // Pota la radice .tmp-verify se ora e' vuota (nessuna altra copia residua).
  try {
    if (existsSync(TMP_VERIFY_ROOT) && readdirSync(TMP_VERIFY_ROOT).length === 0) {
      rmSync(TMP_VERIFY_ROOT, { recursive: true, force: true });
    }
  } catch { /* best-effort: una radice non vuota o concorrente non e' un errore */ }
}

// Pulisce TUTTE le copie temporanee residue (es. dopo un crash). Idempotente.
export function cleanupAllVerifyWorkspaces() {
  if (existsSync(TMP_VERIFY_ROOT)) {
    rmSync(TMP_VERIFY_ROOT, { recursive: true, force: true });
  }
}
