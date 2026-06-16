#!/usr/bin/env node
// =============================================================================
// triage.test.mjs — self-test del modulo 08 (triage/spiegazione + policy FP).
//
// Verifica le proprieta' che 08 / L-COL-028 / L-COL-002 richiedono, con finding
// SINTETICI deterministici (nessun oracolo, nessuna rete, nessun git):
//
//   A) ORDINE STABILE & SPIETATO (08 §3): la prioritizzazione e' deterministica
//      (idempotente, indipendente dall'ordine di input), mette in cima secret /
//      nuovo&sopra-soglia / in-scope e affonda pre-existing/advisory; NON tocca
//      severity/category.
//   B) FP FLAGGATO-NON-SCARTATO (08 §5, L-COL-028): un sospetto-FP CON evidenza
//      e' flaggato + ottiene una proposta di allowlist ben formata, MA resta nel
//      modello (non rimosso, severity/category/fix_state invariati). Senza
//      evidenza concreta NON e' un flag-FP (nel-dubbio-si-tiene).
//   C) VERO POSITIVO MAI LIQUIDATO (08 §5, eval 10 §8): un vero positivo seminato
//      (S6 injection, S7 authz) non viene mai marcato sospetto-FP dal meccanismo
//      e resta in cima/visibile.
//   D) SPIEGAZIONE ONESTA (08 §4): cita uno standard nominato, mai dice "sicuro",
//      e' proporzionata, prende la direzione-fix da remediation_hint.
//
// Esce 0 se tutto passa, 1 altrimenti. Node ESM, solo built-in.
// =============================================================================

import { fileURLToPath } from 'node:url';

import { prioritize, priorityOrder } from './prioritize.mjs';
import { applyFpPolicy, flagSuspectedFp, isSuspectedFp, validateEvidence } from './fp_policy.mjs';
import { explainFinding } from './explain.mjs';

