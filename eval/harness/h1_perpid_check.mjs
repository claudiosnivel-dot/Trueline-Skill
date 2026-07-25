#!/usr/bin/env node
// h1_perpid_check.mjs — ORACOLO H-1: RADICE TEMP PRIVATA PER-PID (KEYSTONE, test-first).
//
// E' il gate della PROPRIETA' DI ISOLAMENTO dei temp dell'harness. Nasce ROSSO: il
// difetto che gatera' e' gia' MISURATO (non ipotizzato), e il fix non esiste ancora.
//
// IL DIFETTO (BD-1, giugno). La radice temporanea CONDIVISA eval/.tmp-verify produce
// FALSI ROSSI su Windows quando due processi girano insieme. Le COPIE sono gia'
// nominate per-pid (eco-<id>-pid<pid>-<n>) quindi NON e' il naming a collidere: e' il
// CLEANUP. cleanupAllVerifyWorkspaces() (trueline/scripts/loop/verify_workspace.mjs
// r.176) cancella l'INTERA radice condivisa — se gira mentre un altro processo ha una
// copia viva li' sotto, gliela rade al suolo. Questo spiega i falsi rossi storici
// (SP-4 m5 55/56, SP-1/SP-3 T3.1). BD-1 ha risolto SOLO per se' (radice PRIVATA
// eval/.tmp-bd-<pid>) e anti_tamper_check ha copiato il pattern (eval/.tmp-at-<pid>);
// il resto dell'harness e' rimasto sulla radice condivisa.
//
// SOTTO-TEST (nomi ESATTI, contratto col verificatore e con l'orchestratore):
//
//   (1) concurrency:legacy-destroys      — DIMOSTRA il meccanismo, autocontenuto e
//       deterministico (NON tocca i veri harness): una radice CONDIVISA finta con
//       dentro la copia VIVA del processo A; il processo B esegue la stessa operazione
//       di cleanupAllVerifyWorkspaces (rm ricorsivo della RADICE) → la copia di A e'
//       SPARITA. E' l'ancora di FALSIFICABILITA': VERDE oggi e per sempre, documenta
//       il failure mode. Se un giorno diventasse rossa, la teoria del difetto sarebbe
//       sbagliata (e questo oracolo andrebbe riscritto, non silenziato).
//
//   (2) concurrency:private-survives     — stessa scena con due radici PRIVATE per-pid
//       distinte: il cleanup di B NON tocca la copia di A → SOPRAVVIVE. Verde oggi.
//       Insieme a (1) prova che la variabile causale e' la CONDIVISIONE della radice.
//
//   (3) static:no-shared-root            — IL GATE VERO. Per i 5 harness rimasti
//       indietro (m1/m3/m4/m5/ecosystem_conformance) si asserisce, per OGNUNO:
//         (a) nessun cleanup CONDIVISO — ne' per NOME (import/uso di
//             cleanupAllVerifyWorkspaces) ne' per COMPORTAMENTO: e' vietato ogni rm
//             RICORSIVO il cui bersaglio, risolto attraverso le const del file, e' un
//             percorso temp NON per-pid (l'rm inline della radice condivisa e' la
//             stessa identica operazione che (1) usa per DIMOSTRARE il failure mode:
//             riscriverla a mano non deve evadere il gate);
//         (b) nessun percorso temp CONDIVISO — regola POSIZIONALE, non un divieto di
//             nome: OGNI literal che comincia per '.tmp' (= il nome della radice temp)
//             deve comparire in un ARGOMENTO che nomina process.pid. Rinominare la
//             radice condivisa ('.tmp-verify' → '.tmp-verify-shared') NON evade, e il
//             pid deve stare nel SEGMENTO-RADICE: la copia nominata per-pid appesa a
//             una radice condivisa (join(TMP_VERIFY, `eco-...-pid${process.pid}`) — il
//             fix SBAGLIATO che l'header di BD-1 esclude) resta ROSSA;
//         (c) il file imposta process.env.TRUELINE_TMP_VERIFY_ROOT a un VALORE che
//             risolve a una radice per-pid. L'assegnazione da sola non basta: si segue
//             la catena delle dichiarazioni fino al literal, cosi' (b) e (c) non sono
//             due predicati SLEGATI ma la stessa radice. Senza, i figli ricadono sulla
//             condivisa.
//       OGGI: 5/5 falliscono → exit 1. E' il comportamento ATTESO.
//
//   (4) static:per-pack-roots            — i verify_fix_check.mjs dei pack
//       (eval/ecosystems/*/verify_fix_check.mjs, ENUMERATI a runtime — non hardcodati,
//       cosi' un pack nuovo e' coperto d'ufficio): STESSO criterio POSIZIONALE di
//       (3)(b) — ogni radice temp USATA deve portare il pid nel proprio segmento. NON
//       basta che il file MENZIONI process.pid da qualche parte (una dichiarazione
//       morta non promuove nulla), e la radice condivisa '.tmp-verify' e' vietata qui
//       come nei 5 harness. Oggi: 16/16 falliscono (roots fissi '.tmp-verify-xx', due
//       addirittura sulla condivisa '.tmp-verify').
//
//   (5) env:child-inheritance            — nei 5 file di (3): ogni spawn/spawnSync che
//       passa un env ESPLICITO deve PROPAGARE una radice PER-PID. Il VALORE conta, non
//       il nome: `TRUELINE_TMP_VERIFY_ROOT: X` vale solo se X risolve a una radice
//       per-pid (propagare una radice CONDIVISA a tutti i figli e' PEGGIO di oggi), e
//       lo spread `...process.env` vale solo se il file soddisfa (3)(c). Spargere una
//       env priva della radice privata fa ricadere il figlio sulla CONDIVISA → sarebbe
//       un FALSO VERDE del fix (il padre isolato, i figli no). Oggi 5/5 falliscono.
//
//   (6) shipped:bit-invariance           — l'albero SPEDITO non e' toccato: git in
//       SOLA LETTURA (`git status --porcelain --untracked-files=all -- trueline/`) deve
//       dare output VUOTO. `git status` e NON `git diff`: quest'ultimo vede solo i file
//       gia' TRACCIATI, quindi un helper NUOVO aggiunto sotto trueline/ (posizione
//       naturale per un fix condiviso) violerebbe la BIT-invarianza a gate VERDE. Le
//       righe '??' sono violazioni quanto le 'M'. Se git non e' disponibile o il cwd
//       non e' un repo → exit 2 (abort AMBIENTALE), MAI un rosso.
//
//   (7) runtime:private-root-roundtrip   — prova sul CODICE SPEDITO REALE, senza
//       modificarlo: un processo FIGLIO con env TRUELINE_TMP_VERIFY_ROOT = radice
//       privata importa trueline/scripts/loop/verify_workspace.mjs, CREA e poi
//       DISTRUGGE un workspace (sourceApp = un mini-fixture nostro, cosi' gira in
//       millisecondi e non dipende da eval/reference-app). Si asserisce SOLO su stato
//       della NOSTRA scena: la TMP_VERIFY_ROOT vista dal figlio e' ESATTAMENTE la
//       radice privata, il workspace e' nato SOTTO di essa ed e' stato rimosso.
//       Deliberatamente NON si osserva l'esistenza di eval/.tmp-verify: e' stato
//       GLOBALE estraneo alla scena (qualunque run_loop/dogfood o pack vicino la crea,
//       essendo il default SPEDITO) e osservarlo renderebbe il keystone FALSO-ROSSO per
//       colpa di un terzo — un flake si risolve con l'ISOLAMENTO, non col retry.
//       Se la creazione fallisce per motivi AMBIENTALI (fixture/permessi) → exit 2, mai
//       rosso. E' il ponte fra lo statico (3)/(5) e il comportamento reale: prova che
//       l'override env FUNZIONA gia' oggi, quindi il fix e' applicabile e il rosso di
//       (3)/(4)/(5) e' un difetto dei CHIAMANTI.
//
//   (8) hygiene:no-residue               — a fine run nessun residuo sotto la NOSTRA
//       radice temp privata, rimossa con cleanH1Tmp() NEVER-THROW (forma di cleanBdTmp
//       in build_discipline_check.mjs: backoff deterministico via Atomics.wait, mai un
//       throw nudo che diventi un falso exit-1).
//
// ESITO (mai un falso verde — "verde" = exit/output reale, L-COL-002):
//   exit 0 — tutti i sotto-test PASS (sara' vero solo DOPO il fix, task successivo);
//   exit 1 — un sotto-test FALLISCE (OGGI: (3)/(4)/(5) rossi = difetto reale);
//   exit 2 — PRECONDIZIONE/AMBIENTE (git assente, cwd non-repo, file bersaglio non
//            leggibili, roundtrip non eseguibile): MAI un falso rosso.
//
// FUORI SCOPE (deliberato): questo oracolo NON esegue m1..m5 / ecosystem_conformance
// (richiedono DB live/docker e minuti di wall-clock: la loro riesecuzione SERIALE e'
// dell'orchestratore, L-COL-002). Qui si gatera' la PROPRIETA' con analisi STATICA dei
// sorgenti + due prove dinamiche autocontenute: gira in pochi secondi, cosi' i builder
// possono iterare sul fix senza pagare il gate pesante.
//
// SPECCHIA build_discipline_check.mjs / anti_tamper_check.mjs: shebang + import solo
// built-in, ROOT da __dirname, radice temp PRIVATA per-pid (cleanH1Tmp never-throw),
// assert(name, ok, detail) che accumula in checks[], tally finale + process.exit(...).
// Node ESM, nessuna dipendenza esterna, niente docker/DB/rete. NON tocca git in
// scrittura: l'unica `git` e' in SOLA LETTURA (rev-parse/diff). Determinismo: id =
// pid + contatore monotono, nessun Date.now()/Math.random(), nessun RETRY che mascheri
// un flake (il flake si risolve con l'ISOLAMENTO, non col retry).

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// Il modulo SPEDITO che gestisce le copie temp (letto, MAI modificato).
const VERIFY_WS = resolve(ROOT, 'trueline', 'scripts', 'loop', 'verify_workspace.mjs');

