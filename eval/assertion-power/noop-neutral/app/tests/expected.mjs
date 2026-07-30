// SPECIMEN — NON e' un difetto da correggere.
// Questo export e' DELIBERATAMENTE gia' nella forma inerte (`{}`): neutralizeExport lo
// riscriverebbe identico a se stesso, quindi non c'e' mutazione da cui trarre un verdetto.
// E' il ramo `mutated === src` di assertionPower, che deve dichiarare STRUCTURAL e NON
// scrivere nulla sul disco.
// Perche' e' load-bearing: e' la porta d'ingresso del falso verde di CR-1 (30/07/2026).
// Quando un ripristino fallisce, il file dell'utente resta neutralizzato e al giro dopo
// l'oracolo lo rilegge GIA' in questa forma — imboccando esattamente questo ramo e
// convertendo un albero guasto in una dichiarazione benigna. Il ramo in se' e' corretto e
// va coperto; a impedire l'abuso e' il flag d'albero sporco, coperto altrove.
// Consumato da: eval/harness/assertion_power_check.mjs -> sotto-test `noop-neutralization:declared`
//   e trueline/scripts/blueprint/ac_assertion_power_check.test.mjs.
// Riempirlo di valori renderebbe ROSSO il keystone.
export const EXPECTED_REGISTRY = {};