const __filename = fileURLToPath(import.meta.url);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// -----------------------------------------------------------------------------
// FINDING SINTETICI (finding model 04). Coprono i casi che contano:
//   F_SECRET  : secret, CRITICAL, new, in-scope          -> deve stare in cima
//   F_INJ (S6): injection, HIGH, new, in-scope, CWE-89    -> vero positivo
//   F_AUTHZ(S7): authz, HIGH, new, in-scope, CWE-862      -> vero positivo
//   F_RLS     : rls, HIGH, new, out-of-scope              -> killer ma out-of-scope
//   F_DEAD_FP : dead-code, LOW, new (knip)                -> sospetto-FP plausibile
//   F_DEPADV  : dependency-vuln, MEDIUM, pre-existing     -> advisory in coda
// -----------------------------------------------------------------------------
const F_SECRET = {
  fingerprint: 'fp-secret-0001', category: 'secret', severity: 'CRITICAL',
  location: { file: 'eval/reference-app/src/lib/config.ts', start_line: 12, end_line: 12, symbol: 'SUPABASE_SERVICE_ROLE_KEY' },
  evidence: 'Segreto rilevato dalla regola "generic-api-key". Valore REDATTO (mai in chiaro).',
  source_oracle: { oracle: 'gitleaks', rule_id: 'generic-api-key' },
  owasp: 'A07:2025', cwe: 'CWE-798',
  fix_state: 'detected', baseline_status: 'new', scope_relevance: 'in-scope', run_id: 'triage-test',
  remediation_hint: 'Rimuovere il segreto dal sorgente, ruotare la credenziale e leggerla da env.',
};
const F_INJ = {
  fingerprint: 'fp-inj-0006', category: 'injection', severity: 'HIGH',
  location: { file: 'eval/reference-app/src/db.ts', start_line: 40, end_line: 40 },
  evidence: 'PLACEHOLDER: possibile costruzione di SQL per concatenazione di stringhe.',
  source_oracle: { oracle: 'semgrep', rule_id: 'sql-string-concat' },
  owasp: 'A05:2025', cwe: 'CWE-89',
  fix_state: 'detected', baseline_status: 'new', scope_relevance: 'in-scope', run_id: 'triage-test',
};
const F_AUTHZ = {
  fingerprint: 'fp-authz-0007', category: 'authz', severity: 'HIGH',
  location: { file: 'eval/reference-app/src/routes/bookings.ts', start_line: 22, end_line: 28 },
  evidence: 'Route mutante con service_role senza check di identita/ruolo.',
  source_oracle: { oracle: 'semgrep', rule_id: 'authz-missing-mutation' },
  owasp: 'A01:2025', cwe: 'CWE-862',
  fix_state: 'detected', baseline_status: 'new', scope_relevance: 'in-scope', run_id: 'triage-test',
};
const F_RLS = {
  fingerprint: 'fp-rls-0003', category: 'rls', severity: 'HIGH',
  location: { file: 'eval/reference-app/supabase/migrations/0001_init.sql', start_line: 63, end_line: 63, symbol: 'public.audit_logs' },
  evidence: 'Controllo RLS RLS001_MISSING_RLS su public.audit_logs',
  source_oracle: { oracle: 'rls-check', rule_id: 'RLS001_MISSING_RLS' },
  owasp: 'A01:2025', cwe: 'CWE-285',
  fix_state: 'detected', baseline_status: 'new', scope_relevance: 'out-of-scope', run_id: 'triage-test',
};
const F_DEAD = {
  fingerprint: 'fp-dead-0008', category: 'dead-code', severity: 'LOW',
  location: { file: 'eval/reference-app/src/legacy/unused.ts', start_line: 5, end_line: 5, symbol: 'formatLegacyBookingLabel' },
  evidence: 'Simbolo non utilizzato (unused-export): formatLegacyBookingLabel.',
  source_oracle: { oracle: 'knip', rule_id: 'unused-export' },
  fix_state: 'detected', baseline_status: 'new', scope_relevance: 'in-scope', run_id: 'triage-test',
  remediation_hint: 'Rimuovere il codice morto (previo gate umano).',
};
const F_DEPADV = {
  fingerprint: 'fp-dep-0009', category: 'dependency-vuln', severity: 'MEDIUM',
  location: { file: 'eval/reference-app/package-lock.json', start_line: 0, end_line: 0, symbol: 'left-pad@1.0.0' },
  evidence: 'CVE-fittizio in left-pad@1.0.0 [npm].',
  source_oracle: { oracle: 'osv-scanner', rule_id: 'CVE-FAKE-0001' },
  owasp: 'A03:2025', owasp_source: 'A06:2021', cwe: 'CWE-1104',
  fix_state: 'detected', baseline_status: 'pre-existing', scope_relevance: 'out-of-scope', run_id: 'triage-test',
  remediation_hint: 'Aggiornare left-pad a una versione non vulnerabile.',
};

const ALL = [F_DEPADV, F_DEAD, F_RLS, F_AUTHZ, F_INJ, F_SECRET]; // ordine "sporco" di input

console.log('=== triage.test — 08 §3/§4/§5 (L-COL-028, L-COL-002) ===\n');

// -----------------------------------------------------------------------------
// A) ORDINE STABILE & SPIETATO
// -----------------------------------------------------------------------------
console.log('A) prioritizzazione (08 §3)');
const ordered = prioritize(ALL);
const order = ordered.map((f) => f.fingerprint);

// A1: secret in cima (blocca-sempre).
check('A1 secret in cima', order[0] === F_SECRET.fingerprint, `cima=${order[0]}`);

// A2: i due veri positivi in-scope (S6/S7) stanno sopra l'advisory pre-existing e
//     sopra il dead-code LOW; il dep advisory pre-existing e' ULTIMO.
const idx = (fp) => order.indexOf(fp);
check('A2 S6/S7 sopra advisory pre-existing', idx(F_INJ.fingerprint) < idx(F_DEPADV.fingerprint) && idx(F_AUTHZ.fingerprint) < idx(F_DEPADV.fingerprint), order.join(' > '));
check('A3 advisory pre-existing in coda (ultimo)', order[order.length - 1] === F_DEPADV.fingerprint, `coda=${order[order.length - 1]}`);

// A4: out-of-scope rls killer affonda sotto gli in-scope di pari severita'.
check('A4 in-scope sopra out-of-scope di pari severita', idx(F_INJ.fingerprint) < idx(F_RLS.fingerprint), `inj@${idx(F_INJ.fingerprint)} rls@${idx(F_RLS.fingerprint)}`);

