# Eco-Expansion Fase F3 — Plan (hasura-jsts + amplify-jsts)

> Build via Dynamic Workflow (data ‖ oracoli paralleli → integrator engine seriale → verify Opus k=2). Git/gate = orchestratore. `main` intatto. Engine-wiring identico a F2 (5 dispatch per oracolo nuovo; vedi plan F2 §ENGINE).

**Goal:** Due pack verified con oracoli authz dichiarativi NUOVI su backend con costo di parsing: `hasura-jsts` (Hasura metadata, **YAML dep-free**) e `amplify-jsts` (AppSync/Amplify **Gen1**, SDL `@auth`). Category `authz`, CWE-862/A01:2025. Gateabili in questo sandbox (parser node).

**Global Constraints:** determinismo; IT prosa/EN id; git solo orchestratore; **BIT-invarianza** (engine additivo, rami nuovi keyed sul tool; `loop.mjs` case authz già dispatch per-oracolo da F2 → aggiungere 2 rami); 8 pack + m5 invariati; `needsDocker` off (injection bonus). Classify: marker distinti (`config.yaml`+`metadata/` per Hasura; `schema.graphql`/`amplify/` per Amplify) → nessuna collisione.

---

## SOTTO-PROGETTO A — `hasura-jsts` (verified)

### Oracle `trueline/scripts/oracles/hasura_metadata_check.mjs` (+ test)
- Modella su `firestore_rules_check.mjs` (contratto/shape: makeFinding nativo, JSON stdout, exit 2 senza args, parse error→parse_warnings).
- **YAML reader dep-free**: scrivi un parser del **subset** usato dalla metadata Hasura (mappe annidate per indentazione, sequenze `- `, scalari; niente anchor/flow/multiline-complessi). Raccoglie `metadata/**/*.yaml` (o un `tables.yaml`/`metadata.json` se presente — supporta anche JSON.parse come fallback).
- Struttura Hasura: ogni tabella ha `select_permissions`/`insert_permissions`/`update_permissions`/`delete_permissions`, ognuna `{ role, permission: { filter: {...}, columns: [...] } }`.
- **HASURA001_PUBLIC_PERMISSION** (HIGH, FLOOR, deterministico): una permission con `role` ∈ {`anonymous`,`public`,`*`} **e** `filter: {}` (filtro vuoto = nessun vincolo di riga). symbol-carrier `match_path` = `<table>.<permType>.<role>`.
- (opz. non-floor HASURA002: `filter: {}` su un ruolo non-anon → euristico.)

### Fix `fixHasuraS3(dir, finding)` (fix_provider.mjs)
- `filter: {}` → `filter: { user_id: { _eq: "X-Hasura-User-Id" } }` (owner-scoped) sulla permission colpita, **o** rimuove la permission anon. Signature `fix-hasura-owner-scope:<match_path>`. Keyed via category authz + path metadata.

### Data
- Manifest `references/ecosystems/hasura-jsts/ecosystem.json`: `languages:['js','ts']`, backend `hasura`, `detect:{files_any:['config.yaml','metadata/'], lang_any:['package.json']}` (⚠ `metadata/` è una dir-marker — verificare strongSignal su segmento dir; se serve, usare un file concreto come `metadata/databases/databases.yaml`), authz={tool:'hasura_metadata_check', kind:'hasura-metadata', scan:['metadata','.'], role:'authz-surface'}, secret=gitleaks, dep-vuln=osv(package-lock), injection=semgrep(bonus), dead-code=knip. floor [secret,dependency-vuln,authz]; verified_set [secret,dead-code,authz]. + guide + ruleset.
- Fixture `eval/ecosystems/hasura-jsts/reference-app/` (mirror firebase-jsts JS + `metadata/` Hasura): metadata YAML con UNA permission `role: anonymous, filter: {}` (SEED HS-S3) + UNA permission owner-scoped pulita (`filter: {user_id: {_eq: X-Hasura-User-Id}}`); secret HS-S1 (serviceAccount-like, private_key lunga); dead-code knip HS-S4; package-lock osv HS-S2. inner .git + knip (orchestratore).
- registry: HS-S1 secret→verified, HS-S2 dep-vuln→detection-only, HS-S3 authz(source_oracle 'hasura-metadata', anchor.match_path)→verified, HS-S4 dead-code→verified.
- verify_fix_check.mjs clone firebase-jsts.