// I 5 harness rimasti sulla radice CONDIVISA (bersaglio di (3) e (5)).
const TARGET_HARNESSES = [
  resolve(ROOT, 'eval', 'harness', 'm1_gate_check.mjs'),
  resolve(ROOT, 'eval', 'harness', 'm3_gate_check.mjs'),
  resolve(ROOT, 'eval', 'harness', 'm4_gate_check.mjs'),
  resolve(ROOT, 'eval', 'harness', 'm5_gate_check.mjs'),
  resolve(ROOT, 'eval', 'harness', 'ecosystem_conformance.mjs'),
];
const ECOSYSTEMS_DIR = resolve(ROOT, 'eval', 'ecosystems');

// Radice temp PRIVATA per-invocazione (pid): stesso pattern di eval/.tmp-bd-<pid> e
// eval/.tmp-at-<pid>. Coperta da .gitignore "eval/.tmp-*/". Nessun'altra esecuzione la
// tocca → l'oracolo che gatera' l'isolamento e' esso stesso isolato.
const TMP_H1_ROOT = resolve(ROOT, 'eval', `.tmp-h1-${process.pid}`);

const rel = (p) => String(p).replace(/\\/g, '/').replace(`${String(ROOT).replace(/\\/g, '/')}/`, '');

// ---------------------------------------------------------------------------
// Helper di esecuzione/IO (mirror di build_discipline_check.mjs / anti_tamper_check.mjs).
// ---------------------------------------------------------------------------

// git in SOLA LETTURA (rev-parse/diff). Non muta nulla, mai.
function gitRead(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: res.status, stdout: (res.stdout || ''), error: res.error };
}

