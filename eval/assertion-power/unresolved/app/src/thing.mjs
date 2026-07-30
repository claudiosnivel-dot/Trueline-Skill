// SPECIMEN — NON e' un difetto da correggere.
// Questo export e' DELIBERATAMENTE in una forma che il neutralizzatore NON sa trattare:
// l'initializer di `thing` e' una CHIAMATA, non un letterale, quindi il candidato
// [mirror vs thing] non e' aggiudicabile e dev'essere DICHIARATO irrisolto, mai inerte.
// E' la forma con cui si prova che l'oracolo non finge di sapere (L-COL-006).
// Consumato da: eval/harness/assertion_power_check.mjs -> sotto-test `unresolved:declared`
// e `unresolved-only:degraded`.
// Correggerlo (es. inlinando `{ k: 1 }`) renderebbe ROSSO il keystone.
function make() { return { k: 1 }; }
// FORMA NON RICONOSCIUTA dal neutralizzatore: initializer che e' una chiamata.
export const thing = make();
