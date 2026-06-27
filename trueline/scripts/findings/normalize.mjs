#!/usr/bin/env node
// =============================================================================
// normalize.mjs — adapter di normalizzazione native->finding (03 §6).
//
// E' il CUORE del contratto 04 (finding model): traduce l'output NATIVO di OGNI
// oracolo (gitleaks, rls-check, knip, osv-scanner, semgrep) nel FINDING MODEL
// unico (trueline/scripts/findings/finding.schema.json). A valle nessun
// componente (loop di fix 05, triage 08) vede mai il dump nativo del tool:
// ragiona solo su questi oggetti strutturati e validi.
//
// RESPONSABILITA' (03 §6):
//   - Mapping campi per oracolo (tabella 03 §6): category, severity, location,
//     evidence (REDATTA), source_oracle.
//   - fingerprint stabile-per-riga = hash(oracle, rule_id, normalized_path,
//     match_signature). Il match_signature e' un'ANCORA DI CONTENUTO (simbolo o
//     snippet normalizzato), MAI il numero di riga: due run sullo stesso difetto
//     danno lo stesso fingerprint anche se la riga si sposta (04 §6).
//   - Dedup: lo stesso segreto trovato sia da gitleaks sia da semgrep collassa in
//     UN finding (chiave fingerprint+categoria; gitleaks autoritativo sui segreti).
//   - OWASP 2025 (L-COL-026): i NOSTRI oracoli (rls-check, ruleset curato) emettono
//     gia 2025; le fonti esterne (osv, registry semgrep) portano 2021/CWE e vengono
//     normalizzate a 2025 con una mappa PROVVISORIA, preservando owasp_source.
//   - fix_state="detected" (stato iniziale dopo normalize); baseline_status="new"
//     contro baseline vuota; run_id/created_at passati come argomento (NON Date.now
//     interno) per riproducibilita deterministica nei test/gate.
//
// CLI:
//   node normalize.mjs <oracle> <native.json> [opzioni]
//     <oracle>      uno di: gitleaks | rls-check | firestore-rules | knip | osv | semgrep
//                   (alias accettati: osv-scanner, rls_check, deadcode, dead-code,
//                    firestore_rules, firestore)
//     <native.json> file col JSON nativo dell'oracolo ("-" per stdin)
//   opzioni:
//     --run-id <id>        run_id fisso (default: "run-fixed" per riproducibilita)
//     --created-at <iso>   created_at fisso (default: epoch ISO, deterministico)
//     --base <dir>         prefisso repo-relativo per i path relativi degli oracoli
//                          basati su git (es. gitleaks history): default
//                          "eval/reference-app"
//     --scope <s>          scope dello scan (informativo, es. working-tree)
//   Stampa su stdout un ARRAY di finding, ognuno conforme a finding.schema.json.
//
// Node ESM, solo moduli built-in (niente dipendenze npm, niente rete).
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep, posix } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Radice del repo: trueline/scripts/findings -> root e 3 livelli sopra.
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

// Base di default per i path relativi degli oracoli git-based (gitleaks history
// emette path relativi alla reference app, non al repo).
const DEFAULT_BASE = 'eval/reference-app';

// Valori deterministici di default (riproducibilita del gate, L-COL-002):
// NON usiamo Date.now()/uuid a runtime; chi vuole un run reale passa --run-id.
const DEFAULT_RUN_ID = 'run-fixed';
const DEFAULT_CREATED_AT = '1970-01-01T00:00:00.000Z';

// -----------------------------------------------------------------------------
// OWASP: mappa AUTORITATIVA 2021/legacy -> 2025 canonico (07 §3.1, L-COL-026).
//
// L'edizione canonica e unica di Trueline e' OWASP Top 10:2025. Le fonti esterne
// (registry semgrep, OSV) emettono ancora codici 2021: questa mappa li traduce al
// codice 2025 corretto PRIMA di popolare finding.owasp, preservando il grezzo in
// finding.owasp_source. NON e' una 1:1 sul numero d'ordine (i numeri CAMBIANO):
//   A03:2021 Injection            -> A05:2025 Injection
//   A06:2021 Vulnerable Components -> A03:2025 Software Supply Chain Failures
//   A10:2021 SSRF                  -> A01:2025 (SSRF assorbita in Broken Access Ctrl)
//   A02:2021 Cryptographic Failures-> A04:2025 Cryptographic Failures
//   A01:2021 Broken Access Control -> A01:2025 (rls/authz)
//   A07:2021 Identification/Auth    -> A07:2025 Authentication Failures (secret)
//   A05:2021 Security Misconfig     -> A02:2025 Security Misconfiguration (config/misc)
//   A04:2021 Insecure Design        -> A04:2025 (numero invariato in tabella)
// La mappa copre SOLO le categorie a cui gli oracoli di Trueline arrivano (07 §3.1,
// "non riproduce l'intera lista"). Un codice 2025 passa invariato; un codice legacy
// FUORI da questa tabella ritorna undefined (NON si inventa una 1:1 sul numero).
// -----------------------------------------------------------------------------
const OWASP_2021_TO_2025 = Object.freeze({
  'A01:2021': 'A01:2025', // Broken Access Control -> Broken Access Control (rls/authz, SSRF assorbita)
  'A02:2021': 'A04:2025', // Cryptographic Failures -> Cryptographic Failures
  'A03:2021': 'A05:2025', // Injection -> Injection (scesa ad A05)
  'A04:2021': 'A04:2025', // Insecure Design (numero coincidente)
  'A05:2021': 'A02:2025', // Security Misconfiguration -> Security Misconfiguration
  'A06:2021': 'A03:2025', // Vulnerable & Outdated Components -> Software Supply Chain Failures
  'A07:2021': 'A07:2025', // Identification & Authentication Failures
  'A10:2021': 'A01:2025', // SSRF -> assorbita in A01:2025 Broken Access Control
});