// A5: DETERMINISMO — idempotente e indipendente dall'ordine di input.
const order2 = priorityOrder([...ALL].reverse());
const order3 = priorityOrder(ALL);
check('A5 ordine deterministico (input-order-independent)', JSON.stringify(order2) === JSON.stringify(order3), JSON.stringify(order3));
const orderTwice = priorityOrder(prioritize(ALL));
check('A6 idempotente (ri-prioritizzare non cambia ordine)', JSON.stringify(orderTwice) === JSON.stringify(order), 'ok');

// A7: NON e' un re-scoring — severity/category invariati per ogni finding.
const severityIntact = ordered.every((f) => {
  const orig = ALL.find((o) => o.fingerprint === f.fingerprint);
  return f.severity === orig.severity && f.category === orig.category;
});
check('A7 severity/category invariati (no re-scoring)', severityIntact);

// A8: l'input originale NON e' mutato (funzione pura).
check('A8 input non mutato (pura)', ALL.every((f) => !('notes' in f) || f.notes === undefined), 'inputs senza notes scritte');

// -----------------------------------------------------------------------------
// B) FP FLAGGATO-NON-SCARTATO
// -----------------------------------------------------------------------------
console.log('\nB) policy falsi positivi (08 §5, L-COL-028)');

// B1: dead-code FP con evidenza concreta -> flaggato + allowlist proposta.
const fpEvidence = { kind: 'framework-entrypoint', detail: 'referenziato dinamicamente dal router del framework', locator: 'eval/reference-app/src/routes/index.ts:1' };
const fpRes = applyFpPolicy(F_DEAD, fpEvidence);
check('B1 sospetto-FP flaggato (con evidenza)', fpRes.flagged === true && isSuspectedFp(fpRes.finding), fpRes.reason);
check('B2 proposta di allowlist ben formata', fpRes.allowlistProposal && fpRes.allowlistProposal.target === 'knip' && fpRes.allowlistProposal.requiresHumanApproval === true && /knip\.json/.test(fpRes.allowlistProposal.path), JSON.stringify(fpRes.allowlistProposal && { t: fpRes.allowlistProposal.target, p: fpRes.allowlistProposal.path }));

// B3: NON rimosso, NON ri-scorato, NON marcato risolto.
check('B3 finding NON rimosso (resta nel modello)', Boolean(fpRes.finding));
check('B4 severity/category/fix_state invariati', fpRes.finding.severity === F_DEAD.severity && fpRes.finding.category === F_DEAD.category && fpRes.finding.fix_state === F_DEAD.fix_state);

// B5: senza evidenza concreta NON e' un flag-FP (nel-dubbio-si-tiene).
const noEv = applyFpPolicy(F_DEAD, { kind: 'opinion', detail: 'mi sembra ok', locator: '' });
check('B5 senza evidenza concreta NON flagga', noEv.flagged === false && !isSuspectedFp(noEv.finding) && noEv.allowlistProposal === null, noEv.reason);

// B6: evidenza vuota -> validateEvidence rifiuta.
check('B6 validateEvidence rifiuta evidenza vuota', validateEvidence({}).ok === false);

// B7: gitleaks FP -> proposta .gitleaks.toml ben formata (es. segreto-fixture di test).
const glFpEvidence = { kind: 'test-fixture', detail: 'chiave finta in una fixture di test, non una credenziale reale', locator: 'eval/reference-app/test/fixtures/fake-keys.ts:3' };
const glProp = flagSuspectedFp(F_SECRET, glFpEvidence);
const glAllow = applyFpPolicy(F_SECRET, glFpEvidence).allowlistProposal;
check('B7 gitleaks FP -> .gitleaks.toml proposto', glAllow && glAllow.target === 'gitleaks' && /\.gitleaks\.toml/.test(glAllow.path) && /\[\[allowlist\]\]/.test(glAllow.snippet), glAllow && glAllow.path);
check('B8 anche un secret flaggato-FP NON e\' rimosso/risolto', glProp.flagged === true && glProp.finding.fix_state === 'detected' && glProp.finding.severity === 'CRITICAL');

