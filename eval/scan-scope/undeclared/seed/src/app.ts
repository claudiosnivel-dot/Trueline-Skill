// FIXTURE `undeclared` — sorgente d'autore di un progetto che NON dichiara nulla.
//
// Serve al sotto-test (11) `no-declaration:bit-invariant`: senza dichiarazioni
// (`DEFAULT_SCAN_EXCLUDE = []`, nessun `.trueline/scan-scope.json`, nessun manifest
// passato) l'insieme dei finding dev'essere BYTE-IDENTICO a quello di oggi. E' cio' che
// rende `m5` 56/56 e i 16 `verify_fix_check` non-regressivi PER COSTRUZIONE, invece che
// per fortuna.
//
// Valore SINTETICO.

export const paymentsApiKey = 'tlfix_3c8f5a1e94b70d26cf83e15b7a4092d6';

export function charge(amountCents: number): string {
  return `charge:${amountCents}`;
}
