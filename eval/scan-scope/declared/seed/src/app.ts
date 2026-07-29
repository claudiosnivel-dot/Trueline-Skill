// FIXTURE `declared` — sorgente D'AUTORE.
//
// Questo file e' il CONTROLLO del sotto-test (3) `source:still-found`: contiene lo
// STESSO identico literal che vive in `build/bundle.js` e in `.next/static/chunks/`.
// L'unica variabile fra i tre e' il PATH. Se lo scope di scansione fosse troppo largo,
// questo finding sparirebbe insieme agli altri due e l'oracolo diventerebbe un timbro.
//
// Il valore e' SINTETICO (inventato per la fixture): non e' una credenziale reale di
// nessuno, ed e' costruito per accendere `trueline-stripe-like-key` in modo
// DETERMINISTICO (nessuna soglia di entropia di mezzo).

export const paymentsApiKey = 'tlfix_7b4e21c9a0d83f56be1740c9d2385a6f';

export function charge(amountCents: number): string {
  return `charge:${amountCents}:${paymentsApiKey.slice(0, 8)}`;
}