// Backoff BLOCCANTE deterministico (niente setTimeout/Date.now/Math.random): assorbe
// un lock transitorio di Windows tra i tentativi senza introdurre non-determinismo.
function settleDeterministic(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { /* Atomics non disponibile: prosegui senza attesa */ }
}

// Pulizia ROBUSTA della NOSTRA radice temp privata. NON lancia MAI: un lock transitorio
// di Windows su un file appena scritto/rimosso NON deve trasformarsi in un falso rosso
// exit-1 (la failure-mode peggiore). Stessa forma di cleanBdTmp/cleanAtTmp.
function cleanH1Tmp() {
  for (let i = 0; i < 6; i += 1) {
    try {
      if (!existsSync(TMP_H1_ROOT)) return;
      rmSync(TMP_H1_ROOT, { recursive: true, force: true, maxRetries: 4, retryDelay: 60 });
      if (!existsSync(TMP_H1_ROOT)) return;
    } catch { /* lock transitorio: ritenta col backoff sotto */ }
    if (i < 5) settleDeterministic(80 * (i + 1));
  }
  /* esaurito: NON lanciamo. (8) tollera una radice vuota-ma-locked. */
}

// id deterministico per le dir di scena: pid + contatore monotono (NO Date.now/Math.random).
let __sceneCounter = 0;
function sceneDir(label) {
  __sceneCounter += 1;
  const safe = String(label).replace(/[^A-Za-z0-9._-]/g, '-');
  const dir = join(TMP_H1_ROOT, `${safe}-pid${process.pid}-${__sceneCounter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Analisi statica: strip dei commenti STRING-AWARE (una menzione di
// '.tmp-verify'/cleanupAllVerifyWorkspaces in un COMMENTO non e' un difetto; una in
// CODICE si). Tokenizer minimale: traccia stringhe '/"/` e salta //... e /*...*/.
// Il caso `\/` (regex-literal) e' guardato: un '/' preceduto da backslash non apre
// un commento. Deterministico, nessuna dipendenza.
// ---------------------------------------------------------------------------
function stripComments(src) {
  let out = '';
  let mode = 'code'; // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length;) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === 'code') {
      const escaped = i > 0 && src[i - 1] === '\\';
      if (c === '/' && d === '/' && !escaped) { mode = 'line'; i += 2; continue; }
      if (c === '/' && d === '*' && !escaped) { mode = 'block'; i += 2; continue; }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      out += c; i += 1; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i += 1; continue; }
    if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; i += 2; } else { if (c === '\n') out += c; i += 1; }
      continue;
    }
    // dentro una stringa/template: l'escape consuma il carattere seguente.
    if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    out += c; i += 1;
  }
  return out;
}

// Ritorna l'indice della parentesi/graffa che CHIUDE quella aperta a `open`,
// ignorando quanto sta dentro le stringhe. -1 se non bilanciata.
function matchBalanced(src, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const close = pairs[src[open]];
  if (!close) return -1;
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === src[open]) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

// Ritorna il testo di un'espressione che comincia a `from`, fino al primo carattere di
// `stops` a profondita' 0 (stringhe ignorate). stops=';' → l'inizializzatore di una
// dichiarazione (`const X = resolve(...);`); stops=',}' → il valore di una proprieta'
// dentro un oggetto (`{ ..., KEY: valore }`); stops=',' → il primo argomento di una call.
function sliceExpr(src, from, stops = ';') {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') {
      if (depth <= 0 && stops.includes(c)) return src.slice(from, i);
      depth -= 1;
    } else if (depth <= 0 && stops.includes(c)) return src.slice(from, i);
  }
  return src.slice(from);
}

// Tutte le dichiarazioni const/let/var del file: [{ name, init }].
function declarations(code) {
  const out = [];
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m = re.exec(code);
  while (m) {
    out.push({ name: m[1], init: sliceExpr(code, m.index + m[0].length, ';') });
    m = re.exec(code);
  }
  return out;
}

// nome → inizializzatori (piu' d'uno se il nome e' dichiarato in scope diversi).
function declMap(code) {
  const map = new Map();
  for (const d of declarations(code)) {
    if (!map.has(d.name)) map.set(d.name, []);
    map.get(d.name).push(d.init);
  }
  return map;
}

// Identificatori di un'espressione (niente parole chiave, niente accessi a proprieta':
// in `process.pid` non e' 'pid' un identificatore risolvibile).
const RESERVED = new Set([
  'const', 'let', 'var', 'function', 'return', 'new', 'typeof', 'await', 'async', 'if',
  'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch',
  'finally', 'throw', 'delete', 'void', 'instanceof', 'in', 'of', 'this', 'class',
  'extends', 'super', 'import', 'export', 'from', 'default', 'yield', 'static',
  'true', 'false', 'null', 'undefined', 'process',
]);
function identifiersIn(text) {
  const out = [];
  const re = /[A-Za-z_$][\w$]*/g;
  let m = re.exec(text);
  while (m) {
    const before = m.index > 0 ? text[m.index - 1] : '';
    if (before !== '.' && !RESERVED.has(m[0])) out.push(m[0]);
    m = re.exec(text);
  }
  return out;
}

// Espansione lungo la catena delle dichiarazioni: al testo dell'espressione si concatena
// l'inizializzatore di ogni identificatore che vi compare (ricorsiva, con guardia su
// cicli e profondita'). E' cio' che LEGA i predicati al percorso REALMENTE usato:
// `dir` → `join(TMP_VERIFY, ...)` → `resolve(ROOT, 'eval', '.tmp-verify')`.
function expandExpr(text, map, seen = new Set(), depth = 0) {
  if (depth > 5) return text;
  let out = text;
  for (const id of identifiersIn(text)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const inits = map.get(id);
    if (!inits) continue;
    for (const init of inits) out += `\n${expandExpr(init, map, seen, depth + 1)}`;
  }
  return out;
}

