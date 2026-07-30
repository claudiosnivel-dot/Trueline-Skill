// SPECIMEN — NON e' un difetto da correggere, e la chmod non e' un residuo di debug.
//
// GEMELLO di eval/assertion-power/inert-identity, con una sola aggiunta: il modulo del
// lato atteso viene reso NON SCRIVIBILE mentre l'oracolo lo tiene neutralizzato, cosi'
// il write di RIPRISTINO fallisce EPERM. E' la riproduzione FEDELE — senza iniettare
// nulla nel prodotto — del guasto di I/O misurato il 30/07/2026: un antivirus o un handle
// ancora aperto su Windows fanno esattamente questo.
//
// L'asserzione e' DELIBERATAMENTE tautologica (config importa `colors` per riferimento),
// ed e' load-bearing: solo cosi' il file resta VERDE anche a token azzerati, che e' la
// condizione senza la quale il falso verde di CR-1 non si manifesta.
//
// PERCHE' LA CHMOD E' CONDIZIONATA. Il controllo 4 esegue i target_test una prima volta
// per verificarne il verde, PRIMA di chiamare l'oracolo. Bloccando il file sempre, a
// fallire sarebbe il write di MUTAZIONE (un guasto diverso, coperto altrove). Si blocca
// percio' solo quando `colors` e' gia' vuoto, cioe' solo dentro il run neutralizzato.
//
// COSA DEVE SUCCEDERE: controllo 4 `error` al primo tentativo E A TUTTI I SUCCESSIVI.
// run_checkpoint.mjs rilancia l'intero checkpoint finche' un controllo esce 'error'; senza
// il flag d'albero sporco il secondo giro rileggeva tokens.mjs GIA' neutralizzato, trovava
// la neutralizzazione no-op, la dichiarava structural benigno e usciva VERDE — cioe' la
// stessa asserzione tautologica che l'oracolo esiste per prendere passava da ROSSO a VERDE
// per un guasto di I/O transitorio (CR-1, 30/07/2026).
//
// Consumato da: eval/harness/assertion_power_check.mjs -> sotto-test
//   `dirty-tree:no-green-on-retry`. Il keystone rimette i permessi dopo il sotto-test.
// Togliere la chmod, o rendere onesta l'asserzione, renderebbe quel sotto-test verde
// senza aver provato niente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.mjs';
import { colors } from '../src/tokens.mjs';

if (Object.keys(colors).length === 0) {
  chmodSync(fileURLToPath(new URL('../src/tokens.mjs', import.meta.url)), 0o444);
}

// covers: AC-1
test('la theme deriva dai token', () => {
  assert.deepEqual(config.theme.extend.colors, colors);
});
