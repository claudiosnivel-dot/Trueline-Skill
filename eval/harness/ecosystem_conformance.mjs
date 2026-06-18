#!/usr/bin/env node
// ecosystem_conformance.mjs <id> — GATE DI CONFORMITÀ PARAMETRICO (SP-0, spec §5.4).
//
// Dato un <id> di ecosistema, risolve il manifest spedito (via resolve.mjs:
// loadManifest) e asserisce i criteri della §5.4 dello spec. SP-0 si ferma a
// `supabase-jsts` (manifest retro-descritto, prova di completezza del contratto):
//
//   CRITERIO 1 — MANIFEST VALIDO (sempre): il manifest <id> passa
//                validateEcosystem (schema strutturale: campi obbligatori, floor
//                legato agli oracoli, esattamente un binding role:authz-surface,
//                verified_set ⊆ categorie legate, coverage_policy nota). Stampa
//                "[PASS] manifest valido (validate_ecosystem)" o FALLISCE (exit 1).
//
//   CRITERI 2..6 — DETECTION/VERIFIED/BUILD/TRIGGERING/IGIENE: per `supabase-jsts`
//                la fixture del pack è l'attuale `eval/reference-app` (S1..S8) +
//                `eval/seeded-blueprint`, e l'intera batteria A/B/C/D/E è GIÀ
//                implementata dal gate v1 `eval/harness/m5_gate_check.mjs`. Qui
//                DELEGHIAMO: individuata la fixture, lanciamo
//                `node eval/harness/m5_gate_check.mjs` e PROPAGHIAMO il suo exit
//                code. (Per i pack nuovi il corpo detection-parametrico arriva con
//                SP-1; SP-0 non aggiunge ecosistemi.)
//
// ESITO (mai un falso verde — L-COL-002, "verde" = exit/output reale di un comando):
//   exit 0  — criterio 1 PASS  E  (in modalità piena) m5_gate_check PASS;
//   exit 1  — criterio 1 FAIL, oppure m5_gate_check FAIL/precondizione assente,
//             oppure fixture del pack mancante (conformità non dimostrabile);
//   exit 2  — <id> sconosciuto / nessun manifest spedito per <id>: NON è un
//             fallimento di merito (esito DISTINTO), ma NON può essere un verde.
//
// FLAG:
//   --validate-only  — esegue SOLO il criterio 1 (salta la delega a m5): self-check
//                      LEGGERO (no DB/docker). exit 0/1.
//
// NON tocca git (l'orchestratore possiede git). Solo letture su filesystem + RUN
// di `node ...`. Node ESM, solo built-in.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadManifest } from '../../trueline/scripts/ecosystem/resolve.mjs';
import { validateEcosystem } from '../../trueline/scripts/ecosystem/validate_ecosystem.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const M5_GATE = resolve(ROOT, 'eval', 'harness', 'm5_gate_check.mjs');

// Fixture del pack per ecosistema. SP-0: solo `supabase-jsts` (la fixture è
// l'attuale reference-app + seeded-blueprint; il gate è m5). I pack nuovi (SP-1+)
// porteranno `eval/ecosystems/<id>/` e un corpo detection-parametrico.
const PACK_FIXTURES = {
  'supabase-jsts': {
    requires: [
      resolve(ROOT, 'eval', 'reference-app'),
      resolve(ROOT, 'eval', 'seeded-blueprint'),
    ],
    gate: M5_GATE,
  },
};

function usage(msg) {
  if (msg) console.error(msg);
  console.error('uso: node eval/harness/ecosystem_conformance.mjs <id> [--validate-only]');
}

function main() {
  const args = process.argv.slice(2);
  const validateOnly = args.includes('--validate-only');
  const id = args.find((a) => !a.startsWith('--'));

  if (!id) {
    usage('ERRORE: <id> ecosistema mancante.');
    process.exit(2);
  }

  console.log(`ecosystem_conformance — <${id}>${validateOnly ? ' (--validate-only)' : ''}`);
  console.log('------------------------------------------------------------');

  // Risoluzione del manifest spedito per <id> (resolve.mjs è la sorgente unica).
  const manifest = loadManifest(id);
  if (!manifest) {
    console.error(`[EXIT 2] nessun manifest spedito per <${id}>: ecosistema sconosciuto.`);
    console.error('         (mai un falso verde — id non risolvibile ≠ conformità.)');
    process.exit(2);
  }

  // --- CRITERIO 1: MANIFEST VALIDO (validate_ecosystem) ----------------------
  const v = validateEcosystem(manifest);
  if (!v.ok) {
    console.error('[FAIL] manifest NON valido (validate_ecosystem):');
    for (const e of v.errors) console.error(`         - ${e}`);
    process.exit(1);
  }
  console.log('[PASS] manifest valido (validate_ecosystem)');

  if (validateOnly) {
    console.log('------------------------------------------------------------');
    console.log(`=== CONFORMANCE <${id}> RESULT: PASS (criterio 1, --validate-only) ===`);
    process.exit(0);
  }

  // --- CRITERI 2..6: DELEGA al gate del pack (m5 per supabase-jsts) ----------
  const pack = PACK_FIXTURES[id];
  if (!pack) {
    // Manifest valido ma SP-0 non ha un corpo di conformità per questo <id>
    // (nessuna fixture/gate spedito): non possiamo dimostrare detection parity.
    // NON è un verde: la conformità piena richiede la fixture del pack.
    console.error(`[FAIL] manifest valido ma nessuna fixture/gate di conformità spedito per <${id}>.`);
    console.error('       (SP-0 implementa il corpo solo per supabase-jsts; usa --validate-only per il solo criterio 1.)');
    process.exit(1);
  }

  // Individua la fixture del pack: se manca, la conformità NON è dimostrabile.
  const missing = pack.requires.filter((p) => !existsSync(p));
  if (missing.length) {
    console.error(`[FAIL] fixture del pack <${id}> mancante:`);
    for (const m of missing) console.error(`         - ${m}`);
    process.exit(1);
  }
  console.log(`[INFO] fixture del pack individuata; delego a ${pack.gate.replace(ROOT, '.')}`);
  console.log('------------------------------------------------------------');

  // Lancia il gate del pack e PROPAGA il suo exit code (stdio ereditato → il log
  // del gate compare inline). exit 0 solo se criterio 1 (sopra) AND il gate passa.
  const res = spawnSync(process.execPath, [pack.gate], { stdio: 'inherit' });
  if (res.error) {
    console.error(`[FAIL] impossibile lanciare il gate del pack: ${res.error.message}`);
    process.exit(1);
  }
  const code = typeof res.status === 'number' ? res.status : 1;

  console.log('------------------------------------------------------------');
  if (code === 0) {
    console.log(`=== CONFORMANCE <${id}> RESULT: PASS (criterio 1 + gate del pack) ===`);
  } else {
    console.log(`=== CONFORMANCE <${id}> RESULT: FAIL (gate del pack exit=${code}) ===`);
  }
  process.exit(code);
}

main();
