# Eco-Expansion Fase F6 (+ Fase 0) — Plan (NoSQL: mongodb / dynamodb / cloudflare-d1)

> Build via Dynamic Workflow (Fase-0 engine Opus k=2 + 3 data Sonnet → integrator PACK_FIXTURES → verify). Git/gate = orchestratore. `main` intatto. Detection-tier come F4 (gateabili qui: gitleaks + osv + semgrep-docker).

**Goal:** 3 pack **detection** NoSQL — `mongodb-jsts`, `dynamodb-jsts`, `cloudflare-d1-jsts` — + il prerequisito **Fase 0** (content-detection in `resolve.mjs`) perché Mongo/Dynamo **non hanno un file-marker** che li distingua da un generico progetto JS (collidono con `postgres-jsts`/`supabase-jsts` su `package.json`).

## FASE 0 — content-detection in `resolve.mjs` [ENGINE, additivo, default-invariante]
- **Problema:** `classify()` è presence-only (`existsSync`). Due pack JS senza marker distinto collidono → `{ambiguous}`. Mongo/Dynamo si identificano solo da una **dipendenza** (`mongodb`/`mongoose`, `@aws-sdk/client-dynamodb`/`aws-sdk`), invisibile a presence-only.
- **Soluzione additiva:** nuovo campo opzionale `detect.deps_any` — lista di nomi-dipendenza; `classify` legge `package.json` (dependencies+devDependencies) / `requirements.txt` e, se uno dei `deps_any` è presente, conta come **strong-signal** (come un files_any). **Default-invariante:** i 17 pack esistenti NON usano `deps_any` → comportamento immutato (provare: tutti i gate + resolve.test invariati).
- **Implementazione:** in `classify()`, dopo il match `files_any`/`lang_any`, aggiungere un ramo che, per i manifest con `detect.deps_any`, legge il content di `package.json` (JSON.parse, già un file noto) e verifica l'intersezione coi `deps_any`. Aggiorna `strongSignal`/il conteggio hits. `validate_ecosystem`: accettare `deps_any` (opzionale) in `detect`.
- **Casi `resolve.test.mjs`:** progetto con `mongodb` in deps → `mongodb-jsts`; con `@aws-sdk/client-dynamodb` → `dynamodb-jsts`; un progetto postgres-jsts (no deps_any) → resta `postgres-jsts` (anti-regressione); Mongo+Dynamo insieme → `{ambiguous}`.

## I 3 pack (detection, template F4)
| id | detect | authz-surface (route-authz semgrep) | dep-vuln lockfile | nota |
|---|---|---|---|---|
| **cloudflare-d1-jsts** | `files_any:['wrangler.toml']`, `lang_any:['package.json']` | sink `env.DB.prepare(SQL)` + Workers `fetch(req, env)` context | package-lock.json | **marker reale `wrangler.toml`** → NON serve Fase 0 |
| **mongodb-jsts** | `deps_any:['mongodb','mongoose']`, `lang_any:['package.json']` | `insertOne/updateOne/deleteOne/findOneAndUpdate` + Mongoose `.save()/.create()` senza auth-guard | package-lock.json | ⚠ richiede Fase 0 |
| **dynamodb-jsts** | `deps_any:['@aws-sdk/client-dynamodb','aws-sdk']`, `lang_any:['package.json']` | `PutItemCommand/UpdateItemCommand/DeleteItemCommand` (no SQL) senza auth-guard | package-lock.json | ⚠ richiede Fase 0 |

Per ogni pack (come F4 detection): manifest (floor `[secret,dependency-vuln,authz]`, `verified_set:[]`, authz=semgrep ruleset, dead-code dichiarato non-floor) + guide + `ruleset/<id>-authz.yml` (regola semgrep route-authz NoSQL — verificare che semgrep coglie il seed S3 + 0 FP, modello sui ruleset F4 che passano) + fixture (secret seed gitleaks + dep-vuln pin REALE osv su package-lock + route-authz seed NoSQL + contrasto guarded; inner .git orchestratore; **niente node_modules**) + registry (S1 secret, S2 dep-vuln, S3 route-authz, tutti detection-only) + 1 riga PACK_FIXTURES detection.

> **Convex / Cloudflare-D1 dichiarativo:** authz IMPERATIVA → nessun floor statico → solo route-authz/semgrep (no oracolo declarativo, no verified). Coerente col brief §5.

## GATE F6 (orchestratore SERIALE)
- Fase 0: tutti i 17 gate esistenti + `resolve.test` **invariati** (default-invariante provato) + nuovi casi deps_any verdi.
- Per ogni `<id>`: `ecosystem_conformance <id>` detection PASS (~26; secret+dep-vuln hard, route-authz semgrep via docker) + classify positivo/negativo (cloudflare via wrangler.toml; mongo/dynamo via deps_any).
- No-regressione: 17 pack verified [DB-runtime deferred] + m1 21/21 + anti_tamper 49/49 + build_discipline 21/21 + `package_skill` lint VERDE (20 pack) + 0-contaminazione. engine: `resolve.mjs` deps_any additivo + `validate_ecosystem` deps_any + 3 righe PACK_FIXTURES.
- Commit di fase (no merge). Ledger: Fase 0 = raffinamento additivo `L-COL-029` (`classify` content-detect) — **nota di riconciliazione** da ratificare a F6-finale; pack NoSQL detection = nessun lock.
