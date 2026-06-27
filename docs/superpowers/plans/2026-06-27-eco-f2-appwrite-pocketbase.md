# Eco-Expansion Fase F2 — Plan (appwrite-jsts + pocketbase-jsts)

> Build via Dynamic Workflow (data Sonnet ‖ engine-integrator Opus seriale ‖ verify Opus k=2). Git + gate SERIALE = orchestratore. `main` intatto (no merge fino a F6).

**Goal:** Due pack verified con **oracoli authz dichiarativi JSON nuovi** — `appwrite-jsts` (Appwrite, `appwrite.json`) e `pocketbase-jsts` (PocketBase, `pb_schema.json`). Entrambi category `authz` (CWE-862, A01:2025), gateabili in questo sandbox (parser node, niente DB/semgrep).

**Architecture:** I due oracoli sono **gemelli strutturali di `firestore_rules_check.mjs`** (CLI posizionale, `makeFinding` nativo `{control_id, severity, category:'authz', match_path, location, snippet, message}`, output JSON su stdout, exit 0 con findings, exit 2 senza args, parse-errori → `parse_warnings` mai throw). Parsing = `JSON.parse` (più semplice del tokenizer .rules). Ogni NUOVO oracolo = **5 dispatch** (detectCategory + collectFindingsForLoop + pickSeedFinding[riuso authz] + canonOracle + normalize alias/fn).

## Global Constraints
- Determinismo; prosa IT, identificatori EN. Git solo orchestratore. **BIT-invarianza:** edit engine **additivi** (rami nuovi keyed sul tool); 6 pack esistenti + m5 invariati.
- `needsDocker` off (authz/secret/dep-vuln nel floor, injection bonus). Classify: marker distinti (`appwrite.json` / `pb_schema.json`) → nessuna collisione tra loro né coi 6 pack.

## ⚠ Trappola load-bearing PocketBase
`pb_schema.json` rule fields: `""` (stringa vuota) = **PUBBLICO** (floor POCKETBASE001) · `null` = **LOCKED/admin-only** = **SICURO** (NESSUN finding) · stringa non-vuota = regola (valutare token owner). **Test obbligatorio:** `null` NON produce finding. Un oracolo che tratta `null` come "missing→public" è ESATTAMENTE al contrario.

---

## SOTTO-PROGETTO A — `appwrite-jsts` (verified)

### Oracle `trueline/scripts/oracles/appwrite_perms_check.mjs`
- Modella su `firestore_rules_check.mjs` (stesso contratto/shape). Raccoglie `appwrite.json` (dir ricorsiva o file).
- `JSON.parse`; itera `config.collections[]` (ognuna `$id`/`name`, `documentSecurity` bool, `$permissions[]` come `read("any")`, `create("users")`, …).
- **APPWRITE001_PUBLIC_PERMISSION** (HIGH, FLOOR, deterministico): una collection con `$permissions` che contiene una permission su `"any"` in scope mutante/lettura → match `/\b(read|create|update|delete|write)\s*\(\s*["']any["']\s*\)/`. symbol-carrier `match_path` = `<collectionId>#<permission>`.
- (opz. non-floor euristico **APPWRITE002**: `documentSecurity:false` su collection con permission a livello-collection larghe.)
- exit 2 senza args; parse error → `parse_warnings`.

### Oracle-test `appwrite_perms_check.test.mjs`
- public `read("any")` → 1 APPWRITE001; owner `read("users")`+documentSecurity:true → 0; JSON malformato → parse_warning, no throw; `null`/assente permissions → 0.

### Fix `fixAppwriteS3(dir, finding)` in `fix_provider.mjs`
- `("any")` → `("users")` sulla permission colpita + se `documentSecurity:false` → `true`. Signature `fix-appwrite-owner-scope:<collectionId>`. FIX selezionato via category authz + path `appwrite.json`.

### Data: manifest + fixture + registry + verify_fix_check
- Manifest `references/ecosystems/appwrite-jsts/ecosystem.json`: `languages:['js','ts']`, backend `appwrite`, `detect:{files_any:['appwrite.json'], lang_any:['package.json']}`, oracles secret=gitleaks, dep-vuln=osv(package-lock), authz={tool:'appwrite_perms_check', kind:'appwrite-perms', scan:['.'], role:'authz-surface'}, injection=semgrep(ruleset/, bonus), dead-code=knip. floor [secret,dependency-vuln,authz]; verified_set [secret,dead-code,authz]; coverage_policy 'declared'. + guide.md + ruleset/appwrite-jsts-injection.yml.
- Fixture `eval/ecosystems/appwrite-jsts/reference-app/` (mirror firebase-jsts JS layout): `appwrite.json` (collection pubblica SEED AW-S3 `read("any")` + collection owner-scoped pulita), `serviceAccount`/config secret SEED, dead-code knip (unused export), `package.json`+`package-lock.json` con 1 pin vulnerabile (osv), inner .git (orchestratore). registry.json: AW-S1 secret→verified, AW-S2 dep-vuln→floor/detection-only, AW-S3 authz(source_oracle 'appwrite-perms', anchor.match_path=`<collectionId>#…`)→verified, AW-S4 dead-code→verified.
- verify_fix_check.mjs clone firebase-jsts (dead-code knip).

