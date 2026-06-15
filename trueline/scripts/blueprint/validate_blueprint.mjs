#!/usr/bin/env node
// validate_blueprint.mjs — oracolo STRUTTURALE del blueprint (11 §5.1, L-COL-019).
//
// Artefatto di RUNTIME della skill: vive in trueline/scripts/blueprint/ e viaggia
// nel .skill (02 §4). È l'"oracolo del piano": controlli meccanici, esito binario,
// fuori dal contesto del modello (L-COL-002 — il verde è un FATTO di comando, mai
// una frase dell'LLM). La parte semantica NON oracolabile resta alla checklist di
// self-check (references/blueprint/self-check-checklist.md, 11 §5.2).
//
// Node ESM, SOLO moduli built-in: nessun npm install, nessuna dipendenza di rete.
//
// Controlli (11 §5.1):
//   (1) REQUIRED_FIELDS — ogni task ha objective + definition_of_done +
//       acceptance_criteria + target_tests non vuoti (enforcement diretto L-COL-019);
//   (2) AC_COVERAGE     — ogni acceptance_criteria (id) è coperto da >=1 target_tests.covers;
//   (3) DAG_VALID       — depends_on senza cicli e senza riferimenti a id inesistenti;
//   (4) UNIQUE_IDS      — id univoci, non riusati;
//   (5) MACROTASK_OWNERSHIP — ogni task dichiara un macrotask non vuoto.
//
// Ogni acceptance_criteria, inoltre, deve portare id + given + when + then (11 §3).
//
// Uso:
//   node validate_blueprint.mjs [dir-del-blueprint]   -> report umano, exit 0/1
//   node validate_blueprint.mjs [dir] --json          -> report JSON su stdout, exit 0/1
// Default dir: ../../../eval/seeded-blueprint (la fixture del gate di build, 10 §4).
//
// Esito: exit 0 SOLO se TUTTI i controlli passano; exit 1 altrimenti.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Parsing degli argomenti -------------------------------------------------
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const positional = args.filter((a) => !a.startsWith('--'));
// La dir del blueprint è passata da CLI, oppure default alla fixture seminata.
const blueprintDir = positional[0]
  ? resolve(positional[0])
  : resolve(__dirname, '..', '..', '..', 'eval', 'seeded-blueprint');