// IL CUORE. Enumera OGNI literal che comincia per '.tmp' (il nome di una radice temp
// sotto eval/) e gli associa l'ARGOMENTO che lo contiene — cioe' il segmento di
// percorso in cui e' scritto, delimitato da virgole/parentesi. Regola POSIZIONALE: il
// pid deve stare LI'. Non e' un divieto sul nome (rinominare non evade) e la copia
// per-pid appesa a una radice condivisa — join(TMP_VERIFY, `eco-...-pid${process.pid}`),
// il fix SBAGLIATO — non passa, perche' l'argomento del literal '.tmp-verify' resta
// senza pid. Le prose ('copia in eval/.tmp-verify') non matchano: il VALORE del literal
// deve cominciare per '.tmp'.
function tempRootUsages(code) {
  const out = [];
  const pending = [];
  const argStarts = [0];
  let depth = 0;
  const closeAt = (d, end) => {
    for (let k = pending.length - 1; k >= 0; k -= 1) {
      if (pending[k].depth >= d) {
        out.push({ lit: pending[k].lit, arg: code.slice(pending[k].start, end) });
        pending.splice(k, 1);
      }
    }
  };
  for (let i = 0; i < code.length;) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === c) break;
        j += 1;
      }
      const end = Math.min(j, code.length - 1);
      if (/^\.tmp/.test(code.slice(i + 1, end))) {
        pending.push({ depth, start: argStarts[depth] ?? 0, lit: code.slice(i, end + 1) });
      }
      i = end + 1; continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth += 1; argStarts[depth] = i + 1; i += 1; continue; }
    if (c === ')' || c === ']' || c === '}') { closeAt(depth, i); depth = depth > 0 ? depth - 1 : 0; i += 1; continue; }
    if (c === ',' || c === ';') { closeAt(depth, i); argStarts[depth] = i + 1; i += 1; continue; }
    i += 1;
  }
  closeAt(0, code.length);
  return out;
}

// Un argomento e' PER-PID se nomina process.pid, direttamente o via un identificatore
// che vi compare e che e' un alias del pid (`const PID = process.pid`). L'alias e'
// sicuro: qualunque cosa metta il pid nel NOME della radice isola davvero.
function argIsPerPid(arg, map) {
  if (/process\.pid/.test(arg)) return true;
  for (const id of identifiersIn(arg)) {
    const inits = map.get(id);
    if (inits && inits.length > 0 && inits.every((t) => /process\.pid/.test(t))) return true;
  }
  return false;
}

// I percorsi temp CONDIVISI del file: i literal la cui radice non porta il pid.
function sharedTempUsages(code, map) {
  const bad = tempRootUsages(code).filter((u) => !argIsPerPid(u.arg, map)).map((u) => u.lit);
  return [...new Set(bad)];
}

// I nomi sotto cui il file puo' chiamare una rimozione: i canonici piu' gli ALIAS
// d'import (`import { rmSync as __rm }`). Senza, bastava rinominare la funzione per
// evadere il controllo COMPORTAMENTALE di (3)(a).
function removalCalleeNames(code) {
  const names = new Set(['rm', 'rmSync', 'rmdir', 'rmdirSync']);
  const re = /\b(?:rm|rmSync|rmdir|rmdirSync)\s+as\s+([A-Za-z_$][\w$]*)/g;
  let m = re.exec(code);
  while (m) { names.add(m[1]); m = re.exec(code); }
  return names;
}

// Il PRIMO argomento (il bersaglio) di ogni rimozione RICORSIVA del file.
function recursiveRemovalTargets(code) {
  const names = removalCalleeNames(code);
  const out = [];
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  let m = re.exec(code);
  while (m) {
    // `__rm(...)` e' una rimozione quanto `rmSync(...)`: si confronta anche il nome
    // spogliato dei prefissi (_ e $), senza confondere `confirm(` con `rm(`.
    if (names.has(m[1]) || names.has(m[1].replace(/^[_$]+/, ''))) {
      const open = m.index + m[0].length - 1;
      const close = matchBalanced(code, open);
      const argsText = close > open ? code.slice(open + 1, close) : code.slice(open + 1, open + 400);
      if (/\brecursive\s*:\s*true/.test(argsText)) out.push(sliceExpr(argsText, 0, ','));
    }
    m = re.exec(code);
  }
  return out;
}

// (3)(a) COMPORTAMENTALE: rm ricorsivi il cui bersaglio, risolto lungo la catena delle
// dichiarazioni, e' un percorso temp NON per-pid. E' la stessa operazione che (1) usa
// per dimostrare il failure mode: riscriverla inline al posto di
// cleanupAllVerifyWorkspaces non deve evadere il gate.
function sharedRecursiveRemovals(code, map) {
  const bad = [];
  for (const target of recursiveRemovalTargets(code)) {
    const offenders = tempRootUsages(expandExpr(target, map)).filter((u) => !argIsPerPid(u.arg, map));
    if (offenders.length > 0) {
      bad.push(`rm ricorsivo di ${target.trim().replace(/\s+/g, ' ')} → ${offenders[0].lit}`);
    }
  }
  return [...new Set(bad)];
}

// I VALORI assegnati a process.env.TRUELINE_TMP_VERIFY_ROOT (non il fatto che esista
// un'assegnazione: e' il valore a dover essere per-pid).
function envRootAssignments(code) {
  const out = [];
  const re = /process\.env\.TRUELINE_TMP_VERIFY_ROOT\s*=(?!=)\s*/g;
  let m = re.exec(code);
  while (m) { out.push(sliceExpr(code, m.index + m[0].length, ';')); m = re.exec(code); }
  return out;
}

