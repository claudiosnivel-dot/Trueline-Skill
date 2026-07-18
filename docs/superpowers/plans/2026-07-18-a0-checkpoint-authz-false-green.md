# A0 — Fix del falso verde authz del controllo 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il controllo 2 (sicurezza) del checkpoint non deve mai dare verde quando l'oracolo authz dichiarativo di un ecosistema non viene eseguito; deve eseguirlo (i 5 oracoli già esistono) e, se un oracolo di floor non parte, deve degradare invece di mentire.

**Architecture:** Estrarre in un modulo a **sorgente unica** (`authz_oracles.mjs`) la mappa `manifest-tool → {script, normalizeKey}` dei 5 oracoli authz dichiarativi, e consumarla da `control2Security` (gate batch) e da `collectFindings` (baseline del loop), riproducendo il wiring che l'harness di eval e `loop.mjs::rerunOracleFor` già usano. In più: (a) un oracolo di **floor** richiesto ma non eseguito rende il controllo 2 `degraded/green:false` (rete strutturale, `L-COL-006`); (b) `validate_ecosystem` valida il vocabolario categorie contro l'enum di `finding.schema.json`.

**Tech Stack:** Node ESM (solo built-in: `node:child_process`, `node:fs`, `node:path`, `node:test`). Nessuna dipendenza nuova. Oracoli e normalizer **già esistenti** — questo piano li cabla, non li crea.

## Global Constraints

- **`L-COL-002`** — il verdetto è un FATTO d'oracolo, mai una frase dell'LLM. Ogni "verde" del gate è l'output reale di un comando.
- **`L-COL-006`** — un oracolo che non gira NON è un verde; nessun falso "via libera". È l'invariante che A0 ripara.
- **BIT-invarianza `m5`** — `supabase-jsts` passa dal ramo manifest-driven; `floor = [secret, dependency-vuln, rls]` (authz/injection → semgrep, **fuori floor**). Il fix strutturale scatta solo per un oracolo di **floor** **richiesto ma fallito**: osv gated-off (`withOsv=false`) e i best-effort **detection-only** restano invariati. Target: `m5` **56/56** immutato.
- **Ramo legacy invariato** — `control2Security` senza manifest (`checkpoint.mjs:242-244`) resta identico byte-per-byte.
- **Git solo nell'orchestratore** (`L-COL-024`) — gli agenti non toccano git; branch `feat/a0-checkpoint-authz-false-green` (già creato), `main` intatto fino al merge human-gated. Provisioning `.git` dei fixture = passo d'orchestratore, mai dell'agente.
- **Windows** — attenzione al file `NUL` (nome riservato) che rompe `git add -A`; usare add esplicito. Righe LF→CRLF: atteso, non un errore.
- **Nessun lock nuovo** — A0 ripara un'invariante esistente. Un eventuale emendamento a `L-COL-006`/`L-COL-018` si valuta a fine milestone, non prima.
- **Dispatch a sorgente unica** — la mappa authz vive in UN modulo; un test di coerenza prova che concorda con `loop.mjs::rerunOracleFor` (evita la 3ª tabella divergente, debito `L-COL-029`).

---

## File Structure

**Creati:**
- `trueline/scripts/oracles/authz_oracles.mjs` — sorgente unica: `AUTHZ_ORACLES` (tool→{script,normalizeKey}), `AUTHZ_TOOL_NAMES`, `authzScanTarget()`, `runAuthzOracle()`.
- `trueline/scripts/oracles/authz_oracles.test.mjs` — unit + coerenza vs `loop.mjs`.
- `eval/harness/a0_authz_gate_check.mjs` — keystone: per i 6 pack, controllo 2 rosso sulla regola spalancata / verde sul contrasto owner-scoped; falsificabilità; degrado strutturale.
- `eval/ecosystems/_a0-fixtures/<pack>/{open,scoped}/…` — fixture minime (solo authz come difetto) per i 6 pack, + una fixture firebase realistica con test verdi per la prova "ship-it".

**Modificati:**
- `trueline/scripts/checkpoint/checkpoint.mjs` — `control2Security`: cablare gli oracoli authz in `runTool`; `floorMiss` → `degraded`. (Zona `runTool` `:155-215`, costruzione `tools` `:217-251`, verdetto `:253-265`.)
- `trueline/scripts/loop/run_loop.mjs` — `collectFindings(dir, manifest)`: seminare l'oracolo authz per-ecosistema (non solo firestore). (`:134-169`, chiamante `:357`.)
- `trueline/scripts/ecosystem/validate_ecosystem.mjs` — guard vocabolario categorie. (Dopo `:30`.)

---

## Task 1: Riproduzione dei blind spot (AC-0) — fixture + keystone che oggi FALLISCE

Chiude i due blind spot della spec **prima** di scrivere il fix: (a) il falso verde "ship-it" a checkpoint intero verde; (b) i 4 backend non-Firebase. Il keystone è scritto per asserire il comportamento **corretto** (controllo 2 rosso sulla regola spalancata): eseguito ora **fallisce su tutti e 6 i pack** — quel fallimento È l'evidenza del bug e diventerà verde nei Task 3-5.

