#!/usr/bin/env node
// pack_verify_battery.mjs — BATTERIA DEI GATE PER-PACK: il CABLAGGIO MANCANTE.
//
// PERCHE' ESISTE (difetto MISURATO, non ipotizzato). I 16
// eval/ecosystems/*/verify_fix_check.mjs sono i gate di merito dei pack: ognuno
// esegue il verify-fix loop su una COPIA ISOLATA della propria fixture e asserisce
// la promozione a `verified` come FATTO di un oracolo rieseguito (L-COL-002).
// `grep -rn "verify_fix_check"` sul repo (27 lug 2026) dice pero' che NESSUN harness
// li invoca: `ecosystem_conformance` non li tocca, e compaiono solo nei plan come
// passo MANUALE. Sono 16 gate ORFANI. Un gate che nessuno esegue non e' un verde
// (L-COL-006): marcisce in silenzio, e infatti la prima esecuzione integrale ha
// trovato 4 rossi su 16, tre dei quali ROSSI DALLA NASCITA (giugno). Questa batteria
// e' il cablaggio che mancava: da qui in poi i 16 gate hanno un chiamante, e la loro
// marcitura diventa VISIBILE al primo run.
//
// COSA FA, e in che ordine:
//   - ENUMERA a runtime eval/ecosystems/*/verify_fix_check.mjs (mai una lista
//     cablata: un pack nuovo e' coperto d'ufficio, un pack rimosso non lascia un
//     riferimento morto);
//   - li esegue in SERIALE, uno alla volta, ciascuno come processo FIGLIO. Mai in
//     parallelo: e' la lezione H-1 sulla CONTESA (due gate che girano insieme si
//     radono a vicenda le copie temp e producono falsi rossi). Il parallelismo qui
//     comprerebbe minuti e pagherebbe in verdi/rossi inaffidabili;
//   - propaga ai figli, per EREDITA', la radice temp PRIVATA per-pid della batteria
//     (TRUELINE_TMP_VERIFY_ROOT): tutti i pack di UN run vivono sotto la stessa
//     radice — sono lo STESSO run logico — mentre due batterie concorrenti hanno
//     radici DIVERSE. E' anche un ESERCIZIO REALE della guardia di proprieta' che i
//     pack hanno appena adottato: se un figlio radesse la radice EREDITATA,
//     danneggerebbe il run del padre.
//
// PROPRIETA' della radice temp (stessa guardia dei 5 harness e dei 16 pack): e'
// NOSTRA solo se l'abbiamo CREATA noi (env ASSENTE all'AVVIO). Se l'abbiamo
// EREDITATA siamo a nostra volta un FIGLIO e sotto quella radice vive il lavoro del
// PADRE: NON la spazziamo. La batteria non crea copie proprie (le creano i figli,
// che le rimuovono da se'), quindi la sola rimozione in gioco e' quella della RADICE.
//
// CLASSIFICAZIONE DI OGNI PACK — tre esiti, non due (L-COL-006):
//   PASS  — exit 0 *CON LE PROVE*: la riga di tally del figlio esiste e dichiara
//           total > 0 e passed === total. L'exit 0 DA SOLO non basta e non e' mai
//           bastato: un pack degradato a no-op (contenuto sostituito da un
//           console.log, zero check) esce 0 e — se lo si contasse PASS — sazierebbe
//           il floor anti-vacuo con ZERO prove; sedici no-op darebbero "16 verdetti
//           di merito" e un verde. "Verde" e' un FATTO misurato (L-COL-002): qui il
//           fatto e' il TALLY del figlio, non il suo exit code.
//   FAIL  — difetto di MERITO. Tre forme: (a) exit != 0 NON attribuito a un tool
//           assente (vedi IL NESSO, sotto); (b) exit 0 SENZA prove — tally assente,
//           a zero check, o incoerente (passed != total): un gate che AFFERMA il
//           successo senza aver verificato nulla e' la peggiore delle marciture, non
//           una copertura mancante, e va mostrato ROSSO; (c) timeout o segnale.
//   SKIP  — copertura MANCANTE, DICHIARATA, mai spacciata per verde. Due forme:
//           (a) il pack stesso dichiara la precondizione mancante uscendo 2 (idioma
//               gia' presente in 13 dei 16: inner-repo della fixture non
//               provisionato, ecc.);
//           (b) OGNI rosso del pack e' ATTRIBUITO a un TOOL ASSENTE nell'ambiente,
//               con EVIDENZA nell'output del figlio (`spawnSync <tool> ENOENT`, il
//               messaggio che Node produce quando l'eseguibile non e' sul PATH):
//               un FALSO ROSSO d'ambiente, non un difetto del prodotto.
//           L'evidenza deve essere VISIBILE nell'output: senza evidenza un rosso
//           resta un FAIL. La direzione conservativa e' deliberata — un pattern
//           largo (un `ENOENT` qualunque, un "not found") trasformerebbe difetti
//           VERI in SKIP, cioe' indebolirebbe il gate proprio dove deve mordere.
//
// IL NESSO fra tool assente e rosso — cio' che rende la forma (b) non abusabile.
// NON basta che `spawnSync <x> ENOENT` compaia DA QUALCHE PARTE nell'output del
// figlio: quella sola presenza riclassificherebbe a SKIP *tutti* i rossi del pack,
// compresi quelli di MERITO che col tool non c'entrano nulla, e la batteria
// uscirebbe 0 assorbendo in silenzio proprio la regressione che deve mostrare
// (basterebbe una riga di log con quel testo per spegnere il gate). Il mandato dice
// "quando il rosso DIPENDE dal tool assente": la dipendenza va STABILITA, non
// presunta. Qui si stabilisce CHECK PER CHECK, sull'unica prova disponibile a un
// chiamante esterno — la riga del check stesso:
//   - il pack e' SKIP(b) sse ha ALMENO UN check ROSSO e OGNI check rosso PORTA SU DI
//     SE' l'evidenza (`spawnSync <tool> ENOENT` nella riga `[FAIL] ...`, con <tool>
//     fra i tool risultati mancanti). E' il caso reale: i gate che dipendono da un
//     tool riportano nel `detail` dell'assert il messaggio d'errore dello spawn.
//   - se anche UN SOLO rosso non porta quell'evidenza il pack e' FAIL, e il
//     riepilogo NOMINA i rossi NON attribuiti: il tool assente non assolve i rossi
//     che non spiega.
//   - un exit != 0 con l'evidenza sparsa nell'output ma SENZA alcun check rosso non
//     e' attribuibile a niente: e' FAIL. La via per dichiarare una precondizione
//     d'ambiente e' l'exit 2 del PACK (forma (a)) — idioma che 13 dei 16 hanno gia'
//     — non un'inferenza della batteria su un output che non ha spiegato il rosso.
// I NOMI dei check rossi si stampano SEMPRE, anche negli SKIP: sono le PROVE della
// classificazione, e nasconderle nello SKIP la renderebbe non verificabile.
//
// ESITO (mai un falso verde — "verde" = exit/output reale, L-COL-002):
//   exit 0 — nessun FAIL: tutti PASS oppure SKIP dichiarati.
//   exit 1 — almeno un pack e' FAIL. E' l'esito ATTESO oggi: la batteria nasce
//            addosso ai rossi di merito misurati il 27 lug (amplify-jsts,
//            appwrite-jsts, phoenix-ex) e li DEVE riportare. Al primo run integrale
//            dopo T5 ne resta UNO — phoenix-ex 10/12 (il DSN Postgres hardcoded
//            sopravvive al fix in config/config.exs) — perche' amplify e appwrite
//            sono stati chiusi nel frattempo. Dice la verita' sullo stato attuale,
//            qualunque sia: il conteggio non e' cablato da nessuna parte.
//   exit 2 — PRECONDIZIONE/AMBIENTE, mai un falso rosso: eval/ecosystems non
//            enumerabile o vuoto, --packs con un nome inesistente o vuoto,
//            argomento sconosciuto, radice temp non creabile, e — FLOOR ANTI-VACUO
//            — nessun pack ha prodotto un VERDETTO DI MERITO.
//
// FLOOR ANTI-VACUO, dichiarato: il mandato chiede exit 2 se ZERO pack sono stati
// ESEGUITI. Qui il floor e' un filo PIU' STRETTO (mai piu' largo): exit 2 se zero
// pack hanno prodotto un verdetto di MERITO (PASS o FAIL). Sedici SKIP di fila —
// tutti i tool assenti — sono una batteria che non ha verificato NULLA: uscirne 0
// sarebbe esattamente il verde vacuo che L-COL-006 vieta. La condizione del mandato
// (zero eseguiti) e' contenuta in questa, che quindi la soddisfa e in piu' copre il
// caso peggiore. Il floor regge SOLO perche' il PASS esige le prove (vedi sopra):
// contare "merito" un exit 0 senza tally lo renderebbe saziabile da pack vuoti —
// il floor conterebbe verdetti che non esistono.
//
// AMBITO: --packs=<csv> (es. --packs=rails-rb,dotnet-cs) restringe la batteria ai
// pack NOMINATI, nell'ordine dato — stessa semantica di h1_perpid_check.mjs, utile
// per iterare su un sottoinsieme senza pagare il run integrale. Senza --packs il
// default e' TUTTI i pack enumerati. Un nome inesistente e' una PRECONDIZIONE
// mancante (exit 2), non un verde: un typo non deve mai passare per "tutto a posto".
//
// FALSIFICABILITA' (la batteria non e' un timbro), provata DAVVERO e non dedotta per
// lettura, su eval/ecosystems/dotnet-cs (pack VERDE e STABILE: 3 run su 3 a 12/12;
// rails-rb, il candidato ovvio, e' risultato FLAKY alla misura — 2 FAIL su 3 run a
// file INTATTO, "ri-sottomissione byte-identica rifiutata" — e avrebbe confuso la
// prova invece di falsificarla):
//   - un check di merito neutralizzato -> FAIL 11/12, exit 1; file ripristinato ->
//     PASS 12/12, exit 0 (si torna al conteggio precedente);
//   - lo stesso rosso PIU' una riga di log estranea che cita "spawnSync fakebin
//     ENOENT" -> resta FAIL/exit 1 (il rosso non porta l'evidenza: nesso ASSENTE);
//   - lo stesso rosso il cui DETAIL porta l'evidenza -> SKIP/exit 0 col rosso
//     comunque STAMPATO (nesso PRESENTE: e' il falso rosso d'ambiente da assolvere);
//   - pack svuotato (exit 0, zero check) -> FAIL, exit 1: il verde vacuo non passa.
//
// COSA NON FA (deliberato, per non diventare un secondo prodotto): non riesegue
// ecosystem_conformance / m1..m5 (li possiede l'orchestratore, sono minuti di
// wall-clock e DB/docker), non ritenta un pack per inseguire un flake (l'isolamento
// e' la soluzione, il retry e' la pezza), non tocca git in scrittura (l'unica `git`
// e' dei figli, sui LORO .git interni; qui non se ne esegue nessuna).
//
// SPECCHIA h1_perpid_check.mjs / build_discipline_check.mjs: shebang, soli moduli
// built-in, ROOT da __dirname, radice temp PRIVATA per-pid con cleanup NEVER-THROW,
// precondAbort(...) per l'exit 2, tally finale + process.exit(...). Node ESM,
// nessuna dipendenza esterna.

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readdirSync, rmSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const ECOSYSTEMS_DIR = resolve(ROOT, 'eval', 'ecosystems');

