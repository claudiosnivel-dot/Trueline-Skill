#!/usr/bin/env node
// release_bump_check.mjs — KEYSTONE del controllo di release di `package_skill`:
// un albero SPEDITO che cambia senza bump di versione NON dev'essere emettibile.
// Scritto TEST-FIRST (nasce ROSSO: il controllo non esiste ancora).
//
// PERCHE' ESISTE (difetto MISURATO il 28 lug 2026, non ipotizzato). Il plugin
// globale era rimasto indietro di un'intera sessione mentre
// `claude plugin update trueline@trueline-local` rispondeva
// «already at the latest version (0.1.0)» senza copiare nulla. Causa: l'update e'
// VERSION-gated e la versione spedita e' `0.1.0` DA SEMPRE — `skillSemver()`
// cercava `skill_version` in `trueline/package.json` (assente), poi `version`
// (`0.0.0`, scartato), e cadeva sul default cablato. Nessuna release ha mai
// cambiato versione: per ogni utente del plugin l'update era un no-op CHE
// RIPORTAVA SUCCESSO. Per un prodotto che spedisce regole di detection di
// sicurezza, e' detection vecchia dichiarata aggiornata: la stessa classe di
// falso verde che `L-COL-006` vieta agli oracoli, spostata nell'ULTIMO MIGLIO.
//
// E' `L-COL-035` applicato alla distribuzione: un artefatto che nessuno puo'
// RICEVERE non e' spedito, esattamente come un gate che nessuno esegue non e' un
// verde.
//
// CONTRATTO VERIFICATO QUI (esiti, non implementazione):
//   (1) absent:declared-skip   record assente  -> emette, ma DICHIARA che il
//                              controllo non e' applicabile (mai un verde muto:
//                              e' il caso dell'utente che ri-pacchettizza dal suo
//                              install, dove il record del nostro repo non c'e').
//   (2) unrecorded:red         versione mai registrata -> RIFIUTA di emettere e
//                              dice come registrarla (`--record-release`).
//   (3) record-release:writes  con `--record-release` registra <versione, digest>
//                              e procede.
//   (4) match:green            contenuto invariato + versione registrata -> verde.
//   (5) drift:red              digest registrato DIVERSO dal contenuto (= albero
//                              cambiato senza bump) -> RIFIUTA di emettere.
//   (6) default:real-record    col record REALE del repo, senza env, -> verde.
//   (7) digest:deterministic   due registrazioni dello stesso albero danno lo
//                              stesso digest (niente timestamp/ordine di FS).
//
// FALSIFICABILITA': neutralizzando il confronto dei digest in `package_skill`,
// (5) e (2) DEVONO diventare verdi -> questo keystone fallisce. Non e' un timbro.
//
// Radice temp PRIVATA per-pid con GUARDIA DI PROPRIETA' (pattern BD-1/H-1): se la
// radice e' EREDITATA appartiene al padre e non la spazziamo noi.
//
// Node ESM, solo built-in. Esce 0 sse TUTTI i sotto-test passano; 1 se un
// sotto-test e' rosso; 2 se manca una PRECONDIZIONE (mai un falso verde, mai un
// falso rosso).

import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, rmSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const PACKAGER = resolve(ROOT, 'trueline', 'scripts', 'packaging', 'package_skill.mjs');
const REAL_RECORD = resolve(ROOT, 'RELEASE-DIGESTS.json');
const SKILL_PKG = resolve(ROOT, 'trueline', 'package.json');

// PROPRIETA' della radice: e' NOSTRA solo se l'abbiamo creata noi (env ASSENTE
// all'avvio). Ereditata = siamo un figlio, sotto ci sono le copie VIVE del padre.
const TMP_ROOT_INHERITED = Boolean(process.env.TRUELINE_TMP_VERIFY_ROOT);
const TMP_ROOT = TMP_ROOT_INHERITED
  ? resolve(process.env.TRUELINE_TMP_VERIFY_ROOT)
  : resolve(ROOT, 'eval', `.tmp-relbump-${process.pid}`);

const rel = (p) => String(p).replace(ROOT, '').replace(/^[\\/]/, '').replace(/\\/g, '/');

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
function precondAbort(reason) {
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('=== RELEASE-BUMP: PRECONDIZIONE MANCANTE (exit 2) ===');
  console.log(`    ${reason}`);
  console.log('    Un controllo NON ESEGUITO non e\' un verde (L-COL-006).');
  console.log('------------------------------------------------------------');
  cleanTmp();
  process.exit(2);
}