// Un VALORE di radice e' per-pid se OGNI literal '.tmp*' a cui risolve porta il pid nel
// proprio segmento. Se non risolve ad alcun literal (radice costruita su
// os.tmpdir()/mkdtempSync) basta che l'espressione risolta nomini process.pid.
function valueIsPerPidRoot(text, map) {
  const expanded = expandExpr(text, map);
  const usages = tempRootUsages(expanded);
  if (usages.length > 0) return usages.every((u) => argIsPerPid(u.arg, map));
  return /process\.pid/.test(expanded);
}

// Il file imposta l'override che i figli erediteranno (solo presenza: diagnostica).
function setsTmpRootEnv(code) {
  return envRootAssignments(code).length > 0;
}

// (3)(c): l'override esiste E punta a una radice per-pid.
function setsPerPidTmpRootEnv(code, map) {
  const values = envRootAssignments(code);
  return values.length > 0 && values.every((v) => valueIsPerPidRoot(v, map));
}

// Import (reale, non in commento) di cleanupAllVerifyWorkspaces da verify_workspace.
function importsCleanupAll(code) {
  return /\bcleanupAllVerifyWorkspaces\b/.test(code);
}

// Tutti gli spawn/spawnSync che passano un env ESPLICITO (sia `env:` sia lo shorthand
// `env` dentro l'oggetto opzioni). `process.env` NON conta (preceduto da un punto).
function spawnCallsWithEnv(code) {
  const out = [];
  const re = /\bspawn(?:Sync)?\s*\(/g;
  let m = re.exec(code);
  while (m) {
    const open = m.index + m[0].length - 1;
    const close = matchBalanced(code, open);
    const argsText = close > open ? code.slice(open, close + 1) : code.slice(open, open + 400);
    if (/(^|[^.\w$])env\s*(:|,|\})/.test(argsText)) out.push(argsText);
    m = re.exec(code);
  }
  return out;
}

// Le "sorgenti env" del file: gli inizializzatori delle dichiarazioni `env = ...`
// (forma usata da tutti gli harness: `const env = { ...process.env, PATH: ... }`)
// piu' il testo dei call-site che passano env inline.
function envSources(code, calls) {
  const out = declarations(code).filter((d) => d.name === 'env').map((d) => d.init);
  for (const c of calls) if (/(^|[^.\w$])env\s*:/.test(c)) out.push(c);
  return out;
}

// Una sorgente env PROPAGA la radice privata se assegna a TRUELINE_TMP_VERIFY_ROOT un
// VALORE che risolve a una radice per-pid (nominare la chiave non basta: propagare una
// radice CONDIVISA a tutti i figli e' peggio di non propagare nulla), OPPURE se fa
// spread di process.env E il file soddisfa (3)(c). Lo spread da solo NON basta:
// spargere un env privo della radice privata fa ricadere il figlio sulla CONDIVISA
// (falso verde del fix: padre isolato, figli no).
function envPropagates(text, map, fileEnvPerPid) {
  const m = /TRUELINE_TMP_VERIFY_ROOT\s*:\s*/.exec(text);
  if (m) return valueIsPerPidRoot(sliceExpr(text, m.index + m[0].length, ',}'), map);
  return /\.\.\.\s*process\.env\b/.test(text) && fileEnvPerPid;
}

// ---------------------------------------------------------------------------
// Banco di asserzioni (stesso stile di build_discipline_check / anti_tamper_check).
// ---------------------------------------------------------------------------
const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// Aborto AMBIENTALE (exit 2): una precondizione non e' soddisfatta. Mai un falso rosso.
function precondAbort(reason) {
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('=== ORACOLO H-1 PER-PID: (precondizione mancante) ===');
  console.log(`  - ${reason}`);
  console.log('(exit 2 = precondizione/ambiente; mai un falso verde, mai un falso rosso.)');
  console.log('------------------------------------------------------------');
  cleanH1Tmp();
  process.exit(2);
}

// Lettura obbligatoria di un sorgente bersaglio: se manca/non leggibile e' AMBIENTE
// (exit 2), non un difetto del codice.
function readTarget(path) {
  try { return readFileSync(path, 'utf8'); }
  catch (e) { precondAbort(`sorgente bersaglio non leggibile: ${rel(path)} (${e.message})`); return ''; }
}

// ===========================================================================
// (1) concurrency:legacy-destroys — il CLEANUP della radice CONDIVISA rade al suolo
//     la copia VIVA di un altro processo. Autocontenuto: nessun harness reale toccato.
// ===========================================================================
function subTestLegacyDestroys() {
  console.log('');
  console.log('(1) concurrency:legacy-destroys — radice CONDIVISA: il cleanup di B distrugge la copia viva di A:');
  const stage = sceneDir('legacy');
  const shared = join(stage, 'shared');                       // la finta eval/.tmp-verify
  const copyA = join(shared, 'eco-fixture-pidAAA-1');          // copia VIVA del processo A
  const aliveA = join(copyA, 'alive.txt');
  mkdirSync(copyA, { recursive: true });
  writeFileSync(aliveA, 'copia viva del processo A\n');
  const bornA = existsSync(aliveA);
  // Il processo B esegue la STESSA operazione di cleanupAllVerifyWorkspaces: rm
  // ricorsivo della RADICE (non della propria copia). Vedi verify_workspace.mjs r.176.
  rmSync(shared, { recursive: true, force: true, maxRetries: 4, retryDelay: 60 });
  const survivedA = existsSync(aliveA);
  assert('concurrency:legacy-destroys', bornA && !survivedA,
    bornA
      ? `la copia di A (${rel(copyA)}) e' ${survivedA ? 'SOPRAVVISSUTA (teoria del difetto smentita!)' : 'SPARITA dopo il cleanup della radice condivisa di B'}`
      : 'scena non allestita: la copia di A non e\' stata creata');
}