function normalizeOwaspTo2025(rawCode) {
  if (!rawCode) return undefined;
  const code = String(rawCode).trim();
  // Gia 2025: passa invariato.
  if (/^A\d{2}:2025$/.test(code)) return code;
  // Legacy 2021 -> 2025 SOLO secondo la tabella autoritativa 07 §3.1 (numeri che
  // cambiano). Un legacy fuori tabella -> undefined (non si inventa una 1:1).
  if (Object.prototype.hasOwnProperty.call(OWASP_2021_TO_2025, code)) {
    return OWASP_2021_TO_2025[code];
  }
  // CWE puro, legacy non in tabella o formato ignoto: nessun codice canonico qui.
  return undefined;
}

// -----------------------------------------------------------------------------
// Path: normalizzazione a repo-relativo POSIX (stabile fra OS).
//   - assoluto (anche Windows, anche stile container "/src/..") -> relativizzato
//   - relativo che gia parte da eval/.. -> invariato
//   - relativo "nudo" (es. src/legacy/credentials.ts da gitleaks history) ->
//     prefissato con la base (default eval/reference-app)
// -----------------------------------------------------------------------------
function normalizePath(rawPath, { base = DEFAULT_BASE, stripContainerSrc = false } = {}) {
  if (!rawPath) return '';
  let p = String(rawPath).replace(/\\/g, '/');

  // Container semgrep: i path arrivano come "/src/<rel>"; "/src" == la dir
  // progetto montata. Strippiamo "/src/" e prefissiamo con la base.
  if (stripContainerSrc) {
    const m = /^\/src\/?(.*)$/.exec(p);
    if (m) {
      const rel = m[1];
      return joinPosix(base, rel);
    }
  }

  // Path assoluto Windows ("C:/..") o POSIX ("/.."): relativizza a REPO_ROOT.
  const isWinAbs = /^[A-Za-z]:\//.test(p);
  const isPosixAbs = p.startsWith('/');
  if (isWinAbs || isPosixAbs) {
    const rel = relative(REPO_ROOT, resolve(p));
    return rel.split(sep).join(posix.sep);
  }

  // Relativo: se gia ancorato sotto la base (o sotto eval/), lascialo; altrimenti
  // prefissa con la base (caso gitleaks history -> "src/legacy/credentials.ts").
  if (p.startsWith(base) || p.startsWith('eval/')) return p;
  return joinPosix(base, p);
}

function joinPosix(...parts) {
  return parts
    .filter((x) => x !== undefined && x !== null && x !== '')
    .join('/')
    .replace(/\/+/g, '/');
}

// -----------------------------------------------------------------------------
// Fingerprint stabile-per-riga = sha256(oracle | rule_id | path | match_sig).
// match_signature = ancora di CONTENUTO normalizzata (simbolo o snippet), MAI il
// numero di riga: spostare il difetto di qualche riga NON cambia il fingerprint.
// -----------------------------------------------------------------------------
function fingerprintOf({ oracle, ruleId, normalizedPath, matchSignature }) {
  const sig = normalizeSignature(matchSignature);
  const material = [oracle, ruleId, normalizedPath, sig].join(' ');
  return createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 32);
}