// PROPRIETA' della radice: fotografata PRIMA di qualunque uso (una lettura
// successiva a un'eventuale riassegnazione direbbe sempre "ereditata").
const TMP_ROOT_INHERITED = Boolean(process.env.TRUELINE_TMP_VERIFY_ROOT);
// Radice temp PRIVATA per-invocazione (pid): stesso pattern di eval/.tmp-bd-<pid>,
// eval/.tmp-at-<pid>, eval/.tmp-h1-<pid>. Coperta da .gitignore "eval/.tmp-*/".
const TMP_BATTERY_ROOT = TMP_ROOT_INHERITED
  ? resolve(process.env.TRUELINE_TMP_VERIFY_ROOT)
  : resolve(ROOT, 'eval', `.tmp-pvb-${process.pid}`);

// Un pack che non termina bloccherebbe la batteria per sempre: il tetto e' LARGO
// (il pack piu' lento misurato sta sotto i 15 s) e serve solo a garantire che il
// gate TERMINI. Un timeout NON e' un tool assente: e' un FAIL dichiarato.
const PACK_TIMEOUT_MS = 15 * 60 * 1000;

const rel = (p) => String(p).replace(/\\/g, '/').replace(`${String(ROOT).replace(/\\/g, '/')}/`, '');

// ---------------------------------------------------------------------------
// Igiene della radice temp (mirror di cleanH1Tmp / cleanBdTmp).
// ---------------------------------------------------------------------------

