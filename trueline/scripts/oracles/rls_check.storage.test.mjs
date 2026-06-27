// rls_check.storage.test.mjs — unit test del ramo storage NUOVO (RLS005_PUBLIC_BUCKET).
// Verifica su FATTI (L-COL-002): l'oracolo rls_check, eseguito su una migration con
// policy su storage.objects, emette RLS005 SOLO quando il predicato e' privo di un
// token di isolamento owner-scoped. Anti-regressione: lo scope public non e' toccato.
// Solo built-in; temp pid-named sotto eval/.tmp-storage-oracle-<pid> (gitignorata).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const RLS_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'rls_check.mjs');
const TMP = join(ROOT, 'eval', `.tmp-storage-oracle-${process.pid}`);

function fresh() { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); }

// Scrive un'unica migration .sql nella temp e ritorna i finding NATIVI di rls_check.
function runOnSql(sql) {
  fresh();
  writeFileSync(join(TMP, 'migration.sql'), sql);
  const r = spawnSync(process.execPath, [RLS_CHECK, TMP], {
    cwd: TMP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  let j = null;
  try { j = JSON.parse((r.stdout || '').trim()); } catch { /* gestito sotto */ }
  assert.ok(j && Array.isArray(j.findings), `rls_check non ha prodotto JSON (exit=${r.status}): ${r.stderr}`);
  return j.findings;
}

const countRls005 = (findings) => findings.filter((f) => f.control_id === 'RLS005_PUBLIC_BUCKET').length;

test('storage USING (true) -> 1 finding RLS005_PUBLIC_BUCKET', () => {
  const findings = runOnSql(
    'CREATE POLICY "public_read" ON storage.objects FOR SELECT USING (true);\n',
  );
  assert.equal(countRls005(findings), 1, 'policy storage pubblica -> esattamente 1 RLS005');
});

test('storage USING (owner = auth.uid()) -> 0 finding RLS005 (owner-scoped)', () => {
  const findings = runOnSql(
    'CREATE POLICY "own_objects" ON storage.objects FOR ALL USING (owner = auth.uid());\n',
  );
  assert.equal(countRls005(findings), 0, 'predicato owner = auth.uid() -> nessun RLS005');
});

test('storage USING ((storage.foldername(name))[1] = auth.uid()::text) -> 0 finding RLS005', () => {
  const findings = runOnSql(
    'CREATE POLICY "per_user_folder" ON storage.objects FOR SELECT '
    + 'USING ((storage.foldername(name))[1] = auth.uid()::text);\n',
  );
  assert.equal(countRls005(findings), 0, 'predicato storage.foldername/auth.uid() -> nessun RLS005');
});

test('anti-regressione: migration public (RLS003) -> conteggi public invariati, 0 RLS005', () => {
  const findings = runOnSql(
    'CREATE TABLE public.documents (id uuid PRIMARY KEY, owner_id uuid);\n'
    + 'ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;\n'
    + 'CREATE POLICY documents_all ON public.documents FOR ALL USING (true);\n',
  );
  // Il ramo storage NON tocca lo scope public: la USING(true) su public.documents
  // resta un RLS003 (comportamento storico), e NON deve diventare un RLS005.
  const rls003 = findings.filter((f) => f.control_id === 'RLS003_PERMISSIVE_TRUE').length;
  assert.equal(rls003, 1, 'public.documents USING(true) -> 1 RLS003 (invariato)');
  assert.equal(countRls005(findings), 0, 'nessun RLS005 sullo scope public (additivita\' rispettata)');
});

test.after(() => { rmSync(TMP, { recursive: true, force: true }); });