// Normalizza l'ancora di contenuto: collassa whitespace, toglie i numeri "nudi"
// (evita che un numero di riga finisca nella firma) e taglia a lunghezza fissa.
function normalizeSignature(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// -----------------------------------------------------------------------------
// Redazione evidence (04 §7): MAI il valore di un segreto in chiaro.
// Per i segreti non emettiamo mai il Match/Secret nativi (gitleaks li redige gia,
// ma il Match puo' contenere il nome della variabile + il valore): produciamo una
// descrizione costruita (regola + simbolo), priva di payload.
// -----------------------------------------------------------------------------
function redactSecretEvidence({ ruleId, file, symbol }) {
  const where = symbol ? ` (assegnazione: ${symbol})` : '';
  return `Segreto rilevato dalla regola "${ruleId}" in ${file}${where}. Valore REDATTO (mai in chiaro).`;
}

// Estrae il nome dell'identificatore da un Match gitleaks tipo
// 'SUPABASE_SERVICE_ROLE_KEY =\n  "REDACTED"' SENZA includere alcun valore.
function extractAssignedSymbol(match) {
  if (!match) return undefined;
  const m = /([A-Za-z_$][\w$]*)\s*[:=]/.exec(String(match));
  return m ? m[1] : undefined;
}

// =============================================================================
// ADAPTER PER ORACOLO
// =============================================================================

// --- gitleaks ----------------------------------------------------------------
// Nativo: array di { RuleID, Description, StartLine, EndLine, File, Match,
//   Secret(REDACTED), Commit, Fingerprint(nativo) }. category=secret;
//   severity CRITICAL/HIGH (i segreti sono sempre alti); evidence REDATTA;
//   source gitleaks + RuleID. owasp/cwe NON dal tool (li porta il registry/07).
function normalizeGitleaks(native, ctx) {
  if (!Array.isArray(native)) {
    throw new Error('gitleaks: atteso un array di finding nativi');
  }
  const out = [];
  for (const r of native) {
    const ruleId = r.RuleID || 'unknown';
    const normalizedPath = normalizePath(r.File, { base: ctx.base });
    const symbol = extractAssignedSymbol(r.Match);
    // match_signature: regola + simbolo + path (NON il valore, NON la riga).
    const matchSignature = [ruleId, symbol || '', normalizedPath].join('|');
    const finding = baseFinding(ctx, {
      category: 'secret',
      // Le chiavi service_role/PAT seminate sono ad alto impatto: CRITICAL.
      severity: 'CRITICAL',
      location: {
        file: normalizedPath,
        start_line: intOr(r.StartLine, 0),
        end_line: intOr(r.EndLine, r.StartLine, 0),
        ...(symbol ? { symbol } : {}),
      },
      evidence: redactSecretEvidence({ ruleId, file: normalizedPath, symbol }),
      source_oracle: {
        oracle: 'gitleaks',
        tool_version: ctx.toolVersions.gitleaks,
        rule_id: ruleId,
      },
      fingerprint: fingerprintOf({
        oracle: 'gitleaks',
        ruleId,
        normalizedPath,
        matchSignature,
      }),
      remediation_hint:
        'Rimuovere il segreto dal sorgente, ruotare la credenziale e leggerla ' +
        'da variabile d\'ambiente / secret manager.',
    });
    out.push(finding);
  }
  return out;
}

// --- rls-check ----------------------------------------------------------------
// Nativo: { oracle, tool_version, findings:[{ control_id, severity, category:'rls',
//   table, location{file,start_line,end_line,statement}, snippet, message,
//   policy?, heuristic? }] }. I NOSTRI oracoli portano gia OWASP 2025 a regime;
//   qui mappiamo i control_id ai codici 2025 canonici (04 §3 / registry).
function normalizeRlsCheck(native, ctx) {
  const report = native && Array.isArray(native.findings) ? native : { findings: native };
  if (!Array.isArray(report.findings)) {
    throw new Error('rls-check: atteso { findings: [...] } oppure un array');
  }
  const toolVersion = report.tool_version || ctx.toolVersions['rls-check'];
  // OWASP canonico 2025 dei controlli RLS (nostro oracolo: gia 2025, L-COL-026).
  const RLS_OWASP_2025 = 'A01:2025'; // Broken Access Control
  const RLS_CWE = {
    RLS001_MISSING_RLS: 'CWE-285',
    RLS002_NO_POLICY: 'CWE-285',
    RLS003_PERMISSIVE_TRUE: 'CWE-285',
    RLS004_MISSING_TENANT_PREDICATE: 'CWE-285',
    RLS005_PUBLIC_BUCKET: 'CWE-285',
  };
  const out = [];
  for (const f of report.findings) {
    const ruleId = f.control_id || 'RLS_UNKNOWN';
    const loc = f.location || {};
    const normalizedPath = normalizePath(loc.file, { base: ctx.base });
    const symbol = f.policy || f.table;
    // match_signature: controllo + tabella/policy + path (semantica, non riga).
    const matchSignature = [ruleId, f.table || '', f.policy || '', normalizedPath].join('|');
    const finding = baseFinding(ctx, {
      category: 'rls',
      severity: normSeverity(f.severity, 'HIGH'),
      location: {
        file: normalizedPath,
        start_line: intOr(loc.start_line, 0),
        end_line: intOr(loc.end_line, loc.start_line, 0),
        ...(symbol ? { symbol } : {}),
      },
      // L'oracolo RLS non emette segreti: il messaggio/snippet e' evidenza sicura.
      evidence: f.message || f.snippet || `Controllo RLS ${ruleId} su ${f.table}`,
      source_oracle: {
        oracle: 'rls-check',
        tool_version: toolVersion,
        rule_id: ruleId,
      },
      // Nostro oracolo: OWASP gia 2025 (owasp_source uguale = nessuna conversione).
      owasp: RLS_OWASP_2025,
      owasp_source: RLS_OWASP_2025,
      ...(RLS_CWE[ruleId] ? { cwe: RLS_CWE[ruleId] } : {}),
      fingerprint: fingerprintOf({
        oracle: 'rls-check',
        ruleId,
        normalizedPath,
        matchSignature,
      }),
      remediation_hint: f.heuristic
        ? 'Verifica comportamentale per-tenant demandata a rls-check [DB-test].'
        : undefined,
    });
    out.push(finding);
  }
  return out;
}

// --- firestore-rules (authz) -------------------------------------------------
// Nativo (da firestore_rules_check.mjs): { oracle:'firestore-rules', tool_version,
//   coverage, scanned_files, parse_warnings, findings:[{ control_id, severity,
//   category:'authz', match_path, allow, location{file,start_line,end_line,
//   statement}, snippet, message, heuristic? }] }. Gemello strutturale di
//   normalizeRlsCheck: e' un NOSTRO oracolo (OWASP gia 2025 a regime, L-COL-026)
//   per il Broken Access Control sulle Firestore Security Rules. category=authz
//   (NON rls: la categoria authz copre le regole di autorizzazione applicative,
//   distinte dalla Row Level Security del DB). Il fingerprint e' ANCORATO al
//   match_path (mai alla riga, che firestore.rules sposta): stesso difetto sullo
//   stesso path -> stesso fingerprint prima e dopo, cosi il loop lo riconosce.
function normalizeFirestoreRules(native, ctx) {
  const report = native && Array.isArray(native.findings) ? native : { findings: native };
  if (!Array.isArray(report.findings)) {
    throw new Error('firestore-rules: atteso { findings: [...] } oppure un array');
  }
  const toolVersion = report.tool_version || ctx.toolVersions['firestore-rules'];
  // OWASP canonico 2025 dei controlli Firestore (nostro oracolo: gia 2025).
  const FIRESTORE_OWASP_2025 = 'A01:2025'; // Broken Access Control
  // CWE-862 Missing Authorization (deliberato, allineato a 07 §4.3): la regola
  // non impone alcun controllo di autorizzazione efficace. NON CWE-285.
  const FIRESTORE_CWE = {
    FIRESTORE001_PUBLIC_ALLOW: 'CWE-862',
    FIRESTORE002_MISSING_AUTH: 'CWE-862',
  };
  const out = [];
  for (const f of report.findings) {
    const ruleId = f.control_id || 'FIRESTORE_UNKNOWN';
    const loc = f.location || {};
    const normalizedPath = normalizePath(loc.file, { base: ctx.base });
    // Simbolo = il match_path della regola (l'ancora semantica del difetto).
    const symbol = f.match_path;
    // match_signature: controllo + match_path + allow + path (semantica, NON la
    // riga): due run sulla stessa regola danno lo stesso fingerprint anche se la
    // riga si sposta.
    const matchSignature = [ruleId, f.match_path || '', f.allow || '', normalizedPath].join('|');
    const finding = baseFinding(ctx, {
      category: 'authz',
      severity: normSeverity(f.severity, 'HIGH'),
      location: {
        file: normalizedPath,
        start_line: intOr(loc.start_line, 0),
        end_line: intOr(loc.end_line, loc.start_line, 0),
        ...(symbol ? { symbol } : {}),
      },
      // L'oracolo Firestore non emette segreti: messaggio/snippet e' evidenza sicura.
      evidence: f.message || f.snippet || `Controllo Firestore ${ruleId} su ${f.match_path}`,
      source_oracle: {
        oracle: 'firestore-rules',
        tool_version: toolVersion,
        rule_id: ruleId,
      },
      // Nostro oracolo: OWASP gia 2025 (owasp_source uguale = nessuna conversione).
      owasp: FIRESTORE_OWASP_2025,
      owasp_source: FIRESTORE_OWASP_2025,
      ...(FIRESTORE_CWE[ruleId] ? { cwe: FIRESTORE_CWE[ruleId] } : {}),
      fingerprint: fingerprintOf({
        oracle: 'firestore-rules',
        ruleId,
        normalizedPath,
        matchSignature,
      }),
      remediation_hint: f.heuristic
        ? 'Verifica euristica per-documento demandata a firestore-rules.'
        : undefined,
    });
    out.push(finding);
  }
  return out;
}

// --- appwrite-perms (authz) --------------------------------------------------
// Nativo (da appwrite_perms_check.mjs): { oracle:'appwrite-perms', tool_version,
//   coverage, scanned_files, parse_warnings, findings:[{ control_id, severity,
//   category:'authz', match_path, collection, permission, location{file,start_line,
//   end_line,statement}, snippet, message, heuristic? }] }. Gemello strutturale di
//   normalizeFirestoreRules: e' un NOSTRO oracolo (OWASP gia 2025 a regime, L-COL-026)
//   per il Broken Access Control sulle permission dichiarative Appwrite. category=
//   authz (NON rls). Il fingerprint e' ANCORATO al match_path (`<collectionId>#
//   <permission>`, mai alla riga, che appwrite.json sposta): stesso difetto sullo
//   stesso path -> stesso fingerprint prima e dopo, cosi il loop lo riconosce.
function normalizeAppwritePerms(native, ctx) {
  const report = native && Array.isArray(native.findings) ? native : { findings: native };
  if (!Array.isArray(report.findings)) {
    throw new Error('appwrite-perms: atteso { findings: [...] } oppure un array');
  }
  const toolVersion = report.tool_version || ctx.toolVersions['appwrite-perms'];
  // OWASP canonico 2025 delle permission Appwrite (nostro oracolo: gia 2025).
  const APPWRITE_OWASP_2025 = 'A01:2025'; // Broken Access Control
  // CWE-862 Missing Authorization (allineato a 07 §4.3): permission read("any") =
  // autorizzazione ASSENTE. Divergenza intenzionale dal CWE-285 della famiglia RLS.
  const APPWRITE_CWE = {
    APPWRITE001_PUBLIC_PERMISSION: 'CWE-862',
    APPWRITE002_BROAD_COLLECTION_PERMISSION: 'CWE-862',
  };
  const out = [];
  for (const f of report.findings) {
    const ruleId = f.control_id || 'APPWRITE_UNKNOWN';
    const loc = f.location || {};
    const normalizedPath = normalizePath(loc.file, { base: ctx.base });
    // Simbolo = il match_path della permission (l'ancora semantica del difetto).
    const symbol = f.match_path;
    // match_signature: controllo + match_path + permission + path (semantica, NON la
    // riga): due run sulla stessa permission danno lo stesso fingerprint.
    const matchSignature = [ruleId, f.match_path || '', f.permission || '', normalizedPath].join('|');
    const finding = baseFinding(ctx, {
      category: 'authz',
      severity: normSeverity(f.severity, 'HIGH'),
      location: {
        file: normalizedPath,
        start_line: intOr(loc.start_line, 0),
        end_line: intOr(loc.end_line, loc.start_line, 0),
        ...(symbol ? { symbol } : {}),
      },
      // L'oracolo Appwrite non emette segreti: messaggio/snippet e' evidenza sicura.
      evidence: f.message || f.snippet || `Controllo Appwrite ${ruleId} su ${f.match_path}`,
      source_oracle: {
        oracle: 'appwrite-perms',
        tool_version: toolVersion,
        rule_id: ruleId,
      },
      // Nostro oracolo: OWASP gia 2025 (owasp_source uguale = nessuna conversione).
      owasp: APPWRITE_OWASP_2025,
      owasp_source: APPWRITE_OWASP_2025,
      ...(APPWRITE_CWE[ruleId] ? { cwe: APPWRITE_CWE[ruleId] } : {}),
      fingerprint: fingerprintOf({
        oracle: 'appwrite-perms',
        ruleId,
        normalizedPath,
        matchSignature,
      }),
      remediation_hint: f.heuristic
        ? 'Verifica euristica delle permission Appwrite demandata ad appwrite-perms.'
        : undefined,
    });
    out.push(finding);
  }
  return out;
}

// --- pocketbase-rules (authz) ------------------------------------------------
// Nativo (da pocketbase_rules_check.mjs): { oracle:'pocketbase-rules', tool_version,
//   coverage, scanned_files, parse_warnings, findings:[{ control_id, severity,
//   category:'authz', match_path, rule_field, location{file,collection,rule_field,
//   start_line,end_line,statement}, snippet, message, heuristic? }] }. Gemello
//   strutturale di normalizeFirestoreRules: NOSTRO oracolo (OWASP gia 2025) per il
//   Broken Access Control sulle API rules dichiarative PocketBase. category=authz.
//   Il fingerprint e' ANCORATO al match_path (`<collection>.<ruleField>`, mai alla
//   riga). Trappola load-bearing: l'oracolo NON emette finding per null (LOCKED) ne
//   per i field assenti — qui normalizziamo solo cio' che l'oracolo segnala ("").
function normalizePocketbaseRules(native, ctx) {
  const report = native && Array.isArray(native.findings) ? native : { findings: native };
  if (!Array.isArray(report.findings)) {
    throw new Error('pocketbase-rules: atteso { findings: [...] } oppure un array');
  }
  const toolVersion = report.tool_version || ctx.toolVersions['pocketbase-rules'];
  const POCKETBASE_OWASP_2025 = 'A01:2025'; // Broken Access Control
  // CWE-862 Missing Authorization: rule field "" = autorizzazione ASSENTE (pubblico).
  const POCKETBASE_CWE = {
    POCKETBASE001_PUBLIC_RULE: 'CWE-862',
    POCKETBASE002_MISSING_AUTH_TOKEN: 'CWE-862',
  };
  const out = [];
  for (const f of report.findings) {
    const ruleId = f.control_id || 'POCKETBASE_UNKNOWN';
    const loc = f.location || {};
    const normalizedPath = normalizePath(loc.file, { base: ctx.base });
    // Simbolo = il match_path del rule field (l'ancora semantica del difetto).
    const symbol = f.match_path;
    // match_signature: controllo + match_path + rule_field + path (semantica, NON la riga).
    const matchSignature = [ruleId, f.match_path || '', f.rule_field || '', normalizedPath].join('|');
    const finding = baseFinding(ctx, {
      category: 'authz',
      severity: normSeverity(f.severity, 'HIGH'),
      location: {
        file: normalizedPath,
        start_line: intOr(loc.start_line, 0),
        end_line: intOr(loc.end_line, loc.start_line, 0),
        ...(symbol ? { symbol } : {}),
      },
      // L'oracolo PocketBase non emette segreti: messaggio/snippet e' evidenza sicura.
      evidence: f.message || f.snippet || `Controllo PocketBase ${ruleId} su ${f.match_path}`,
      source_oracle: {
        oracle: 'pocketbase-rules',
        tool_version: toolVersion,
        rule_id: ruleId,
      },
      owasp: POCKETBASE_OWASP_2025,
      owasp_source: POCKETBASE_OWASP_2025,
      ...(POCKETBASE_CWE[ruleId] ? { cwe: POCKETBASE_CWE[ruleId] } : {}),
      fingerprint: fingerprintOf({
        oracle: 'pocketbase-rules',
        ruleId,
        normalizedPath,
        matchSignature,
      }),
      remediation_hint: f.heuristic
        ? 'Verifica euristica delle API rules PocketBase demandata a pocketbase-rules.'
        : undefined,
    });
    out.push(finding);
  }
  return out;
}

// --- knip (dead-code) ---------------------------------------------------------
// Nativo: { issues:[{ file, exports:[{name,line,col}], types:[...], files:[{name}],
//   dependencies, ... }] }. category=dead-code; severity=LOW (igiene, 04 §4).
//   Un file interamente non referenziato compare in `files`; i singoli simboli
//   morti in `exports`/`types`/`enumMembers`/`namespaceMembers`. Emettiamo un
//   finding per ciascun elemento morto.
function normalizeKnip(native, ctx) {
  const issues = native && Array.isArray(native.issues) ? native.issues : [];
  const out = [];
  for (const issue of issues) {
    const file = issue.file || '';
    const normalizedPath = normalizePath(file, { base: ctx.base });

    // File interamente non referenziato (subsume gli export del file).
    for (const f of issue.files || []) {
      const name = typeof f === 'string' ? f : f.name;
      const np = normalizePath(name || file, { base: ctx.base });
      out.push(
        makeKnipFinding(ctx, {
          ruleId: 'unused-file',
          normalizedPath: np,
          symbol: undefined,
          startLine: 0,
          evidence: `File non referenziato da alcun entry: ${np} (dead code).`,
        }),
      );
    }

    // Simboli morti a livello di export/tipo/enum/namespace.
    for (const [bucket, kind] of [
      ['exports', 'unused-export'],
      ['types', 'unused-type'],
      ['enumMembers', 'unused-enum-member'],
      ['namespaceMembers', 'unused-namespace-member'],
    ]) {
      for (const sym of issue[bucket] || []) {
        const name = typeof sym === 'string' ? sym : sym.name;
        const line = typeof sym === 'object' ? intOr(sym.line, 0) : 0;
        out.push(
          makeKnipFinding(ctx, {
            ruleId: kind,
            normalizedPath,
            symbol: name,
            startLine: line,
            evidence: `Simbolo non utilizzato (${kind}): ${name} in ${normalizedPath}.`,
          }),
        );
      }
    }
  }
  return out;
}

// --- vulture (dead-code Python — SP-2/SP-4) ----------------------------------
// Nativo (da run_deadcode.mjs --tool=vulture): { tool:'vulture', issues:[{ file,
//   line, type, name, confidence }] }. category=dead-code; severity=LOW (igiene,
//   come knip). Un'issue = un simbolo Python non usato (function/class/variable/
//   attribute/...). Emettiamo un finding per simbolo, con location.symbol=name.
//   Il fingerprint e' ANCORATO al simbolo (NON alla riga, che vulture sposta):
//   stesso simbolo morto -> stesso fingerprint prima e dopo la fix, cosi' il loop
//   (stillPresent per fingerprint) lo riconosce come "ancora presente / azzerato".
function normalizeVulture(native, ctx) {
  const issues = native && Array.isArray(native.issues) ? native.issues : [];
  const out = [];
  for (const issue of issues) {
    const normalizedPath = normalizePath(issue.file || '', { base: ctx.base });
    const symbol = issue.name || undefined;
    const kind = String(issue.type || 'symbol').trim().replace(/\s+/g, '-');
    const ruleId = `unused-${kind}`; // es. unused-function, unused-class, unused-attribute
    // match_signature: tipo-di-morto + simbolo + path (NON la riga, NON la
    // confidence: due run sullo stesso simbolo danno lo stesso fingerprint).
    const matchSignature = [ruleId, symbol || '', normalizedPath].join('|');
    out.push(baseFinding(ctx, {
      category: 'dead-code',
      severity: 'LOW',
      location: {
        file: normalizedPath,
        start_line: intOr(issue.line, 0),
        end_line: intOr(issue.line, 0),
        ...(symbol ? { symbol } : {}),
      },
      evidence: `Simbolo Python non utilizzato (${ruleId}): ${symbol || '?'} in ${normalizedPath} (vulture, ${intOr(issue.confidence, 0)}% confidence).`,
      source_oracle: {
        oracle: 'vulture',
        tool_version: ctx.toolVersions.vulture,
        rule_id: ruleId,
      },
      fingerprint: fingerprintOf({ oracle: 'vulture', ruleId, normalizedPath, matchSignature }),
      remediation_hint: 'Rimuovere il simbolo morto (previo gate umano).',
    }));
  }
  return out;
}

function makeKnipFinding(ctx, { ruleId, normalizedPath, symbol, startLine, evidence }) {
  // match_signature: tipo-di-morto + simbolo + path (NON la riga).
  const matchSignature = [ruleId, symbol || '', normalizedPath].join('|');
  return baseFinding(ctx, {
    category: 'dead-code',
    severity: 'LOW',
    location: {
      file: normalizedPath,
      start_line: intOr(startLine, 0),
      end_line: intOr(startLine, 0),
      ...(symbol ? { symbol } : {}),
    },
    evidence,
    source_oracle: {
      oracle: 'knip',
      tool_version: ctx.toolVersions.knip,
      rule_id: ruleId,
    },
    fingerprint: fingerprintOf({ oracle: 'knip', ruleId, normalizedPath, matchSignature }),
    remediation_hint: 'Rimuovere il codice morto (previo gate umano).',
  });
}

// --- osv-scanner (dependency-vuln) -------------------------------------------
// Nativo: { results:[{ source{path}, packages:[{ package{name,version,ecosystem},
//   vulnerabilities:[{ id, summary, severity:[{type,score}], database_specific{...},
//   aliases }], groups }] }] }. category=dependency-vuln; severity da CVSS;
//   source osv-scanner + CVE/OSV id; owasp_source/cwe dalla fonte esterna ->
//   owasp normalizzato a 2025.
function normalizeOsv(native, ctx) {
  const results = native && Array.isArray(native.results) ? native.results : [];
  const out = [];
  for (const res of results) {
    const sourcePath = res.source && res.source.path ? res.source.path : '';
    const normalizedPath = normalizePath(sourcePath, { base: ctx.base });
    for (const pkg of res.packages || []) {
      const pkgInfo = pkg.package || {};
      const pkgName = pkgInfo.name || 'unknown';
      const pkgVersion = pkgInfo.version || '';
      for (const vuln of pkg.vulnerabilities || []) {
        const id = vuln.id || 'OSV-UNKNOWN';
        const sev = severityFromCvss(vuln.severity);
        const cwe = firstCweFrom(vuln);
        const owaspSource = firstOwaspFrom(vuln);
        // match_signature: id-vuln + package@version (NON la riga del lockfile).
        const matchSignature = [id, `${pkgName}@${pkgVersion}`].join('|');
        out.push(
          baseFinding(ctx, {
            category: 'dependency-vuln',
            severity: sev,
            location: {
              file: normalizedPath || `${pkgName}@${pkgVersion}`,
              start_line: 0,
              end_line: 0,
              symbol: `${pkgName}@${pkgVersion}`,
            },
            evidence:
              (vuln.summary || vuln.details || id) +
              ` [${pkgName}@${pkgVersion}, ${pkgInfo.ecosystem || 'npm'}]`,
            source_oracle: {
              oracle: 'osv-scanner',
              tool_version: ctx.toolVersions.osv,
              rule_id: id,
            },
            // Fonte esterna: owasp_source grezzo -> owasp 2025 (mappa provvisoria).
            ...(owaspSource ? { owasp_source: owaspSource } : {}),
            ...(normalizeOwaspTo2025(owaspSource)
              ? { owasp: normalizeOwaspTo2025(owaspSource) }
              : {}),
            ...(cwe ? { cwe } : {}),
            fingerprint: fingerprintOf({
              oracle: 'osv-scanner',
              ruleId: id,
              normalizedPath: normalizedPath || pkgName,
              matchSignature,
            }),
            remediation_hint: `Aggiornare ${pkgName} a una versione non vulnerabile.`,
          }),
        );
      }
    }
  }
  return out;
}

// --- semgrep ------------------------------------------------------------------
// Nativo: { version, results:[{ check_id, path, start{line}, end{line},
//   extra{ severity:ERROR|WARNING|INFO, metadata{category, owasp_source?, cwe?,
//   owasp?}, message } }] }. category da metadata.category; sev ERROR->HIGH /
//   WARNING->MEDIUM / INFO->LOW; loc path+start/end.line; source semgrep+check_id.
//   owasp_source 2021/CWE -> owasp 2025 (mappa provvisoria), preservando il grezzo.
function normalizeSemgrep(native, ctx) {
  const results = native && Array.isArray(native.results) ? native.results : [];
  const toolVersion = native && native.version ? `semgrep@${native.version}` : ctx.toolVersions.semgrep;
  const out = [];
  for (const r of results) {
    const checkId = r.check_id || 'semgrep.unknown';
    const extra = r.extra || {};
    const md = extra.metadata || {};
    const normalizedPath = normalizePath(r.path, { base: ctx.base, stripContainerSrc: true });
    const category = mapSemgrepCategory(md.category);
    const startLine = intOr(r.start && r.start.line, 0);
    const endLine = intOr(r.end && r.end.line, startLine, 0);
    // owasp: l'oracolo curato (M4) emettera gia 2025; il placeholder porta 2021.
    const owaspSource = md.owasp_source || (Array.isArray(md.owasp) ? md.owasp[0] : md.owasp);
    const owasp2025 = normalizeOwaspTo2025(owaspSource);
    const cwe = md.cwe ? (Array.isArray(md.cwe) ? firstCweString(md.cwe[0]) : firstCweString(md.cwe)) : undefined;
    // match_signature: check_id + categoria + path (semantica, NON la riga).
    const matchSignature = [checkId, category, normalizedPath].join('|');
    out.push(
      baseFinding(ctx, {
        category,
        severity: mapSemgrepSeverity(extra.severity),
        location: {
          file: normalizedPath,
          start_line: startLine,
          end_line: endLine,
        },
        // Semgrep: evidenza = messaggio della regola (mai un payload di segreto:
        // per i segreti l'autoritativo e' gitleaks e il dedup elimina il doppione).
        evidence: extra.message || checkId,
        source_oracle: {
          oracle: 'semgrep',
          tool_version: toolVersion,
          rule_id: checkId,
        },
        ...(owaspSource ? { owasp_source: owaspSource } : {}),
        ...(owasp2025 ? { owasp: owasp2025 } : {}),
        ...(cwe ? { cwe } : {}),
        fingerprint: fingerprintOf({
          oracle: 'semgrep',
          ruleId: checkId,
          normalizedPath,
          matchSignature,
        }),
      }),
    );
  }
  return out;
}

function mapSemgrepCategory(raw) {
  const c = String(raw || '').toLowerCase();
  const allowed = new Set([
    'secret', 'rls', 'dead-code', 'injection', 'authz', 'crypto',
    'dependency-vuln', 'config', 'misc',
  ]);
  if (allowed.has(c)) return c;
  // Sinonimi comuni del registry semgrep.
  if (c === 'security' || c === 'sql-injection') return 'injection';
  if (c === 'authorization' || c === 'access-control') return 'authz';
  if (c === 'cryptography') return 'crypto';
  return 'misc';
}

function mapSemgrepSeverity(raw) {
  switch (String(raw || '').toUpperCase()) {
    case 'ERROR':
      return 'HIGH';
    case 'WARNING':
      return 'MEDIUM';
    case 'INFO':
      return 'LOW';
    default:
      return 'MEDIUM';
  }
}

// =============================================================================
// HELPER comuni
// =============================================================================

// Costruisce lo scheletro comune di un finding e vi fonde i campi specifici.
// Imposta gli invarianti: fix_state=detected, baseline_status=new (baseline
// vuota), run_id/created_at deterministici dal contesto.
function baseFinding(ctx, fields) {
  const f = {
    fingerprint: fields.fingerprint,
    category: fields.category,
    severity: fields.severity,
    location: fields.location,
    evidence: fields.evidence,
    source_oracle: pruneUndefined(fields.source_oracle),
    fix_state: 'detected',
    baseline_status: 'new', // baseline vuota in M0 -> tutto e' nuovo (04 §6)
    run_id: ctx.runId,
    created_at: ctx.createdAt,
  };
  if (ctx.scope) f.scope_relevance = 'in-scope';
  if (fields.owasp) f.owasp = fields.owasp;
  if (fields.owasp_source) f.owasp_source = fields.owasp_source;
  if (fields.cwe) f.cwe = fields.cwe;
  if (fields.remediation_hint) f.remediation_hint = fields.remediation_hint;
  return f;
}

function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

function normSeverity(raw, fallback) {
  const s = String(raw || '').toUpperCase();
  if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(s)) return s;
  return fallback;
}

