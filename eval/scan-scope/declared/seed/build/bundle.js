// FIXTURE `declared` — ARTEFATTO DI BUILD (classe A del PLAN §1).
//
// Bundle "prodotto" da un build: NON e' sorgente d'autore. Contiene lo STESSO literal
// di `src/app.ts` perche' il build lo ha inlinato. Bersaglio del sotto-test (1)
// `generated:not-scanned` (pattern `build/**` di provenienza `manifest`) e del
// sotto-test (10) `loop:seed-file-never-excluded` (quando E' il file sotto fix, lo
// scope NON deve poterlo nascondere: un `verified` gratis sarebbe un falso verde).
(function () {
  var e = { apiKey: 'tlfix_7b4e21c9a0d83f56be1740c9d2385a6f' };
  function t(n) { return 'charge:' + n + ':' + e.slice(0, 8); }
  module.exports = { charge: t };
}());