// ===========================================================================
// (2) concurrency:private-survives — due radici PRIVATE per-pid: il cleanup di B
//     non vede la copia di A → SOPRAVVIVE. E' la variabile causale isolata.
// ===========================================================================
function subTestPrivateSurvives() {
  console.log('');
  console.log('(2) concurrency:private-survives — radici PRIVATE per-pid: il cleanup di B non tocca la copia di A:');
  const stage = sceneDir('private');
  const rootA = join(stage, 'tmp-x-pidAAA');                  // radice privata di A
  const rootB = join(stage, 'tmp-x-pidBBB');                  // radice privata di B
  const copyA = join(rootA, 'eco-fixture-pidAAA-1');
  const copyB = join(rootB, 'eco-fixture-pidBBB-1');
  const aliveA = join(copyA, 'alive.txt');
  mkdirSync(copyA, { recursive: true });
  mkdirSync(copyB, { recursive: true });
  writeFileSync(aliveA, 'copia viva del processo A\n');
  writeFileSync(join(copyB, 'alive.txt'), 'copia viva del processo B\n');
  const bornA = existsSync(aliveA);
  // B pulisce SOLO la PROPRIA radice (il fix): A resta intatto.
  rmSync(rootB, { recursive: true, force: true, maxRetries: 4, retryDelay: 60 });
  const survivedA = existsSync(aliveA);
  const goneB = !existsSync(copyB);
  assert('concurrency:private-survives', bornA && survivedA && goneB,
    `A ${survivedA ? 'SOPRAVVIVE' : 'DISTRUTTA (isolamento non efficace!)'} (${rel(copyA)}); B rimossa=${goneB}`);
}

// ===========================================================================
// (3) static:no-shared-root — IL GATE VERO sui 5 harness rimasti indietro.
// ===========================================================================
function subTestNoSharedRoot(sources) {
  console.log('');
  console.log('(3) static:no-shared-root — i 5 harness: no cleanup condiviso, no percorso temp condiviso, env per-pid:');
  const failing = [];
  for (const path of TARGET_HARNESSES) {
    const code = sources.get(path);
    const map = declMap(code);
    const removals = sharedRecursiveRemovals(code, map);
    const shared = sharedTempUsages(code, map);
    const a = !importsCleanupAll(code) && removals.length === 0;
    const b = shared.length === 0;
    const c = setsPerPidTmpRootEnv(code, map);
    const ok = a && b && c;
    if (!ok) {
      const why = [];
      if (!a) {
        const how = importsCleanupAll(code) ? 'importa cleanupAllVerifyWorkspaces' : removals[0];
        why.push(`(a) cleanup CONDIVISO: ${how}`);
      }
      if (!b) why.push(`(b) percorso temp CONDIVISO (pid assente dal segmento-radice): ${shared.join(', ')}`);
      if (!c) {
        why.push(`(c) env TRUELINE_TMP_VERIFY_ROOT assegnata=${setsTmpRootEnv(code)} a radice per-pid=${setsPerPidTmpRootEnv(code, map)}`);
      }
      failing.push(`${rel(path)}: ${why.join('; ')}`);
    }
    console.log(`      ${ok ? 'ok  ' : 'KO  '} ${rel(path)} — a=${a} b=${b} c=${c}`);
  }
  assert('static:no-shared-root', failing.length === 0,
    failing.length === 0
      ? `${TARGET_HARNESSES.length}/${TARGET_HARNESSES.length} harness su radice PRIVATA per-pid`
      : `${failing.length}/${TARGET_HARNESSES.length} harness ancora sulla radice CONDIVISA → ${failing.join(' | ')}`);
}

// ===========================================================================
// (4) static:per-pack-roots — i verify_fix_check.mjs dei pack, ENUMERATI a runtime.
// ===========================================================================
function subTestPerPackRoots() {
  console.log('');
  console.log('(4) static:per-pack-roots — eval/ecosystems/*/verify_fix_check.mjs: radice temp con process.pid:');
  let packs = [];
  try {
    packs = readdirSync(ECOSYSTEMS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => resolve(ECOSYSTEMS_DIR, e.name, 'verify_fix_check.mjs'))
      .filter((p) => existsSync(p))
      .sort();
  } catch (e) {
    precondAbort(`eval/ecosystems non enumerabile: ${e.message}`);
  }
  if (packs.length === 0) {
    precondAbort(`nessun verify_fix_check.mjs sotto ${rel(ECOSYSTEMS_DIR)} (enumerazione vuota: gate non esercitabile)`);
  }
  const failing = [];
  for (const path of packs) {
    let code = '';
    try { code = stripComments(readFileSync(path, 'utf8')); }
    catch (e) { precondAbort(`pack non leggibile: ${rel(path)} (${e.message})`); }
    const map = declMap(code);
    const usages = tempRootUsages(code);
    const shared = [...new Set(usages.filter((u) => !argIsPerPid(u.arg, map)).map((u) => u.lit))];
    // Nessun literal '.tmp*': il pack non ha una radice temp nel repo — vale solo se
    // usa mkdtempSync (unica per chiamata) o l'override env per-pid; altrimenti le
    // copie finiscono sul default SPEDITO (la radice CONDIVISA) → rosso.
    const ok = usages.length > 0
      ? shared.length === 0
      : (/\bmkdtempSync\b/.test(code) || setsPerPidTmpRootEnv(code, map));
    if (!ok) {
      failing.push(`${rel(path)}${usages.length > 0
        ? ` (radice CONDIVISA: ${shared.join(', ')})`
        : ' (nessuna radice temp per-pid: copie sul default SPEDITO)'}`);
    }
    console.log(`      ${ok ? 'ok  ' : 'KO  '} ${rel(path)}`);
  }
  assert('static:per-pack-roots', failing.length === 0,
    failing.length === 0
      ? `${packs.length}/${packs.length} pack con radice temp per-pid`
      : `${failing.length}/${packs.length} pack con radice temp FISSA → ${failing.join(' | ')}`);
}