function intOr(...candidates) {
  // L'ultimo argomento e' il default; i precedenti sono candidati.
  const dflt = candidates[candidates.length - 1];
  for (const c of candidates.slice(0, -1)) {
    if (Number.isInteger(c)) return c;
    const n = Number(c);
    if (Number.isInteger(n)) return n;
  }
  return Number.isInteger(dflt) ? dflt : 0;
}

// CVSS -> severity (CRITICAL>=9, HIGH>=7, MEDIUM>=4, altrimenti LOW). Se manca un
// punteggio numerico, ripiega su MEDIUM (presenza di una vuln nota e' non-LOW).
function severityFromCvss(severityArr) {
  if (!Array.isArray(severityArr) || severityArr.length === 0) return 'MEDIUM';
  let best = 0;
  for (const s of severityArr) {
    const score = Number(s && s.score);
    if (Number.isFinite(score)) best = Math.max(best, score);
  }
  if (best >= 9) return 'CRITICAL';
  if (best >= 7) return 'HIGH';
  if (best >= 4) return 'MEDIUM';
  if (best > 0) return 'LOW';
  return 'MEDIUM';
}

function firstCweString(raw) {
  if (!raw) return undefined;
  const m = /CWE-\d+/i.exec(String(raw));
  return m ? m[0].toUpperCase() : undefined;
}

