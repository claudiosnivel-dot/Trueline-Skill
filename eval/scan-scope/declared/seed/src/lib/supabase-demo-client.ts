// FIXTURE `declared` — CHIAVE DEMO DELLO STACK LOCALE (classe D del PLAN §1, §2).
//
// I due token di questo file e del gemello `supabase-cloud-client.ts` sono COSTRUITI PER
// LA FIXTURE, non copiati da nessun progetto: header/payload/firma in base64url, con una
// FIRMA che e' un blob inventato. Decodificati, i payload sono:
//   qui:      {"iss":"supabase-demo","role":"anon","iat":1750000000,"exp":2060000000}
//   gemello:  {"iss":"supabase","ref":"...","role":"anon","iat":...,"exp":...}
// L'unica differenza sostanziale e' il claim `iss` — che e' il punto: `supabase-demo` e'
// il marchio della costante pubblica che ogni `supabase start` produce identica per
// tutti (PLAN §2: stesso valore in 3 progetti indipendenti => non e' un segreto DI
// progetto), `supabase` e' un progetto cloud reale.
//
// SOTTO-TEST (5) `demo-key:not-flagged`. LA LEVA 2 E' CAUSALMENTE NECESSARIA — misurato
// per differenza il 2026-07-29, stesso file, stesso gitleaks, due sole config:
//   `git show HEAD:trueline/scripts/oracles/gitleaks.toml` (SENZA la leva 2)
//        -> jwt@34, stripe-access-token@31, trueline-stripe-like-key@31
//   `trueline/scripts/oracles/gitleaks.toml` ATTUALE (CON la leva 2)
//        ->        stripe-access-token@31, trueline-stripe-like-key@31
// Il finding `jwt` della riga 34 esiste senza la leva 2 e sparisce SOLO con essa.
// Quindi (5) NON e' un'ancora di non-regressione e NON e' vacuo: e' un rosso che
// diventa verde, e l'unica cosa che lo rende verde e' la `[[allowlists]]` di Trueline.
//
// CORREZIONE STORICA (L-COL-006, tenuta a memoria di come si sbaglia): una nota
// precedente in questo stesso file affermava il contrario — «il token demo non produce
// gia' oggi alcun finding, la soppressione viene dall'allowlist GLOBALE DI DEFAULT di
// gitleaks». Era falso e verificabile in 10 secondi col comando qui sopra. Chi l'avesse
// creduto avrebbe rimosso la `[[allowlists]]` convinto che fosse inerte, riaprendo la
// classe D del rumore. Un fatto scritto dentro materiale di gate va MISURATO, non
// ricordato.
//
// FLOOR ANTI-VACUO — senza, "nessun finding" potrebbe voler dire "il file non e' stato
// nemmeno guardato": la riga CONTROLLO qui sotto porta un segreto che DEVE essere
// segnalato. Il sotto-test (5) pretende: 0 finding sulla riga del token demo E >= 1
// finding sulla riga di controllo, nello STESSO file.

export const SUPABASE_URL = 'http://127.0.0.1:54321';

// CONTROLLO (floor anti-vacuo di (5)): valore sintetico, deve restare ROSSO.
export const legacyPaymentsApiKey = 'tlfix_7b4e21c9a0d83f56be1740c9d2385a6f';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwMDAwMDAsImV4cCI6MjA2MDAwMDAwMH0.dGhpcy1pcy1ub3QtYS1yZWFsLXNpZ25hdHVyZS1maXh0dXJl';

export function localClientConfig() {
  return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
}