// SOLO IL PROPRIETARIO SPAZZA: mai la radice di un altro processo. Never-throw:
// un fallimento ambientale non deve diventare un rosso di merito.
function cleanTmp() {
  if (TMP_ROOT_INHERITED) return;
  try {
    if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true, maxRetries: 4, retryDelay: 60 });
  } catch { /* ambientale: si tollera una radice residua */ }
}

let __n = 0;
// Esegue il packager verso una destinazione temporanea. `record` (path) finisce
// nell'env override; `extra` sono flag aggiuntivi.
function runPackager({ record, extra = [] }) {
  __n += 1;
  const out = join(TMP_ROOT, `emit-${__n}`);
  const env = { ...process.env };
  if (record === null) delete env.TRUELINE_RELEASE_DIGESTS;
  else env.TRUELINE_RELEASE_DIGESTS = record;
  const res = spawnSync(process.execPath, [PACKAGER, '--out', out, ...extra], {
    cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: res.status,
    out: `${res.stdout || ''}${res.stderr || ''}`,
    error: res.error,
    dest: out,
  };
}

function readRecord(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function currentVersion() {
  // Stessa risoluzione di skillSemver(): skill_version, poi version (>0.0.0),
  // poi il default documentato. Replicata QUI di proposito: se il packager
  // cambiasse regola in silenzio, il keystone se ne accorgerebbe.
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(SKILL_PKG, 'utf8')); } catch { /* default sotto */ }
  if (typeof pkg.skill_version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.skill_version)) return pkg.skill_version;
  if (typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version) && pkg.version !== '0.0.0') return pkg.version;
  return '0.1.0';
}

