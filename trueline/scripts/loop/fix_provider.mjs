// fix_provider.mjs — FIX PROVIDER iniettabile per il verify-fix loop (05 §5).
//
// Il loop accetta un fix provider iniettabile: la MACCHINA e' identica, cambia
// solo CHI propone la patch.
//   - skill reale  -> un LLM propone la fix (human-gated, L-COL-005).
//   - EVAL-MODE     -> questa TABELLA DETERMINISTICA di fix note per i difetti
//                      seminati. Nessun LLM, nessun token, riproducibile.
//
// Un fix provider e' una funzione:
//   propose(finding, attempt, lastFailureReason) -> Patch | null
// dove:
//   attempt           1 = proposta iniziale, 2..3 = retry (05 §4, cap 2 retry)
//   lastFailureReason motivo del fallimento precedente (perche' l'oracolo
//                     flagga ancora / quale test si e' rotto), passato come
//                     input al tentativo successivo (05 §3).
// e Patch e':
//   { id, kind, apply(workspaceDir) -> { ok, detail }, signature }
//     - kind: "secret" | "rls" | "dead-code" | "secret-history"
//     - signature: stringa che identifica MATERIALMENTE la patch. Il loop
//       rifiuta una ri-sottomissione byte-identica (05 §3): due patch con la
//       stessa signature sono "la stessa patch".
//     - apply: modifica i file nella COPIA TEMPORANEA (mai il fixture canonico).
//
// Node ESM, solo built-in (fs, path). Niente rete.

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { removePySymbol } from './py_deadcode_edit.mjs';

const MIGRATION_REL = 'supabase/migrations/0001_init.sql';
const CONFIG_REL = 'src/lib/config.ts';
const DEAD_REL = 'src/legacy/unused.ts';

// --- Path Python della fixture supabase-py (SP-4) ----------------------------
// Le migration vivono nello stesso layout Supabase (supabase/migrations) sia per
// la fixture JS sia per quella Python: MIGRATION_REL e' condiviso. Gli altri
// path sono specifici dell'ecosistema Python.
const PY_CONFIG_REL = 'app/config.py';

// --- Tabella deterministica di fix note (EVAL-MODE) --------------------------
//
// Indicizzata per controlId/categoria del difetto seminato. Ogni voce e' una
// FAMIGLIA di patch: la prima e' la fix corretta (porta a verified); le
// eventuali successive sono varianti MATERIALMENTE diverse per i retry. Per il
// set in-scope la prima fix e' gia' corretta -> un solo tentativo basta.

// Sostituisce in modo idempotente la prima occorrenza di `needle` (regex) con
// `replacement` nel file `rel` della copia temp. Ritorna {ok, detail}.
function patchFile(dir, rel, needle, replacement, label) {
  const p = resolve(dir, rel);
  if (!existsSync(p)) return { ok: false, detail: `file assente: ${rel}` };
  const before = readFileSync(p, 'utf8');
  if (!needle.test(before)) {
    return { ok: false, detail: `pattern non trovato per ${label} in ${rel}` };
  }
  const after = before.replace(needle, replacement);
  if (after === before) return { ok: false, detail: `nessuna modifica applicata (${label})` };
  writeFileSync(p, after, 'utf8');
  return { ok: true, detail: `${label}: patch applicata su ${rel}` };
}

// S1 — secret working-tree: rimuove il literal hardcoded, legge da process.env.
function fixSecretS1(dir) {
  return patchFile(
    dir, CONFIG_REL,
    // il blocco "const SUPABASE_SERVICE_ROLE_KEY =\n  \"sk_live_...\";"
    /const SUPABASE_SERVICE_ROLE_KEY\s*=\s*\n?\s*"sk_live_[^"]*";/,
    'const SUPABASE_SERVICE_ROLE_KEY =\n  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";',
    'S1 secret',
  );
}

