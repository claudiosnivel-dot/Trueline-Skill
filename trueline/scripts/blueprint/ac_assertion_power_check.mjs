#!/usr/bin/env node
// ac_assertion_power_check.mjs — oracolo del POTERE dell'asserzione d'accettazione.
//
// FRATELLO di ac_assertion_trace_check.mjs, NON una sua modifica: quello verifica la
// PROVENIENZA (l'asserzione discende dall'AC), questo verifica il POTERE (l'asserzione
// puo' FALLIRE). Un'asserzione tautologica passa la provenienza a pieni voti.
//
// DUE STADI, e la separazione e' il punto:
//   1) CANDIDATI (statico, SOVRA-INCLUSIVO): nessun verdetto. Misurato il 30/07/2026,
//      un rilevatore statico su raggiungibilita' dei moduli da 2 FALSI POSITIVI su 3.
//   2) VERDETTO (ESECUZIONE): si neutralizza il binding esportato sulla COPIA di lavoro
//      e si riesegue QUEL SOLO target_test. Resta verde => l'asserzione e' INERTE.
//      L'autorita' e' l'exit code del runner (L-COL-002), mai l'analisi statica.
//
// DIREZIONE CONSERVATIVA, dichiarata: in caso di dubbio NON si segnala. Il file gira a
// livello di FILE, non di singolo test case, quindi un altro test dello stesso file che
// diventa rosso maschera l'inerzia => FALSO NEGATIVO possibile. E' il verso giusto in cui
// sbagliare: un falso positivo renderebbe rosso un progetto sano.
//
// Node ESM, solo built-in.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve as presolve } from 'node:path';

const NEUTRAL_STRING = "'\\u0000TRUELINE_NEUTRALIZED'";
const NEUTRAL_NUMBER = '-987654321';

