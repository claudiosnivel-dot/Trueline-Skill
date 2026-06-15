#!/usr/bin/env node
// validate_blueprint.mjs — oracolo strutturale del blueprint (11 §5.1, L-COL-019).
// Node ESM, SOLO moduli built-in: nessun npm install, nessuna dipendenza di rete.
//
// Controlli (gate T-1.3):
//   (a) ogni task ha objective, definition_of_done, acceptance_criteria, target_tests non vuoti;
//   (b) ogni acceptance_criteria.id è coperto da >=1 target_tests.covers;
//   (c) id univoci;
//   (d) depends_on senza cicli e senza id inesistenti.
// Extra (11 §5.1): ogni task dichiara un macrotask non vuoto.
//
// Esito: stampa una riga "[OK]"/"[FAIL]" per controllo; exit 0 solo se tutto OK.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// La dir del blueprint è passata da CLI, oppure default a ../seeded-blueprint
const blueprintDir = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(__dirname, '..', 'seeded-blueprint');

// --- Estrae i blocchi YAML (```yaml ... ```) dai file markdown del blueprint ---
function extractYamlBlocks(text) {
  const blocks = [];
  const re = /```ya?ml\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

// --- Mini-parser del solo subset YAML usato dallo schema 11 §3 ---
// Supporta: lista di task ("- id: ..."), scalari, blocchi ">" (folded),
// liste di scalari ("- foo"), liste di mappe (acceptance_criteria, target_tests),
// liste inline ([A, B]). Sufficiente e deterministico per la fixture.
function parseTasks(yaml) {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const tasks = [];
  let cur = null;
  let i = 0;

  const indentOf = (l) => l.length - l.trimStart().length;
  const stripComment = (s) => {
    // rimuove commenti # solo se non dentro apici
    let inS = false, inD = false, out = '';
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === "'" && !inD) inS = !inS;
      else if (c === '"' && !inS) inD = !inD;
      if (c === '#' && !inS && !inD) break;
      out += c;
    }
    return out;
  };
  const unquote = (v) => {
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  };
  const parseInlineList = (v) => {
    const inner = v.trim().slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((x) => unquote(x.trim()));
  };

  while (i < lines.length) {
    let raw = lines[i];
    let line = stripComment(raw).replace(/\s+$/, '');
    if (line.trim() === '') { i++; continue; }
    const ind = indentOf(line);
    const content = line.trim();

    // Nuovo task: "- id: ..." al livello di lista top
    if (content.startsWith('- id:')) {
      cur = { __indent: ind };
      tasks.push(cur);
      const val = content.slice('- id:'.length).trim();
      cur.id = unquote(val);
      i++;
      continue;
    }

    if (!cur) { i++; continue; }

    // Chiave: valore  (campi del task)
    const kv = content.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (kv && ind > cur.__indent) {
      const key = kv[1];
      let val = kv[2];

      if (val === '>' || val === '|' || val === '>-' || val === '|-') {
        // blocco scalare multilinea -> raccogli righe più indentate
        const blockLines = [];
        i++;
        const baseInd = ind;
        while (i < lines.length) {
          const bl = lines[i];
          if (bl.trim() === '') { blockLines.push(''); i++; continue; }
          if (indentOf(bl) <= baseInd) break;
          blockLines.push(bl.trim());
          i++;
        }
        cur[key] = blockLines.join(' ').trim();
        continue;
      }

      if (val.startsWith('[')) {
        cur[key] = parseInlineList(val);
        i++;
        continue;
      }

      if (val === '') {
        // potrebbe essere una lista (righe "- ...") o lista di mappe
        const childItems = [];
        i++;
        while (i < lines.length) {
          let craw = lines[i];
          if (craw.trim() === '') { i++; continue; }
          const cind = indentOf(craw);
          if (cind <= ind) break;
          const ctext = stripComment(craw).trim();
          if (ctext.startsWith('- ')) {
            const after = ctext.slice(2).trim();
            const innerKv = after.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
            if (innerKv) {
              // lista di mappe: prima chiave dell'item
              const obj = {};
              let kk = innerKv[1];
              let vv = innerKv[2];
              obj[kk] = vv.startsWith('[') ? parseInlineList(vv) : unquote(vv);
              i++;
              // chiavi successive della stessa mappa (più indentate del "- ")
              const itemInd = cind;
              while (i < lines.length) {
                let nraw = lines[i];
                if (nraw.trim() === '') { i++; continue; }
                const nind = indentOf(nraw);
                if (nind <= itemInd) break;
                const ntext = stripComment(nraw).trim();
                const nkv = ntext.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
                if (!nkv) break;
                obj[nkv[1]] = nkv[2].startsWith('[')
                  ? parseInlineList(nkv[2])
                  : unquote(nkv[2]);
                i++;
              }
              childItems.push(obj);
            } else {
              // lista di scalari
              childItems.push(unquote(after));
              i++;
            }
          } else {
            break;
          }
        }
        cur[key] = childItems;
        continue;
      }

      // scalare semplice
      cur[key] = unquote(val);
      i++;
      continue;
    }

    i++;
  }

  // pulizia campo interno
  for (const t of tasks) delete t.__indent;
  return tasks;
}

// --- Carica tutti i task dai file .md del blueprint ---
function loadAllTasks(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  let tasks = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const block of extractYamlBlocks(text)) {
      const parsed = parseTasks(block);
      // considera solo i blocchi che contengono task (hanno almeno un id)
      if (parsed.some((t) => t.id)) tasks = tasks.concat(parsed.filter((t) => t.id));
    }
  }
  return tasks;
}

function nonEmptyList(v) {
  return Array.isArray(v) && v.length > 0;
}
function nonEmptyStr(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// --- Esegui i controlli ---
const tasks = loadAllTasks(blueprintDir);
const results = [];
let allOk = true;
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  if (!ok) allOk = false;
};

// Pre-condizione: ci sono task
check('TASKS_PRESENT', tasks.length > 0, `${tasks.length} task trovati in ${blueprintDir}`);

// (a) campi obbligatori non vuoti
{
  const bad = [];
  for (const t of tasks) {
    const miss = [];
    if (!nonEmptyStr(t.objective)) miss.push('objective');
    if (!nonEmptyList(t.definition_of_done)) miss.push('definition_of_done');
    if (!nonEmptyList(t.acceptance_criteria)) miss.push('acceptance_criteria');
    if (!nonEmptyList(t.target_tests)) miss.push('target_tests');
    if (!nonEmptyStr(t.macrotask)) miss.push('macrotask');
    if (miss.length) bad.push(`${t.id || '(?)'}: manca ${miss.join(',')}`);
  }
  check('(a) REQUIRED_FIELDS', bad.length === 0, bad.length ? bad.join(' | ') : 'tutti i campi presenti e non vuoti');
}

// (b) ogni acceptance_criteria.id coperto da >=1 target_tests.covers
{
  const orphans = [];
  for (const t of tasks) {
    const covered = new Set();
    for (const tt of t.target_tests || []) {
      const c = tt.covers;
      if (Array.isArray(c)) for (const x of c) covered.add(x);
      else if (nonEmptyStr(c)) covered.add(c);
    }
    for (const ac of t.acceptance_criteria || []) {
      if (!ac || !nonEmptyStr(ac.id)) {
        orphans.push(`${t.id}: acceptance_criteria senza id`);
        continue;
      }
      if (!covered.has(ac.id)) orphans.push(`${t.id}/${ac.id} non coperto`);
    }
  }
  check('(b) AC_COVERAGE', orphans.length === 0, orphans.length ? orphans.join(' | ') : 'ogni acceptance_criteria coperto da >=1 target_test');
}

// (c) id univoci
{
  const seen = new Map();
  const dups = [];
  for (const t of tasks) {
    seen.set(t.id, (seen.get(t.id) || 0) + 1);
  }
  for (const [id, n] of seen) if (n > 1) dups.push(`${id} x${n}`);
  check('(c) UNIQUE_IDS', dups.length === 0, dups.length ? `duplicati: ${dups.join(', ')}` : `${seen.size} id univoci`);
}

// (d) depends_on: niente id inesistenti, niente cicli
{
  const ids = new Set(tasks.map((t) => t.id));
  const dangling = [];
  const graph = new Map();
  for (const t of tasks) {
    const deps = Array.isArray(t.depends_on) ? t.depends_on : [];
    graph.set(t.id, deps);
    for (const d of deps) if (!ids.has(d)) dangling.push(`${t.id} -> ${d} (inesistente)`);
  }
  // rilevamento cicli (DFS con stack di colori)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...ids].map((id) => [id, WHITE]));
  const cycles = [];
  const dfs = (node, path) => {
    color.set(node, GRAY);
    for (const dep of graph.get(node) || []) {
      if (!ids.has(dep)) continue; // dangling già segnalato
      if (color.get(dep) === GRAY) {
        cycles.push([...path, node, dep].join(' -> '));
      } else if (color.get(dep) === WHITE) {
        dfs(dep, [...path, node]);
      }
    }
    color.set(node, BLACK);
  };
  for (const id of ids) if (color.get(id) === WHITE) dfs(id, []);

  const ok = dangling.length === 0 && cycles.length === 0;
  const detail = ok
    ? 'DAG aciclico, nessun riferimento inesistente'
    : [...dangling, ...cycles.map((c) => `ciclo: ${c}`)].join(' | ');
  check('(d) DAG_VALID', ok, detail);
}

// --- Report ---
console.log(`validate_blueprint — dir: ${blueprintDir}`);
for (const r of results) {
  console.log(`  [${r.ok ? 'OK' : 'FAIL'}] ${r.name} — ${r.detail}`);
}
console.log(allOk ? 'RESULT: OK (tutti i controlli passati)' : 'RESULT: FAIL');
process.exit(allOk ? 0 : 1);