// Estrae il primo CWE dai campi database_specific/ecosystem_specific di una vuln OSV.
function firstCweFrom(vuln) {
  const ds = vuln.database_specific || {};
  const candidates = [];
  if (ds.cwe_ids) candidates.push(...[].concat(ds.cwe_ids));
  if (ds.cwes) candidates.push(...[].concat(ds.cwes));
  if (Array.isArray(vuln.aliases)) candidates.push(...vuln.aliases);
  for (const c of candidates) {
    const cwe = firstCweString(typeof c === 'string' ? c : c && c.cweId);
    if (cwe) return cwe;
  }
  return undefined;
}

// Estrae un eventuale codice OWASP grezzo dai metadati della vuln OSV.
function firstOwaspFrom(vuln) {
  const ds = vuln.database_specific || {};
  const raw = ds.owasp || ds.owasp_source;
  if (!raw) return undefined;
  const m = /A\d{2}:20\d{2}/.exec(String(Array.isArray(raw) ? raw[0] : raw));
  return m ? m[0] : undefined;
}

// =============================================================================
// DEDUP (03 §6): stesso segreto da gitleaks E semgrep -> UN finding.
// Chiave = (category, fingerprint). Sui SEGRETI gitleaks e' autoritativo: se
// esistono un finding gitleaks e uno semgrep con lo stesso fingerprint+categoria,
// tiene gitleaks. La normalizzazione produce fingerprint coerenti (regola+path),
// cosi il doppione collassa. Inoltre, per la categoria secret, si scarta sempre
// il finding semgrep se ne esiste uno gitleaks per lo stesso (path+simbolo).
// =============================================================================
export function dedup(findings) {
  // 1) collasso esatto per (fingerprint) tenendo la fonte autoritativa.
  const authority = { gitleaks: 3, 'rls-check': 2, 'osv-scanner': 2, knip: 2, semgrep: 1 };
  const byFp = new Map();
  for (const f of findings) {
    const key = `${f.category} ${f.fingerprint}`;
    const prev = byFp.get(key);
    if (!prev) {
      byFp.set(key, f);
      continue;
    }
    const a = authority[f.source_oracle.oracle] || 0;
    const b = authority[prev.source_oracle.oracle] || 0;
    if (a > b) byFp.set(key, f);
  }
  let result = [...byFp.values()];

  // 2) sui SEGRETI: se gitleaks copre un (path+simbolo), elimina i semgrep-secret
  //    che insistono sullo stesso punto (gitleaks autoritativo, 03 §6).
  const gitleaksSecretKeys = new Set();
  for (const f of result) {
    if (f.category === 'secret' && f.source_oracle.oracle === 'gitleaks') {
      gitleaksSecretKeys.add(`${f.location.file} ${f.location.symbol || ''}`);
    }
  }
  result = result.filter((f) => {
    if (f.category === 'secret' && f.source_oracle.oracle === 'semgrep') {
      const k = `${f.location.file} ${f.location.symbol || ''}`;
      // semgrep non porta symbol: confronto anche solo per file.
      const kFileOnly = `${f.location.file} `;
      if (gitleaksSecretKeys.has(k) || gitleaksSecretKeys.has(kFileOnly)) return false;
      // Confronto largo per file (semgrep secret subsumed da gitleaks sullo stesso file).
      for (const gk of gitleaksSecretKeys) {
        if (gk.startsWith(`${f.location.file} `)) return false;
      }
    }
    return true;
  });

  return result;
}

