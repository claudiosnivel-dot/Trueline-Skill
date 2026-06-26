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
import { removeTsSymbol } from './ts_deadcode_edit.mjs';
import { resolveRlsMigrationsDir, resolveRlsMigrationFile } from './rls_scan.mjs';

// Path RELATIVO STORICO della migration primaria (layout Supabase). Conservato
// come fallback BIT-INVARIANTE: i fix RLS lo usano quando il resolver
// manifest-driven non trova alcuna migration-dir (es. dir senza migration).
const MIGRATION_REL = 'supabase/migrations/0001_init.sql';
const CONFIG_REL = 'src/lib/config.ts';
const DEAD_REL = 'src/legacy/unused.ts';

// MANIFEST-DRIVEN (O-COL-011): localizza la migration .sql primaria da fixare
// nella copia `dir`, SENZA cablare la migration-dir ne' il nome-file. Usa la
// probe-list di default del resolver ('supabase/migrations' PRIMA -> BIT-invariante
// per le fixture Supabase; 'migrations/' per postgres-py). Se il resolver non
// trova alcun .sql, FALLBACK al path storico (BIT-invariante): cosi' i chiamanti
// che prima cablavano sempre MIGRATION_REL hanno lo stesso path su quel layout.
function migrationFileFor(dir, opts = {}) {
  const found = resolveRlsMigrationFile(dir, { manifest: opts.manifest });
  return found || resolve(dir, MIGRATION_REL);
}

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
  return patchAbsFile(resolve(dir, rel), needle, replacement, label, rel);
}