---

## SOTTO-PROGETTO B — `amplify-jsts` (verified, Gen1)

### Oracle `trueline/scripts/oracles/appsync_auth_check.mjs` (+ test)
- Modella su firestore. Raccoglie `schema.graphql` (o `amplify/**/schema.graphql`). Parser SDL line/regex-based (no dep): trova `type <Name> @model` seguiti da `@auth(rules: [ ... ])`.
- **APPSYNC001_PUBLIC_AUTH** (HIGH, FLOOR, deterministico): una rule `{ allow: public }` dentro `@auth(rules: [...])` su un `@model` → accesso pubblico. symbol-carrier `match_path` = `<TypeName>@auth`. Regex robusta a whitespace: `/allow:\s*public/`.
- ⚠ **Gen2 = detection-only** (la sintassi Gen2 `a.allow.publicApiKey()` in TS è diversa; il floor SDL `@auth` è Gen1). Dichiararlo nel manifest/guide.

### Fix `fixAppsyncS3(dir, finding)` (fix_provider.mjs)
- `allow: public` → `allow: owner` sulla rule colpita. Signature `fix-appsync-owner-scope:<TypeName>`.

### Data
- Manifest `references/ecosystems/amplify-jsts/ecosystem.json`: backend `amplify`, `detect:{files_any:['schema.graphql','amplify/'], lang_any:['package.json']}`, authz={tool:'appsync_auth_check', kind:'appsync-auth', scan:['.','amplify'], role:'authz-surface'}. floor/verified_set come hasura. + guide (nota Gen2 detection-only) + ruleset.
- Fixture: `schema.graphql` con UN `@model` con `@auth(rules:[{allow: public}])` (SEED AM-S3) + UN model owner-scoped (`{allow: owner}`) pulito; secret AM-S1; dead-code knip AM-S4; osv AM-S2. inner .git + knip.
- registry: AM-S1..S4 (authz source_oracle 'appsync-auth').

---

## ENGINE (integrator Opus, SERIALE, additivo) — pattern F2
Per OGNUNO dei 2 oracoli: const path; `detectCategory` arm; `collectFindingsForLoop` ramo authz per tool; `pickSeedFinding` authz/match_path = riuso; `canonOracle` 2 if; `normalize` ORACLE_ALIASES + normalizeHasura/normalizeAppsync (category authz, CWE-862, A01:2025); `loop.mjs` case authz +2 rami (`hasura-metadata`→HASURA_METADATA_CHECK, `appsync-auth`→APPSYNC_AUTH_CHECK; default Firestore invariato); 2 fix in fix_provider; 2 righe PACK_FIXTURES verified.

## GATE F3 (orchestratore SERIALE)
- `ecosystem_conformance hasura-jsts` PASS + falsificabile; `amplify-jsts` PASS + falsificabile.
- Oracle-test verdi (hasura: anon+filter{}→1, owner→0, YAML malformato→parse_warning; appsync: allow:public→1, allow:owner→0, SDL malformato→parse_warning).
- No-regressione: 8 pack [DB-runtime deferred F6], m1 21/21, anti_tamper 49/49, build_discipline 21/21, **loop.mjs BIT** via firebase-jsts 34/34 + firebase-py 33/33 + appwrite/pocketbase 33/33, package_skill lint VERDE (10 pack), engine N/0 (loop.mjs += rami additivi), 0-contaminazione.
- Commit di fase (no merge). Ledger: oracoli nuovi = L-COL-029 additivo; verified = L-COL-030 fase 2.