// Trova la fine di un letterale bilanciato partendo da open ({ o [), ignorando
// le parentesi dentro stringhe. Ritorna l'indice del carattere di chiusura, o -1.
function matchBalanced(src, start) {
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Si CERCA sulla copia mascherata e si RISCRIVE sull'originale: maskComments preserva le
// lunghezze apposta, quindi ogni indice vale su entrambe.
//
// Senza questo, una dichiarazione COMMENTATA — il pattern «vecchia versione commentata
// sopra la nuova», o un @example in JSDoc — verrebbe neutralizzata al posto di quella
// viva, che resterebbe intatta. Il file riscritto e' ancora sintatticamente VALIDO, quindi
// niente a valle se ne accorge: lo stadio 2 rilancia il test, lo trova verde e dichiara
// INERTE un progetto sano. Cercare sul mascherato fa sparire il commento dal match, cosi'
// si trova la dichiarazione vera; se l'unica forma presente e' commentata non c'e' match e
// si torna null — il candidato finisce in unresolved, che e' la risposta onesta.
export function neutralizeExport(source, name) {
  const masked = maskComments(source);
  const re = new RegExp(`export\\s+const\\s+${name}\\b([^=]*)=\\s*`, 'm');
  const m = re.exec(masked);
  if (!m) return null;
  const initStart = m.index + m[0].length;
  const head = source.slice(0, initStart);
  const ch = masked[initStart];
  if (ch === '{' || ch === '[') {
    // Anche il bilanciamento gira sul mascherato: una graffa dentro un commento
    // (`{ a: 1 /* } */ }`) non deve chiudere il letterale in anticipo.
    const end = matchBalanced(masked, initStart);
    if (end < 0) return null;
    return head + (ch === '{' ? '{}' : '[]') + source.slice(end + 1);
  }
  const tail = masked.slice(initStart);
  const strM = /^(['"])(?:\\.|(?!\1).)*\1/.exec(tail);
  if (strM) return head + NEUTRAL_STRING + source.slice(initStart + strM[0].length);
  const numM = /^-?\d+(?:\.\d+)?/.exec(tail);
  if (numM) return head + NEUTRAL_NUMBER + source.slice(initStart + numM[0].length);
  return null; // forma non riconosciuta: si dichiara, non si indovina
}

// Sbianca i caratteri DENTRO i commenti lasciando lunghezza e newline intatti, cosi'
// indici e numeri di riga restano quelli del sorgente vero. (PURA, esportata per il test,
// come textTracesAc del fratello ac_assertion_trace_check.mjs.)
//
// Serve perche' un'asserzione CITATA in un commento non viene mai eseguita: neutralizzare
// il suo modulo lascerebbe il file verde e lo stadio 2 la dichiarerebbe INERTE. Sarebbe un
// FALSO POSITIVO, cioe' la sola direzione d'errore che quest'oracolo si vieta. Non e'
// teorico: le fixture stesse ne contengono uno (inert-identity/tests/tokens.test.mjs cita
// la propria asserzione nell'header), misurato il 30/07/2026.
//
// String-aware come commentedPortion() del fratello, e per la stessa ragione al contrario:
// un // dentro una stringa ('http://x') NON apre un commento, altrimenti si perderebbe il
// resto della riga e con esso candidati REALI. I letterali di stringa restano INTATTI:
// ASSERT_RE ammette ' e " perche' deve vedere l'accesso a chiave (obj['k']).
// Limite dichiarato, ereditato dal fratello: i letterali regex non sono riconosciuti, e una
// quote dentro un regex (`/'/g`) puo' far misparsare la riga. Il danno e' pero' CONFINATO
// alla riga (vedi il reset su newline sotto): prima dilagava sul resto del file, e quello
// non era un falso negativo locale ma la disattivazione silenziosa dell'intera maschera.
export function maskComments(src) {
  const out = src.split('');
  let str = null;    // null | "'" | '"' | '`'
  let line = false;  // dentro //
  let block = false; // dentro /* */
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = i + 1 < src.length ? src[i + 1] : '';
    if (line) {
      if (c === '\n') { line = false; continue; } // il newline regge il conteggio righe
      out[i] = ' ';
      continue;
    }
    if (block) {
      if (c === '*' && c2 === '/') { out[i] = ' '; out[i + 1] = ' '; i++; block = false; continue; }
      if (c !== '\n') out[i] = ' ';
      continue;
    }
    if (str) {
      // Una stringa '/" non puo' contenere un newline non-escapato. Se lo incontriamo il
      // parse era SBAGLIATO — tipicamente una quote dentro un letterale regex, `/'/g` o
      // `/don't/` — e lo si confina a QUESTA riga. Senza, lo stato stringa resta aperto e
      // da li' in poi nessun commento viene piu' mascherato: tornerebbe per intero il
      // difetto che maskComments esiste per chiudere, e in silenzio.
      if (c === '\n' && str !== '`') { str = null; continue; }
      if (c === '\\') { i++; continue; } // escape: il prossimo char non chiude nulla
      if (c === str) str = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '/' && c2 === '/') { out[i] = ' '; out[i + 1] = ' '; i++; line = true; continue; }
    if (c === '/' && c2 === '*') { out[i] = ' '; out[i + 1] = ' '; i++; block = true; continue; }
  }
  return out.join('');
}

const EXT = ['.ts', '.tsx', '.mjs', '.js', '.jsx'];

// Risolve uno specificatore ai file del progetto. `@/x` -> <app>/src/x (convenzione
// piu' diffusa); relativo -> risolto dal file. Pacchetto npm -> null (fuori scope,
// dichiarato: un binding di libreria non e' codice d'autore da neutralizzare).
//
// ASSUNZIONE non verificata contro il tsconfig, che vale la pena nominare: `@/*` mappato
// alla ROOT del progetto invece che a src/ — configurazione frequente — qui non risolve e
// il binding sparisce in silenzio. L'effetto e' un candidato in meno, cioe' un possibile
// FALSO NEGATIVO: il verso giusto in cui sbagliare, ma resta un buco di copertura.
// Leggere i path del tsconfig e' il modo di chiuderlo, e non e' fatto.
export function resolveSpec(appDir, fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(appDir, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = presolve(dirname(fromFile), spec);
  else return null;
  if (existsSync(base) && /\.[cm]?[jt]sx?$/.test(base)) return base;
  for (const e of EXT) if (existsSync(base + e)) return base + e;
  for (const e of EXT) if (existsSync(join(base, 'index' + e))) return join(base, 'index' + e);
  return null;
}

// `src` arriva gia' mascherato dal chiamante: un import commentato non deve registrare un
// binding che non esiste a runtime, per la stessa ragione dell'asserzione commentata.
function importBindings(appDir, file, src) {
  const out = new Map();
  // Apici SINGOLI E DOPPI: Prettier emette doppi di default, quindi riconoscendo i soli
  // singoli l'oracolo sarebbe cieco per costruzione su una fetta larga dei progetti
  // bersaglio — zero binding, zero candidati, un gate che non spara mai e non lo dice.
  for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+(['"])([^'"]+)\2/g)) {
    const target = resolveSpec(appDir, file, m[3]);
    if (!target) continue;
    const clause = m[1];
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) for (const p of named[1].split(',')) {
      const n = p.trim().split(/\s+as\s+/).pop().trim();
      if (n) out.set(n, target);
    }
    // `import * as ns`: registrato come binding del modulo. Lo stadio 2 cerchera'
    // `export const ns` e non lo trovera', quindi il candidato finira' in unresolved con
    // un motivo. E' l'esito giusto: prima veniva scartato qui, senza lasciare traccia.
    const ns = /^\s*\*\s+as\s+(\w+)\s*$/.exec(clause);
    if (ns) out.set(ns[1], target);
    const def = /^\s*(\w+)\s*(?:,|$)/.exec(clause);
    if (def) out.set(def[1], target);
  }
  return out;
}

const ASSERT_RE = new RegExp(
  // vitest/jest: expect(A).toEqual(B) | .toStrictEqual | .toBe
  'expect\\(\\s*([A-Za-z_$][\\w$.\\[\\]\'"]*)\\s*\\)\\s*\\.\\s*(?:toEqual|toStrictEqual|toBe)\\(\\s*([A-Za-z_$][\\w$.\\[\\]\'"]*)\\s*\\)'
  // node:assert: assert.deepEqual(A, B) e varianti
  + '|assert\\s*\\.\\s*(?:deepEqual|deepStrictEqual|equal|strictEqual)\\(\\s*([A-Za-z_$][\\w$.\\[\\]\'"]*)\\s*,\\s*([A-Za-z_$][\\w$.\\[\\]\'"]*)\\s*\\)',
  'g',
);

export function findCandidates(appDir, testRelPath) {
  const abs = join(appDir, testRelPath);
  if (!existsSync(abs)) return [];
  // Letto e mascherato UNA volta: le due analisi devono vedere lo stesso testo, o un
  // import e la sua asserzione potrebbero non concordare su cosa e' codice vivo.
  const src = maskComments(readFileSync(abs, 'utf8'));
  const imps = importBindings(appDir, abs, src);
  // Il chiamante confronta testFile per uguaglianza con i path del blueprint, che usano
  // sempre `/`: su Windows un separativo nativo qui non matcherebbe mai.
  const testFile = testRelPath.replace(/\\/g, '/');
  const out = [];
  for (const m of src.matchAll(ASSERT_RE)) {
    const a = m[1] || m[3];
    const b = m[2] || m[4];
    if (!a || !b) continue;
    const rootA = a.split(/[.[]/)[0];
    const rootB = b.split(/[.[]/)[0];
    if (rootA === rootB) continue;
    const modA = imps.get(rootA); const modB = imps.get(rootB);
    if (!modA || !modB) continue; // almeno un lato non e' un binding importato
    out.push({
      testFile,
      line: src.slice(0, m.index).split('\n').length,
      kind: m[1] ? 'expect' : 'assert',
      actualRoot: rootA, expectedRoot: rootB,
      bindingName: rootB, bindingModule: modB,
    });
  }
  return out;
}