**Files:**
- Create: `eval/ecosystems/_a0-fixtures/firebase-jsts/open/` (firestore.rules `if true` + `firebase.json` + `package.json`, NIENTE secret, NIENTE injection), `.../firebase-jsts/scoped/` (regola owner-scoped, contrasto pulito).
- Create: analoghe `open/`+`scoped/` per `firebase-py`, `appwrite-jsts`, `pocketbase-jsts`, `hasura-jsts`, `amplify-jsts` (il file dichiarativo del rispettivo backend, spalancato vs vincolato).
- Create: `eval/ecosystems/_a0-fixtures/firebase-jsts/shipit/` — fixture realistica con un test che passa (`node:test`), solo difetto = regola `if true`.
- Create: `eval/harness/a0_authz_gate_check.mjs`
- Create: `eval/ecosystems/_a0-fixtures/provision_fixtures.sh` (inner-`.git` dei fixture, eseguito dall'orchestratore).

**Interfaces:**
- Consumes: `runCheckpoint` da `trueline/scripts/checkpoint/checkpoint.mjs` (già esistente).
- Produces: `a0_authz_gate_check.mjs` eseguibile che esce 0 se tutti i sotto-test passano, 1 se un'asserzione fallisce, 2 se una precondizione (fixture assente) manca. Sotto-test nominati `open:<pack>`, `scoped:<pack>`, `shipit:firebase-jsts`, `falsifiable`, `degraded-floor-miss`, `degraded-detection-only`.

- [ ] **Step 1: Costruire le 6 fixture `open/` (regola spalancata, unico difetto)**

Per ciascun pack, copiare la struttura minima del rispettivo `eval/ecosystems/<pack>/reference-app`, tenendo SOLO il file dichiarativo spalancato e i file necessari a `classify()`, e RIMUOVENDO ogni altro seed (secret, injection, dead-code). Esempio `firebase-jsts/open/firestore.rules`:

```
service cloud.firestore {
  match /databases/{database}/documents {
    match /public_notes/{noteId} {
      allow read, write: if true;   // difetto authz — l'UNICO
    }
  }
}
```

E `firebase-jsts/open/firebase.json` + `package.json` minimi perché `classify()` risolva `firebase-jsts`. Per gli altri backend usare il file dichiarativo spalancato equivalente (`appwrite.json` con permessi `any`, `pb_schema.json` con regole vuote/nulle, metadata Hasura con `filter: {}` su ruolo anonimo, `schema.graphql` AppSync con `@auth` public).

- [ ] **Step 2: Costruire le 6 fixture `scoped/` (contrasto owner-scoped pulito)**

Stessa struttura, ma con la regola vincolata (es. `allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;`). L'oracolo authz su questa deve dare 0 finding.

- [ ] **Step 3: Costruire `firebase-jsts/shipit/` (checkpoint intero verde col buco)**

Fixture con: regola `if true` (difetto authz), NESSUN altro seed, un `package.json` con uno script `test` reale e un test `node:test` che passa, così che i controlli 1 (knip: 0 morto), 3 e 4 siano verdi. Scopo: dimostrare che oggi l'**intero** checkpoint è verde con la regola spalancata.

- [ ] **Step 4: Scrivere il keystone `a0_authz_gate_check.mjs`**

```js
#!/usr/bin/env node
// a0_authz_gate_check.mjs — keystone A0. Verita' = FATTO d'oracolo (L-COL-002).
// Per ogni pack con oracolo authz dichiarativo: il controllo 2 e' ROSSO sulla
// regola spalancata (open) e VERDE sul contrasto (scoped). + shipit + falsificabilita'.
import { runCheckpoint } from '../../trueline/scripts/checkpoint/checkpoint.mjs';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(HERE, '..', 'ecosystems', '_a0-fixtures');
const PACKS = ['firebase-jsts','firebase-py','appwrite-jsts','pocketbase-jsts','hasura-jsts','amplify-jsts'];
const RUN = { runId: 'a0', createdAt: '1970-01-01T00:00:00.000Z' };

let fails = 0;
const check = (name, cond, detail) => {
  if (!cond) { fails++; console.log(`  [FAIL] ${name} — ${detail}`); }
  else console.log(`  [ok]   ${name}`);
};
const control2 = (dir) => {
  const cp = runCheckpoint(dir, { mode: 'build', withOsv: false, runOpts: RUN });
  return cp.controls.find((c) => c.id === 2);
};

for (const p of PACKS) {
  const open = resolve(FIX, p, 'open');
  const scoped = resolve(FIX, p, 'scoped');
  if (!existsSync(open) || !existsSync(scoped)) { console.error(`precondizione: fixture ${p} assente`); process.exit(2); }
  const co = control2(open);
  check(`open:${p}`, co && co.green === false, `atteso controllo 2 ROSSO/degradato, visto green=${co && co.green} (${co && co.detail})`);
  const cs = control2(scoped);
  check(`scoped:${p}`, cs && cs.green === true, `atteso controllo 2 VERDE, visto green=${cs && cs.green} (${cs && cs.detail})`);
}

// shipit: intero checkpoint (firebase) — oggi verde col buco; dopo il fix, non-verde.
const shipit = resolve(FIX, 'firebase-jsts', 'shipit');
if (existsSync(shipit)) {
  const cp = runCheckpoint(shipit, { mode: 'build', withOsv: false, runOpts: RUN });
  check('shipit:firebase-jsts', cp.green === false, `atteso checkpoint NON-verde col buco authz, visto green=${cp.green}`);
}

console.log(fails === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 5: Provisionare i `.git` dei fixture (ORCHESTRATORE) ed eseguire il keystone — deve FALLIRE**

Provisioning via `eval/ecosystems/_a0-fixtures/provision_fixtures.sh` (init `.git` in ogni fixture, come `eval/anti-tamper/provision_fixtures.sh`). Poi:

Run: `node eval/harness/a0_authz_gate_check.mjs`
Expected: `RESULT: FAIL` — tutti gli `open:<pack>` e `shipit:firebase-jsts` falliscono (oggi verde col buco). Questa è l'evidenza AC-0 del falso verde su tutti e 6 i pack + ship-it.

- [ ] **Step 6: Commit**

```bash
rm -f ./NUL 2>/dev/null
git add eval/ecosystems/_a0-fixtures eval/harness/a0_authz_gate_check.mjs
git commit -m "test(a0): fixture 6 pack + keystone che documenta il falso verde authz (AC-0, oggi FAIL)"
```

---

## Task 2: Modulo a sorgente unica `authz_oracles.mjs`

Estrae la mappa authz in un modulo, con un test che prova la coerenza con `loop.mjs::rerunOracleFor` (nessuna 3ª tabella divergente). Addizione pura, nessun cambio di comportamento.

**Files:**
- Create: `trueline/scripts/oracles/authz_oracles.mjs`
- Test: `trueline/scripts/oracles/authz_oracles.test.mjs`

**Interfaces:**
- Produces:
  - `AUTHZ_ORACLES: Record<string,{script:string, normalizeKey:string}>` — chiavi = nomi-tool del manifest (`firestore_rules_check`, `appwrite_perms_check`, `pocketbase_rules_check`, `hasura_metadata_check`, `appsync_auth_check`).
  - `AUTHZ_TOOL_NAMES: Set<string>` — le stesse chiavi.
  - `authzScanTarget(dir: string, binding: object): string` — risolve la dir di scansione dal `binding.scan` (default `['.']`).
  - `runAuthzOracle(toolName: string, dir: string, binding: object, runOpts: object): { ok: boolean, findings: object[], detail: string, ran: boolean }` — esegue lo script e normalizza con `normalizeKey`; `ran:false` se lo script è assente/non produce JSON.

- [ ] **Step 1: Scrivere il test (unit + coerenza)**

```js
// authz_oracles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHZ_ORACLES, AUTHZ_TOOL_NAMES, authzScanTarget } from './authz_oracles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('mappa: 5 oracoli, chiavi = nomi-tool del manifest', () => {
  assert.deepEqual([...AUTHZ_TOOL_NAMES].sort(), [
    'appsync_auth_check','appwrite_perms_check','firestore_rules_check',
    'hasura_metadata_check','pocketbase_rules_check',
  ]);
});