// --- Estrae i blocchi YAML (```yaml ... ```) dai file markdown del blueprint ---
function extractYamlBlocks(text) {
  const blocks = [];
  const re = /```ya?ml\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

// --- Mini-parser del solo subset YAML usato dallo schema 11 §3 ---------------
// Supporta: lista di task ("- id: ..."), scalari, blocchi ">" / "|" (folded/literal),
// liste di scalari ("- foo"), liste di mappe (acceptance_criteria, target_tests),
// liste inline ([A, B]). Deterministico e sufficiente per lo schema del task.
// (Logica riusata dall'harness di T-1.3: stesso formato, stesso parser.)
function parseTasks(yaml) {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const tasks = [];
  let cur = null;
  let i = 0;

  const indentOf = (l) => l.length - l.trimStart().length;
  const stripComment = (s) => {
    // rimuove i commenti "#" solo se non dentro apici
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
        // blocco scalare multilinea -> raccogli le righe più indentate
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
        // potrebbe essere una lista (righe "- ...") o una lista di mappe
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

  // pulizia del campo interno
  for (const t of tasks) delete t.__indent;
  return tasks;
}

// --- Carica tutti i task dai file .md del blueprint --------------------------
function loadAllTasks(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { tasks: [], error: `directory blueprint inesistente: ${dir}` };
  }
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
  return { tasks, error: null };
}

function nonEmptyList(v) {
  return Array.isArray(v) && v.length > 0;
}
function nonEmptyStr(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// --- Esegui i controlli ------------------------------------------------------
const { tasks, error } = loadAllTasks(blueprintDir);
const results = [];
let allOk = true;
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) allOk = false;
};

// Pre-condizione: la dir esiste e contiene task
check('TASKS_PRESENT', !error && tasks.length > 0,
  error || `${tasks.length} task trovati in ${blueprintDir}`);

// Se non c'è nulla da validare, salta i controlli sullo schema ma resta FAIL.
if (!error && tasks.length > 0) {
  // (1) campi obbligatori non vuoti (L-COL-019)
  {
    const bad = [];
    for (const t of tasks) {
      const miss = [];
      if (!nonEmptyStr(t.objective)) miss.push('objective');
      if (!nonEmptyList(t.definition_of_done)) miss.push('definition_of_done');
      if (!nonEmptyList(t.acceptance_criteria)) miss.push('acceptance_criteria');
      if (!nonEmptyList(t.target_tests)) miss.push('target_tests');
      if (miss.length) bad.push(`${t.id || '(?)'}: manca ${miss.join(',')}`);
    }
    check('(1) REQUIRED_FIELDS', bad.length === 0,
      bad.length ? bad.join(' | ') : 'tutti i campi obbligatori presenti e non vuoti');
  }

  // (2) ogni acceptance_criteria.id coperto da >=1 target_tests.covers; nessun criterio orfano.
  //     Verifica anche che ogni AC porti id + given + when + then (11 §3).
  {
    const orphans = [];
    const malformed = [];
    for (const t of tasks) {
      const covered = new Set();
      for (const tt of t.target_tests || []) {
        const c = tt && tt.covers;
        if (Array.isArray(c)) for (const x of c) covered.add(x);
        else if (nonEmptyStr(c)) covered.add(c);
      }
      for (const ac of t.acceptance_criteria || []) {
        if (!ac || !nonEmptyStr(ac.id)) {
          orphans.push(`${t.id}: acceptance_criteria senza id`);
          continue;
        }
        const missField = ['given', 'when', 'then'].filter((k) => !nonEmptyStr(ac[k]));
        if (missField.length) malformed.push(`${t.id}/${ac.id} senza ${missField.join(',')}`);
        if (!covered.has(ac.id)) orphans.push(`${t.id}/${ac.id} non coperto`);
      }
    }
    const issues = [...orphans, ...malformed];
    check('(2) AC_COVERAGE', issues.length === 0,
      issues.length ? issues.join(' | ') : 'ogni acceptance_criteria (id+given+when+then) coperto da >=1 target_test');
  }

  // (3) DAG: niente cicli, niente id inesistenti.
  {
    const ids = new Set(tasks.map((t) => t.id));
    const dangling = [];
    const graph = new Map();
    for (const t of tasks) {
      const deps = Array.isArray(t.depends_on) ? t.depends_on : [];
      graph.set(t.id, deps);
      for (const d of deps) if (!ids.has(d)) dangling.push(`${t.id} -> ${d} (inesistente)`);
    }
    // rilevamento cicli (DFS con colori bianco/grigio/nero)
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
      ? 'DAG aciclico, nessun riferimento a id inesistente'
      : [...dangling, ...cycles.map((c) => `ciclo: ${c}`)].join(' | ');
    check('(3) DAG_VALID', ok, detail);
  }

  // (4) id univoci
  {
    const seen = new Map();
    const dups = [];
    for (const t of tasks) seen.set(t.id, (seen.get(t.id) || 0) + 1);
    for (const [id, n] of seen) if (n > 1) dups.push(`${id} x${n}`);
    check('(4) UNIQUE_IDS', dups.length === 0,
      dups.length ? `duplicati: ${dups.join(', ')}` : `${seen.size} id univoci`);
  }

  // (5) appartenenza: ogni task dichiara un macrotask non vuoto
  {
    const bad = [];
    for (const t of tasks) if (!nonEmptyStr(t.macrotask)) bad.push(`${t.id}: macrotask mancante`);
    check('(5) MACROTASK_OWNERSHIP', bad.length === 0,
      bad.length ? bad.join(' | ') : 'ogni task dichiara un macrotask');
  }
}

// --- Report ------------------------------------------------------------------
if (jsonMode) {
  const report = {
    tool: 'validate_blueprint',
    blueprint_dir: blueprintDir,
    task_count: tasks.length,
    ok: allOk,
    checks: results,
  };
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`validate_blueprint — dir: ${blueprintDir}`);
  for (const r of results) {
    console.log(`  [${r.ok ? 'OK' : 'FAIL'}] ${r.name} — ${r.detail}`);
  }
  console.log(allOk ? 'RESULT: OK (tutti i controlli strutturali passati)' : 'RESULT: FAIL');
}

process.exit(allOk ? 0 : 1);