// S3 — RLS assente su public.audit_logs: aggiunge ENABLE RLS + policy isolata.
function fixRlsS3(dir) {
  const p = resolve(dir, MIGRATION_REL);
  if (!existsSync(p)) return { ok: false, detail: `migration assente` };
  const sql = readFileSync(p, 'utf8');
  if (/ALTER TABLE public\.audit_logs ENABLE ROW LEVEL SECURITY/i.test(sql)) {
    return { ok: false, detail: 'S3 gia\' fixato' };
  }
  const addition =
    '\n-- FIX S3: abilita RLS + policy isolata su public.audit_logs\n'
    + 'ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;\n'
    + 'CREATE POLICY audit_logs_owner_isolation\n'
    + '    ON public.audit_logs\n'
    + '    FOR ALL\n'
    + '    USING (actor_id = auth.uid())\n'
    + '    WITH CHECK (actor_id = auth.uid());\n';
  writeFileSync(p, sql + addition, 'utf8');
  return { ok: true, detail: 'S3: ENABLE RLS + policy su public.audit_logs' };
}

// S4 — policy USING(true): sostituisce con un predicato reale (auth.uid()).
function fixRlsS4(dir) {
  return patchFile(
    dir, MIGRATION_REL,
    /USING \(true\);\s*-- SEED:S4/,
    'USING (owner_id = auth.uid());  -- FIX:S4',
    'S4 rls',
  );
}

// S5 — policy senza isolamento per tenant: aggiunge il vincolo auth.uid()/tenant_id.
function fixRlsS5(dir) {
  return patchFile(
    dir, MIGRATION_REL,
    /USING \(status <> 'draft'\);/,
    "USING (status <> 'draft' AND tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);  -- FIX:S5",
    'S5 rls',
  );
}

// S8 — dead-code: rimuove l'export morto (gate umano, L-COL-021; in eval
// auto-approvato deterministicamente). knip segnala src/legacy/unused.ts come
// FILE morto (nessun entry lo importa): la fix corretta e' RIMUOVERE il file,
// non svuotarlo (un file vuoto resta comunque non importato). Usa git rm per
// togliere anche la traccia dall'indice (commit isolato additivo/reversibile).
function fixDeadcodeS8(dir) {
  const p = resolve(dir, DEAD_REL);
  if (!existsSync(p)) return { ok: false, detail: 'unused.ts gia\' rimosso' };
  rmSync(p, { force: true });
  return { ok: true, detail: 'S8: file morto src/legacy/unused.ts rimosso' };
}

// S2 — secret-in-history: ROTAZIONE (simulata). La rotazione effettiva della
// chiave e' fuori dal codice (console del provider): la skill la PRESCRIVE e ne
// traccia la dichiarazione (05 §7). La riscrittura della history e' distruttiva
// -> MAI autonoma. Quindi questa "fix" NON tocca la history: registra solo la
// rotazione -> esito atteso mitigated-residual, MAI verified.
function fixSecretHistoryS2() {
  return {
    ok: true,
    detail:
      'S2: rotazione chiave PRESCRITTA e dichiarata (azione fuori dal codice, '
      + 'console provider). History NON riscritta (distruttiva, gate umano). '
      + 'Esito atteso: mitigated-residual.',
    rotationDeclared: true,
    historyRewritten: false,
  };
}

// =============================================================================
// FIX PYTHON (SP-4, supabase-py) — additive. Dispatch keyed sul finding/ecosystem
// (vedi selectKnownFix): i fix JS e Python coesistono senza interferire.
// =============================================================================

// SPY-S1 — secret working-tree (Python): sostituisce le credenziali hardcoded in
// app/config.py con os.getenv(...). Cosi' gitleaks working-tree torna PULITO su
// app/config.py (sparisce il literal JWT della service_role key + la DSN con
// password) -> verified. La suite di caratterizzazione resta verde: con le env
// impostate get_database_url()/get_service_role_key() tornano il valore d'ambiente
// (ramo "env presente" invariato), e PORT continua a leggere os.environ.
function fixSecretSpyS1(dir) {
  const p = resolve(dir, PY_CONFIG_REL);
  if (!existsSync(p)) return { ok: false, detail: `file assente: ${PY_CONFIG_REL}` };
  let src = readFileSync(p, 'utf8');
  const before = src;

  // DATABASE_URL = "postgresql://...":  -> os.getenv (nessun default hardcoded).
  src = src.replace(
    /^DATABASE_URL\s*=\s*["'][^"'\n]*["']\s*$/m,
    'DATABASE_URL = os.getenv("DATABASE_URL", "")',
  );
  // SUPABASE_SERVICE_ROLE_KEY = "eyJ...": -> os.getenv.
  src = src.replace(
    /^SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"'\n]*["']\s*$/m,
    'SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")',
  );

  if (src === before) {
    return { ok: false, detail: 'SPY-S1: literal hardcoded non trovato in app/config.py (pattern cambiato?)' };
  }
  writeFileSync(p, src, 'utf8');
  return { ok: true, detail: 'SPY-S1: credenziali hardcoded in app/config.py sostituite con os.getenv(...)' };
}

