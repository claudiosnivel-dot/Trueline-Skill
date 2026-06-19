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

// strongSignal(projectDir, entry) -> bool
// SP-1 T2.1 — un'entry di detect.files_any è un SEGNALE FORTE quando il file
// dichiarato esiste OPPURE quando esiste la sua DIRECTORY-MARKER (il primo
// segmento del path-signal). Razionale: i marker dichiarati (es.
// `supabase/config.toml`) identificano un ecosistema tramite la cartella-firma
// (`supabase/`) che un progetto reale ha SEMPRE — anche mid-setup (solo
// `supabase/migrations/`, config.toml non ancora generato) o nelle fixture eval.
// Senza questo, un repo Supabase con la dir `supabase/` ma senza config.toml
// cadrebbe nel fallback lang_any-only e verrebbe mis-classificato come il pack
// generico (es. postgres-jsts), rompendo a valle la selezione degli oracoli del
// loop (verified_set sbagliato). La dir-marker NON è lasca: vale solo per le entry
// con un segmento di directory (es. `supabase/...`); un'entry file-in-root
// (es. `package.json`) resta un match esatto-file, mai dir.
function strongSignal(projectDir, entry) {
  if (existsSync(join(projectDir, entry))) return true; // file dichiarato presente
  const seg = String(entry).split('/')[0];
  if (seg && seg !== entry) {                            // l'entry ha una dir-marker
    try { if (statSync(join(projectDir, seg)).isDirectory()) return true; } catch { /* assente */ }
  }
  return false;
}

// classify(projectDir) -> id (string) | null | {ambiguous:true, candidates:[...]}
// SP-1 T2.1 — precedenza file-signal-forte, in DUE passate:
//  (1) i manifest con detect.files_any NON vuoto il cui SEGNALE FORTE è presente
//      (file dichiarato O dir-marker, vedi strongSignal) = SEGNALE FORTE; tra più
//      match forti vince il più SPECIFICO (più files_any combacianti). Pari merito
//      tra manifest distinti = AMBIGUITÀ -> esito {ambiguous} (il chiamante fa
//      proponi+conferma, regola dura SKILL.md §1) — MAI un verde silenzioso.
//  (2) fallback: i manifest lang_any-only (detect senza files_any) il cui lang_any
//      combacia; stessa gestione dell'ambiguità.
//  Repo che non combacia in nessuna passata -> null (non supportato, onesto).
export function classify(projectDir, ecosystems = loadEcosystems()) {
  // Passata 1 — segnale forte (files_any non vuoto + segnale presente: file o dir-marker).
  const strong = [];
  for (const m of ecosystems) {
    const d = m.detect || {};
    const filesAny = d.files_any || [];
    if (!filesAny.length) continue;
    const hits = filesAny.filter((f) => strongSignal(projectDir, f)).length;
    if (hits > 0) strong.push({ id: m.id, hits });
  }
  if (strong.length) {
    const max = Math.max(...strong.map((s) => s.hits));
    const top = strong.filter((s) => s.hits === max);
    if (top.length === 1) return top[0].id;
    return { ambiguous: true, candidates: top.map((s) => s.id) }; // proponi+conferma
  }

  // Passata 2 — fallback lang_any-only (nessun files_any nel manifest).
  const weak = [];
  for (const m of ecosystems) {
    const d = m.detect || {};
    if ((d.files_any || []).length) continue; // i forti sono già stati valutati
    const langAny = d.lang_any || [];
    const hits = langAny.filter((f) => existsSync(join(projectDir, f))).length;
    if (hits > 0) weak.push({ id: m.id, hits });
  }
  if (weak.length) {
    const max = Math.max(...weak.map((w) => w.hits));
    const top = weak.filter((w) => w.hits === max);
    if (top.length === 1) return top[0].id;
    return { ambiguous: true, candidates: top.map((w) => w.id) }; // proponi+conferma
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