// ===========================================================================
// (5) env:child-inheritance — i figli devono EREDITARE la radice privata.
// ===========================================================================
function subTestChildInheritance(sources) {
  console.log('');
  console.log('(5) env:child-inheritance — ogni spawn con env esplicito propaga una radice PER-PID:');
  const failing = [];
  for (const path of TARGET_HARNESSES) {
    const code = sources.get(path);
    const map = declMap(code);
    const calls = spawnCallsWithEnv(code);
    const fileEnvPerPid = setsPerPidTmpRootEnv(code, map);
    let ok = true;
    let detail = 'nessuno spawn con env esplicito (nulla da propagare)';
    if (calls.length > 0) {
      const srcs = envSources(code, calls);
      if (srcs.length === 0) {
        ok = false;
        detail = `${calls.length} spawn con env esplicito ma sorgente env non risolvibile`;
      } else {
        const bad = srcs.filter((s) => !envPropagates(s, map, fileEnvPerPid)).length;
        ok = bad === 0;
        detail = `${calls.length} spawn con env; ${srcs.length} sorgenti env; non-propaganti=${bad}`;
      }
    }
    if (!ok) failing.push(`${rel(path)}: ${detail}${fileEnvPerPid ? '' : " (il file non imposta process.env.TRUELINE_TMP_VERIFY_ROOT a una radice PER-PID: si propaga ai figli una radice CONDIVISA, o nessuna → figli sulla CONDIVISA)"}`);
    console.log(`      ${ok ? 'ok  ' : 'KO  '} ${rel(path)} — ${detail}`);
  }
  assert('env:child-inheritance', failing.length === 0,
    failing.length === 0
      ? `${TARGET_HARNESSES.length}/${TARGET_HARNESSES.length} harness propagano la radice privata ai figli`
      : `${failing.length}/${TARGET_HARNESSES.length} harness NON propagano → ${failing.join(' | ')}`);
}

// ===========================================================================
// (6) shipped:bit-invariance — l'albero SPEDITO trueline/ non e' toccato.
//     git in SOLA LETTURA; git assente / cwd non-repo → exit 2, MAI rosso.
// ===========================================================================
function subTestShippedBitInvariance() {
  console.log('');
  console.log('(6) shipped:bit-invariance — git status --porcelain -- trueline/ deve essere VUOTO (sola lettura):');
  const probe = gitRead(ROOT, ['rev-parse', '--is-inside-work-tree']);
  if (probe.error || probe.status !== 0 || probe.stdout.trim() !== 'true') {
    precondAbort(`git non disponibile o cwd non e' un repo (${rel(ROOT)}): ${probe.error ? probe.error.message : `exit=${probe.status}`}`);
  }
  // `status --porcelain -uall` e NON `diff`: `diff` vede solo i file gia' TRACCIATI,
  // quindi un helper NUOVO sotto trueline/ (es. scripts/loop/private_tmp.mjs) passerebbe
  // inosservato. Le righe '??' (untracked) sono violazioni quanto le 'M'/'D'.
  const d = gitRead(ROOT, ['status', '--porcelain', '--untracked-files=all', '--', 'trueline/']);
  if (d.error || d.status !== 0) {
    precondAbort(`git status non eseguibile su trueline/: ${d.error ? d.error.message : `exit=${d.status}`}`);
  }
  const changed = d.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  assert('shipped:bit-invariance', changed.length === 0,
    changed.length === 0 ? 'albero SPEDITO trueline/ bit-invariante (status vuoto: ne modifiche ne file nuovi)'
      : `${changed.length} voci nell'albero SPEDITO (vietato, aggiunte incluse): ${changed.join(', ')}`);
}