// Backoff BLOCCANTE deterministico (niente setTimeout/Date.now/Math.random): assorbe
// un lock transitorio di Windows tra i tentativi senza introdurre non-determinismo.
function settleDeterministic(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { /* Atomics non disponibile: prosegui senza attesa */ }
}

// Pulizia ROBUSTA della radice temp. NON lancia MAI: un lock transitorio di Windows
// su una dir appena rimossa da un figlio NON deve diventare un falso exit-1.
// SOLO IL PROPRIETARIO SPAZZA: se la radice e' EREDITATA appartiene al PADRE e sotto
// vive il suo lavoro — raderla e' il danno che il pattern per-pid vuole eliminare.
function cleanBatteryTmp() {
  if (TMP_ROOT_INHERITED) return;
  for (let i = 0; i < 6; i += 1) {
    try {
      if (!existsSync(TMP_BATTERY_ROOT)) return;
      rmSync(TMP_BATTERY_ROOT, { recursive: true, force: true, maxRetries: 4, retryDelay: 60 });
      if (!existsSync(TMP_BATTERY_ROOT)) return;
    } catch { /* lock transitorio: ritenta col backoff sotto */ }
    if (i < 5) settleDeterministic(80 * (i + 1));
  }
  /* esaurito: NON lanciamo. Il residuo e' DICHIARATO nel riepilogo. */
}