// Variante che opera su un path GIA' ASSOLUTO (per i fix RLS manifest-driven:
// la migration-dir e' risolta dal resolver, non cablata). `labelPath` e' solo
// per i messaggi.
function patchAbsFile(p, needle, replacement, label, labelPath) {
  if (!existsSync(p)) return { ok: false, detail: `file assente: ${labelPath || p}` };
  const before = readFileSync(p, 'utf8');
  if (!needle.test(before)) {
    return { ok: false, detail: `pattern non trovato per ${label} in ${labelPath || p}` };
  }
  const after = before.replace(needle, replacement);
  if (after === before) return { ok: false, detail: `nessuna modifica applicata (${label})` };
  writeFileSync(p, after, 'utf8');
  return { ok: true, detail: `${label}: patch applicata su ${labelPath || p}` };
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
  const p = migrationFileFor(dir);
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
// MANIFEST-DRIVEN: la migration-dir e' risolta dal resolver (BIT-invariante
// 'supabase/migrations' per la fixture JS).
function fixRlsS4(dir) {
  return patchAbsFile(
    migrationFileFor(dir),
    /USING \(true\);\s*-- SEED:S4/,
    'USING (owner_id = auth.uid());  -- FIX:S4',
    'S4 rls', MIGRATION_REL,
  );
}

// S5 — policy senza isolamento per tenant: aggiunge il vincolo auth.uid()/tenant_id.
function fixRlsS5(dir) {
  return patchAbsFile(
    migrationFileFor(dir),
    /USING \(status <> 'draft'\);/,
    "USING (status <> 'draft' AND tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);  -- FIX:S5",
    'S5 rls', MIGRATION_REL,
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

// PY-S1 (condiviso supabase-py SPY-S1 / postgres-py PY-S1) — secret working-tree
// Python: sostituisce le credenziali hardcoded in app/config.py con os.getenv(...).
// Cosi' gitleaks working-tree torna PULITO su app/config.py (sparisce il literal
// della chiave + la DSN con password) -> verified. La suite di caratterizzazione
// resta verde: con le env impostate get_database_url()/get_service_role_key()/
// get_api_key() tornano il valore d'ambiente (ramo "env presente" invariato), e
// PORT continua a leggere os.environ.
//
// MULTI-ECOSYSTEM (additivo, BIT-INVARIANTE): la stessa funzione bonifica sia il
// literal Supabase (SUPABASE_SERVICE_ROLE_KEY = "eyJ...") sia quello postgres-py
// (API_KEY = "sk_live_..."). Le DUE replace dei nomi-chiave sono mutuamente
// esclusive per fixture: supabase-py NON ha la riga API_KEY (la sua replace e' un
// NO-OP la' -> path byte-identico), postgres-py NON ha SUPABASE_SERVICE_ROLE_KEY
// (idem). DATABASE_URL e' condiviso. Cosi' il ramo Supabase resta invariato.
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
  // SUPABASE_SERVICE_ROLE_KEY = "eyJ...": -> os.getenv (fixture supabase-py).
  src = src.replace(
    /^SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"'\n]*["']\s*$/m,
    'SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")',
  );
  // API_KEY = "sk_live_...": -> os.getenv (fixture postgres-py). Riga ASSENTE in
  // supabase-py -> replace NO-OP la' (BIT-invariante).
  src = src.replace(
    /^API_KEY\s*=\s*["'][^"'\n]*["']\s*$/m,
    'API_KEY = os.getenv("API_KEY", "")',
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
  // MANIFEST-DRIVEN (O-COL-011): la migration-dir e' risolta dal resolver. Per
  // supabase-py il layout e' 'supabase/migrations' (BIT-invariante); il resolver
  // generalizza a 'migrations/' per il layout postgres-py senza cablarlo.
  const p = migrationFileFor(dir);
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

// PY-S3 — RLS USING (true) su public.invoices (fixture postgres-py, NON-Supabase):
// trasferisce il fix RLS (USING(true) -> predicato reale) sulla migration della
// fixture Postgres. A DIFFERENZA di SPY-S3 (Supabase, auth.uid()), l'idioma di
// isolamento e' current_setting('app.current_tenant')::uuid — lo STESSO del
// contrasto PULITO della fixture (policy notes_select), che rls_check non flagga.
// Cosi' la policy riscritta usa l'idioma corretto per un Postgres non-Supabase
// (auth.uid() non esiste fuori da Supabase): rls_check torna PULITO (0 finding)
// -> verified, e la migration NON contiene auth.uid() (idioma coerente).
//
// MANIFEST-DRIVEN (O-COL-011 / L-COL-029): la migration-dir e' risolta dal resolver
// (migrationFileFor), che per il layout postgres-py risolve 'migrations/' (la dir
// 'supabase/migrations' non esiste nella copia -> il resolver cade su 'migrations').
function fixRlsPgS3(dir) {
  const p = migrationFileFor(dir);
  if (!existsSync(p)) return { ok: false, detail: `migration assente: ${MIGRATION_REL}` };
  const sql = readFileSync(p, 'utf8');
  // Match mirato alla policy invoices_select su public.invoices (NON tocca il
  // contrasto notes_select, gia' isolato via current_setting). Come in SPY-S3, il
  // match cattura il terminatore `;` ($2) e lo RI-EMETTE PRIMA del commento di
  // fix: senza, il commento commenterebbe il `;` lasciando lo statement aperto e
  // agganciando il successivo (create table notes) -> migration ROTTA a runtime.
  const re = /(create\s+policy\s+invoices_select\s+on\s+public\.invoices\s+for\s+select\s+using\s*\()\s*true\s*(\)\s*;?)/i;
  if (!re.test(sql)) {
    return { ok: false, detail: 'PY-S3: policy invoices_select USING (true) non trovata in 0001_init.sql' };
  }
  // Idioma Postgres non-Supabase: current_setting('app.current_tenant')::uuid,
  // identico al contrasto pulito notes_select (isolamento reale per tenant).
  const after = sql.replace(
    re,
    "$1tenant_id = current_setting('app.current_tenant')::uuid$2  -- FIX:PY-S3",
  );
  if (after === sql) return { ok: false, detail: 'PY-S3: nessuna modifica applicata' };
  writeFileSync(p, after, 'utf8');
  return { ok: true, detail: "PY-S3: invoices_select USING(true) -> USING(tenant_id = current_setting('app.current_tenant')::uuid)" };
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

// =============================================================================
// FIX JS/TS NON-Supabase (SP-7, postgres-jsts) — additive. BINDING dei seed-path
// di postgres-jsts ai rami JS/TS GIA' ESISTENTI del dispatch (selectKnownFix):
// PG-S1 secret -> process.env ; PG-S5 dead-code -> rimozione simbolo (knip).
// PG-S6 secret-in-history riusa SENZA modifiche il ramo legacy/credentials.ts ->
// fixSecretHistoryS2 (mitigated-residual). Nessun nuovo algoritmo: si lega il
// path/simbolo del seed alla macchina di fix esistente.
// =============================================================================

// Path della config TS della fixture postgres-jsts (layout 'src/config.ts', SENZA
// 'lib/'): distinto dal CONFIG_REL Supabase ('src/lib/config.ts') -> i due rami
// secret-WT non si sovrappongono (selettore keyed sul path).
const PG_CONFIG_REL = 'src/config.ts';

// PG-S1 — secret working-tree (postgres-jsts): rimuove i literal hardcoded
// (const DATABASE_URL = "postgres://...:password@..." e const SERVICE_TOKEN =
// "sk_live_PGS1...") in src/config.ts e fa leggere la config dal SOLO process.env.
// Cosi' gitleaks working-tree torna PULITO su src/config.ts -> verified. La suite
// di caratterizzazione (node:test) resta VERDE: con DATABASE_URL/SERVICE_TOKEN
// impostate, config.databaseUrl/serviceToken tornano il valore d'ambiente (il ramo
// "env presente" e' preservato; il fallback hardcoded diventa "").
//
// DIVERSO da fixSecretS1 (Supabase, src/lib/config.ts, un solo
// SUPABASE_SERVICE_ROLE_KEY): qui i literal sono due const SEPARATE e la lettura e'
// `process.env.X ?? CONST`. Rimuoviamo le due const e degradiamo il fallback a "".
function fixSecretPgS1(dir) {
  const p = resolve(dir, PG_CONFIG_REL);
  if (!existsSync(p)) return { ok: false, detail: `file assente: ${PG_CONFIG_REL}` };
  let src = readFileSync(p, 'utf8');
  const before = src;

  // 1) Rimuovi la dichiarazione `const DATABASE_URL = "...";` (puo' essere su piu'
  //    righe: il literal e' su una riga separata).
  src = src.replace(/const\s+DATABASE_URL\s*=\s*\n?\s*"[^"]*";\s*\n?/, '');
  // 2) Rimuovi la dichiarazione `const SERVICE_TOKEN = "...";`.
  src = src.replace(/const\s+SERVICE_TOKEN\s*=\s*\n?\s*"[^"]*";\s*\n?/, '');
  // 3) Degrada i fallback hardcoded a "" (env-only): il ramo "env presente" resta
  //    invariato (con env impostata, l'output e' identico prima/dopo).
  src = src.replace(/process\.env\.DATABASE_URL\s*\?\?\s*DATABASE_URL/, 'process.env.DATABASE_URL ?? ""');
  src = src.replace(/process\.env\.SERVICE_TOKEN\s*\?\?\s*SERVICE_TOKEN/, 'process.env.SERVICE_TOKEN ?? ""');

  if (src === before) {
    return { ok: false, detail: 'PG-S1: literal hardcoded non trovato in src/config.ts (pattern cambiato?)' };
  }
  writeFileSync(p, src, 'utf8');
  return { ok: true, detail: 'PG-S1: literal hardcoded in src/config.ts rimossi (config legge dal solo process.env)' };
}

// PG-S5 — dead-code TS (postgres-jsts): rimuove in modo SICURO la definizione del
// simbolo morto segnalato da knip (finding {file, symbol}, ruleId unused-export).
// Delega all'helper riusabile removeTsSymbol (ts_deadcode_edit.mjs): rimuove SOLO
// la definizione top-level esportata (non rompe il modulo); se il simbolo non e'
// un export top-level fallisce ONESTAMENTE (mai una rimozione approssimata). Gate
// umano: L-COL-021 (in eval auto-approvato dal loop). Dopo, knip NON segnala piu'
// il simbolo -> verified; il contrasto usedHelper resta intatto (la suite di
// caratterizzazione resta verde).
//
// DIVERSO da fixDeadcodeS8 (m5/supabase-jsts): la' il finding e' un FILE
// interamente non referenziato (knip unused-file, location.symbol assente) e la
// fix corretta e' rimuovere il file; qui il finding ha un SIMBOLO (unused-export)
// dentro un file che contiene anche codice vivo (usedHelper) -> si rimuove il SOLO
// simbolo. Il selettore discrimina i due casi sulla PRESENZA di location.symbol.
function fixDeadcodeTsSymbol(dir, finding) {
  const rel = String((finding && finding.location && finding.location.file) || '')
    .replace(/\\/g, '/');
  const symbol = (finding && finding.location && finding.location.symbol) || '';
  if (!rel || !symbol) {
    return { ok: false, detail: `PG-S5: finding senza file/symbol (file=${rel || '?'} symbol=${symbol || '?'})` };
  }
  const absFile = resolveTsFileInCopy(dir, rel);
  if (!absFile) {
    return { ok: false, detail: `PG-S5: file TS non risolto nella copia (${rel})` };
  }
  const r = removeTsSymbol(absFile, symbol);
  if (!r.ok) return { ok: false, detail: `PG-S5: ${r.detail}` };
  return { ok: true, detail: `PG-S5: ${r.detail}` };
}

// Risolve il path ASSOLUTO del file .ts/.js nella COPIA `dir` a partire dal path
// (eventualmente repo-relativo) del finding. Strategia: prende il segmento a
// partire da "src/" (layout della fixture); fallback al path cosi' com'e' se gia'
// risolve dentro la copia. NON esce mai dalla copia (nessun ../ verso l'esterno).
function resolveTsFileInCopy(dir, rel) {
  const norm = rel.replace(/\\/g, '/');
  const m = /(?:^|\/)(src\/.+\.(?:ts|tsx|js|jsx|mjs|cjs))$/.exec(norm);
  if (m) {
    const cand = resolve(dir, m[1]);
    if (existsSync(cand)) return cand;
  }
  const direct = resolve(dir, norm);
  if (existsSync(direct)) return direct;
  return null;
}

// =============================================================================
// FIX FIREBASE (SP-8, firebase-jsts) — additive. authz Firestore (if true ->
// owner-scoped) + secret serviceAccount.json. Dispatch in selectKnownFix
// keyed su cat==='authz' && firestore.rules e cat==='secret' && serviceAccount.json:
// path DISGIUNTI dai rami esistenti -> nessuna interferenza (BIT-invariante).
// =============================================================================

// Risolve firestore.rules (di solito alla radice della copia) — mai fuori dalla copia.
function resolveFirestoreFileInCopy(dir, rel) {
  const norm = String(rel || 'firestore.rules').replace(/\\/g, '/');
  const m = /(?:^|\/)([^/]*firestore\.rules)$/.exec(norm);
  const cand = resolve(dir, m ? m[1] : 'firestore.rules');
  if (existsSync(cand)) return cand;
  const direct = resolve(dir, norm);
  return existsSync(direct) ? direct : null;
}

// FB-S3 (authz Firestore): riscrive `allow ...: if true;` in regola OWNER-SCOPED.
// firestore_rules_check considera PULITA una condizione non-literal-true che contiene
// un OWNER_COMPARISON_TOKEN ('resource.data' / 'request.auth.uid ==') — analogo
// dichiarativo del transfer RLS (USING(true)->auth.uid()). Tollera `if true` e `if (true)`.
//
// IMPORTANTE (riscrittura per-riga, non globale sul testo): la doc-comment in cima al
// file `firestore.rules` puo' CITARE la forma vulnerabile fra backtick (es.
// "una collection con `allow read, write: if true;`"). Una replace sul testo intero
// colpirebbe la PRIMA occorrenza — cioe' il COMMENTO — lasciando intatta la regola
// reale e l'oracolo continuerebbe a flaggare. Si itera per riga e si scarta la
// porzione di COMMENTO (`//...`) e gli span in backtick prima di cercare il match,
// applicando la sostituzione SOLO sulla prima riga di CODICE che concede `if true`.
function fixFirestoreRules(dir, finding) {
  const rel = (finding && finding.location && finding.location.file) || 'firestore.rules';
  const p = resolveFirestoreFileInCopy(dir, rel);
  if (!p) return { ok: false, detail: `FB-S3: firestore.rules non risolto (${rel})` };
  const src = readFileSync(p, 'utf8');
  const re = /(allow\s+[\w,\s]+:\s*if\s+)\(?\s*true\s*\)?(\s*;)/;
  const lines = src.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    // Porzione di CODICE della riga: rimuove gli span in backtick (doc) e il
    // commento di riga `//...`. Se qui non c'e' match, la riga e' solo prosa.
    const codeOnly = lines[i].replace(/`[^`]*`/g, '').replace(/\/\/.*$/, '');
    if (!re.test(codeOnly)) continue;
    lines[i] = lines[i].replace(re, '$1request.auth != null && request.auth.uid == resource.data.ownerId$2  // FIX:FB-S3');
    changed = true;
    break;
  }
  if (!changed) return { ok: false, detail: 'FB-S3: "allow ...: if true;" non trovato (fuori dai commenti)' };
  const after = lines.join('\n');
  if (after === src) return { ok: false, detail: 'FB-S3: nessuna modifica applicata' };
  writeFileSync(p, after, 'utf8');
  return { ok: true, detail: 'FB-S3: allow if true -> owner-scoped (resource.data.ownerId)' };
}

// FB-S1 (secret in serviceAccount.json): NEUTRALIZZA il valore private_key (il segreto
// committato) con un placeholder non-segreto, cosi' gitleaks working-tree e' pulito.
// Mantiene il file (struttura JSON intatta) -> nessun side-effect su knip/altri oracoli.
function fixSecretFbS1(dir, finding) {
  const rel = (finding && finding.location && finding.location.file) || 'serviceAccount.json';
  const norm = String(rel).replace(/\\/g, '/');
  const m = /(?:^|\/)([^/]*serviceAccount\.json)$/.exec(norm);
  const p = (() => {
    const cand = resolve(dir, m ? m[1] : 'serviceAccount.json');
    if (existsSync(cand)) return cand;
    const direct = resolve(dir, norm);
    return existsSync(direct) ? direct : null;
  })();
  if (!p) return { ok: false, detail: `FB-S1: serviceAccount.json non risolto (${rel})` };
  const src = readFileSync(p, 'utf8');
  // Sostituisce il valore di "private_key": "...PEM..." con "" (placeholder; il segreto
  // reale va in FIREBASE_PRIVATE_KEY / secret-manager — il file committato resta template).
  const after = src.replace(/("private_key"\s*:\s*)"(?:[^"\\]|\\.)*"/, '$1""');
  if (after === src) return { ok: false, detail: 'FB-S1: campo private_key non trovato' };
  writeFileSync(p, after, 'utf8');
  return { ok: true, detail: 'FB-S1: private_key neutralizzata (placeholder; leggere da env)' };
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
  // MANIFEST-DRIVEN layout (O-COL-011): la migration Python puo' vivere sotto
  // 'supabase/migrations/' (supabase-py) O 'migrations/' (postgres-py). La
  // discriminante FORTE resta la policy 'invoices_select' (assente nella fixture
  // JS, che usa marker -- SEED:S4 su documents). Il match sul path tollera
  // entrambi i layout senza cablare il prefisso supabase/.
  const isMigrationSql = /(?:^|\/)(?:supabase\/)?migrations\/.*\.sql$/.test(file);
  const isPyMigration = isMigrationSql && policySym === 'invoices_select';
  // ECOSYSTEM dell'idioma RLS (SP-6): il layout del path discrimina l'idioma di
  // isolamento corretto. supabase-py vive in 'supabase/migrations/' -> auth.uid()
  // (idioma Supabase). postgres-py vive in 'migrations/' (SENZA prefisso supabase/)
  // -> current_setting('app.current_tenant') (idioma Postgres non-Supabase, lo
  // stesso del contrasto pulito notes_select). NB: la fixture JS NON ha la policy
  // invoices_select, quindi isPyMigration la esclude a monte (resta su FIX_TABLE).
  const isSupabaseMigration = /(?:^|\/)supabase\/migrations\/.*\.sql$/.test(file);
  const isPgMigration = isMigrationSql && !isSupabaseMigration;

  // --- RAMO PYTHON RLS — additivo, PRECEDENZA su FIX_TABLE -------------------
  // Deve precedere il lookup FIX_TABLE: RLS003_PERMISSIVE_TRUE e' in FIX_TABLE
  // mappato alla fix JS fixRlsS4 (cerca "USING (true); -- SEED:S4", marker assente
  // nella fixture Python). Per la migration Python (policy invoices_select) usiamo
  // la fix per-ecosistema -> altrimenti la fix JS fallirebbe il pattern.
  if (cat === 'rls' && isPyMigration && ruleId === 'RLS003_PERMISSIVE_TRUE') {
    // postgres-py (layout 'migrations/', non-Supabase): idioma current_setting.
    if (isPgMigration) {
      return { kind: 'rls', apply: fixRlsPgS3, signature: 'fix-py-s3-invoices-current-setting' };
    }
    // supabase-py (layout 'supabase/migrations/'): idioma auth.uid() (invariato).
    return { kind: 'rls', apply: fixRlsSpyS3, signature: 'fix-spy-s3-invoices-auth-uid' };
  }

  if (cat === 'rls' && FIX_TABLE[ruleId]) {
    return FIX_TABLE[ruleId];
  }

  // --- RAMO AUTHZ FIRESTORE (SP-8, additivo) --------------------------------
  if (cat === 'authz' && /firestore\.rules$/.test(file)) {
    const mp = (finding.location && finding.location.symbol) || '';
    return { kind: 'authz', apply: fixFirestoreRules, signature: `fix-fb-s3-owner-scope:${mp}` };
  }
  // --- RAMO SECRET FIREBASE serviceAccount.json (SP-8, additivo) -------------
  // Precede i rami config.ts: il path serviceAccount.json e' disgiunto -> non interferisce.
  if (cat === 'secret' && /serviceAccount\.json$/.test(file)) {
    return { kind: 'secret', apply: fixSecretFbS1, signature: 'fix-fb-s1-neutralize-service-account' };
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

  // --- RAMO JS/TS (invariato per m5/supabase-jsts; additivo per postgres-jsts) --
  if (cat === 'secret') {
    // secret-in-history (S2 / PG-S6): path .../legacy/credentials.ts (non esiste
    // piu' nel working tree) -> rotazione simulata, mitigated-residual. Il pattern
    // 'legacy/credentials.ts$' copre SIA supabase-jsts S2 (src/legacy/credentials.ts)
    // SIA postgres-jsts PG-S6 (src/legacy/credentials.ts): stesso esito, ramo
    // BIT-invariante riusato senza modifiche (binding per path).
    if (/legacy\/credentials\.ts$/.test(file)) {
      return { kind: 'secret-history', apply: fixSecretHistoryS2, signature: 'rotate-s2-no-rewrite' };
    }
    // secret working-tree postgres-jsts (PG-S1): src/config.ts (SENZA 'lib/') ->
    // rimuovi i literal hardcoded, leggi dal solo process.env. Precede il ramo
    // Supabase 'lib/config.ts': i path sono disgiunti (src/config.ts vs
    // src/lib/config.ts), quindi additivo e non interferente.
    if (/(^|\/)src\/config\.ts$/.test(file)) {
      return { kind: 'secret', apply: fixSecretPgS1, signature: 'fix-pg-s1-env-config-ts' };
    }
    // secret working-tree Supabase (S1): src/lib/config.ts -> rimuovi il literal.
    if (/lib\/config\.ts$/.test(file)) {
      return { kind: 'secret', apply: fixSecretS1, signature: 'fix-s1-env-config' };
    }
  }
  if (cat === 'dead-code') {
    // DISCRIMINANTE additivo (BIT-invariante per m5): knip emette due forme di
    // finding dead-code -> unused-FILE (file interamente non referenziato,
    // location.symbol ASSENTE: m5/supabase-jsts S8) vs unused-EXPORT/-type/...
    // (SIMBOLO morto dentro un file con codice vivo, location.symbol PRESENTE:
    // postgres-jsts PG-S5 unusedDeadHelper). Solo il caso con simbolo passa per la
    // rimozione-simbolo (removeTsSymbol); il caso file-intero resta su fixDeadcodeS8
    // (rimozione del file) -> il ramo m5 e' BIT-invariante.
    const tsSym = (finding.location && finding.location.symbol) || '';
    if (tsSym) {
      return { kind: 'dead-code', apply: fixDeadcodeTsSymbol, signature: `fix-pg-s5-remove-ts-symbol:${tsSym}` };
    }
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
