// fix_provider.storage.test.mjs — unit test del fix NUOVO RLS005 (Supabase Storage).
// Verifica su FATTI (L-COL-002): data una migration con policy storage.objects
// pubblica, il fix provider deterministico seleziona fixRlsStorageS5, lo applica e
// rls_check ri-eseguito sulla COPIA non emette piu' RLS005 (-> verified).
// Falsificabilita': un fix no-op lascerebbe RLS005 -> il test FALLIREBBE (esplicito).
// Solo built-in; temp pid-named sotto eval/.tmp-storage-fix-<pid> (gitignorata).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deterministicFixProvider } from './fix_provider.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const RLS_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'rls_check.mjs');
const TMP = join(ROOT, 'eval', `.tmp-storage-fix-${process.pid}`);

// La migration vive nel layout Supabase: migrationFileFor la risolve (resolver,
// con fallback BIT-invariante a supabase/migrations/0001_init.sql).
const MIG_DIR = join(TMP, 'supabase', 'migrations');
const MIG_FILE = join(MIG_DIR, '0001_init.sql');

const VULN_SQL = '-- bucket avatars: policy permissiva (pubblica)\n'
  + 'CREATE POLICY "avatars_public" ON storage.objects FOR SELECT USING (true);\n';

function fresh() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(MIG_DIR, { recursive: true });
  writeFileSync(MIG_FILE, VULN_SQL);
}

// Conta i finding RLS005 NATIVI di rls_check eseguito sulla migration-dir della copia.
function countRls005() {
  const r = spawnSync(process.execPath, [RLS_CHECK, MIG_DIR], {
    cwd: TMP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  let j = null;
  try { j = JSON.parse((r.stdout || '').trim()); } catch { /* gestito sotto */ }
  assert.ok(j && Array.isArray(j.findings), `rls_check non ha prodotto JSON (exit=${r.status}): ${r.stderr}`);
  return j.findings.filter((f) => f.control_id === 'RLS005_PUBLIC_BUCKET').length;
}

// Finding normalizzato (forma che arriva al fix provider nel loop): category 'rls',
// rule_id RLS005, location.symbol = nome-policy (normalize: symbol = policy||table).
const finding = {
  category: 'rls',
  fingerprint: 'd'.repeat(64),
  location: { file: 'supabase/migrations/0001_init.sql', symbol: 'avatars_public' },
  source_oracle: { rule_id: 'RLS005_PUBLIC_BUCKET' },
};

test('rls/storage: selectKnownFix -> fixRlsStorageS5 (signature dedicata)', () => {
  fresh();
  const patch = deterministicFixProvider().propose(finding, 1);
  assert.ok(patch, 'patch proposta per RLS005');
  assert.equal(patch.kind, 'rls', 'kind = rls');
  assert.equal(patch.signature, 'fix-storage-owner-scope-bucket',
    'la patch RLS005 e\' instradata a fixRlsStorageS5 (FIX_TABLE), non a un altro ramo RLS');
});

test('rls/storage: fix applicato -> rls_check ri-eseguito 0 RLS005 (verified)', () => {
  fresh();
  assert.equal(countRls005(), 1, 'prima del fix: 1 RLS005 (la migration e\' vulnerabile)');
  const patch = deterministicFixProvider().propose(finding, 1);
  const res = patch.apply(TMP);
  assert.equal(res.ok, true, res.detail);
  // FATTO: l'oracolo LEGATO ri-eseguito sulla copia e' PULITO.
  assert.equal(countRls005(), 0, 'dopo il fix: 0 RLS005 (predicato owner-scoped)');
});

test('rls/storage: falsificabilita\' — un fix NO-OP lascia RLS005 (il gate misura davvero)', () => {
  fresh();
  // Simula un fix che non tocca il file (no-op): l'asserzione "0 RLS005" del test
  // precedente NON reggerebbe. Cosi' il verde non e' un falso verde.
  const noop = (workspaceDir) => ({ ok: true, detail: `no-op su ${workspaceDir}` });
  const before = countRls005();
  noop(TMP);
  assert.equal(before, 1, 'pre-condizione: 1 RLS005');
  assert.equal(countRls005(), 1,
    'con un fix no-op la migration resta vulnerabile -> il test di verifica FALLIREBBE');
});

test('BIT-invarianza: un finding RLS public (RLS003) NON e\' deviato sul ramo storage', () => {
  // RLS003 resta mappato a fixRlsS4 (FIX_TABLE), invariato: il ramo storage non
  // intercetta le policy public (binding per rule_id RLS005).
  const f = {
    category: 'rls', fingerprint: 'e'.repeat(64),
    location: { file: 'supabase/migrations/0001_init.sql', symbol: 'documents_all' },
    source_oracle: { rule_id: 'RLS003_PERMISSIVE_TRUE' },
  };
  const patch = deterministicFixProvider().propose(f, 1);
  assert.ok(patch && patch.signature === 'fix-s4-real-predicate-documents',
    'RLS003 resta su fixRlsS4 (ramo storage non interferisce)');
});

test.after(() => { rmSync(TMP, { recursive: true, force: true }); });