test('ogni normalizeKey e la source_oracle attesa dal normalize', () => {
  assert.equal(AUTHZ_ORACLES.firestore_rules_check.normalizeKey, 'firestore-rules');
  assert.equal(AUTHZ_ORACLES.appwrite_perms_check.normalizeKey, 'appwrite-perms');
  assert.equal(AUTHZ_ORACLES.pocketbase_rules_check.normalizeKey, 'pocketbase-rules');
  assert.equal(AUTHZ_ORACLES.hasura_metadata_check.normalizeKey, 'hasura-metadata');
  assert.equal(AUTHZ_ORACLES.appsync_auth_check.normalizeKey, 'appsync-auth');
});

test('authzScanTarget: default "." quando il binding non ha scan', () => {
  assert.equal(authzScanTarget('/x', {}), resolve('/x', '.'));
});

test('COERENZA: ogni normalizeKey e dispatchata da loop.mjs::rerunOracleFor', () => {
  // il gate batch e il re-run del loop DEVONO eseguire lo stesso oracolo (L-COL-002).
  const loopSrc = readFileSync(resolve(HERE, '..', 'loop', 'loop.mjs'), 'utf8');
  for (const { normalizeKey } of Object.values(AUTHZ_ORACLES)) {
    assert.ok(loopSrc.includes(`'${normalizeKey}'`), `loop.mjs non dispatcha ${normalizeKey}`);
  }
});
```

- [ ] **Step 2: Eseguire il test → FAIL (modulo assente)**

Run: `node --test trueline/scripts/oracles/authz_oracles.test.mjs`
Expected: FAIL — `Cannot find module './authz_oracles.mjs'`.

- [ ] **Step 3: Scrivere il modulo**

```js
// authz_oracles.mjs — sorgente UNICA della mappa authz dichiarativa (A0).
// I 5 oracoli authz per-ecosistema condividono un contratto (CLI posizionale,
// JSON su stdout con {findings:[...]}, category 'authz', exit 0 anche con rilievi).
// Consumato dal checkpoint (control2Security) e dalla baseline del loop
// (collectFindings): il gate batch esegue lo STESSO oracolo del verify-fix loop
// (loop.mjs::rerunOracleFor), senza tabelle divergenti (L-COL-002/L-COL-029).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../findings/normalize.mjs';

const ORACLES = dirname(fileURLToPath(import.meta.url));
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

// manifest tool-name -> { script, normalizeKey }. normalizeKey = nome-oracolo atteso
// da `normalize` (= source_oracle.oracle del finding, = ramo di loop.mjs::rerunOracleFor).
export const AUTHZ_ORACLES = {
  firestore_rules_check:  { script: resolve(ORACLES, 'firestore_rules_check.mjs'),  normalizeKey: 'firestore-rules' },
  appwrite_perms_check:   { script: resolve(ORACLES, 'appwrite_perms_check.mjs'),   normalizeKey: 'appwrite-perms' },
  pocketbase_rules_check: { script: resolve(ORACLES, 'pocketbase_rules_check.mjs'), normalizeKey: 'pocketbase-rules' },
  hasura_metadata_check:  { script: resolve(ORACLES, 'hasura_metadata_check.mjs'),  normalizeKey: 'hasura-metadata' },
  appsync_auth_check:     { script: resolve(ORACLES, 'appsync_auth_check.mjs'),     normalizeKey: 'appsync-auth' },
};

export const AUTHZ_TOOL_NAMES = new Set(Object.keys(AUTHZ_ORACLES));

// dir di scansione dal binding (manifest.oracles.authz.scan), default ['.'].
export function authzScanTarget(dir, binding) {
  const scans = (binding && Array.isArray(binding.scan) && binding.scan.length) ? binding.scan : ['.'];
  const found = scans.find((s) => existsSync(resolve(dir, s)));
  return resolve(dir, found || '.');
}