// Aborto AMBIENTALE (exit 2): una precondizione non e' soddisfatta. Mai un falso
// rosso e mai un falso verde.
function precondAbort(reason) {
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('=== BATTERIA GATE PER-PACK: (precondizione mancante) ===');
  console.log(`  - ${reason}`);
  console.log('(exit 2 = precondizione/ambiente; mai un falso verde, mai un falso rosso.)');
  console.log('------------------------------------------------------------');
  cleanBatteryTmp();
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Ambito dei pack: enumerazione a runtime + --packs=<csv>.
// ---------------------------------------------------------------------------

// Tutti i pack con un verify_fix_check.mjs, ENUMERATI a runtime (non hardcodati:
// un pack nuovo e' coperto d'ufficio), ordinati per nome.
function enumerateAllPacks() {
  let entries = [];
  try {
    entries = readdirSync(ECOSYSTEMS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, file: resolve(ECOSYSTEMS_DIR, e.name, 'verify_fix_check.mjs') }))
      .filter((p) => existsSync(p.file))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  } catch (e) {
    precondAbort(`eval/ecosystems non enumerabile: ${e.message}`);
  }
  if (entries.length === 0) {
    precondAbort(`nessun verify_fix_check.mjs sotto ${rel(ECOSYSTEMS_DIR)} (enumerazione vuota: batteria non esercitabile)`);
  }
  return entries;
}