// =============================================================================
// DISPATCH + API pubblica
// =============================================================================

const ORACLE_ALIASES = {
  gitleaks: 'gitleaks',
  'rls-check': 'rls-check',
  rls_check: 'rls-check',
  rls: 'rls-check',
  'firestore-rules': 'firestore-rules',
  firestore_rules: 'firestore-rules',
  firestore: 'firestore-rules',
  'appwrite-perms': 'appwrite-perms',
  appwrite_perms: 'appwrite-perms',
  appwrite_perms_check: 'appwrite-perms',
  'appwrite-perms-check': 'appwrite-perms',
  'pocketbase-rules': 'pocketbase-rules',
  pocketbase_rules: 'pocketbase-rules',
  pocketbase_rules_check: 'pocketbase-rules',
  'pocketbase-rules-check': 'pocketbase-rules',
  knip: 'knip',
  deadcode: 'knip',
  'dead-code': 'knip',
  vulture: 'vulture',
  osv: 'osv',
  'osv-scanner': 'osv',
  semgrep: 'semgrep',
};

/**
 * Normalizza l'output nativo `native` dell'oracolo `oracle` in un array di
 * finding conformi al finding model. `opts`: { runId, createdAt, base, scope,
 * toolVersions }. NON applica dedup (responsabilita del chiamante che fonde piu
 * oracoli — vedi normalizeAll/dedup).
 */