// Esegue l'oracolo authz sullo scan target e normalizza (category 'authz').
// ran:false se lo script e' assente o non produce JSON (il chiamante decide se
// questo e' un floor-miss o un degrado onesto — L-COL-006). MAI un throw.
export function runAuthzOracle(toolName, dir, binding, runOpts) {
  const entry = AUTHZ_ORACLES[toolName];
  if (!entry) return { ok: false, ran: false, findings: [], detail: `tool authz ignoto: ${toolName}` };
  if (!existsSync(entry.script)) return { ok: false, ran: false, findings: [], detail: `oracolo assente: ${entry.script}` };
  const target = authzScanTarget(dir, binding);
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(process.execPath, [entry.script, target], { cwd: dir, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) return { ok: false, ran: false, findings: [], detail: `spawn: ${res.error.message}` };
  const raw = (res.stdout || '').trim();
  if (!raw) return { ok: false, ran: false, findings: [], detail: `nessun JSON (exit=${res.status})` };
  let json; try { json = JSON.parse(raw); } catch (e) { return { ok: false, ran: true, findings: [], detail: `JSON invalido: ${e.message}` }; }
  let findings; try { findings = normalize(entry.normalizeKey, json, { ...runOpts, scope: 'working-tree' }); }
  catch (e) { return { ok: false, ran: true, findings: [], detail: `normalize(${entry.normalizeKey}): ${e.message}` }; }
  return { ok: true, ran: true, findings, detail: `${findings.length} finding` };
}
```

- [ ] **Step 4: Eseguire il test → PASS**

Run: `node --test trueline/scripts/oracles/authz_oracles.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/oracles/authz_oracles.mjs trueline/scripts/oracles/authz_oracles.test.mjs
git commit -m "feat(a0): modulo authz_oracles a sorgente unica (tool->script/normalizeKey) + coerenza vs loop"
```

---

## Task 3: Cablare i 5 oracoli authz in `control2Security` (fix primario)

Il controllo 2 esegue l'oracolo authz dichiarativo del manifest e ne blocca i finding (`authz` è già in `gateCategories`). Chiude i 6 pack. Il keystone AC-0 passa da FAIL a PASS sugli `open:*` + `shipit`; il gemello falsificabile prova che il rosso viene dall'oracolo.

**Files:**
- Modify: `trueline/scripts/checkpoint/checkpoint.mjs` (`control2Security`, zona `:143-265`)
- Test: `eval/harness/a0_authz_gate_check.mjs` (già scritto in Task 1; ora deve passare gli `open`/`scoped`/`shipit`)

**Interfaces:**
- Consumes: `AUTHZ_ORACLES`, `AUTHZ_TOOL_NAMES`, `runAuthzOracle` da `../oracles/authz_oracles.mjs`.
- Produces: nessuna nuova firma pubblica; `control2Security` invariata in firma, cambia il set di tool eseguiti quando il manifest lega un oracolo authz dichiarativo.

- [ ] **Step 1: Aggiungere l'AC falsificabile al keystone**

In `a0_authz_gate_check.mjs`, dopo il loop dei pack, aggiungere il sotto-test `falsifiable` che prova che il rosso su `firebase-jsts/open` sparisce se si neutralizza l'oracolo (rinominando temporaneamente lo scan target) e ritorna ripristinando. Implementazione deterministica: eseguire il controllo 2 su `open` (atteso rosso), poi su una copia senza `firestore.rules` (atteso verde: nessun difetto), a dimostrare che è il finding dell'oracolo — non altro — a produrre il rosso.

```js
// falsifiable: il rosso di open viene dall'ORACOLO authz, non da altro.
import { cpSync, rmSync } from 'node:fs';
const openFb = resolve(FIX, 'firebase-jsts', 'open');
const tmp = resolve(FIX, 'firebase-jsts', '.tmp-falsify');
rmSync(tmp, { recursive: true, force: true });
cpSync(openFb, tmp, { recursive: true });
rmSync(resolve(tmp, 'firestore.rules'), { force: true }); // rimuovi il difetto
const cf = control2(tmp);
check('falsifiable', cf && cf.green === true, `senza firestore.rules il controllo 2 deve tornare VERDE, visto green=${cf && cf.green}`);
rmSync(tmp, { recursive: true, force: true });
```

- [ ] **Step 2: Eseguire il keystone → gli `open`/`shipit` ancora FALLISCONO**

Run: `node eval/harness/a0_authz_gate_check.mjs`
Expected: FAIL — `open:*`, `shipit` rossi attesi ma verdi (fix non ancora scritto); `scoped:*` e `falsifiable` già verdi.

- [ ] **Step 3: Importare il modulo in `checkpoint.mjs`**

In cima a `checkpoint.mjs`, accanto agli altri import:

```js
import { AUTHZ_ORACLES, AUTHZ_TOOL_NAMES, runAuthzOracle } from '../oracles/authz_oracles.mjs';
```

- [ ] **Step 4: Catturare il binding authz nella costruzione di `tools`**

In `control2Security`, sostituire il blocco `:225-245` (ramo `if (manifest && manifest.oracles)`) per NON scartare i tool authz e per ricordare il loro binding:

```js
  let tools;
  let gateCategories;
  const bindingByTool = new Map(); // tool -> binding (per lo scan authz)
  if (manifest && manifest.oracles) {
    const seen = new Set();
    tools = [];
    const toWrapper = { gitleaks: 'gitleaks', rls_check: 'rls_check', osv: 'osv', semgrep: 'semgrep' };
    for (const b of Object.values(manifest.oracles)) {
      const t = b && b.tool;
      if (!t) continue;
      if (t === 'knip') continue; // dead-code = controllo 1
      const wrapper = AUTHZ_TOOL_NAMES.has(t) ? t : (toWrapper[t] || t);
      if (AUTHZ_TOOL_NAMES.has(t)) bindingByTool.set(t, b);
      if (seen.has(wrapper)) continue;
      seen.add(wrapper);
      tools.push(wrapper);
    }
    gateCategories = control2CategoriesFrom(manifest);
  } else {
    tools = ['gitleaks', 'rls_check', 'osv', 'semgrep'];
    gateCategories = CONTROL2_GATE_CATEGORIES;
  }
```

- [ ] **Step 5: Aggiungere il ramo authz a `runTool`**

In `runTool`, PRIMA dello `switch` (o come primo controllo), gestire i tool authz via modulo:

```js
  function runTool(tool) {
    // authz dichiarativa (A0): esegue l'oracolo del manifest e normalizza a 'authz'.
    // Se lo script c'e' ma non produce finding -> contrasto pulito (verde legittimo).
    // Se NON gira (assente/JSON rotto) -> degrado; il chiamante decide floorMiss.
    if (AUTHZ_TOOL_NAMES.has(tool)) {
      const b = bindingByTool.get(tool);
      const a = runAuthzOracle(tool, referenceApp, b, runOpts);
      if (!a.ran) return { note: ` (${tool}: oracolo authz non eseguito, degradato — ${a.detail})`, ranFail: true };
      if (!a.ok) return { fatal: secErr(`authz ${tool}`, a.detail) };
      all.push(...a.findings); sub.push(`${AUTHZ_ORACLES[tool].normalizeKey}:${a.findings.length}`);
      return {};
    }
    switch (tool) {
      // ... rami gitleaks/rls_check/osv/semgrep INVARIATI ...
      default:
        return { note: ` (${tool}: tool sconosciuto, saltato — DICHIARATO, mai falso verde)`, ranFail: true };
    }
  }
```

(Il campo `ranFail` serve al Task 4; qui è inerte.)

- [ ] **Step 6: Eseguire il keystone → `open`/`scoped`/`shipit`/`falsifiable` PASSANO**

Run: `node eval/harness/a0_authz_gate_check.mjs`
Expected: PASS — tutti gli `open:<pack>` ora rossi (finding authz bloccante), `scoped:<pack>` verdi, `shipit:firebase-jsts` checkpoint non-verde, `falsifiable` verde.

- [ ] **Step 7: Commit**

```bash
git add trueline/scripts/checkpoint/checkpoint.mjs eval/harness/a0_authz_gate_check.mjs
git commit -m "fix(a0): control2Security esegue gli oracoli authz dichiarativi (6 pack, gate ROSSO sulla regola spalancata)"
```

---

## Task 4: Fix strutturale — oracolo di floor non eseguito → `degraded` (la rete)

Rende la classe di bug impossibile: un oracolo la cui categoria è nel **floor** e che è **richiesto ma non parte** declassa il controllo 2 a `degraded/green:false`. Best-effort **detection-only** e osv **gated-off** restano invariati (BIT-invarianza `m5`).

**Files:**
- Modify: `trueline/scripts/checkpoint/checkpoint.mjs` (`control2Security`, verdetto `:253-265`)
- Test: `eval/harness/a0_authz_gate_check.mjs`

**Interfaces:**
- Consumes: `manifest.floor`, il campo `ranFail` da `runTool` (Task 3).
- Produces: `control2Security` può ora emettere `status:'degraded', green:false` (oltre a `green`/`red`), coerente con i controlli 3/4 e con `gateOnDegraded` di `runCheckpoint`.

- [ ] **Step 1: Aggiungere i sotto-test `degraded-floor-miss` e `degraded-detection-only` al keystone**

```js
// manifest sintetico: authz di FLOOR con tool senza wrapper -> degraded (green:false).
// (usa un fixture con un manifest fittizio o monkeypatch del classify — vedi Step 2)
// degraded-detection-only: stesso tool non eseguito ma categoria FUORI floor -> verde con nota.
```

Concretamente: due fixture minime sotto `_a0-fixtures/_structural/` con manifest locale (via un pack che lega un tool authz **inesistente** — es. `ghost_rules_check` — una volta nel `floor`, una volta fuori). Asserire: floor → `co.status === 'degraded' && co.green === false`; fuori-floor → `co.green === true` con nota.

- [ ] **Step 2: Eseguire → i due sotto-test FALLISCONO**

Run: `node eval/harness/a0_authz_gate_check.mjs`
Expected: FAIL su `degraded-floor-miss` (oggi verde con nota, non degraded).

- [ ] **Step 3: Calcolare il set dei tool di floor e propagare `floorMiss`**

In `control2Security`, dopo la costruzione di `tools`, calcolare quali tool servono una categoria di floor:

```js
  // tool -> serve una categoria di FLOOR? (solo ramo manifest-driven)
  const floorCats = new Set((manifest && Array.isArray(manifest.floor)) ? manifest.floor : []);
  const floorTools = new Set();
  if (manifest && manifest.oracles) {
    for (const [key, b] of Object.entries(manifest.oracles)) {
      const cats = key.split('|').map((c) => c.trim());
      if (b && b.tool && cats.some((c) => floorCats.has(c))) floorTools.add(b.tool);
    }
  }
```

E nel loop di esecuzione, tracciare un floor-miss:

```js
  let floorMiss = null;
  for (const t of tools) {
    const r = runTool(t);
    if (r.fatal) return r.fatal;
    if (r.note) notes.push(r.note);
    if (r.ranFail && floorTools.has(t)) floorMiss = floorMiss || t; // primo oracolo di floor non eseguito
  }
```

**Confine (BIT-invarianza).** `osv` gated-off ritorna `{}` (nessun `ranFail`) → mai floorMiss: preservato. `semgrep` detection-only degrada con `note` **senza** `ranFail`? No — il degrado semgrep oggi ritorna `{note}`. Per non declassare `m5` (dove semgrep NON è floor) va bene marcare `ranFail:true` anche su semgrep degradato, perché `floorTools.has('semgrep')` è **false** per supabase-jsts → nessun floorMiss. Su un pack dove semgrep È floor (route-authz) e docker manca → floorMiss corretto (AC-4). Aggiungere `ranFail:true` al ramo semgrep degradato (`:203`, `:206`) e al ramo osv-degradato *non-gated* (`:184`, `:186`).

- [ ] **Step 4: Emettere `degraded` nel verdetto**

Sostituire `:257-265`:

```js
  const blockers = deltaBlockers(all, baseline, { deadcode: false, gateCategories });
  const noteStr = notes.join('');
  if (floorMiss && blockers.length === 0) {
    // un oracolo di FLOOR non e' stato eseguito: NON e' verde (L-COL-006). Come i
    // controlli 3/4, degradato -> il checkpoint d'insieme non e' verde.
    return {
      id: 2, name: 'security', status: 'degraded', green: false,
      detail: `oracolo di floor non eseguito: ${floorMiss} — controllo DEGRADATO, NON verde${noteStr}`,
      findings: all, blockers: [],
    };
  }
  const green = blockers.length === 0;
  return {
    id: 2, name: 'security', status: green ? 'green' : 'red', green,
    detail: green
      ? `nessun finding di sicurezza NUOVO >= ${GATE_SEVERITY} [${sub.join(' ')}]${noteStr}`
      : `${blockers.length} finding NUOVO >= ${GATE_SEVERITY} [${sub.join(' ')}]${noteStr}`,
    findings: all, blockers,
  };
```

(Se ci sono blockers reali, il rosso vince sul degraded: un difetto trovato è più informativo di "non eseguito".)

- [ ] **Step 5: Eseguire il keystone → PASS (tutti i sotto-test)**

Run: `node eval/harness/a0_authz_gate_check.mjs`
Expected: PASS — inclusi `degraded-floor-miss` (degraded) e `degraded-detection-only` (verde con nota).

- [ ] **Step 6: Commit**

```bash
git add trueline/scripts/checkpoint/checkpoint.mjs eval/harness/a0_authz_gate_check.mjs eval/ecosystems/_a0-fixtures/_structural
git commit -m "fix(a0): oracolo di floor non eseguito -> controllo 2 DEGRADATO (rete strutturale, L-COL-006)"
```

---

## Task 5: Ride-along — `collectFindings` semina tutti e 5 gli oracoli authz

Chiude il buco end-to-end dei 4 backend non-Firebase in REMEDIATE: la detection iniziale (baseline pre-fix) esegue l'oracolo authz **del manifest attivo**, non solo firestore, così `rerunOracleFor` ha un finding su cui girare.

**Files:**
- Modify: `trueline/scripts/loop/run_loop.mjs` (`collectFindings` `:134-169`, chiamante `:357`, export `:463`)
- Test: `trueline/scripts/loop/run_loop.a0.test.mjs` (nuovo)

**Interfaces:**
- Consumes: `AUTHZ_ORACLES`, `runAuthzOracle` da `../oracles/authz_oracles.mjs`; il `manifest` risolto (già disponibile al chiamante `:357`).
- Produces: `collectFindings(dir, manifest)` — firma estesa con `manifest` (default `null` → comportamento firestore attuale, BIT-invariante).

- [ ] **Step 1: Scrivere il test**

```js
// run_loop.a0.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFindings } from './run_loop.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const FIX = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'eval', 'ecosystems', '_a0-fixtures');

test('collectFindings semina authz per un pack Appwrite (non solo firestore)', () => {
  const manifest = { oracles: { authz: { tool: 'appwrite_perms_check', role: 'authz-surface', scan: ['.'] } } };
  const found = collectFindings(resolve(FIX, 'appwrite-jsts', 'open'), manifest);
  assert.ok(found.some((f) => f.category === 'authz'), 'atteso >=1 finding authz dalla baseline');
});

test('collectFindings senza manifest = comportamento firestore invariato', () => {
  const found = collectFindings(resolve(FIX, 'firebase-jsts', 'open'));
  assert.ok(found.some((f) => f.category === 'authz'));
});
```

- [ ] **Step 2: Eseguire → FAIL**

Run: `node --test trueline/scripts/loop/run_loop.a0.test.mjs`
Expected: FAIL — il caso Appwrite non trova finding authz (oggi `collectFindings` gira solo firestore, che su un fixture Appwrite dà 0).

- [ ] **Step 3: Estendere `collectFindings`**

Importare il modulo in `run_loop.mjs`:

```js
import { AUTHZ_ORACLES, runAuthzOracle } from '../oracles/authz_oracles.mjs';
```

Cambiare firma e sostituire il blocco firestore (`:150-157`):

```js
function collectFindings(dir, manifest = null) {
  const findings = [];
  const migrations = resolve(dir, 'supabase', 'migrations');
  // ... gitleaks/rls/knip INVARIATI ...

  // authz dichiarativa: esegui l'oracolo del MANIFEST attivo (non solo firestore).
  // Il binding authz-surface e' individuato dal ruolo; default firestore se assente
  // (BIT-invariante per i pack Firestore e senza manifest).
  const authzBinding = manifest && manifest.oracles
    ? Object.values(manifest.oracles).find((b) => b && b.role === 'authz-surface' && AUTHZ_ORACLES[b.tool])
    : null;
  const authzTool = authzBinding ? authzBinding.tool : 'firestore_rules_check';
  const a = runAuthzOracle(authzTool, dir, authzBinding || {}, RUN_OPTS_FROM_CONTEXT);
  if (a.ok) findings.push(...a.findings);

  // ... semgrep INVARIATO ...
  return findings;
}
```

(Nota: usare gli stessi `runOpts` deterministici già usati da `norm(...)` in `collectFindings`; sostituire `RUN_OPTS_FROM_CONTEXT` col valore reale presente nel file — verificare come `norm` ottiene `runId/createdAt` e riusarlo.)

- [ ] **Step 4: Aggiornare il chiamante**

Alla riga `:357`, passare il manifest già risolto:

```js
    const all = collectFindings(ws.dir, manifest);
```

- [ ] **Step 5: Eseguire → PASS**

Run: `node --test trueline/scripts/loop/run_loop.a0.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add trueline/scripts/loop/run_loop.mjs trueline/scripts/loop/run_loop.a0.test.mjs
git commit -m "fix(a0): collectFindings semina l'oracolo authz del manifest attivo (chiude i 4 backend non-Firebase in REMEDIATE)"
```

---

## Task 6: `validate_ecosystem` — guard del vocabolario categorie

Un refuso di categoria (`injecton`, `duplicaton`) non deve più passare silenzioso: le chiavi di `oracles`/`floor`/`verified_set` devono appartenere all'enum di `finding.schema.json`.

**Files:**
- Modify: `trueline/scripts/ecosystem/validate_ecosystem.mjs` (dopo `:30`)
- Test: `trueline/scripts/ecosystem/validate_ecosystem.a0.test.mjs` (nuovo)

**Interfaces:**
- Consumes: l'enum categorie da `trueline/scripts/findings/finding.schema.json` (`secret, rls, dead-code, injection, authz, crypto, dependency-vuln, config, misc`).
- Produces: `validateEcosystem(m)` aggiunge errori se una chiave-categoria non è nell'enum.

- [ ] **Step 1: Scrivere il test**

```js
// validate_ecosystem.a0.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEcosystem } from './validate_ecosystem.mjs';

const base = () => ({
  id: 'x', version: '1.0.0', languages: ['js'], backend: 'x',
  detect: { files_any: ['a'] }, triggers: ['x'],
  oracles: { secret: { tool: 'gitleaks' }, authz: { tool: 'firestore_rules_check', role: 'authz-surface' } },
  floor: ['secret'], verified_set: ['secret'], coverage_policy: 'declared',
});

test('categoria oracolo con refuso -> FAIL', () => {
  const m = base(); m.oracles.injecton = { tool: 'semgrep' };
  const r = validateEcosystem(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /injecton/.test(e)));
});

