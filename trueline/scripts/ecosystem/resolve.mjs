#!/usr/bin/env node
// resolve.mjs — sorgente unica della risoluzione dell'ecosistema attivo (SP-0).
// Classifica il repo -> manifest attivo (via detect), espone i binding. Nessun
// manifest combacia -> null (la skill dichiara "non supportato", non inventa).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEcosystem } from './validate_ecosystem.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ECO_DIR = resolve(__dirname, '..', '..', 'references', 'ecosystems');

export function loadEcosystems(dir = ECO_DIR) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const mf = join(dir, e, 'ecosystem.json');
    if (!existsSync(mf)) continue;
    let m = null;
    try { m = JSON.parse(readFileSync(mf, 'utf8')); } catch { continue; }
    if (validateEcosystem(m).ok) out.push(m);
  }
  return out;
}

export function classify(projectDir, ecosystems = loadEcosystems()) {
  for (const m of ecosystems) {
    const d = m.detect || {};
    const filesOk = (d.files_any || []).some((f) => existsSync(join(projectDir, f)));
    const langOk = (d.lang_any || []).some((f) => existsSync(join(projectDir, f)));
    // detect: combacia se uno dei segnali "files_any" è presente (segnale forte),
    // oppure se NON ci sono files_any ma un lang_any combacia. (Precedenza/ambiguità
    // multi-match: regola dura SKILL.md §1 — proponi+conferma; qui ritorna il primo.)
    if ((d.files_any && d.files_any.length ? filesOk : langOk)) return m.id;
  }
  return null;
}

const keysToCategories = (oracles) => {
  const out = {};
  for (const [key, b] of Object.entries(oracles)) for (const cat of key.split('|')) out[cat.trim()] = b;
  return out;
};
export const oraclesFor = (m) => keysToCategories(m.oracles);
export const deadCodeTool = (m) => (m.oracles['dead-code'] && m.oracles['dead-code'].tool) || null;
export const testRunnerDetect = (m) => (m.test_runner && m.test_runner.detect) || [];
export const verifiedSet = (m) => m.verified_set || [];
export const floorOf = (m) => m.floor || [];
export function authzSurfaceCategory(m) {
  for (const [key, b] of Object.entries(m.oracles)) if (b && b.role === 'authz-surface') return key.split('|')[0].trim();
  return null;
}
export function loadManifest(id) { return loadEcosystems().find((m) => m.id === id) || null; }