// --packs=<csv>: restringe la batteria ai pack NOMINATI, nell'ordine dato. Senza
// --packs il default e' l'insieme COMPLETO. Un nome inesistente, una lista vuota o
// un argomento sconosciuto sono PRECONDIZIONI mancanti (exit 2).
function resolvePackScope(argv, all) {
  const byName = new Map(all.map((p) => [p.name, p]));
  let requested = null;
  for (const arg of argv) {
    const m = /^--packs=(.*)$/.exec(arg);
    if (!m) {
      precondAbort(`argomento non riconosciuto: "${arg}" (unico ammesso: --packs=<csv di nomi di pack>)`);
      continue;
    }
    requested = m[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }
  if (requested === null) return { packs: all, label: `TUTTI i pack enumerati (${all.length})` };
  if (requested.length === 0) {
    precondAbort('--packs e\' vuoto: nessun pack da eseguire (un ambito vuoto non e\' un verde)');
  }
  const unknown = requested.filter((n) => !byName.has(n));
  if (unknown.length > 0) {
    precondAbort(`--packs nomina pack inesistenti: ${unknown.join(', ')} (disponibili: ${all.map((p) => p.name).join(', ')})`);
  }
  const seen = new Set();
  const packs = [];
  for (const n of requested) {
    if (seen.has(n)) continue;
    seen.add(n);
    packs.push(byName.get(n));
  }
  return { packs, label: `--packs (${packs.length}/${all.length}): ${packs.map((p) => p.name).join(', ')}` };
}

// ---------------------------------------------------------------------------
// Lettura dell'output di un figlio.
// ---------------------------------------------------------------------------

// L'EVIDENZA di un tool assente: il messaggio che Node produce quando l'eseguibile
// non e' sul PATH (`spawnSync dart ENOENT`, `spawn docker ENOENT`). Pattern STRETTO
// per costruzione: un `ENOENT` generico (un file mancante) o un "not found" a testo
// libero NON qualificano — allargarlo trasformerebbe difetti VERI in SKIP.
// Fabbrica (non una costante globale con `lastIndex` condiviso: qui il pattern si
// usa sia sull'output intero sia riga-per-riga, e uno stato residuo darebbe
// attribuzioni fantasma).
const missingToolRe = () => /\bspawn(?:Sync)?\s+([A-Za-z0-9._+-]+)\s+ENOENT\b/g;

function missingTools(output) {
  const out = new Set();
  const re = missingToolRe();
  let m = re.exec(output);
  while (m) { out.add(m[1]); m = re.exec(output); }
  return [...out];
}

// IL NESSO, check per check: questa riga di `[FAIL] ...` porta SU DI SE' l'evidenza
// di uno dei tool mancanti? Solo in quel caso il tool assente SPIEGA quel rosso.
// La stessa evidenza trovata ALTROVE nell'output non dice nulla su QUESTO check —
// e' esattamente la scorciatoia che permetteva a una riga di log qualunque di
// convertire in SKIP i difetti di merito di un intero pack.
function checkBlamesMissingTool(checkLine, tools) {
  if (tools.length === 0) return false;
  const re = missingToolRe();
  let m = re.exec(checkLine);
  while (m) {
    if (tools.includes(m[1])) return true;
    m = re.exec(checkLine);
  }
  return false;
}

// La riga di tally del pack: `=== GATE ... RESULT: PASS === (21/22 check)`. Formato
// comune a tutti i 16 (assert(name, ok, detail) + tally finale). Si prende l'ULTIMA
// occorrenza: e' quella conclusiva. La variante dello SKIP dichiarato dal pack
// (`RESULT: SKIP (exit 2) === (15/15 check eseguiti)`) e' riconosciuta anch'essa: un
// pack che salta ha comunque una copertura da riportare. Se la riga manca del tutto
// (crash precoce), tally = null e il riepilogo lo dice invece di inventare un numero.
function parseTally(output) {
  const re = /RESULT:\s*(PASS|FAIL|SKIP)[^\n=]*===\s*\((\d+)\s*\/\s*(\d+)\s+check[^)\n]*\)/g;
  let last = null;
  let m = re.exec(output);
  while (m) { last = m; m = re.exec(output); }
  if (!last) return null;
  return { verdict: last[1], passed: Number(last[2]), total: Number(last[3]) };
}

// Le righe dei check ROSSI del figlio, `nome — detail` INTERE: e' cio' che rende la
// batteria AZIONABILE senza riversare 16 output interi nel terminale, ed e' anche il
// materiale dell'ATTRIBUZIONE — il `detail` di un assert che dipende da un tool
// riporta il messaggio dello spawn fallito, cioe' l'evidenza del nesso. Per questo si
// tiene la riga intera e non il solo nome.
function failedCheckNames(output) {
  const out = [];
  const re = /^\s*\[FAIL\]\s+(.+?)\s*$/gm;
  let m = re.exec(output);
  while (m) { out.push(m[1]); m = re.exec(output); }
  return out;
}