// SPY-S3 — RLS USING (true) su public.invoices (Python fixture): trasferisce il
// fix RLS (USING(true) -> predicato reale con auth.uid()) sulla migration della
// fixture Python (stesso layout supabase/migrations). rls_check torna PULITO
// (0 finding) -> verified. Riusa la stessa semantica di fixRlsS4 (predicato reale),
// adattata alla colonna di tenancy della fixture Python (tenant_id = auth.uid(),
// coerente col contrasto public.notes che NON e' flaggato).
function fixRlsSpyS3(dir) {
  const p = resolve(dir, MIGRATION_REL);
  if (!existsSync(p)) return { ok: false, detail: `migration assente: ${MIGRATION_REL}` };
  const sql = readFileSync(p, 'utf8');
  // Sostituisci la USING (true) della policy invoices_select con un predicato
  // reale Supabase (auth.uid()). Match mirato alla policy su public.invoices per
  // non toccare il contrasto notes_select (gia' isolato).
  //
  // Il match INCLUDE il terminatore `;` dello statement (opzionale) e lo RI-EMETTE
  // PRIMA del commento di fix. Senza, il commento `-- FIX:SPY-S3` si frapporrebbe
  // tra `)` e `;`, COMMENTANDO il terminatore: lo statement resterebbe aperto e lo
  // statement SUCCESSIVO (create table notes) verrebbe agganciato -> migration
  // SINTATTICAMENTE ROTTA a runtime (rls_check statico non se ne accorge, ma la
  // caratterizzazione RLS a runtime sì). Il `;` va quindi PRIMA del commento.
  const re = /(create\s+policy\s+invoices_select\s+on\s+public\.invoices\s+for\s+select\s+using\s*\()\s*true\s*(\)\s*;?)/i;
  if (!re.test(sql)) {
    return { ok: false, detail: 'SPY-S3: policy invoices_select USING (true) non trovata in 0001_init.sql' };
  }
  // $2 cattura ")" + l'eventuale ";": lo emettiamo invariato, poi il commento, così
  // il terminatore resta FUORI dal commento e lo statement è chiuso correttamente.
  const after = sql.replace(re, '$1tenant_id = auth.uid()$2  -- FIX:SPY-S3');
  if (after === sql) return { ok: false, detail: 'SPY-S3: nessuna modifica applicata' };
  writeFileSync(p, after, 'utf8');
  return { ok: true, detail: 'SPY-S3: invoices_select USING(true) -> USING(tenant_id = auth.uid())' };
}

// SPY-S5 — dead-code Python: rimuove in modo SICURO la definizione del simbolo
// morto segnalato da vulture (finding {file, line, symbol}). Delega all'helper
// riusabile removePySymbol (py_deadcode_edit.mjs): rimuove SOLO la definizione
// top-level (non rompe il modulo); se il simbolo non e' una def top-level fallisce
// ONESTAMENTE (mai una rimozione approssimata). Gate umano: L-COL-021 (in eval
// auto-approvato dal loop). Dopo, vulture NON segnala piu' il simbolo -> verified;
// used_helper resta intatto (la suite di caratterizzazione resta verde).
function fixDeadcodeSymbol(dir, finding) {
  const rel = String((finding && finding.location && finding.location.file) || '')
    .replace(/\\/g, '/');
  const symbol = (finding && finding.location && finding.location.symbol) || '';
  const kindHint = inferKindFromRuleId(finding && finding.source_oracle && finding.source_oracle.rule_id);
  if (!rel || !symbol) {
    return { ok: false, detail: `SPY-S5: finding senza file/symbol (file=${rel || '?'} symbol=${symbol || '?'})` };
  }
  // Il path del finding e' repo-relativo (es. eval/.tmp-verify/<id>/app/dead.py o
  // app/dead.py a seconda della base di normalize). Lo ancoriamo alla COPIA `dir`
  // prendendo la coda dopo "app/" se presente, altrimenti il basename.
  const absFile = resolvePyFileInCopy(dir, rel);
  if (!absFile) {
    return { ok: false, detail: `SPY-S5: file Python non risolto nella copia (${rel})` };
  }
  const r = removePySymbol(absFile, symbol, { kindHint });
  if (!r.ok) return { ok: false, detail: `SPY-S5: ${r.detail}` };
  return { ok: true, detail: `SPY-S5: ${r.detail}` };
}