test('manifest valido -> OK', () => {
  assert.equal(validateEcosystem(base()).ok, true);
});
```

- [ ] **Step 2: Eseguire → FAIL (il refuso oggi passa)**

Run: `node --test trueline/scripts/ecosystem/validate_ecosystem.a0.test.mjs`
Expected: FAIL sul primo test (oggi `ok:true`).

- [ ] **Step 3: Aggiungere il guard**

In `validate_ecosystem.mjs`, dopo la costruzione di `oracleKeys` (`:29-30`):

```js
  // (1bis) vocabolario categorie: ogni chiave-categoria deve essere nell'enum
  // chiuso di finding.schema.json (A0). Un refuso (es. "injecton") non deve
  // passare silenzioso e far cadere la categoria dal gate a valle (L-COL-006).
  const CATEGORY_ENUM = new Set([
    'secret','rls','dead-code','injection','authz','crypto','dependency-vuln','config','misc',
  ]);
  for (const c of oracleKeys) {
    if (!CATEGORY_ENUM.has(c)) errors.push(`categoria oracolo fuori vocabolario (finding.schema.json): "${c}"`);
  }
```

(Nota: `CATEGORY_ENUM` è duplicato piccolo e stabile; se si preferisce, leggerlo da `finding.schema.json` con `readFileSync`+`JSON.parse` per una sorgente unica — scelta del reviewer, entrambe accettabili. Se letto dal file, ancorare il path con `fileURLToPath(import.meta.url)`.)

- [ ] **Step 4: Eseguire → PASS**

Run: `node --test trueline/scripts/ecosystem/validate_ecosystem.a0.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Verificare i 20 manifest reali (nessuna regressione)**