export function normalize(oracle, native, opts = {}) {
  const canon = ORACLE_ALIASES[String(oracle).toLowerCase()];
  if (!canon) {
    throw new Error(
      `oracolo sconosciuto: "${oracle}" (ammessi: gitleaks, rls-check, firestore-rules, knip, vulture, osv, semgrep)`,
    );
  }
  const ctx = {
    runId: opts.runId || DEFAULT_RUN_ID,
    createdAt: opts.createdAt || DEFAULT_CREATED_AT,
    base: opts.base || DEFAULT_BASE,
    scope: opts.scope || null,
    toolVersions: {
      gitleaks: 'gitleaks',
      'rls-check': 'rls-check@trueline',
      'firestore-rules': 'firestore-rules-check',
      'appwrite-perms': 'appwrite-perms-check',
      'pocketbase-rules': 'pocketbase-rules-check',
      knip: 'knip',
      vulture: 'vulture',
      osv: 'osv-scanner',
      semgrep: 'semgrep',
      ...(opts.toolVersions || {}),
    },
  };
  switch (canon) {
    case 'gitleaks':
      return normalizeGitleaks(native, ctx);
    case 'rls-check':
      return normalizeRlsCheck(native, ctx);
    case 'firestore-rules':
      return normalizeFirestoreRules(native, ctx);
    case 'appwrite-perms':
      return normalizeAppwritePerms(native, ctx);
    case 'pocketbase-rules':
      return normalizePocketbaseRules(native, ctx);
    case 'knip':
      return normalizeKnip(native, ctx);
    case 'vulture':
      return normalizeVulture(native, ctx);
    case 'osv':
      return normalizeOsv(native, ctx);
    case 'semgrep':
      return normalizeSemgrep(native, ctx);
    default:
      return [];
  }
}

