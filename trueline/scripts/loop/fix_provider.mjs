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

const MIGRATION_REL = 'supabase/migrations/0001_init.sql';
const CONFIG_REL = 'src/lib/config.ts';
const DEAD_REL = 'src/legacy/unused.ts';

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

// Mappa controlId(rule_id) -> costruttore di patch.
const FIX_TABLE = {
  // gitleaks: il rule_id varia per regola; mappiamo per categoria nel selettore.
  'RLS001_MISSING_RLS': { kind: 'rls', apply: fixRlsS3, signature: 'fix-s3-enable-rls-audit_logs' },
  'RLS003_PERMISSIVE_TRUE': { kind: 'rls', apply: fixRlsS4, signature: 'fix-s4-real-predicate-documents' },
  'RLS004_MISSING_TENANT_PREDICATE': { kind: 'rls', apply: fixRlsS5, signature: 'fix-s5-tenant-predicate-invoices' },
};

// Seleziona la patch nota per un finding. Per secret/dead-code si seleziona per
// categoria + path (i rule_id di gitleaks/knip sono meno stabili dei controlId rls).
function selectKnownFix(finding) {
  const cat = finding.category;
  const file = (finding.location && finding.location.file) || '';
  const ruleId = (finding.source_oracle && finding.source_oracle.rule_id) || '';

  if (cat === 'rls' && FIX_TABLE[ruleId]) {
    return FIX_TABLE[ruleId];
  }
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
        apply: (workspaceDir) => known.apply(workspaceDir),
      };
    },
  };
}
