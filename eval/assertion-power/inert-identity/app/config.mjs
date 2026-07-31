// SPECIMEN — NON e' un difetto da correggere.
// Questo modulo e' DELIBERATAMENTE derivato: `colors` viene assegnato per RIFERIMENTO,
// quindi config.theme.extend.colors E' lo stesso oggetto di tokens.colors — ed e' cio'
// che rende inerte l'asserzione in tests/tokens.test.mjs.
// E' il caso misurato il 30/07/2026 su progetto-web-ai, ridotto al minimo.
// Consumato da: eval/harness/assertion_power_check.mjs -> sotto-test `inert:detected`.
// Correggerlo (es. clonando l'oggetto) renderebbe ROSSO il keystone.
import { colors } from './src/tokens.mjs';
// La config DERIVA dai token: stesso oggetto, assegnato per riferimento.
export const config = { theme: { extend: { colors } } };