// Ricava il keyword di definizione (function/class) dal rule_id vulture
// (unused-function/unused-class/...). Default: function.
function inferKindFromRuleId(ruleId) {
  const r = String(ruleId || '');
  if (/class/i.test(r)) return 'class';
  return 'function';
}

// Risolve il path ASSOLUTO del file Python nella COPIA `dir` a partire dal path
// (eventualmente repo-relativo) del finding. Strategia: prende il segmento a
// partire da "app/" (layout della fixture); fallback al path cosi' com'e' se gia'
// risolve dentro la copia. NON esce mai dalla copia (nessun ../ verso l'esterno).
function resolvePyFileInCopy(dir, rel) {
  const norm = rel.replace(/\\/g, '/');
  const m = /(?:^|\/)(app\/.+\.py)$/.exec(norm);
  if (m) {
    const cand = resolve(dir, m[1]);
    if (existsSync(cand)) return cand;
  }
  // Fallback: il path e' gia' relativo alla copia.
  const direct = resolve(dir, norm);
  if (existsSync(direct)) return direct;
  return null;
}

// SPY-S6 — secret-in-history (Python): ROTAZIONE dichiarata, NESSUNA riscrittura
// di history (distruttiva, gate umano). Riusa il pattern di fixSecretHistoryS2:
// la chiave vive SOLO nella git history (app/legacy_credentials.py rimosso dal
// working tree); purgarla richiede git filter-repo (distruttivo) -> MAI autonomo.
// Esito atteso: mitigated-residual, MAI verified (L-COL-006/L-COL-024).
function fixSecretHistorySpyS6() {
  return {
    ok: true,
    detail:
      'SPY-S6: rotazione chiave PRESCRITTA e dichiarata (azione fuori dal codice, '
      + 'console provider). History NON riscritta (purga distruttiva, gate umano). '
      + 'Esito atteso: mitigated-residual (mai verified).',
    rotationDeclared: true,
    historyRewritten: false,
  };
}

// Mappa controlId(rule_id) -> costruttore di patch.
const FIX_TABLE = {
  // gitleaks: il rule_id varia per regola; mappiamo per categoria nel selettore.
  'RLS001_MISSING_RLS': { kind: 'rls', apply: fixRlsS3, signature: 'fix-s3-enable-rls-audit_logs' },
  'RLS003_PERMISSIVE_TRUE': { kind: 'rls', apply: fixRlsS4, signature: 'fix-s4-real-predicate-documents' },
  'RLS004_MISSING_TENANT_PREDICATE': { kind: 'rls', apply: fixRlsS5, signature: 'fix-s5-tenant-predicate-invoices' },
};

