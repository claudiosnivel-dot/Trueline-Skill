import { limit } from './pool.mjs';
// Costante PROPRIA, non derivata: puo' divergere, ed e' questo che il test verifica.
export const DOCUMENT_LIMITS = { error_issues: 24 };
export function apply(v) { return limit(v); }