Run: `for f in trueline/references/ecosystems/*/ecosystem.json; do node trueline/scripts/ecosystem/validate_ecosystem.mjs "$f" >/dev/null || echo "FAIL: $f"; done`
Expected: nessun `FAIL:` stampato (tutti i 20 pack reali usano categorie in vocabolario).

- [ ] **Step 6: Commit**

```bash
git add trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/scripts/ecosystem/validate_ecosystem.a0.test.mjs
git commit -m "fix(a0): validate_ecosystem valida il vocabolario categorie vs finding.schema.json enum"
```

---

## Task 7: Gate integrale SERIALE + falsificabilità end-to-end + nota di ledger

Il gate della milestone: non-regressione integrale in riesecuzione **seriale** (il "verde" è un fatto, `L-COL-002`), più la prova che A0 non ha rotto nulla e che il gate resta falsificabile.

**Files:**
- Modify: `00-INDEX.md` (§4 ledger — nota A0, nessun lock nuovo), `SESSION-STATE.md` (riga 9 + §6/§7).
- Nessun file di prodotto nuovo.

**Interfaces:**
- Consumes: tutti gli harness esistenti + il keystone A0.
- Produces: evidenza di gate verde, pronta per il merge human-gated (che NON è in questo task — è una decisione dell'utente).

- [ ] **Step 1: Keystone A0 verde in riesecuzione**

Run: `node eval/harness/a0_authz_gate_check.mjs`
Expected: `RESULT: PASS` (open/scoped ×6, shipit, falsifiable, degraded-floor-miss, degraded-detection-only).

- [ ] **Step 2: Unit dei moduli toccati**

Run: `node --test trueline/scripts/oracles/authz_oracles.test.mjs trueline/scripts/loop/run_loop.a0.test.mjs trueline/scripts/ecosystem/validate_ecosystem.a0.test.mjs`
Expected: tutti PASS.

- [ ] **Step 3: Non-regressione — `m5` (BIT-invarianza del percorso canonico)**

Precondizione ambiente: DB di test su (`eval/db-test/up.ps1`) + docker/semgrep. Se l'ambiente non è disponibile qui, **dichiararlo** (`L-COL-006`) e rimandare l'esecuzione di questo step a macchina capace prima del merge; non trattarlo come verde.

Run: `node eval/harness/m5_gate_check.mjs`
Expected: **56/56** (invariato). Se rosso: STOP, il fix ha toccato il percorso canonico — diagnosi prima di procedere.

- [ ] **Step 4: Non-regressione — conformance dei 6 pack authz + keystone anti-tamper + build-discipline**

Run: `node eval/harness/ecosystem_conformance.mjs firebase-jsts` (poi `firebase-py`, `appwrite-jsts`, `pocketbase-jsts`, `hasura-jsts`, `amplify-jsts`)
Expected: ciascuno al suo punteggio noto (33/33 o 34/34 secondo il pack), invariato.

Run: `node eval/harness/anti_tamper_check.mjs` · `node eval/harness/build_discipline_check.mjs`
Expected: **49/49** · **21/21**.

- [ ] **Step 5: Lint di packaging**

Run: `node trueline/scripts/packaging/package_skill.mjs --lint` (o l'invocazione reale del lint — verificare in `09`/`package_skill`)
Expected: VERDE; `SKILL.md` < 500 righe; 0 orfani. (A0 non tocca `SKILL.md`: l'inventario dei 5 oracoli è milestone A1.)

- [ ] **Step 6: Falsificabilità end-to-end del gate**

Prova che il keystone A0 è un gate reale, non un timbro: neutralizzare il cablaggio authz (commentare l'import di `runAuthzOracle` in `checkpoint.mjs` **in una copia di lavoro**, o rinominare temporaneamente un oracolo) → il keystone deve tornare **FAIL** sugli `open` → ripristinare → **PASS**. Documentare l'esito (comando + output) senza lasciare la modifica sul branch.

- [ ] **Step 7: Aggiornare il ledger e lo stato**

In `00-INDEX.md` §4: nota A0 (fix del falso verde authz del controllo 2; nessun lock nuovo; `L-COL-006` riparato). In `SESSION-STATE.md`: aggiornare riga 9 «Ultima sessione» (includendo che era stale di due commit — vedi anche il preflight del 4 lug non registrato), §6 carry-over, §7 promemoria (A1/A2 come prossime). Registrare i verdetti della verifica adversariale (5 refutatori) e i due blind spot chiusi.

- [ ] **Step 8: Commit del ledger**

```bash
rm -f ./NUL 2>/dev/null
git add 00-INDEX.md SESSION-STATE.md
git commit -m "docs(a0): ledger 00-INDEX §4 + SESSION-STATE (fix falso verde authz control2, nessun lock nuovo)"
```

- [ ] **Step 9: STOP — merge human-gated**

NON mergeare in autonomia (`L-COL-024`). Riassumere all'utente: gate verde (o gli step rimandati a macchina capace, dichiarati), branch `feat/a0-checkpoint-authz-false-green` pronto, e chiedere l'ok per merge `--no-ff` su `main` + push + riallineamento install.

---

## Self-Review

**1. Spec coverage** — §6.1 (cablare i 5) → Task 3; §6.2 (floor-declass, best-effort preservato) → Task 4; §6.3 (ride-along collectFindings) → Task 5; §6.4 (vocabolario) → Task 6; §8 AC-0 → Task 1; AC-1 falsificabile + AC-2 sei pack → Task 3; AC-3 + AC-4 → Task 4; AC-5 → Task 5; AC-6 → Task 6; non-regressione integrale → Task 7; §7 sorgente unica → Task 2 (+ test di coerenza). Coperta.

**2. Placeholder scan** — un solo punto lasciato aperto di proposito: `RUN_OPTS_FROM_CONTEXT` in Task 5 Step 3, con istruzione esplicita di sostituirlo col `runOpts` reale già presente in `collectFindings` (il file usa un helper `norm(...)`; il valore va letto lì, non inventato). Nessun "TBD"/"handle edge cases" generico.

**3. Type consistency** — `AUTHZ_ORACLES`/`AUTHZ_TOOL_NAMES`/`runAuthzOracle`/`authzScanTarget` (Task 2) usati con le stesse firme in Task 3 e Task 5. `ranFail` introdotto in Task 3 Step 5, consumato in Task 4 Step 3. `collectFindings(dir, manifest)` (Task 5) coerente col chiamante `:357`. `control2` helper nel keystone coerente fra Task 1/3/4.

**Rischi noti** — (a) il ramo semgrep `ranFail:true` (Task 4 Step 3) va aggiunto senza declassare `m5` (semgrep non-floor su supabase-jsts): coperto dalla logica `floorTools.has(t)`, verificato che `authz/injection ∉ floor` per supabase-jsts. (b) `m5` richiede DB+docker: se assente qui, Step 3 di Task 7 è dichiarato e rimandato, mai finto verde.
