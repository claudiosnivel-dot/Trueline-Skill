#!/usr/bin/env node
// run_cyclecheck.mjs — oracolo CICLI DI IMPORT (A2a). madge costruisce il GRAFO
// degli import (la parte difficile: parsa .ts/.tsx e risolve gli import relativi,
// dove dependency-cruiser 16 su Node 25 ispezionava 0 moduli); i cicli li calcola
// QUESTO wrapper con un DFS deterministico (la parte facile, sotto il nostro
// controllo). JSON nativo su stdout; il verdetto vive nel payload (03 §3). madge
// da <dir>/node_modules o npx; grafo VUOTO (0 moduli) -> exit 1 DICHIARATO, mai
// {cycles:[]} nudo (L-COL-006).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Su Windows npx e' npx.cmd: spawnSync('npx')->ENOENT, spawnSync('npx.cmd')->EINVAL
// (Node CVE-2024-27980 blocca .cmd/.bat senza shell:true; shell:true mis-parsa il
// path con lo spazio "Trueline Skill"). Invochiamo npx via node sul suo cli JS.
function npxCli() {
  const nodeDir = dirname(process.execPath);
  const candidates = process.platform === 'win32'
    ? [join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js')]
    : [join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')];
  return candidates.find((p) => existsSync(p)) || null;
}

// Cicli elementari via DFS con rilevamento di back-edge sullo stack corrente.
// Ritorna una lista di cicli (ognuno = lista di moduli), dedotta per set di nodi.
function findCycles(graph) {
  const cycles = [];
  const done = new Set();
  const stack = [];
  const onStack = new Set();
  function dfs(node) {
    stack.push(node); onStack.add(node);
    for (const dep of (graph[node] || [])) {
      if (onStack.has(dep)) {
        const idx = stack.indexOf(dep);
        if (idx >= 0) cycles.push(stack.slice(idx));
      } else if (!done.has(dep) && graph[dep] !== undefined) {
        dfs(dep);
      }
    }
    stack.pop(); onStack.delete(node); done.add(node);
  }
  for (const n of Object.keys(graph)) if (!done.has(n)) dfs(n);
  const uniq = new Map();
  for (const c of cycles) { const key = [...c].sort().join('|'); if (!uniq.has(key)) uniq.set(key, c); }
  return [...uniq.values()];
}

function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) { console.error('uso: run_cyclecheck.mjs <dir>'); process.exit(2); }
  const localBin = resolve(dir, 'node_modules', 'madge', 'bin', 'cli.js');
  const useLocal = existsSync(localBin);
  const target = existsSync(resolve(dir, 'src')) ? 'src' : '.';
  const NPX_CLI = useLocal ? null : npxCli();
  const head = useLocal ? [localBin] : (NPX_CLI ? [NPX_CLI, '--yes', 'madge'] : ['--yes', 'madge']);
  // --json (grafo completo, non --circular): ci serve il grafo sia per il guard
  // anti-vacuo (n. moduli) sia per calcolare noi i cicli.
  const argv = head.concat(['--json', '--extensions', 'ts,tsx,js,jsx,mjs,cjs', target]);
  const bin = (useLocal || NPX_CLI) ? process.execPath : 'npx';
  const res = spawnSync(bin, argv, { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const rawOut = (res.stdout || '').trim();
  if (!rawOut) { console.error(`madge non eseguito (exit=${res.status}): ${(res.stderr || '').slice(-200)}`); process.exit(1); }
  let graph; try { graph = JSON.parse(rawOut); } catch (e) { console.error(`JSON invalido: ${e.message}`); process.exit(1); }
  const modules = Object.keys(graph || {});
  if (modules.length === 0) {
    console.error('madge ha costruito un grafo VUOTO (0 moduli): resolver/estensioni? oracolo non eseguito');
    process.exit(1); // non un verde (L-COL-006)
  }
  const cycles = findCycles(graph).map((c) => ({ modules: c }));
  process.stdout.write(JSON.stringify({ oracle: 'cycle', tool: 'madge', modulesScanned: modules.length, cycles }));
  process.exit(0);
}
main();