// ===========================================================================
// (7) runtime:private-root-roundtrip — prova sul CODICE SPEDITO REALE (letto, mai
//     modificato): con TRUELINE_TMP_VERIFY_ROOT il workspace nasce SOTTO la radice
//     privata, viene distrutto, e la CONDIVISA non viene mai creata.
// ===========================================================================
function subTestRoundtrip() {
  console.log('');
  console.log('(7) runtime:private-root-roundtrip — verify_workspace SPEDITO con radice privata (figlio isolato):');
  if (!existsSync(VERIFY_WS)) {
    precondAbort(`modulo SPEDITO assente: ${rel(VERIFY_WS)}`);
  }
  // NOTA (deliberata): qui NON si osserva l'esistenza di eval/.tmp-verify. E' stato
  // GLOBALE estraneo a questa scena — il default SPEDITO di verify_workspace, che
  // qualunque run_loop/dogfood o pack vicino puo' creare DENTRO la finestra di questo
  // sotto-test — e osservarlo renderebbe il keystone FALSO-ROSSO per colpa di un terzo.
  // L'isolamento e' gia' provato, e in modo piu' forte, da root/underPrivate qui sotto.
  const stage = sceneDir('roundtrip');
  const privateRoot = join(stage, 'tmp-private');
  // Mini-fixture sorgente: createVerifyWorkspace accetta `sourceApp` (additivo BD-1),
  // quindi NON copiamo eval/reference-app (lenta, node_modules) → run in millisecondi.
  const sourceApp = join(stage, 'mini-app');
  mkdirSync(sourceApp, { recursive: true });
  writeFileSync(join(sourceApp, 'index.js'), '// mini fixture per il roundtrip H-1\n');
  const childPath = join(stage, 'h1_roundtrip_child.mjs');
  const wsUrl = pathToFileURL(VERIFY_WS).href;
  // Il figlio deve importare verify_workspace DOPO che l'env e' impostato: TMP_VERIFY_ROOT
  // e' una const di modulo, quindi l'override arriva via env dello spawn (non runtime).
  writeFileSync(childPath, [
    "import { existsSync } from 'node:fs';",
    `import { createVerifyWorkspace, destroyVerifyWorkspace, TMP_VERIFY_ROOT } from '${wsUrl}';`,
    'const out = { root: TMP_VERIFY_ROOT };',
    'const ws = createVerifyWorkspace({ id: "h1-roundtrip", includeGit: false, sourceApp: process.argv[2] });',
    'out.dir = ws.dir;',
    'out.created = existsSync(ws.dir);',
    'destroyVerifyWorkspace(ws.dir);',
    'out.afterDestroy = existsSync(ws.dir);',
    'console.log(JSON.stringify(out));',
    '',
  ].join('\n'));

  const res = spawnSync(process.execPath, [childPath, sourceApp], {
    cwd: ROOT,
    // env ESPLICITO che PROPAGA la radice privata (la proprieta' che (5) pretende dai
    // 5 harness): spread di process.env + override esplicito.
    env: { ...process.env, TRUELINE_TMP_VERIFY_ROOT: privateRoot },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  let out = null;
  try { out = JSON.parse((res.stdout || '').trim().split('\n').pop() || ''); } catch { /* gestito sotto */ }
  if (res.error || res.status !== 0 || !out || !out.dir) {
    precondAbort(`roundtrip non eseguibile (ambiente: fixture/permessi): exit=${res.status} ${res.error ? res.error.message : ''} stderr=${(res.stderr || '').trim().slice(0, 400)}`);
  }
  const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase();
  // La TMP_VERIFY_ROOT vista dal FIGLIO e' esattamente la radice privata: prova diretta
  // (e locale alla scena) che l'override env raggiunge il modulo SPEDITO, senza dover
  // dedurlo dall'assenza della radice condivisa.
  const rootHonored = norm(out.root || '') === norm(privateRoot);
  const underPrivate = norm(out.dir).startsWith(`${norm(privateRoot)}/`);
  assert('runtime:private-root-roundtrip',
    rootHonored && underPrivate && out.created === true && out.afterDestroy === false,
    `workspace=${rel(out.dir)} radice-figlio=${rootHonored ? 'privata (override onorato)' : `ALTRA (${out.root})`} `
    + `sotto-radice-privata=${underPrivate} creato=${out.created} distrutto=${out.afterDestroy === false}`);
}

// ===========================================================================
// (8) hygiene:no-residue — nessun residuo sotto la NOSTRA radice temp privata.
// ===========================================================================
function subTestHygiene() {
  console.log('');
  console.log('(8) hygiene:no-residue — nessun residuo sotto eval/.tmp-h1-<pid> (cleanup never-throw):');
  cleanH1Tmp();
  // Su Windows la RADICE puo' restare (vuota ma) momentaneamente LOCKED da un figlio
  // appena terminato: NON e' un residuo. Asseriamo l'assenza di SOTTOCARTELLE/file,
  // tollerando una radice vuota o non leggibile. readdirSync in try/catch.
  let residual = [];
  try { residual = existsSync(TMP_H1_ROOT) ? readdirSync(TMP_H1_ROOT) : []; }
  catch { residual = []; }
  assert('hygiene:no-residue', residual.length === 0,
    residual.length === 0
      ? `nessun residuo in ${rel(TMP_H1_ROOT)} (radice vuota, assente o lockata)`
      : `residui: ${residual.join(', ')}`);
}

// ---------------------------------------------------------------------------
function main() {
  console.log('============================================================');
  console.log(' ORACOLO H-1 — RADICE TEMP PRIVATA PER-PID (test-first, nasce ROSSO)');
  console.log(`   repo root   : ${ROOT}`);
  console.log(`   radice temp : ${rel(TMP_H1_ROOT)}`);
  console.log('   (1) concurrency:legacy-destroys    — radice condivisa: il cleanup di B rade la copia di A');
  console.log('   (2) concurrency:private-survives   — radici per-pid: la copia di A sopravvive');
  console.log('   (3) static:no-shared-root          — i 5 harness: no cleanup condiviso, radice temp col pid, env per-pid');
  console.log('   (4) static:per-pack-roots          — eval/ecosystems/*/verify_fix_check.mjs: il pid nel segmento-radice');
  console.log('   (5) env:child-inheritance          — gli spawn propagano ai figli una radice PER-PID');
  console.log('   (6) shipped:bit-invariance         — trueline/ intatto, aggiunte incluse (git in sola lettura)');
  console.log('   (7) runtime:private-root-roundtrip — verify_workspace SPEDITO onora la radice privata');
  console.log('   (8) hygiene:no-residue             — nessun residuo nella nostra radice temp');
  console.log('============================================================');

  // --- PRECONDIZIONE: sweep + sorgenti bersaglio leggibili -----------------
  cleanH1Tmp();
  try { mkdirSync(TMP_H1_ROOT, { recursive: true }); }
  catch (e) { precondAbort(`radice temp non creabile (${rel(TMP_H1_ROOT)}): ${e.message}`); }
  const sources = new Map();
  for (const path of TARGET_HARNESSES) {
    if (!existsSync(path)) precondAbort(`harness bersaglio assente: ${rel(path)}`);
    sources.set(path, stripComments(readTarget(path)));
  }
  console.log('');
  console.log(`[PASS] precondizione: ${TARGET_HARNESSES.length} harness bersaglio leggibili; radice temp privata allestita.`);

  // --- I sotto-test --------------------------------------------------------
  subTestLegacyDestroys();
  subTestPrivateSurvives();
  subTestNoSharedRoot(sources);
  subTestPerPackRoots();
  subTestChildInheritance(sources);
  subTestShippedBitInvariance();
  subTestRoundtrip();
  subTestHygiene();

  // --- Esito ---------------------------------------------------------------
  const passed = checks.filter((c) => c.ok).length;
  const allOk = passed === checks.length;
  const red = checks.filter((c) => !c.ok).map((c) => c.name);
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(`=== ORACOLO H-1 RESULT: ${allOk ? 'PASS' : 'FAIL'} ===`);
  if (!allOk) console.log(`    sotto-test ROSSI: ${red.join(', ')}`);
  console.log(`h1_perpid_check: ${passed}/${checks.length} PASS`);
  console.log('------------------------------------------------------------');
  process.exit(allOk ? 0 : 1);
}

main();