// Seleziona la patch nota per un finding. Per secret/dead-code si seleziona per
// categoria + path (i rule_id di gitleaks/knip/vulture sono meno stabili dei
// controlId rls). DISPATCH keyed sul finding/ecosystem: il ramo Python (.py /
// supabase-py) e quello JS (.ts) coesistono, NESSUNO interferisce con l'altro.
function selectKnownFix(finding) {
  const cat = finding.category;
  const file = String((finding.location && finding.location.file) || '').replace(/\\/g, '/');
  const ruleId = (finding.source_oracle && finding.source_oracle.rule_id) || '';
  const isPy = /\.py$/.test(file);
  // Discrimina la fixture Python supabase-py: la sua migration ha la policy
  // invoices_select USING(true) su public.invoices. La fixture JS usa marker
  // diversi (-- SEED:S4 su documents). Distinguiamo per la presenza della policy
  // invoices_select nella signature/symbol del finding (location.symbol = policy).
  const policySym = String((finding.location && finding.location.symbol) || '');
  const isPyMigration = /supabase\/migrations\/.*\.sql$/.test(file) && policySym === 'invoices_select';

  // --- RAMO PYTHON (SP-4, supabase-py) — additivo, PRECEDENZA su FIX_TABLE --
  // Deve precedere il lookup FIX_TABLE: RLS003_PERMISSIVE_TRUE e' in FIX_TABLE
  // mappato alla fix JS fixRlsS4 (cerca "USING (true); -- SEED:S4", marker assente
  // nella fixture Python). Per la migration Python (policy invoices_select) usiamo
  // fixRlsSpyS3 -> altrimenti la fix JS fallirebbe il pattern.
  if (cat === 'rls' && isPyMigration && ruleId === 'RLS003_PERMISSIVE_TRUE') {
    return { kind: 'rls', apply: fixRlsSpyS3, signature: 'fix-spy-s3-invoices-auth-uid' };
  }

  if (cat === 'rls' && FIX_TABLE[ruleId]) {
    return FIX_TABLE[ruleId];
  }

  if (cat === 'secret' && isPy) {
    // SPY-S6: secret-in-history Python (app/legacy_credentials.py, assente dal
    // working tree) -> rotazione dichiarata, mitigated-residual (mai verified).
    if (/legacy_credentials\.py$/.test(file)) {
      return { kind: 'secret-history', apply: fixSecretHistorySpyS6, signature: 'rotate-spy-s6-no-rewrite' };
    }
    // SPY-S1: secret working-tree Python (app/config.py) -> os.getenv(...).
    if (/(^|\/)app\/config\.py$/.test(file)) {
      return { kind: 'secret', apply: fixSecretSpyS1, signature: 'fix-spy-s1-env-config-py' };
    }
  }
  if (cat === 'dead-code' && isPy) {
    // SPY-S5: dead-code Python (vulture {file,line,symbol}) -> rimozione sicura
    // del simbolo via helper riusabile. La signature include il simbolo cosi'
    // ogni simbolo morto distinto ha una patch MATERIALMENTE distinta.
    const sym = (finding.location && finding.location.symbol) || '?';
    return { kind: 'dead-code', apply: fixDeadcodeSymbol, signature: `fix-spy-s5-remove-symbol:${sym}` };
  }

  // --- RAMO JS/TS (invariato) ----------------------------------------------
  if (cat === 'secret') {
    // secret-in-history (S2): path src/legacy/credentials.ts (non esiste piu' nel
    // working tree) -> rotazione simulata, mitigated-residual.
    if (/legacy\/credentials\.ts$/.test(file)) {
      return { kind: 'secret-history', apply: fixSecretHistoryS2, signature: 'rotate-s2-no-rewrite' };
    }
    // secret working-tree (S1): config.ts -> rimuovi il literal.
    if (/lib\/config\.ts$/.test(file)) {
      return { kind: 'secret', apply: fixSecretS1, signature: 'fix-s1-env-config' };
    }
  }
  if (cat === 'dead-code') {
    return { kind: 'dead-code', apply: fixDeadcodeS8, signature: 'fix-s8-remove-dead-export' };
  }
  return null;
}

// FIX PROVIDER deterministico (EVAL-MODE). Implementa propose(...). Restituisce
// una Patch o null se non c'e' fix nota (categoria detection-only fuori scope).
export function deterministicFixProvider() {
  return {
    name: 'eval-deterministic',
    propose(finding, attempt /*, lastFailureReason */) {
      const known = selectKnownFix(finding);
      if (!known) return null;
      // Nel set in-scope la prima fix e' gia' corretta: non servono varianti.
      // Se per ipotesi servisse un retry, qui si restituirebbe una variante con
      // signature DIVERSA. Per i difetti seminati questo non accade (attempt 1
      // basta), ma la macchina resta capace di gestirlo.
      return {
        id: `${finding.fingerprint.slice(0, 8)}-a${attempt}`,
        kind: known.kind,
        signature: known.signature,
        // Passiamo il finding all'apply: i fix Python data-driven (es.
        // fixDeadcodeSymbol) ne ricavano file/symbol. I fix JS lo ignorano
        // (firma backward-compatible: secondo arg opzionale).
        apply: (workspaceDir) => known.apply(workspaceDir, finding),
      };
    },
  };
}