// ---------------------------------------------------------------------------
// Esecuzione SERIALE di un pack.
// ---------------------------------------------------------------------------
function runPack(p, env) {
  const startedAt = Date.now();
  const res = spawnSync(process.execPath, [p.file], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: PACK_TIMEOUT_MS,
  });
  const elapsedMs = Date.now() - startedAt;
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  const tally = parseTally(output);
  const tools = missingTools(output);
  const rec = {
    name: p.name,
    status: null,        // PASS | FAIL | SKIP
    reason: '',
    executed: true,      // il figlio e' partito e ha prodotto un esito
    exit: res.status,
    tally,
    tools,
    failed: failedCheckNames(output),
    unexplained: [],     // rossi NON attribuibili ai tool assenti (il nesso mancante)
    elapsedMs,
  };

  // (i) il figlio non e' PARTITO: e' ambiente, non merito. ETIMEDOUT e' l'eccezione
  //     — il processo era partito e non e' terminato: quello e' un FAIL dichiarato.
  if (res.error && res.error.code === 'ETIMEDOUT') {
    rec.status = 'FAIL';
    rec.reason = `timeout dopo ${Math.round(PACK_TIMEOUT_MS / 1000)}s (un gate che non termina non e' un verde)`;
    return rec;
  }
  if (res.error) {
    rec.status = 'SKIP';
    rec.executed = false;
    rec.reason = `figlio NON avviabile: ${res.error.message}`;
    return rec;
  }
  // (ii) ucciso da un segnale: non e' un verdetto, ma non e' nemmeno ambiente noto.
  if (res.status === null) {
    rec.status = 'FAIL';
    rec.reason = `terminato da segnale ${res.signal || '?'} senza exit code`;
    return rec;
  }
  // Un PASS esige le PROVE, non solo l'exit 0: la riga di tally del figlio deve
  // esistere, contare almeno UN check e dichiararli TUTTI verdi. Un pack svuotato
  // (no-op che esce 0) non e' una copertura mancante da dichiarare: e' un gate che
  // AFFERMA il successo senza aver verificato nulla — il verde vacuo che L-COL-006
  // vieta e che il floor anti-vacuo, da solo, non intercetterebbe (lo conterebbe
  // come verdetto di merito). Va mostrato ROSSO.
  if (res.status === 0) {
    if (!tally) {
      rec.status = 'FAIL';
      rec.reason = 'exit 0 SENZA PROVE: nessuna riga di tally nell\'output '
        + '(un gate che non mostra un solo check eseguito non e\' un verde)';
      return rec;
    }
    if (tally.total === 0) {
      rec.status = 'FAIL';
      rec.reason = 'exit 0 SENZA PROVE: tally a ZERO check (nulla e\' stato verificato)';
      return rec;
    }
    if (tally.passed !== tally.total) {
      rec.status = 'FAIL';
      rec.reason = `exit 0 INCOERENTE con le prove: il tally dichiara ${tally.passed}/${tally.total} check `
        + '(esito e prove in contraddizione: si crede alle prove)';
      return rec;
    }
    rec.status = 'PASS';
    rec.reason = `${tally.passed}/${tally.total} check`;
    return rec;
  }
  // (iii) exit 2: il pack DICHIARA da se' la precondizione mancante (idioma gia' suo).
  if (res.status === 2) {
    rec.status = 'SKIP';
    rec.reason = `precondizione dichiarata dal pack (exit 2)${tally ? `, ${tally.passed}/${tally.total} check eseguiti` : ''}`
      + `${tools.length > 0 ? ` — tool assente: ${tools.join(', ')}` : ''}`;
    return rec;
  }
  // (iv) rosso SPIEGATO da un tool assente: falso rosso d'ambiente, non un difetto.
  //      Il NESSO si stabilisce CHECK PER CHECK (vedi l'header): il tool assente
  //      assolve SOLO i rossi che portano su di se' la sua evidenza. Se anche uno
  //      solo non la porta, quel rosso e' di MERITO e il pack resta FAIL — altrimenti
  //      una riga qualunque contenente "spawnSync <x> ENOENT" spegnerebbe il gate.
  if (tools.length > 0) {
    rec.unexplained = rec.failed.filter((line) => !checkBlamesMissingTool(line, tools));
    if (rec.failed.length > 0 && rec.unexplained.length === 0) {
      rec.status = 'SKIP';
      rec.reason = `tool assente nell'ambiente: ${tools.join(', ')} — TUTTI i ${rec.failed.length} check rossi `
        + 'portano l\'evidenza dello spawn fallito (nessun rosso di merito)'
        + `${tally ? `, ${tally.passed}/${tally.total} check` : ''}`;
      return rec;
    }
    rec.status = 'FAIL';
    rec.reason = rec.failed.length === 0
      // Evidenza sparsa nell'output ma nessun check rosso a cui attribuirla: non c'e'
      // nesso da stabilire. La via onesta per un gap d'ambiente e' l'exit 2 DEL PACK.
      ? `exit ${res.status} NON attribuibile: tool assenti nell'output (${tools.join(', ')}) ma NESSUN check rosso `
        + 'che li porti come causa (per un gap d\'ambiente il pack deve dichiararlo uscendo 2)'
      : `${rec.unexplained.length} dei ${rec.failed.length} check rossi NON sono spiegati dai tool assenti `
        + `(${tools.join(', ')}): difetto di MERITO`
        + `${tally ? `, ${tally.passed}/${tally.total} check` : ''}`;
    return rec;
  }
  // (v) tutto il resto e' un difetto di MERITO.
  rec.status = 'FAIL';
  rec.reason = tally ? `${tally.passed}/${tally.total} check` : `exit ${res.status} (nessuna riga di tally)`;
  return rec;
}