/**
 * Normalizza piu' coppie {oracle, native} e applica il dedup fra oracoli
 * (gitleaks autoritativo sui segreti). `opts` come in normalize().
 */
export function normalizeAll(pairs, opts = {}) {
  const all = [];
  for (const { oracle, native } of pairs) {
    all.push(...normalize(oracle, native, opts));
  }
  return dedup(all);
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      flags[key] = val;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function readNativeJson(path) {
  const raw = path === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(path), 'utf8');
  return JSON.parse(raw);
}

function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const [oracle, nativeFile] = positional;
  if (!oracle || !nativeFile) {
    process.stderr.write(
      'uso: node normalize.mjs <oracle> <native.json|-> ' +
        '[--run-id <id>] [--created-at <iso>] [--base <dir>] [--scope <s>]\n' +
        'oracoli: gitleaks | rls-check | firestore-rules | knip | osv | semgrep\n',
    );
    return 2;
  }
  let native;
  try {
    native = readNativeJson(nativeFile);
  } catch (err) {
    process.stderr.write(`impossibile leggere/parsare ${nativeFile}: ${err.message}\n`);
    return 2;
  }
  let findings;
  try {
    findings = normalize(oracle, native, {
      runId: flags['run-id'],
      createdAt: flags['created-at'],
      base: flags.base,
      scope: flags.scope === 'true' ? 'working-tree' : flags.scope,
    });
  } catch (err) {
    process.stderr.write(`errore di normalizzazione: ${err.message}\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === __filename) {
  process.exit(main(process.argv));
}