---

## SOTTO-PROGETTO B — `pocketbase-jsts` (verified)

### Oracle `trueline/scripts/oracles/pocketbase_rules_check.mjs`
- Modella su firestore. Raccoglie `pb_schema.json`. `JSON.parse`; lo schema è un array di collections (o `{collections:[…]}`), ognuna `name`/`id` + rule fields `listRule/viewRule/createRule/updateRule/deleteRule`.
- **POCKETBASE001_PUBLIC_RULE** (HIGH, FLOOR, deterministico): un rule field **=== `""`** (stringa vuota) → pubblico. ⚠ **`null` (locked) e i field assenti → NESSUN finding.** symbol-carrier `match_path` = `<collection>.<ruleField>`.
- (opz. non-floor **POCKETBASE002**: rule non-vuota ma senza token `@request.auth` → euristico.)

### Oracle-test `pocketbase_rules_check.test.mjs`
- `listRule:""` → 1 POCKETBASE001; **`viewRule:null` → 0 (TEST CRITICO null=SAFE)**; `createRule:"@request.auth.id != \"\""` → 0; più rule `""` → N finding distinti; JSON malformato → parse_warning.

### Fix `fixPocketbaseS3(dir, finding)` in `fix_provider.mjs`
- `""` → `"@request.auth.id != \"\""` (autenticato) o owner `"@request.auth.id = user"` sul rule field colpito (match per `<collection>.<ruleField>`). Signature `fix-pocketbase-owner-scope:<collection>.<rule>`.

### Data: manifest + fixture + registry + verify_fix_check
- Manifest `references/ecosystems/pocketbase-jsts/ecosystem.json`: come appwrite ma `detect:{files_any:['pb_schema.json'], lang_any:['package.json']}`, authz={tool:'pocketbase_rules_check', kind:'pocketbase-rules', scan:['.'], role:'authz-surface'}.
- Fixture: `pb_schema.json` (collection con `listRule:""` SEED PB-S3 + collection `viewRule:null` LOCKED pulita + collection owner-scoped pulita) + secret/dead-code/dep-vuln seeds + inner .git. registry: PB-S1 secret, PB-S2 dep-vuln floor, PB-S3 authz(source_oracle 'pocketbase-rules')→verified, PB-S4 dead-code.

---

## ENGINE — 5 dispatch per oracolo (integrator Opus, SERIALE, additivo)
Clona gli arm `firestore_rules_check` esistenti in `eval/harness/ecosystem_conformance.mjs`:
1. **const path** (cima, ~L106-122): `APPWRITE_PERMS_CHECK` / `POCKETBASE_RULES_CHECK`.
2. **detectCategory** (~L908-992): `if (tool === 'appwrite_perms_check'){ run; return {findings: safeNormalize('appwrite-perms', native, opts)} }` (idem pocketbase). Clona l'arm firestore (gestisce output `{findings}` oggetto).
3. **collectFindingsForLoop** (~L819-862): l'arm authz dispatcha per tool → aggiungi i 2 rami (o generalizza authz per tool). cwd=dir.
4. **pickSeedFinding** (~L893-900): arm authz su `match_path` — **riuso** (i nuovi oracoli usano match_path).
5. **canonOracle** (~L241-252): `if (n==='appwrite-perms'||n==='appwrite_perms_check') return 'appwrite-perms'` (idem pocketbase).
6. **normalize.mjs**: ORACLE_ALIASES + `normalizeAppwritePerms`/`normalizePocketbaseRules` (category 'authz', CWE-862, A01:2025, fingerprint su match_path) + case nello switch.
7. **PACK_FIXTURES**: 2 righe verified.

## GATE F2 (orchestratore SERIALE)
- `ecosystem_conformance appwrite-jsts` PASS (~34) + falsificabile; `pocketbase-jsts` PASS (~34) + falsificabile + **test null=SAFE verde**.
- No-regressione: 6 pack esistenti [m5 56*/supabase-py 40*/postgres-py 40*/postgres-jsts 36/firebase-jsts 34/firebase-py 33] (*DB-runtime deferred F6), m1 21/21, anti_tamper 49/49, build_discipline 21/21, resolve.test, package_skill lint VERDE (8 pack), engine N/0, 0-contaminazione.
- Commit di fase su `feat/eco-expansion` (NO merge). Decisioni reversibili: nessuna nuova (oracoli nuovi = L-COL-029 additivo; verified = L-COL-030 fase 2).