// -----------------------------------------------------------------------------
// C) VERO POSITIVO MAI LIQUIDATO
// -----------------------------------------------------------------------------
console.log('\nC) veri positivi mai liquidati (08 §5, eval 10 §8)');

// C1: il meccanismo non flagga MAI da solo: senza una chiamata esplicita CON
//     evidenza, S6/S7 NON sono sospetti-FP. La prioritizzazione non li flagga.
const prioritized = prioritize(ALL);
const s6 = prioritized.find((f) => f.fingerprint === F_INJ.fingerprint);
const s7 = prioritized.find((f) => f.fingerprint === F_AUTHZ.fingerprint);
check('C1 S6 non auto-flaggato come FP dalla prioritizzazione', !isSuspectedFp(s6));
check('C2 S7 non auto-flaggato come FP dalla prioritizzazione', !isSuspectedFp(s7));

// C3: se per errore si tentasse un flag-FP su S6 SENZA evidenza, viene rifiutato
//     (l'asimmetria conservativa protegge il vero positivo).
const badDismiss = applyFpPolicy(F_INJ, { kind: 'bogus', detail: '', locator: '' });
check('C3 tentato dismiss di S6 senza evidenza -> rifiutato', badDismiss.flagged === false && badDismiss.finding.fix_state === 'detected');

// C4: anche un flag-FP CON evidenza su un vero positivo NON lo rimuove/risolve:
//     resta nel modello come detected (solo l'umano dispone). Dimostra che il
//     flag non e' mai una "liquidazione".
const tpFlag = applyFpPolicy(F_INJ, { kind: 'test-fixture', detail: 'ipotesi', locator: 'x:1' });
check('C4 flag su vero positivo NON lo rimuove/risolve', Boolean(tpFlag.finding) && tpFlag.finding.fix_state === 'detected' && tpFlag.finding.severity === 'HIGH');

// -----------------------------------------------------------------------------
// D) SPIEGAZIONE ONESTA
// -----------------------------------------------------------------------------
console.log('\nD) spiegazione (08 §4)');
const exInj = explainFinding(F_INJ);
const exRls = explainFinding(F_RLS);
const exDead = explainFinding(F_DEAD);

// D1: cita uno standard nominato (OWASP 2025 + CWE) — non un parere.
check('D1 cita standard nominato (OWASP+CWE)', /A05:2025/.test(exInj.why) && /CWE-89/.test(exInj.why), exInj.why.slice(0, 80));
// D2: RLS cita il provvedimento nominato + standard RLS 07 §5.
check('D2 RLS cita controllo nominato (07 §5)', /RLS001_MISSING_RLS/.test(exRls.why) && /A01:2025/.test(exRls.why));
// D3: MAI "e' sicuro" / "via libera" in nessun campo della spiegazione.
const allText = [exInj.text, exRls.text, exDead.text].join('\n').toLowerCase();
check('D3 mai "sicuro"/"via libera"', !/\bsicuro\b/.test(allText) && !/via libera/.test(allText), 'nessuna assoluzione');
// D4: direzione-fix viene da remediation_hint quando presente.
check('D4 direzione-fix da remediation_hint', exDead.fixDirection.includes('Rimuovere il codice morto'));
// D5: proporzionalita' — LOW e' minimal, HIGH e' full.
check('D5 profondita proporzionata (LOW=minimal, HIGH=full)', exDead.depth === 'minimal' && exInj.depth === 'full');
// D6: lo stato dichiarato resta "detected" (problema rilevato, non assoluzione).
check('D6 stato dichiarato = detected (rilevato)', /detected/.test(exInj.text) && /RILEVATO/.test(exInj.text));
// D7: nessun valore di segreto in chiaro nell'evidenza/spiegazione del secret.
const exSecret = explainFinding(F_SECRET);
check('D7 nessun segreto in chiaro nella spiegazione', /REDATTO/.test(F_SECRET.evidence) && !/sk_live_/.test(exSecret.text));

// -----------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length} check passati`);
if (failed.length) {
  for (const f of failed) console.log(`  - FAIL: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
}
process.exit(failed.length === 0 ? 0 : 1);
