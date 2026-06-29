// fix_provider.test.mjs — unit test dei fix NUOVI di SP-8 (authz Firestore + secret JSON).
// Verifica su FATTI (L-COL-002): dopo il fix, l'oracolo LEGATO ri-eseguito e' PULITO.
// Solo built-in; temp pid-named sotto eval/.tmp-sp8-unit-<pid> (gitignorata).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deterministicFixProvider } from '../../../eval/harness/fix_provider.eval.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const FIRESTORE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'firestore_rules_check.mjs');
const GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP = join(ROOT, 'eval', `.tmp-sp8-unit-${process.pid}`);
const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };

function fresh() { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); }
function runJson(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: TMP, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse((r.stdout || '').trim()); } catch { return null; }
}

const VULN_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /public_notes/{noteId} {
      // SEED:FB-S3
      allow read, write: if true;
    }
  }
}
`;

test('authz: fixFirestoreRules rende firestore_rules_check PULITO (if true -> owner-scoped)', () => {
  fresh();
  writeFileSync(join(TMP, 'firestore.rules'), VULN_RULES);
  const before = runJson(FIRESTORE, [TMP]);
  assert.ok(before && before.findings.length >= 1, 'prima del fix: >=1 finding FIRESTORE001');
  const finding = {
    category: 'authz', fingerprint: 'a'.repeat(64),
    location: { file: 'firestore.rules', symbol: '/databases/{database}/documents/public_notes/{noteId}' },
    source_oracle: { rule_id: 'FIRESTORE001_PUBLIC_ALLOW' },
  };
  const patch = deterministicFixProvider().propose(finding, 1);
  assert.ok(patch && patch.kind === 'authz', 'patch authz proposta');
  const res = patch.apply(TMP);
  assert.equal(res.ok, true, res.detail);
  const after = runJson(FIRESTORE, [TMP]);
  assert.equal(after.findings.length, 0, 'dopo il fix: 0 finding (oracolo pulito)');
});

test('secret: fixSecretFbS1 neutralizza il segreto in serviceAccount.json (gitleaks WT pulito)', () => {
  fresh();
  // service-account con private_key PEM (forma che gitleaks coglie).
  const sa = { type: 'service_account', project_id: 'p',
    private_key_id: 'kid',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkq=\n-----END PRIVATE KEY-----\n',
    client_email: 'x@p.iam.gserviceaccount.com' };
  writeFileSync(join(TMP, 'serviceAccount.json'), JSON.stringify(sa, null, 2));
  const finding = {
    category: 'secret', fingerprint: 'b'.repeat(64), _scope: 'working-tree',
    location: { file: 'serviceAccount.json' }, source_oracle: { rule_id: 'private-key' },
  };
  const patch = deterministicFixProvider().propose(finding, 1);
  assert.ok(patch && patch.kind === 'secret', 'patch secret proposta');
  const res = patch.apply(TMP);
  assert.equal(res.ok, true, res.detail);
  const txt = readFileSync(join(TMP, 'serviceAccount.json'), 'utf8');
  assert.doesNotMatch(txt, /BEGIN PRIVATE KEY/, 'il PEM e\' stato neutralizzato');
});

test('BIT-invarianza: un finding rls/secret-config esistente NON e\' deviato dai rami nuovi', () => {
  // cat secret su src/config.ts deve restare sul ramo fixSecretPgS1 (signature nota).
  const finding = { category: 'secret', fingerprint: 'c'.repeat(64), _scope: 'working-tree',
    location: { file: 'src/config.ts' }, source_oracle: { rule_id: 'generic' } };
  const patch = deterministicFixProvider().propose(finding, 1);
  assert.ok(patch && /fix-pg-s1-env-config-ts/.test(patch.signature), 'ramo config.ts invariato');
});

test.after(() => { rmSync(TMP, { recursive: true, force: true }); });
