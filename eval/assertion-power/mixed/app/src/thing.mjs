// SPECIMEN — NON e' un difetto da correggere.
// Gemello di eval/assertion-power/unresolved/app/src/thing.mjs: l'initializer e' una
// CHIAMATA, forma che il neutralizzatore non sa rendere inerte. Serve a mettere un
// candidato STRUCTURAL accanto a uno aggiudicabile, nello stesso target_test.
// Consumato da: eval/harness/assertion_power_check.mjs -> sotto-test `mixed:green-with-declared`.
// Correggerlo (es. inlinando `{ k: 1 }`) renderebbe ROSSO il keystone.
function make() { return { k: 2 }; }
export const thing = make();
