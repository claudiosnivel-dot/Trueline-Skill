#!/usr/bin/env node
// package_ecosystem.test.mjs — verifica che package_skill validi i manifest
// ecosistema (SP-0, Task E1). Pure-Node, falsificabile SENZA corrompere il
// manifest reale. Il "verde" e un FATTO di comando (L-COL-002).
//
// Due scenari:
//   (A) manifest ROTTO (floor non legato) -> validateEcosystem -> RIGETTO
//   (B) manifest REALE (supabase-jsts)     -> validateEcosystem -> ACCETTATO
//
// La verifica di integrazione e: node package_skill.mjs --no-archive
// -> lint VERDE + ecosistemi elencati con version/tier.

import { validateEcosystem } from '../ecosystem/validate_ecosystem.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok: Boolean(ok) });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
};

// --- Scenario A: manifest ROTTO (floor non legato a nessun oracolo) ----------
// Questa e la falsificabilita: un manifest invalido DEVE essere rigettato.
const BROKEN = {
  id: 'broken-eco',
  version: '1.0.0',
  languages: ['ts'],
  backend: 'postgres',
  detect: { files_any: ['supabase/config.toml'] },
  triggers: ['trigger1', 'trigger2'],
  oracles: {
    secret: { tool: 'gitleaks', shared: true },
    rls:    { tool: 'rls_check', role: 'authz-surface' },
  },
  // floor contiene 'floor-non-legata' che NON e un oracolo -> validazione FALLISCE
  floor: ['secret', 'floor-non-legata'],
  verified_set: ['secret'],
  coverage_policy: 'declared',
};

const brokenResult = validateEcosystem(BROKEN);
check(
  'manifest ROTTO (floor non legato) -> RIGETTATO',
  brokenResult.ok === false,
  brokenResult.ok === false
    ? `errori: ${brokenResult.errors.join('; ')}`
    : 'ERRORE: validazione non ha rigettato il manifest rotto',
);
check(
  'messaggio di errore menziona la categoria non legata',
  brokenResult.errors && brokenResult.errors.some((e) => e.includes('floor-non-legata')),
  brokenResult.errors ? brokenResult.errors.join('; ') : '(nessun errore)',
);

// --- Scenario B: manifest REALE (supabase-jsts) -> ACCETTATO -----------------
const REAL_PATH = resolve(__dirname, '..', '..', 'references', 'ecosystems', 'supabase-jsts', 'ecosystem.json');

check(
  'ecosystem.json reale esiste su filesystem',
  existsSync(REAL_PATH),
  REAL_PATH,
);

let realManifest = null;
try {
  realManifest = JSON.parse(readFileSync(REAL_PATH, 'utf8'));
  check('ecosystem.json reale e JSON valido', true);
} catch (e) {
  check('ecosystem.json reale e JSON valido', false, e.message);
}

if (realManifest) {
  const realResult = validateEcosystem(realManifest);
  check(
    'manifest REALE (supabase-jsts) -> ACCETTATO',
    realResult.ok === true,
    realResult.ok ? 'ok' : `errori: ${realResult.errors.join('; ')}`,
  );

  // Verifica anche il tier: verified_set non vuoto -> tier "verified"
  const tier = realManifest.verified_set && realManifest.verified_set.length > 0
    ? 'verified'
    : 'detection';
  check('tier calcolato per supabase-jsts = "verified"', tier === 'verified', `tier=${tier}`);

  // Verifica che il manifest reale sia supabase-jsts v1.0.0
  check(
    'supabase-jsts id e version corretti',
    realManifest.id === 'supabase-jsts' && realManifest.version === '1.0.0',
    `id=${realManifest.id} version=${realManifest.version}`,
  );
}

// --- Riepilogo ----------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
if (failed.length > 0) {
  console.log('Fallimenti:');
  for (const f of failed) console.log(`  - ${f.label}`);
}
process.exit(failed.length === 0 ? 0 : 1);
