// FIXTURE `undeclared` — artefatto di build in un progetto SENZA dichiarazioni.
//
// E' il pezzo che rende NON VACUO il sotto-test (11): il path `build/bundle.js` e'
// esattamente quello che il manifest d'ecosistema escluderebbe. Se un giorno una
// esclusione di DEFAULT si intrufolasse nel modulo (`DEFAULT_SCAN_EXCLUDE` non piu'
// vuoto), questo finding sparirebbe e la BIT-invarianza cadrebbe qui, subito, invece
// che tre progetti utente piu' in la'.
(function () {
  var e = { apiKey: 'tlfix_3c8f5a1e94b70d26cf83e15b7a4092d6' };
  module.exports = { key: e };
}());