function main() {
  console.log('============================================================');
  console.log(' KEYSTONE RELEASE-BUMP — un albero SPEDITO che cambia senza bump');
  console.log(' NON dev\'essere emettibile (L-COL-035 applicato alla distribuzione)');
  console.log(`   repo root : ${ROOT}`);
  console.log(`   radice tmp: ${rel(TMP_ROOT)}`);
  console.log('============================================================');

  if (!existsSync(PACKAGER)) precondAbort(`packager assente: ${rel(PACKAGER)}`);
  cleanTmp();
  try { mkdirSync(TMP_ROOT, { recursive: true }); }
  catch (e) { precondAbort(`radice temp non creabile (${rel(TMP_ROOT)}): ${e.message}`); }

  const VERSION = currentVersion();
  console.log('');
  console.log(`[PASS] precondizione: packager presente; versione risolta = ${VERSION}`);

  // --- (1) record ASSENTE -> emette ma DICHIARA la non-applicabilita' --------
  console.log('');
  console.log('(1) absent:declared-skip — record assente: emette, ma lo DICHIARA (mai un verde muto):');
  const missingPath = join(TMP_ROOT, 'record-che-non-esiste.json');
  const r1 = runPackager({ record: missingPath });
  const dichiara = /non applicabile|record .*assent/i.test(r1.out);
  assert('absent:declared-skip', r1.status === 0 && dichiara,
    r1.status !== 0
      ? `exit=${r1.status} (un record assente NON deve bloccare chi ri-pacchettizza dal proprio install)`
      : (dichiara ? 'emesso con non-applicabilita\' DICHIARATA' : 'emesso in SILENZIO: verde muto (L-COL-006)'));

  // --- (2) versione MAI registrata -> rifiuta e spiega ----------------------
  console.log('');
  console.log('(2) unrecorded:red — versione mai registrata: RIFIUTA di emettere e dice come registrarla:');
  const emptyPath = join(TMP_ROOT, 'record-vuoto.json');
  writeFileSync(emptyPath, '{}\n', 'utf8');
  const r2 = runPackager({ record: emptyPath });
  const spiega = /--record-release/.test(r2.out);
  assert('unrecorded:red', r2.status !== 0 && spiega,
    r2.status === 0
      ? 'EMESSO con versione mai registrata: il controllo non morde'
      : (spiega ? `rifiutato (exit=${r2.status}) indicando --record-release` : `rifiutato (exit=${r2.status}) ma SENZA dire come registrarla`));

  // --- (3) --record-release registra <versione, digest> e procede -----------
  console.log('');
  console.log('(3) record-release:writes — registra <versione, digest> e procede:');
  const r3 = runPackager({ record: emptyPath, extra: ['--record-release'] });
  const rec3 = readRecord(emptyPath);
  const dig3 = rec3 && typeof rec3[VERSION] === 'string' ? rec3[VERSION] : null;
  const digestSano = Boolean(dig3) && /^[0-9a-f]{64}$/.test(dig3);
  assert('record-release:writes', r3.status === 0 && digestSano,
    r3.status !== 0
      ? `exit=${r3.status} con --record-release`
      : (digestSano ? `registrato ${VERSION} -> ${dig3.slice(0, 12)}…` : `record non scritto o digest non valido (${dig3})`));

  // --- (4) contenuto invariato + versione registrata -> verde ---------------
  console.log('');
  console.log('(4) match:green — contenuto invariato e versione registrata: emette senza flag:');
  const r4 = runPackager({ record: emptyPath });
  assert('match:green', r4.status === 0,
    r4.status === 0 ? 'emesso (digest coincide col registrato)' : `exit=${r4.status}: un contenuto invariato NON deve essere rifiutato`);

  // --- (7) determinismo del digest (registrato prima di sporcare il record) --
  console.log('');
  console.log('(7) digest:deterministic — due registrazioni dello stesso albero danno lo stesso digest:');
  const bisPath = join(TMP_ROOT, 'record-bis.json');
  writeFileSync(bisPath, '{}\n', 'utf8');
  const r7 = runPackager({ record: bisPath, extra: ['--record-release'] });
  const rec7 = readRecord(bisPath);
  const dig7 = rec7 && typeof rec7[VERSION] === 'string' ? rec7[VERSION] : null;
  assert('digest:deterministic', r7.status === 0 && Boolean(dig7) && dig7 === dig3,
    dig7 && dig3
      ? (dig7 === dig3 ? `stesso digest su due run (${dig7.slice(0, 12)}…)` : `DIGEST DIVERSI: ${dig3.slice(0, 12)}… vs ${dig7.slice(0, 12)}… (non deterministico)`)
      : `digest non registrato (exit=${r7.status})`);

  // --- (5) DRIFT: digest registrato diverso dal contenuto -> rifiuta --------
  console.log('');
  console.log('(5) drift:red — albero cambiato senza bump (digest registrato diverso): RIFIUTA di emettere:');
  writeFileSync(emptyPath, `${JSON.stringify({ [VERSION]: 'f'.repeat(64) }, null, 2)}\n`, 'utf8');
  const r5 = runPackager({ record: emptyPath });
  const nominaIlBump = /bump|versione|skill_version/i.test(r5.out);
  assert('drift:red', r5.status !== 0 && nominaIlBump,
    r5.status === 0
      ? 'EMESSO con digest divergente: e\' il difetto del 28 lug, non corretto'
      : (nominaIlBump ? `rifiutato (exit=${r5.status}) nominando il bump` : `rifiutato (exit=${r5.status}) ma senza spiegare che serve un bump`));

  // --- (8) il controllo NON deve mascherare un lint rosso -------------------
  //   Regressione REALE colta dal gate m5 (28 lug 2026): con --inject-missing-ref
  //   l'albero e' mutato APPOSTA per provare che il lint e' falsificabile, quindi
  //   il digest diverge per costruzione. Se il release-guard girasse comunque,
  //   uscirebbe 2 al posto dell'1 del lint e nasconderebbe il fallimento che m5
  //   sta misurando. Il guard gata l'EMISSIONE: a lint rosso non c'e' nulla da
  //   gatare.
  console.log('');
  console.log('(8) lint-red:not-masked — a lint ROSSO il controllo non deve rubare l\'esito al lint:');
  const r8 = runPackager({ record: emptyPath, extra: ['--inject-missing-ref'] });
  assert('lint-red:not-masked', r8.status === 1,
    r8.status === 1
      ? 'exit=1 (esito del LINT, non del release-guard)'
      : `exit=${r8.status}: il release-guard ha mascherato il lint rosso (m5 lo vede come pacchetto-rotto-non-bocciato)`);

  // --- (6) record REALE del repo, nessun env -> verde -----------------------
  console.log('');
  console.log('(6) default:real-record — col record REALE del repo (nessun env): deve essere verde:');
  if (!existsSync(REAL_RECORD)) {
    assert('default:real-record', false, `${rel(REAL_RECORD)} assente: la release corrente non e' registrata nel repo`);
  } else {
    const r6 = runPackager({ record: null });
    assert('default:real-record', r6.status === 0,
      r6.status === 0
        ? `emesso col record versionato (${rel(REAL_RECORD)})`
        : `exit=${r6.status}: l'albero SPEDITO e' cambiato senza bump — bumpa skill_version e ri-registra`);
  }

  // --- esito ---------------------------------------------------------------
  cleanTmp();
  const passed = checks.filter((c) => c.ok).length;
  const allOk = passed === checks.length;
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(`=== KEYSTONE RELEASE-BUMP RESULT: ${allOk ? 'PASS' : 'FAIL'} ===`);
  if (!allOk) console.log(`    sotto-test ROSSI: ${checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`);
  console.log(`release_bump_check: ${passed}/${checks.length} PASS`);
  console.log('------------------------------------------------------------');
  process.exit(allOk ? 0 : 1);
}

main();
