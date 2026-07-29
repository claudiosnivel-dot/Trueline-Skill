// FIXTURE `declared` — CHIAVE DI UN PROGETTO CLOUD REALE (PLAN §2, terza riga della
// tabella: `iss=supabase`, trovata in UN SOLO progetto — quindi NON una costante
// d'ecosistema, quindi non allowlistabile).
//
// Token COSTRUITO PER LA FIXTURE: stesso header e stessa firma-blob del gemello demo,
// stesso `role`, stesso ordine dei claim. L'UNICA differenza sostanziale e' `iss`:
//     {"iss":"supabase","ref":"qtzkmnprvxwabcdefghi","role":"anon","iat":...,"exp":...}
//
// SOTTO-TEST (6) `real-key:still-found` — l'ANTI-VACUITA' della leva 2, ed e' qui che la
// leva puo' davvero rompersi: un'allowlist scritta su "i JWT", su `role=anon` o su
// "qualunque token che nomina supabase" farebbe sparire anche questo. Decidere che una
// anon key di produzione non vada segnalata non e' una decisione da prendere dentro
// un'allowlist (PLAN §2). Misurato il 2026-07-28: questo token PRODUCE un finding `jwt`
// con la config spedita — (6) e' rosso-capace, non decorativo.

export const SUPABASE_URL = 'https://qtzkmnprvxwabcdefghi.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0emttbnBydnh3YWJjZGVmZ2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwMDAwMDAsImV4cCI6MjA2MDAwMDAwMH0.dGhpcy1pcy1ub3QtYS1yZWFsLXNpZ25hdHVyZS1maXh0dXJl';

export function cloudClientConfig() {
  return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
}