// ---------------------------------------------------------------------------
function main() {
  const allPacks = enumerateAllPacks();
  const scope = resolvePackScope(process.argv.slice(2), allPacks);

  console.log('============================================================');
  console.log(' BATTERIA DEI GATE PER-PACK — eval/ecosystems/*/verify_fix_check.mjs');
  console.log(`   repo root   : ${ROOT}`);
  console.log(`   radice temp : ${rel(TMP_BATTERY_ROOT)} (${TMP_ROOT_INHERITED ? 'EREDITATA: NON la spazziamo' : 'PROPRIA: la spazziamo noi'})`);
  console.log(`   ambito      : ${scope.label}`);
  console.log('   esecuzione  : SERIALE (mai in parallelo: la contesa sui temp produce falsi rossi)');
  console.log('   esiti       : PASS | FAIL (merito) | SKIP (copertura MANCANTE, dichiarata)');
  console.log('============================================================');

  try { mkdirSync(TMP_BATTERY_ROOT, { recursive: true }); }
  catch (e) { precondAbort(`radice temp non creabile (${rel(TMP_BATTERY_ROOT)}): ${e.message}`); }

  // I figli EREDITANO la radice della batteria: stesso run logico. Nient'altro viene
  // aggiunto all'ambiente — la batteria e' un ESECUTORE, non un correttore d'ambiente:
  // arricchire il PATH qui nasconderebbe proprio i tool assenti che deve DICHIARARE.
  const childEnv = { ...process.env, TRUELINE_TMP_VERIFY_ROOT: TMP_BATTERY_ROOT };

  const results = [];
  let i = 0;
  for (const p of scope.packs) {
    i += 1;
    const idx = `[${String(i).padStart(2, ' ')}/${scope.packs.length}]`;
    console.log('');
    console.log(`${idx} ${p.name} — esecuzione (${rel(p.file)})`);
    const rec = runPack(p, childEnv);
    results.push(rec);
    console.log(`${idx} ${p.name}: ${rec.status} — ${rec.reason} (exit=${rec.exit === null ? 'nessuno' : rec.exit}, ${(rec.elapsedMs / 1000).toFixed(1)}s)`);
    // I check rossi si stampano SEMPRE che ci siano, FAIL o SKIP: sono le PROVE della
    // classificazione. Nasconderli nello SKIP (come faceva la prima stesura) rendeva
    // la dichiarazione "e' colpa del tool assente" non verificabile da chi legge.
    if (rec.failed.length > 0) {
      // Nel FAIL da nesso mancante i rossi NON attribuiti vengono per primi: sono
      // quelli che il tool assente NON assolve, cioe' il merito da guardare.
      const ordered = [...rec.unexplained, ...rec.failed.filter((l) => !rec.unexplained.includes(l))];
      for (const line of ordered.slice(0, 5)) {
        const attributed = rec.status === 'SKIP' || !rec.unexplained.includes(line);
        const tag = rec.tools.length > 0
          ? (attributed ? 'check ROSSO (attribuito al tool assente)' : 'check ROSSO (NON spiegato dal tool assente)')
          : 'check ROSSO';
        console.log(`        ${tag}: ${line.slice(0, 160)}`);
      }
      if (ordered.length > 5) console.log(`        ... e altri ${ordered.length - 5} check rossi`);
      console.log(`        riprodurre: node ${rel(p.file)}`);
    }
  }

  // --- Riepilogo + COPERTURA DICHIARATA ------------------------------------
  const passed = results.filter((r) => r.status === 'PASS');
  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');
  const executed = results.filter((r) => r.executed);
  const merit = passed.length + failed.length;

  // La riga di verdetto dice la stessa cosa dell'exit code. Col floor anti-vacuo non
  // raggiunto (merito = 0) NON si stampa 'PASS' per poi uscire 2: la riga dichiara la
  // precondizione mancante — "verde" e' un fatto dell'esito, non una parola (L-COL-002).
  const verdict = merit === 0 ? 'PRECONDIZIONE MANCANTE (nessun verdetto di merito)'
    : (failed.length === 0 ? 'PASS' : 'FAIL');
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(`=== BATTERIA GATE PER-PACK RESULT: ${verdict} ===`);
  console.log(`  PASS ${String(passed.length).padStart(2, ' ')}/${results.length}: ${passed.map((r) => `${r.name} (${r.reason})`).join(', ') || '—'}`);
  console.log(`  FAIL ${String(failed.length).padStart(2, ' ')}/${results.length}: ${failed.map((r) => `${r.name} (${r.reason})`).join(', ') || '—'}`);
  console.log(`  SKIP ${String(skipped.length).padStart(2, ' ')}/${results.length}: ${skipped.map((r) => r.name).join(', ') || '—'}`);
  console.log('');
  console.log('  COPERTURA DICHIARATA (L-COL-006: cio\' che non e\' stato eseguito NON e\' un verde):');
  console.log(`    - pack in ambito      : ${results.length}`);
  console.log(`    - eseguiti            : ${executed.length}`);
  console.log(`    - verdetto di MERITO  : ${merit} (PASS ${passed.length} + FAIL ${failed.length})`);
  console.log(`    - copertura MANCANTE  : ${skipped.length}`);
  for (const r of skipped) console.log(`        * ${r.name}: ${r.reason}`);
  if (skipped.length === 0) console.log('        (nessuna: ogni pack in ambito ha dato un verdetto di merito)');

  // Residuo temp: DICHIARATO, non gatato. I figli rimuovono le proprie copie; un
  // residuo qui e' un'informazione d'igiene, non il verdetto della batteria (e su
  // Windows un lock transitorio lo renderebbe un falso rosso).
  cleanBatteryTmp();
  let residual = [];
  try { residual = existsSync(TMP_BATTERY_ROOT) ? readdirSync(TMP_BATTERY_ROOT) : []; }
  catch { residual = []; }
  console.log(`    - residuo temp        : ${residual.length === 0
    ? `nessuno in ${rel(TMP_BATTERY_ROOT)}${TMP_ROOT_INHERITED ? ' (radice EREDITATA: non rimossa, e\' del padre)' : ''}`
    : `${residual.length} voci in ${rel(TMP_BATTERY_ROOT)}: ${residual.slice(0, 5).join(', ')}`}`);

  // FLOOR ANTI-VACUO: zero verdetti di merito = nessuna verifica avvenuta. Non e' un
  // verde e non e' un rosso: e' una precondizione mancante (exit 2).
  if (merit === 0) {
    console.log('------------------------------------------------------------');
    precondAbort(`nessun pack ha prodotto un verdetto di MERITO su ${results.length} in ambito `
      + `(eseguiti=${executed.length}, saltati=${skipped.length}): una batteria che non verifica nulla non e' un verde`);
  }

  console.log(`pack_verify_battery: ${passed.length} PASS / ${failed.length} FAIL / ${skipped.length} SKIP su ${results.length} pack`);
  console.log('------------------------------------------------------------');
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
