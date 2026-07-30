# Oracolo di POTERE dell'asserzione d'accettazione — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere ROSSO il controllo 4 quando un `target_test` verde contiene un'asserzione che **non può fallire** — provato per esecuzione, non per inferenza.

**Architecture:** Un oracolo **fratello** di `ac_assertion_trace_check.mjs` (che verifica la *provenienza* dell'asserzione), non una sua modifica: `ac_assertion_power_check.mjs` verifica il *potere*. Due stadi: (1) un **candidato** statico e volutamente sovra-inclusivo — nessun verdetto; (2) il **verdetto per ESECUZIONE** — si neutralizza il binding esportato sulla copia di lavoro e si riesegue quel solo `target_test`: se resta verde, l'asserzione è inerte. Il verdetto lo emette l'exit code del runner, mai l'analisi statica (`L-COL-002`). Si innesta in `control4Conformance` **dopo** che i target_test sono verdi: su un controllo 4 già rosso il costo è zero.

**Tech Stack:** Node ESM, **solo built-in** (`fs`, `path`, `crypto`, `child_process`). Nessuna dipendenza npm nuova. Runner dei test dell'harness: `node --test`. Runner dei `target_test` del progetto: `manifest.test_runner.run_file` (riuso di `runTargetFile`).

## Global Constraints

- **Il verde è un FATTO d'oracolo, mai una frase dell'LLM** (`L-COL-002`). Lo stadio 1 non emette verdetti: solo candidati.
- **Un controllo non eseguito NON è un verde** (`L-COL-006`). Zero candidati, candidato non risolvibile, runner assente: tutti **dichiarati** nella coverage, mai verdi muti.
- **Ciò che l'oracolo non guarda va dichiarato** (`L-COL-036`): la coverage esce con file esaminati, candidati trovati, candidati aggiudicati e non risolti **con motivo**.
- **Un gate consegnato dev'essere raggiungibile da una batteria** (`L-COL-035`): il keystone va agganciato, e l'albero SPEDITO cambia → `skill_version` + `--record-release` o `package_skill` rifiuta di emettere.
- **Direzione conservativa obbligatoria:** in caso di dubbio l'oracolo **non** segnala. I falsi negativi sono accettabili e dichiarati; un falso positivo renderebbe rosso un progetto sano ed è la sola cosa che uccide l'adozione del gate.
- **Bit-invarianza:** senza `blueprintDir` il controllo 4 resta byte-identico (ramo legacy). Su un progetto senza candidati l'output del controllo 4 è byte-identico a oggi.
- **Ripristino verificato per sha256** dopo ogni neutralizzazione. Ripristino non bit-esatto = `status: 'error'`, mai un verde.
- **Si lavora su BRANCH** (`feat/ac-assertion-power`), mai su `main`. Nessuna operazione distruttiva autonoma (`L-COL-024`).
- **Corpo `SKILL.md` < ~500 righe** (`L-COL-014`): questa feature non aggiunge nulla a `SKILL.md`.

---

## Perché questo piano esiste (la misura del 30 lug 2026)

Misurato su `progetto-web-ai`, copia read-only a `HEAD`, ripristino byte-esatto:

- `tests/tokens.test.ts:9` asserisce `expect(tailwindConfig.theme.extend.colors).toEqual(colors)`, e `tailwind.config.ts` fa `import { colors } from './src/ui/theme/tokens'` assegnandolo **per riferimento**. È `expect(X).toEqual(X)`.
- **Prova per esecuzione:** con `colors = {}` (tutti i design token cancellati) il target_test resta **2/2 verde** e la **suite intera (696 test) è identica alla baseline**. Nessun test, da nessuna parte, se ne accorge.
- Quell'asserzione porta il tag `covers: AC-020-1`: passa **tutti** i controlli del controllo 4 (esiste, traccia, non è vacua, è verde) e non ha la rete del controllo 3 sotto.
- Il difetto è **strutturale, non statistico**: 1 caso confermato su 65 file di test. La frequenza NON è stabilita e non va gonfiata. Ciò che è stabilito è che oggi Trueline **non ha nulla che possa vederlo**.
- Un rilevatore puramente statico su raggiungibilità dei moduli dà **2 falsi positivi su 3** (`DOCUMENT_LIMITS.error_issues` vs `POOL_LIMITS.error_issues`: due letterali `24` indipendenti, asserzione che può fallire davvero). **Per questo il verdetto è per esecuzione.**

---

## File Structure

| File | Responsabilità |
|---|---|
| `trueline/scripts/blueprint/ac_assertion_power_check.mjs` | **Nuovo, SPEDITO.** Stadio 1 (candidati) + stadio 2 (verdetto per esecuzione) + coverage. Esporta `findCandidates`, `neutralizeExport`, `assertionPower`. |
| `trueline/scripts/blueprint/ac_assertion_power_check.test.mjs` | **Nuovo, SPEDITO.** Unit test delle funzioni pure (`node --test`). |
| `trueline/scripts/checkpoint/checkpoint.mjs` | **Modificato, SPEDITO.** Innesto in `control4Conformance` dopo l'esecuzione dei target_test verdi. |
| `trueline/references/build-discipline.md` | **Modificato, SPEDITO.** Momento 2: la regola che un'asserzione dev'essere in grado di fallire. |
| `eval/assertion-power/*` | **Nuovo, eval.** 5 fixture: `inert-identity`, `honest-parallel`, `healthy`, `unresolved`, `no-candidates`. |
| `eval/harness/assertion_power_check.mjs` | **Nuovo, eval.** Keystone, scritto PRIMA dell'oracolo. |
| `eval/harness/suite_battery.mjs` *(se esiste)* o runbook | Aggancio del keystone (`L-COL-035`). Se la batteria non esiste ancora, **dichiararlo** nel commit. |
| `trueline/package.json` | `skill_version` 0.3.0 → **0.4.0**. |
| `RELEASE-DIGESTS.json` | Nuovo digest via `package_skill --record-release`. |
| `00-INDEX.md` §4 | Proposta di lock **`L-COL-037`** (ratifica umana a fine sessione). |

---

## Interfaccia pubblica (definita qui una volta, usata da tutti i task)

```js
// ac_assertion_power_check.mjs

/** Stadio 1 — candidati, SOVRA-INCLUSIVO, nessun verdetto.
 *  @returns {Array<{testFile, line, kind, actualRoot, expectedRoot, bindingName, bindingModule}>} */
export function findCandidates(appDir, testRelPath)

/** Neutralizza `export const <name> = <init>` nel sorgente.
 *  @returns {string|null} nuovo sorgente, oppure null se la FORMA non e' riconosciuta. */
export function neutralizeExport(source, name)

/** Stadio 2 — VERDETTO PER ESECUZIONE.
 *  @returns {{ok:boolean, status:'green'|'red'|'degraded'|'error',
 *              inert:Array, unresolved:Array, coverage:Object, detail:string}} */
export function assertionPower(tasks, appDir, inScope, { runFileTpl })
```

---

### Task 1: Keystone e fixture — scritti PRIMA dell'oracolo

Il gate nasce prima del codice (`L-COL-019`/`L-COL-027`). Alla fine di questo task il keystone **deve essere ROSSO**: è l'esito atteso finché l'oracolo non esiste, esattamente come fece `scan_scope_check`.

**Files:**
- Create: `eval/assertion-power/inert-identity/` (app + blueprint)
- Create: `eval/assertion-power/honest-parallel/`
- Create: `eval/assertion-power/healthy/`
- Create: `eval/assertion-power/unresolved/`
- Create: `eval/assertion-power/no-candidates/`
- Create: `eval/harness/assertion_power_check.mjs`

**Interfaces:**
- Consumes: niente (primo task).
- Produces: le 5 fixture e i nomi dei sotto-test, consumati dal gate di ogni task successivo.

**VINCOLO OBBLIGATORIO — intestazione `SPECIMEN` (deciso dall'utente il 30 lug 2026).**
Due fixture contengono **di proposito** ciò che un rubric di review tratta come difetto:
`inert-identity` ha un test la cui asserzione non può fallire, `unresolved` ha un export in
una forma che il neutralizzatore non sa trattare. Nel diff sono indistinguibili da difetti
veri. Ogni file-campione porta quindi in testa un commento che dichiara **cosa dimostra**,
**quale sotto-test lo consuma** e **che correggerlo romperebbe il keystone** — l'informazione
sta nel codice, dove il reviewer la legge, non in una nota dell'orchestratore. È
`L-COL-036` applicato alle fixture: ciò che non è quel che sembra va **dichiarato**.

Forma esatta, da replicare in `inert-identity/app/tests/tokens.test.mjs`,
`inert-identity/app/config.mjs` e `unresolved/app/src/thing.mjs`:

```js
// SPECIMEN — NON e' un difetto da correggere.
// Questo test e' DELIBERATAMENTE inerte: assert.deepEqual(config.theme.extend.colors, colors)
// confronta lo STESSO oggetto, perche' config.mjs importa colors per riferimento.
// E' il caso misurato il 30/07/2026 su progetto-web-ai, ridotto al minimo.
// Consumato da: eval/harness/assertion_power_check.mjs -> sotto-test `inert:detected`.
// Correggerlo renderebbe ROSSO il keystone.
```

Le fixture `honest-parallel`, `healthy` e `no-candidates` **non** portano l'intestazione:
sono codice sano, ed è proprio ciò che devono sembrare.

- [ ] **Step 1: fixture `inert-identity` — il caso misurato, ridotto al minimo**

`eval/assertion-power/inert-identity/app/src/tokens.mjs`:
```js
export const colors = {
  background: 'var(--color-background)',
  primary: 'var(--color-primary)',
};
```

`eval/assertion-power/inert-identity/app/config.mjs`:
```js
import { colors } from './src/tokens.mjs';
// La config DERIVA dai token: stesso oggetto, assegnato per riferimento.
export const config = { theme: { extend: { colors } } };
```

`eval/assertion-power/inert-identity/app/tests/tokens.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import { colors } from '../src/tokens.mjs';

// covers: AC-1
test('la theme deriva dai token', () => {
  assert.deepEqual(config.theme.extend.colors, colors);
});
```

`eval/assertion-power/inert-identity/blueprint/01.md`:
````markdown
```yaml
- id: T-1
  macrotask: m
  objective: o
  definition_of_done: [d]
  acceptance_criteria:
    - id: AC-1
      given: la config del builder
      when: si leggono i colori della theme
      then: sono gli stessi dell'oggetto colors esportato da tokens
  target_tests:
    - file: "tests/tokens.test.mjs"
      covers: AC-1
```
````

- [ ] **Step 2: fixture `honest-parallel` — il FALSO POSITIVO da non fare**

È il sotto-test **load-bearing**: senza di esso, un oracolo che segnala tutto ciò che è connesso nel grafo passerebbe il gate. Riproduce il caso reale `DOCUMENT_LIMITS`/`POOL_LIMITS`.

`eval/assertion-power/honest-parallel/app/src/pool.mjs`:
```js
export const POOL_LIMITS = { error_issues: 24 };
export function limit(v) { return v.slice(0, POOL_LIMITS.error_issues); }
```

`eval/assertion-power/honest-parallel/app/src/document.mjs`:
```js
import { limit } from './pool.mjs';
// Costante PROPRIA, non derivata: puo' divergere, ed e' questo che il test verifica.
export const DOCUMENT_LIMITS = { error_issues: 24 };
export function apply(v) { return limit(v); }
```

`eval/assertion-power/honest-parallel/app/tests/limits.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_LIMITS } from '../src/document.mjs';
import { POOL_LIMITS } from '../src/pool.mjs';

// covers: AC-1
test('i tetti non sono divergiti', () => {
  assert.equal(DOCUMENT_LIMITS.error_issues, POOL_LIMITS.error_issues);
});
```

Blueprint identico a Step 1 con `file: "tests/limits.test.mjs"`.

- [ ] **Step 3: fixture `healthy`, `unresolved`, `no-candidates`**

**Forma obbligata, e la ragione è misurata.** La prima stesura di questa fixture usava
`assert.equal(slugify('A'.repeat(80)).length, MAX)`. Eseguendo il matcher del Task 2 contro
di essa: **0 candidati** — il lato sinistro contiene una chiamata, e il matcher accetta solo
member-expression piatte su **entrambi** i lati. Il sotto-test `healthy:not-flagged` sarebbe
stato **verde perché non guardava niente**: la stessa classe di difetto che questo piano
esiste per impedire, dentro il piano. La fixture deve avere la forma **golden-fixture**
(costante attesa scritta a mano, indipendente dal modulo sotto test), che è anche la forma
realistica in cui un candidato onesto compare davvero.

`eval/assertion-power/healthy/app/src/theme.mjs`:
```js
export const colors = { primary: 'p', border: 'b' };
```
`eval/assertion-power/healthy/app/tests/expected.mjs`:
```js
// Costante attesa scritta A MANO: non importa nulla da src/, quindi puo' divergere.
export const EXPECTED_COLORS = { primary: 'p', border: 'b' };
```
`eval/assertion-power/healthy/app/tests/theme.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colors } from '../src/theme.mjs';
import { EXPECTED_COLORS } from './expected.mjs';

// covers: AC-1
test('la palette e\' quella attesa', () => {
  assert.deepEqual(colors, EXPECTED_COLORS);
});
```

Verificato eseguendo il matcher: **1 candidato** `[colors vs EXPECTED_COLORS]`. Lo stadio 2
neutralizza `EXPECTED_COLORS` → `{}` → `deepEqual({primary:'p',border:'b'}, {})` fallisce →
test ROSSO → **non inerte**. È l'assoluzione per esecuzione, non per assenza di esame.

`eval/assertion-power/unresolved/app/src/thing.mjs`:
```js
function make() { return { k: 1 }; }
// FORMA NON RICONOSCIUTA dal neutralizzatore: initializer che e' una chiamata.
export const thing = make();
```
`eval/assertion-power/unresolved/app/tests/thing.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thing } from '../src/thing.mjs';
import { mirror } from '../mirror.mjs';

// covers: AC-1
test('mirror rispecchia thing', () => {
  assert.deepEqual(mirror, thing);
});
```
`eval/assertion-power/unresolved/app/mirror.mjs`:
```js
import { thing } from './src/thing.mjs';
export const mirror = thing;
```

`eval/assertion-power/no-candidates/app/src/index.mjs`:
```js
export function add(a, b) { return a + b; }
```
`eval/assertion-power/no-candidates/app/tests/add.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/index.mjs';

// covers: AC-1
test('add somma', () => { assert.equal(add(1, 2), 3); });
```

Ogni fixture ha il suo `blueprint/01.md` sulla forma di Step 1, con il proprio `file:`.

- [ ] **Step 4: scrivere il keystone con gli 11 sotto-test**

`eval/harness/assertion_power_check.mjs` — struttura identica a `eval/harness/scan_scope_check.mjs` (radice temp privata per-pid con guardia di proprietà, `assert(name, ok, detail)`, riepilogo finale, `process.exit(allOk ? 0 : 1)`). Sotto-test, nell'ordine:

| # | nome | cosa prova |
|---|---|---|
| 1 | `inert:detected` | su `inert-identity`, `assertionPower` ritorna `ok:false` e `inert.some(i => i.testFile === 'tests/tokens.test.mjs')` |
| 2 | `honest-parallel:not-flagged` | **LOAD-BEARING** — su `honest-parallel` ritorna `ok:true`, `inert` VUOTO |
| 3 | `healthy:not-flagged` | su `healthy` ritorna `ok:true`, `inert` vuoto |
| 4 | `fixtures:candidate-exists` | **ANTI-VACUO DEL GATE STESSO** — `honest-parallel`, `healthy` e `unresolved` devono avere `coverage.candidates >= 1` ciascuna. Senza questo, 2 e 3 sarebbero verdi per assenza d'esame, non per assoluzione |
| 5 | `unresolved:declared` | su `unresolved`, il candidato compare in `unresolved[]` **con motivo**, e NON in `inert[]` |
| 6 | `unresolved-only:degraded` | se ogni candidato è irrisolto, `status==='degraded'` e `ok:false` — mai `green` |
| 7 | `zero-candidates:declared` | su `no-candidates`, `coverage.candidates===0` è **scritto**, e `status==='green'` con `coverage.scanned===1` |
| 8 | `restore:bit-exact` | dopo ogni run, sha256 di tutti i file dell'app identico a prima (calcolato dal keystone, non dall'oracolo) |
| 9 | `coverage:declared` | ogni `target_test` in-scope compare in `coverage.files[]` con il suo conteggio di candidati |
| 10 | `wiring:control4` | **importa ed esegue `control4Conformance`** su `inert-identity` e verifica `status==='red'`; su `healthy` verifica `green===true` |
| 11 | `bit-invariance:legacy` | `control4Conformance(app, { mode:'build' })` senza `blueprintDir` ritorna byte-identico a prima della modifica (`status:'degraded'`) |

Il sotto-test 10 esiste perché la sessione scan-scope ha trovato un keystone **12/12 verde sopra un wiring neutralizzato**: un keystone che non guarda l'innesto non prova che l'innesto esista. Il sotto-test 4 esiste perché **la prima stesura di questo piano ci è cascata**: la fixture `healthy` dava 0 candidati e nessuno se ne sarebbe accorto.

I blueprint delle fixture puntano rispettivamente a `tests/tokens.test.mjs`, `tests/limits.test.mjs`, `tests/theme.test.mjs`, `tests/thing.test.mjs`, `tests/add.test.mjs`.

Scheletro del keystone (radice temp privata per-pid con **guardia di proprietà**, come `h1_perpid_check`; l'oracolo si importa **dinamicamente** perché all'inizio non esiste ancora):

```js
#!/usr/bin/env node
// assertion_power_check.mjs — KEYSTONE del potere dell'asserzione d'accettazione.
// Scritto PRIMA dell'oracolo: finche' ac_assertion_power_check.mjs non esiste, il
// rosso e' l'ESITO ATTESO. Verita' = FATTO d'oracolo (L-COL-002).
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const FX = join(ROOT, 'eval', 'assertion-power');
const MANIFEST = { test_runner: { run_file: 'node --test {file}' } };

// Radice privata per-pid + guardia di proprieta': spazza SOLO chi l'ha creata.
const TMP_ROOT = process.env.TRUELINE_TMP_VERIFY_ROOT
  ? join(process.env.TRUELINE_TMP_VERIFY_ROOT, `ap-${process.pid}`)
  : join(tmpdir(), `trueline-ap-${process.pid}`);
const OWNED = !existsSync(TMP_ROOT);

const checks = [];
function assert(name, ok, detail) { checks.push({ name, ok: Boolean(ok), detail }); }

// sha256 ricorsivo dell'albero: prova del ripristino, calcolata DAL KEYSTONE.
function treeHash(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else { h.update(relative(dir, p).replace(/\\/g, '/')); h.update(readFileSync(p)); }
    }
  };
  walk(dir);
  return h.digest('hex');
}

function stage(name) {
  const dst = join(TMP_ROOT, name);
  mkdirSync(dst, { recursive: true });
  cpSync(join(FX, name), dst, { recursive: true });
  return { app: join(dst, 'app'), bp: join(dst, 'blueprint') };
}

async function main() {
  let mod = null;
  try { mod = await import(pathToFileURL(join(ROOT, 'trueline', 'scripts', 'blueprint', 'ac_assertion_power_check.mjs')).href); }
  catch { /* non esiste ancora: tutti i sotto-test restano rossi, ed e' l'atteso */ }
  const { loadTasks } = await import(pathToFileURL(join(ROOT, 'trueline', 'scripts', 'blueprint', 'blueprint_tasks.mjs')).href);

  const run = (name) => {
    const { app, bp } = stage(name);
    const before = treeHash(app);
    const tasks = loadTasks(bp);
    const inScope = tasks.flatMap((t) => (t.target_tests || []).map((tt) => tt.file))
      .filter((f) => existsSync(join(app, f))).sort();
    const r = mod ? mod.assertionPower(tasks, app, inScope, { runFileTpl: MANIFEST.test_runner.run_file }) : null;
    return { app, bp, tasks, inScope, r, before, after: treeHash(app) };
  };

  const inert = run('inert-identity');
  assert('inert:detected', inert.r && inert.r.ok === false
    && inert.r.inert.some((i) => i.testFile === 'tests/tokens.test.mjs'),
    `atteso ok:false + tests/tokens.test.mjs in inert, visto ${JSON.stringify(inert.r)}`);

  const honest = run('honest-parallel');
  assert('honest-parallel:not-flagged', honest.r && honest.r.ok === true && honest.r.inert.length === 0,
    `costanti indipendenti: NON e' inerte, visto ${JSON.stringify(honest.r)}`);

  const healthy = run('healthy');
  assert('healthy:not-flagged', healthy.r && healthy.r.ok === true && healthy.r.inert.length === 0,
    `golden-fixture: NON e' inerte, visto ${JSON.stringify(healthy.r)}`);

  const unres = run('unresolved');
  assert('fixtures:candidate-exists',
    [honest, healthy, unres].every((x) => x.r && x.r.coverage.candidates >= 1),
    'una fixture di controllo senza candidati renderebbe VACUI i sotto-test 2, 3 e 5');

  assert('unresolved:declared', unres.r && unres.r.unresolved.length === 1
    && typeof unres.r.unresolved[0].reason === 'string' && unres.r.inert.length === 0,
    `atteso 1 unresolved con reason, visto ${JSON.stringify(unres.r)}`);
  assert('unresolved-only:degraded', unres.r && unres.r.status === 'degraded' && unres.r.ok === false,
    'candidati non aggiudicati = copertura mancante, mai green (L-COL-006)');

  const none = run('no-candidates');
  assert('zero-candidates:declared', none.r && none.r.coverage.candidates === 0
    && none.r.coverage.scanned === 1 && none.r.status === 'green',
    `zero candidati va SCRITTO, visto ${JSON.stringify(none.r)}`);

  assert('restore:bit-exact', [inert, honest, healthy, unres, none].every((x) => x.before === x.after),
    'un albero non ripristinato bit-esatto invalida ogni verdetto');

  assert('coverage:declared', [inert, honest, healthy, unres, none].every(
    (x) => x.r && x.inScope.every((f) => x.r.coverage.files.some((cf) => cf.file === f))),
    'ogni target_test in-scope deve comparire in coverage.files[]');

  // WIRING REALE — la lezione di scan-scope: il keystone deve guardare l'innesto.
  const { control4Conformance } = await import(pathToFileURL(join(ROOT, 'trueline', 'scripts', 'checkpoint', 'checkpoint.mjs')).href);
  const c4Inert = control4Conformance(inert.app, { mode: 'build', blueprintDir: inert.bp, manifest: MANIFEST });
  const c4Healthy = control4Conformance(healthy.app, { mode: 'build', blueprintDir: healthy.bp, manifest: MANIFEST });
  assert('wiring:control4', c4Inert.status === 'red' && c4Inert.green === false && c4Healthy.green === true,
    `inert->${c4Inert.status}, healthy->${c4Healthy.status}: l'innesto in control4 non c'e' o non regge`);

  const c4Legacy = control4Conformance(none.app, { mode: 'build', manifest: MANIFEST });
  assert('bit-invariance:legacy', c4Legacy.status === 'degraded' && c4Legacy.green === false,
    `senza blueprintDir il ramo legacy deve restare invariato, visto ${JSON.stringify(c4Legacy)}`);

  if (OWNED) { try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* never-throw */ } }

  const passed = checks.filter((c) => c.ok).length;
  const red = checks.filter((c) => !c.ok).map((c) => c.name);
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(`=== ORACOLO ASSERTION-POWER RESULT: ${red.length === 0 ? 'PASS' : 'FAIL'} ===`);
  if (red.length) {
    console.log(`    sotto-test ROSSI (${red.length}/${checks.length}): ${red.join(', ')}`);
    console.log("    (fino a che trueline/scripts/blueprint/ac_assertion_power_check.mjs non esiste, il rosso e' l'ESITO ATTESO.)");
    for (const c of checks.filter((x) => !x.ok)) console.log(`      - ${c.name}: ${c.detail}`);
  }
  console.log(`assertion_power_check: ${passed}/${checks.length} PASS`);
  console.log('------------------------------------------------------------');
  process.exit(red.length === 0 ? 0 : 1);
}

main();
```

- [ ] **Step 5: eseguire il keystone e verificare che sia ROSSO**

Run: `node eval/harness/assertion_power_check.mjs`
Expected: `FAIL`, con messaggio che dichiara «fino a che `trueline/scripts/blueprint/ac_assertion_power_check.mjs` non esiste, il rosso è l'ESITO ATTESO».

- [ ] **Step 6: commit**

```bash
git checkout -b feat/ac-assertion-power
git add eval/assertion-power eval/harness/assertion_power_check.mjs
git commit -m "test(power): il gate scritto prima — 10 sotto-test, e il falso positivo e' load-bearing"
```

---

### Task 2: `neutralizeExport` e `findCandidates` — le funzioni pure

**Files:**
- Create: `trueline/scripts/blueprint/ac_assertion_power_check.mjs`
- Create: `trueline/scripts/blueprint/ac_assertion_power_check.test.mjs`

**Interfaces:**
- Consumes: le fixture di Task 1.
- Produces: `findCandidates(appDir, testRelPath)`, `neutralizeExport(source, name)` — usate da `assertionPower` in Task 3.

- [ ] **Step 1: scrivere i test unitari che falliscono**

`trueline/scripts/blueprint/ac_assertion_power_check.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neutralizeExport } from './ac_assertion_power_check.mjs';

test('neutralizeExport: oggetto -> {}', () => {
  const s = "export const colors = {\n  a: 'x',\n  b: { c: 'y' },\n};\n";
  assert.equal(neutralizeExport(s, 'colors'), 'export const colors = {};\n');
});

test('neutralizeExport: annotazione TS conservata', () => {
  const s = "export const colors: Record<string, string> = { a: 'x' };\n";
  assert.equal(neutralizeExport(s, 'colors'), 'export const colors: Record<string, string> = {};\n');
});

test('neutralizeExport: array -> []', () => {
  const s = 'export const xs = [1, 2, 3];\n';
  assert.equal(neutralizeExport(s, 'xs'), 'export const xs = [];\n');
});

test('neutralizeExport: stringa -> sentinella distinta', () => {
  const s = "export const name = 'ciao';\n";
  assert.match(neutralizeExport(s, 'name'), /TRUELINE_NEUTRALIZED/);
});

test('neutralizeExport: numero -> valore distinto', () => {
  const s = 'export const MAX = 60;\n';
  assert.equal(neutralizeExport(s, 'MAX'), 'export const MAX = -987654321;\n');
});

test('neutralizeExport: graffe dentro stringa non contano', () => {
  const s = "export const o = { a: '}' , b: 1 };\n";
  assert.equal(neutralizeExport(s, 'o'), 'export const o = {};\n');
});

test('neutralizeExport: forma non riconosciuta -> null', () => {
  assert.equal(neutralizeExport('export const t = make();\n', 't'), null);
});

test('neutralizeExport: binding assente -> null', () => {
  assert.equal(neutralizeExport('export const a = 1;\n', 'b'), null);
});
```

- [ ] **Step 2: eseguire e verificare che falliscano**

Run: `node --test trueline/scripts/blueprint/ac_assertion_power_check.test.mjs`
Expected: FAIL — `Cannot find module` / `neutralizeExport is not a function`.

- [ ] **Step 3: implementare `neutralizeExport`**

```js
#!/usr/bin/env node
// ac_assertion_power_check.mjs — oracolo del POTERE dell'asserzione d'accettazione.
//
// FRATELLO di ac_assertion_trace_check.mjs, NON una sua modifica: quello verifica la
// PROVENIENZA (l'asserzione discende dall'AC), questo verifica il POTERE (l'asserzione
// puo' FALLIRE). Un'asserzione tautologica passa la provenienza a pieni voti.
//
// DUE STADI, e la separazione e' il punto:
//   1) CANDIDATI (statico, SOVRA-INCLUSIVO): nessun verdetto. Misurato il 30/07/2026,
//      un rilevatore statico su raggiungibilita' dei moduli da 2 FALSI POSITIVI su 3.
//   2) VERDETTO (ESECUZIONE): si neutralizza il binding esportato sulla COPIA di lavoro
//      e si riesegue QUEL SOLO target_test. Resta verde => l'asserzione e' INERTE.
//      L'autorita' e' l'exit code del runner (L-COL-002), mai l'analisi statica.
//
// DIREZIONE CONSERVATIVA, dichiarata: in caso di dubbio NON si segnala. Il file gira a
// livello di FILE, non di singolo test case, quindi un altro test dello stesso file che
// diventa rosso maschera l'inerzia => FALSO NEGATIVO possibile. E' il verso giusto in cui
// sbagliare: un falso positivo renderebbe rosso un progetto sano.
//
// Node ESM, solo built-in.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve as presolve } from 'node:path';

const NEUTRAL_STRING = "'\\u0000TRUELINE_NEUTRALIZED'";
const NEUTRAL_NUMBER = '-987654321';

// Trova la fine di un letterale bilanciato partendo da open ({ o [), ignorando
// le parentesi dentro stringhe. Ritorna l'indice del carattere di chiusura, o -1.
function matchBalanced(src, start) {
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

export function neutralizeExport(source, name) {
  const re = new RegExp(`export\\s+const\\s+${name}\\b([^=]*)=\\s*`, 'm');
  const m = re.exec(source);
  if (!m) return null;
  const initStart = m.index + m[0].length;
  const head = source.slice(0, initStart);
  const ch = source[initStart];
  if (ch === '{' || ch === '[') {
    const end = matchBalanced(source, initStart);
    if (end < 0) return null;
    return head + (ch === '{' ? '{}' : '[]') + source.slice(end + 1);
  }
  const tail = source.slice(initStart);
  const strM = /^(['"])(?:\\.|(?!\1).)*\1/.exec(tail);
  if (strM) return head + NEUTRAL_STRING + tail.slice(strM[0].length);
  const numM = /^-?\d+(?:\.\d+)?/.exec(tail);
  if (numM) return head + NEUTRAL_NUMBER + tail.slice(numM[0].length);
  return null; // forma non riconosciuta: si dichiara, non si indovina
}
```

- [ ] **Step 4: eseguire i test e verificare che passino**

Run: `node --test trueline/scripts/blueprint/ac_assertion_power_check.test.mjs`
Expected: `pass 8`.

- [ ] **Step 5: aggiungere i test di `findCandidates`**

Appendere a `ac_assertion_power_check.test.mjs`:
```js
import { findCandidates } from './ac_assertion_power_check.mjs';
import { join } from 'node:path';
const FX = join(process.cwd(), 'eval', 'assertion-power');

test('findCandidates: coppia di binding importati -> candidato', () => {
  const c = findCandidates(join(FX, 'inert-identity', 'app'), 'tests/tokens.test.mjs');
  assert.equal(c.length, 1);
  assert.equal(c[0].bindingName, 'colors');
});

test('findCandidates: letterale a destra -> nessun candidato', () => {
  assert.equal(findCandidates(join(FX, 'no-candidates', 'app'), 'tests/add.test.mjs').length, 0);
});

test('findCandidates: sovra-inclusivo — il caso onesto E\' un candidato', () => {
  // Lo stadio 1 NON decide: honest-parallel deve arrivare allo stadio 2, che lo assolve.
  assert.equal(findCandidates(join(FX, 'honest-parallel', 'app'), 'tests/limits.test.mjs').length, 1);
});
```

- [ ] **Step 6: implementare `findCandidates`**

Appendere a `ac_assertion_power_check.mjs`:
```js
const EXT = ['.ts', '.tsx', '.mjs', '.js', '.jsx'];

// Risolve uno specificatore ai file del progetto. `@/x` -> <app>/src/x (convenzione
// piu' diffusa); relativo -> risolto dal file. Pacchetto npm -> null (fuori scope,
// dichiarato: un binding di libreria non e' codice d'autore da neutralizzare).
export function resolveSpec(appDir, fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(appDir, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = presolve(dirname(fromFile), spec);
  else return null;
  if (existsSync(base) && /\.[cm]?[jt]sx?$/.test(base)) return base;
  for (const e of EXT) if (existsSync(base + e)) return base + e;
  for (const e of EXT) if (existsSync(join(base, 'index' + e))) return join(base, 'index' + e);
  return null;
}

function importBindings(appDir, file) {
  const src = readFileSync(file, 'utf8');
  const out = new Map();
  for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+'([^']+)'/g)) {
    const target = resolveSpec(appDir, file, m[2]);
    if (!target) continue;
    const clause = m[1];
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) for (const p of named[1].split(',')) {
      const n = p.trim().split(/\s+as\s+/).pop().trim();
      if (n) out.set(n, target);
    }
    const def = /^\s*(\w+)\s*(?:,|$)/.exec(clause);
    if (def) out.set(def[1], target);
  }
  return out;
}

const ASSERT_RE = new RegExp(
  // vitest/jest: expect(A).toEqual(B) | .toStrictEqual | .toBe
  'expect\\(\\s*([A-Za-z_$][\\w$.\\[\\]\'"]*)\\s*\\)\\s*\\.\\s*(?:toEqual|toStrictEqual|toBe)\\(\\s*([A-Za-z_$][\\w$.\\[\\]\'"]*)\\s*\\)'
  // node:assert: assert.deepEqual(A, B) e varianti
  + '|assert\\s*\\.\\s*(?:deepEqual|deepStrictEqual|equal|strictEqual)\\(\\s*([A-Za-z_$][\\w$.\\[\\]\'"]*)\\s*,\\s*([A-Za-z_$][\\w$.\\[\\]\'"]*)\\s*\\)',
  'g',
);

export function findCandidates(appDir, testRelPath) {
  const abs = join(appDir, testRelPath);
  if (!existsSync(abs)) return [];
  const src = readFileSync(abs, 'utf8');
  const imps = importBindings(appDir, abs);
  const out = [];
  for (const m of src.matchAll(ASSERT_RE)) {
    const a = m[1] || m[3];
    const b = m[2] || m[4];
    if (!a || !b) continue;
    const rootA = a.split(/[.[]/)[0];
    const rootB = b.split(/[.[]/)[0];
    if (rootA === rootB) continue;
    const modA = imps.get(rootA); const modB = imps.get(rootB);
    if (!modA || !modB) continue; // almeno un lato non e' un binding importato
    out.push({
      testFile: testRelPath,
      line: src.slice(0, m.index).split('\n').length,
      kind: m[1] ? 'expect' : 'assert',
      actualRoot: rootA, expectedRoot: rootB,
      bindingName: rootB, bindingModule: modB,
    });
  }
  return out;
}
```

- [ ] **Step 7: eseguire i test e verificare che passino**

Run: `node --test trueline/scripts/blueprint/ac_assertion_power_check.test.mjs`
Expected: `pass 11`.

- [ ] **Step 8: commit**

```bash
git add trueline/scripts/blueprint/ac_assertion_power_check.mjs trueline/scripts/blueprint/ac_assertion_power_check.test.mjs
git commit -m "feat(power): stadio 1 e neutralizzatore — lo statico propone, non giudica"
```

---

### Task 3: `assertionPower` — il verdetto per esecuzione

**Files:**
- Modify: `trueline/scripts/blueprint/ac_assertion_power_check.mjs`
- Modify: `eval/harness/assertion_power_check.mjs` (nessuna modifica al gate: si esegue e basta)

**Interfaces:**
- Consumes: `findCandidates`, `neutralizeExport` (Task 2); `runTargetFile(appDir, file, template)` da `../checkpoint/run_file.mjs` — **esattamente 3 parametri, nessun oggetto di opzioni** (verificato in `run_file.mjs:41`) — che ritorna `{ error, testCount, passed, detail }`.
- Produces: `assertionPower(tasks, appDir, inScope, { runFileTpl })`, consumata da `control4Conformance` in Task 4.

- [ ] **Step 1: eseguire il keystone per fissare il punto di partenza**

Run: `node eval/harness/assertion_power_check.mjs`
Expected: FAIL, i sotto-test 1–9 rossi (l'oracolo non esiste ancora).

- [ ] **Step 2: implementare `assertionPower`**

Appendere a `ac_assertion_power_check.mjs`:
```js
import { runTargetFile } from '../checkpoint/run_file.mjs';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

export function assertionPower(tasks, appDir, inScope, { runFileTpl } = {}) {
  const files = [];
  const inert = [];
  const unresolved = [];
  let adjudicated = 0;
  const countCandidates = () => files.reduce((a, f) => a + f.candidates, 0);

  // `tasks` serve a dire QUALE AC e' guardato da una tautologia: un messaggio che
  // nomina solo il file lascia all'utente il lavoro di capire cosa non e' piu' provato.
  const acsOf = new Map();
  for (const t of tasks || []) for (const tt of (t.target_tests || [])) {
    const ids = Array.isArray(tt.covers) ? tt.covers : [tt.covers].filter(Boolean);
    acsOf.set(tt.file, [...(acsOf.get(tt.file) || []), ...ids]);
  }

  for (const rel of inScope) {
    const cands = findCandidates(appDir, rel).map((c) => ({ ...c, acIds: acsOf.get(rel) || [] }));
    files.push({ file: rel, candidates: cands.length });
    for (const c of cands) {
      const src = readFileSync(c.bindingModule, 'utf8');
      const mutated = neutralizeExport(src, c.bindingName);
      if (mutated === null) {
        unresolved.push({ ...c, reason: `forma dell'export non riconosciuta per '${c.bindingName}'` });
        continue;
      }
      if (mutated === src) {
        unresolved.push({ ...c, reason: `neutralizzazione no-op per '${c.bindingName}'` });
        continue;
      }
      const h0 = sha(c.bindingModule);
      writeFileSync(c.bindingModule, mutated);
      let r;
      try { r = runTargetFile(appDir, rel, runFileTpl); }
      finally { writeFileSync(c.bindingModule, src); }
      if (sha(c.bindingModule) !== h0) {
        return {
          ok: false, status: 'error', inert, unresolved,
          coverage: { scanned: files.length, files, candidates: countCandidates(), adjudicated, unresolved: unresolved.length },
          detail: `ripristino NON bit-esatto di ${c.bindingModule}: l'albero e' sporco, nessun verdetto`,
        };
      }
      if (r.error) { unresolved.push({ ...c, reason: `errore d'esecuzione: ${r.detail}` }); continue; }
      adjudicated++;
      // VERDE dopo la neutralizzazione = l'asserzione non puo' fallire.
      if (r.passed && r.testCount >= 1) inert.push({ ...c, verdict: 'inerte' });
    }
  }

  const candidates = countCandidates();
  const coverage = { scanned: files.length, files, candidates, adjudicated, unresolved: unresolved.length };

  if (inert.length > 0) {
    return {
      ok: false, status: 'red', inert, unresolved, coverage,
      detail: `asserzione INERTE (non puo' fallire): ${inert.map((i) => `${i.testFile}:${i.line} su '${i.bindingName}' [${i.acIds.join(', ') || 'AC ignoto'}]`).join('; ')}`,
    };
  }
  // FLOOR ANTI-VACUO: candidati trovati ma nessuno aggiudicato = copertura mancante,
  // non un verde (L-COL-006).
  if (candidates > 0 && adjudicated === 0) {
    return {
      ok: false, status: 'degraded', inert, unresolved, coverage,
      detail: `${candidates} candidati, NESSUNO aggiudicato: potere dell'asserzione NON verificato`,
    };
  }
  return {
    ok: true, status: 'green', inert, unresolved, coverage,
    detail: `potere verificato: ${adjudicated}/${candidates} candidati aggiudicati su ${files.length} target_test`,
  };
}
```

- [ ] **Step 3: eseguire il keystone**

Run: `node eval/harness/assertion_power_check.mjs`
Expected: sotto-test 1–9 VERDI; 10 (`wiring:control4`) e 11 (`bit-invariance:legacy`) ancora ROSSI — l'innesto non esiste.

- [ ] **Step 4: commit**

```bash
git add trueline/scripts/blueprint/ac_assertion_power_check.mjs
git commit -m "feat(power): stadio 2 — il verdetto lo emette l'esecuzione, e il ripristino si prova"
```

---

### Task 4: innesto in `control4Conformance` + prova di bit-invarianza

**Files:**
- Modify: `trueline/scripts/checkpoint/checkpoint.mjs:48` (import) e `:753-761` (dopo il loop dei target_test)

**Interfaces:**
- Consumes: `assertionPower` (Task 3).
- Produces: `control4Conformance` ritorna `status:'red'` con `power` popolato quando esiste un'asserzione inerte; il campo `power` compare nel JSON del checkpoint.

- [ ] **Step 1: eseguire i due sotto-test di wiring e verificare che siano rossi**

Run: `node eval/harness/assertion_power_check.mjs`
Expected: `wiring:control4` ROSSO.

- [ ] **Step 2: aggiungere l'import**

In `trueline/scripts/checkpoint/checkpoint.mjs`, dopo la riga 49:
```js
import { assertionPower } from '../blueprint/ac_assertion_power_check.mjs';
```

- [ ] **Step 3: innestare DOPO il verde dei target_test**

Sostituire il blocco finale del ramo AC-acceptance (oggi righe ~757-761):
```js
    const green = fails.length === 0;
    return {
      id: 4, name: 'conformance', status: green ? 'green' : 'red', green,
      detail: green ? `accettazione AC: ${inScope.length} target_test verdi` : `accettazione AC fallita: ${fails.join('; ')}`,
    };
```
con:
```js
    if (fails.length > 0) {
      return {
        id: 4, name: 'conformance', status: 'red', green: false,
        detail: `accettazione AC fallita: ${fails.join('; ')}`,
      };
    }
    // <<< POTERE DELL'ASSERZIONE — solo su un controllo 4 GIA' VERDE >>>
    // Su un run rosso il costo e' zero: un test che fallisce ha gia' il suo potere.
    const power = assertionPower(tasks, referenceApp, inScope, { runFileTpl });
    if (!power.ok) {
      return {
        id: 4, name: 'conformance', status: power.status, green: false,
        detail: `${inScope.length} target_test verdi, ma ${power.detail}`,
        power,
      };
    }
    return {
      id: 4, name: 'conformance', status: 'green', green: true,
      detail: `accettazione AC: ${inScope.length} target_test verdi; ${power.detail}`,
      power,
    };
```

- [ ] **Step 4: eseguire il keystone — atteso 11/11**

Run: `node eval/harness/assertion_power_check.mjs`
Expected: `assertion_power_check: 11/11 PASS`.

- [ ] **Step 5: provare la FALSIFICABILITÀ in due direzioni**

Neutralizzare l'innesto (commentare la riga `const power = ...` e il blocco `if (!power.ok)`) e rieseguire:
Run: `node eval/harness/assertion_power_check.mjs`
Expected: `wiring:control4` e `inert:detected` ROSSI. Poi ripristinare e riottenere 11/11.

Poi neutralizzare il solo `honest-parallel` (rendere lo stadio 2 sempre «inerte»):
Expected: `honest-parallel:not-flagged` e `healthy:not-flagged` ROSSI. Ripristinare → 11/11.

- [ ] **Step 6: non-regressione dei gate esistenti sul controllo 4**

Run:
```bash
node --test trueline/scripts/checkpoint/control4_ac.test.mjs
node --test trueline/scripts/checkpoint/checkpoint.trace.test.mjs
node eval/harness/anti_tamper_check.mjs
```
Expected: `control4_ac` 6/6, `checkpoint.trace` 3/3, `anti_tamper_check` **49/49**.

- [ ] **Step 7: commit**

```bash
git add trueline/scripts/checkpoint/checkpoint.mjs
git commit -m "feat(power): l'innesto nel controllo 4, e il keystone che lo guarda davvero"
```

---

### Task 5: la regola nello spedito e la proposta di lock

**Files:**
- Modify: `trueline/references/build-discipline.md` (sezione «Momento 2 — Test-first sull'AC»)
- Modify: `00-INDEX.md` §4 (proposta `L-COL-037`, **non ratificata** finché l'utente non lo dice)

**Interfaces:**
- Consumes: il comportamento costruito nei Task 2–4.
- Produces: la guida che l'agente in BUILD legge, e la voce di ledger da ratificare.

- [ ] **Step 1: aggiungere la regola in `build-discipline.md`**

Dopo il blocco «un `target_test` le cui asserzioni **divergono** dal suo AC…», aggiungere:

```markdown
- un `target_test` la cui asserzione **non può fallire** non è un oracolo: è un verde
  senza contenuto. La provenienza (l'asserzione discende dall'AC) **non** implica il
  potere. Il caso tipico è l'asserzione **tautologica**: `expect(A).toEqual(B)` dove i
  due lati sono lo **stesso oggetto**, perché B è importato da A o viceversa — allora
  l'uguaglianza è vera per costruzione e resta verde qualunque cosa accada al valore.
  L'oracolo `ac_assertion_power_check` lo **prova per esecuzione**: neutralizza il
  binding e riesegue il solo `target_test`; se resta verde, il controllo 4 è ROSSO.
  Quello che l'oracolo **non** copre — un test debole ma non tautologico — resta
  scoperto e **va dichiarato**, non assunto (`L-COL-006`).
```

- [ ] **Step 2: scrivere la proposta di lock in `00-INDEX.md` §4**

Aggiungere una riga alla tabella del ledger, marcata **PROPOSTO** (ratifica umana a fine sessione):

> **`L-COL-037` (PROPOSTO)** — **Un'asserzione che non può fallire non è un oracolo.** Il controllo 4 asseriva che il `target_test` *esiste, traccia, non è vacuo, è verde*: una tautologia soddisfa tutti e quattro **per costruzione**. Meccanismo: `trueline/scripts/blueprint/ac_assertion_power_check.mjs`, **fratello** di `ac_assertion_trace_check` (provenienza) sul lato *potere*. Due stadi **inscindibili**: lo statico **propone** (sovra-inclusivo, nessun verdetto — misurato: un rilevatore statico su raggiungibilità dei moduli dà **2 FP su 3**) e l'**esecuzione giudica** (neutralizza il binding, riesegue il solo `target_test`; verde ⇒ inerte). Direzione **conservativa** dichiarata: gira a livello di file, quindi i falsi negativi sono possibili e i falsi positivi no. **Nato da una misura, non da un principio:** su `progetto-web-ai`, `expect(tailwindConfig.theme.extend.colors).toEqual(colors)` con la config che importa `colors` per riferimento — cancellando **tutti** i design token il target_test resta 2/2 verde e la suite intera (696 test) è **identica alla baseline**. Frequenza NON stabilita (1 caso su 65 file): ciò che è stabilito è che nulla, in Trueline, poteva vederlo. | Estende `L-COL-002` dal lato dell'oracolo *del progetto*: l'oracolo giudica, ma solo se può dire di no. Completa `L-COL-032` (provenienza) col potere. | `05`, `06`, `10`, `trueline/scripts/blueprint/ac_assertion_power_check.mjs`, `eval/harness/assertion_power_check.mjs`, `L-COL-002`, `L-COL-006`, `L-COL-032` |

- [ ] **Step 3: commit**

```bash
git add trueline/references/build-discipline.md 00-INDEX.md
git commit -m "docs(power): la regola nello spedito + L-COL-037 PROPOSTO, non ratificato"
```

---

### Task 6: release — o l'update non consegnerebbe nulla

L'albero **SPEDITO** è cambiato (`trueline/scripts/blueprint/*`, `trueline/scripts/checkpoint/checkpoint.mjs`, `trueline/references/build-discipline.md`). Senza questo task `package_skill` **rifiuta di emettere** e l'update resterebbe un no-op che riporta successo (`L-COL-035`, braccio distribuzione).

**Files:**
- Modify: `trueline/package.json` (`skill_version` → `0.4.0`)
- Modify: `RELEASE-DIGESTS.json` (via `--record-release`)
- Modify: l'invocazione di `h1_perpid_check` nel runbook di sessione (`--shipped-allow`)

- [ ] **Step 1: dichiarare i path spediti toccati**

Run:
```bash
node eval/harness/h1_perpid_check.mjs --shipped-allow=trueline/scripts/blueprint/ac_assertion_power_check.mjs,trueline/scripts/blueprint/ac_assertion_power_check.test.mjs,trueline/scripts/checkpoint/checkpoint.mjs,trueline/references/build-discipline.md,trueline/package.json
```
Expected: **10/10 PASS**. Un path dichiarato ma **non** modificato è ROSSO (allowlist stale): se accade, correggere la lista, non il gate.

- [ ] **Step 2: bumpare `skill_version`**

In `trueline/package.json`: `"skill_version": "0.3.0"` → `"skill_version": "0.4.0"`.

- [ ] **Step 3: registrare la release**

Run: `node trueline/scripts/packaging/package_skill.mjs --record-release`
Expected: nuova chiave `"0.4.0"` in `RELEASE-DIGESTS.json`, lint **VERDE 20 pack**.

- [ ] **Step 4: verificare il keystone di release**

Run: `node eval/harness/release_bump_check.mjs`
Expected: **8/8 PASS**.

- [ ] **Step 5: commit**

```bash
git add trueline/package.json RELEASE-DIGESTS.json
git commit -m "rel(power): skill_version 0.4.0 + digest registrato"
```

---

### Task 7 (orchestratore, SERIALE — non delegabile): gate integrale

Il verdetto vero lo dà la riesecuzione **seriale** dell'orchestratore su albero fermo (`L-COL-002`; lezione di `DYNAMIC-WORKFLOWS §5.2`: chi legge tutto va isolato da chi scrive).

- [ ] **Step 1: preflight dell'ambiente, PRIMA di promettere il verde**

Run: `docker ps` · `node -e "console.log(process.version)"` · `eval/db-test/up.ps1` se il container è giù.
Se DB-live o docker/semgrep mancano: `m5` **non** è ri-gateabile qui → **gap dichiarato**, non un verde (`L-COL-006`).

- [ ] **Step 2: gate seriale**

```bash
node eval/harness/assertion_power_check.mjs        # atteso 11/11
node eval/harness/anti_tamper_check.mjs            # atteso 49/49
node eval/harness/build_discipline_check.mjs       # atteso 21/21
node eval/harness/h1_perpid_check.mjs --shipped-allow=...   # atteso 10/10
node eval/harness/scan_scope_check.mjs             # atteso 17/17
node eval/harness/release_bump_check.mjs           # atteso 8/8
node eval/harness/pack_verify_battery.mjs          # atteso 16/16, 0 SKIP
node eval/harness/m5_gate_check.mjs                # atteso 56/56 REALE
node eval/harness/a0_authz_gate_check.mjs && node eval/harness/a2a_hygiene_check.mjs \
  && node eval/harness/a2b_arch_check.mjs && node eval/harness/a2c_hygiene_activation_check.mjs
node eval/harness/ecosystem_conformance.mjs supabase-jsts   # pack toccato dal controllo 4
node trueline/scripts/packaging/package_skill.mjs --lint     # atteso VERDE 20 pack
```

- [ ] **Step 3: prova di bit-invarianza sul comportamento**

Run: `node eval/harness/assertion_power_check.mjs` sul fixture `no-candidates` e confrontare il JSON del controllo 4 con quello prodotto **prima** della modifica (`git stash` del solo `checkpoint.mjs` non è ammesso a questo punto: usare `git show HEAD~3:trueline/scripts/checkpoint/checkpoint.mjs` in una copia temp).
Expected: `detail` e `status` identici su un progetto senza candidati.

- [ ] **Step 4: dichiarare cosa NON è stato misurato**

Nel commit di chiusura, scrivere esplicitamente: la frequenza della classe (1 caso su 65 file), i falsi negativi possibili per la granularità di file, e ogni gate saltato per tool assente.

- [ ] **Step 5: merge human-gated**

**FERMARSI e chiedere all'utente** (`L-COL-024`): merge `--no-ff` su `main`, ri-verde su `main` **prima** del push, push, `claude plugin update`, e **ratifica di `L-COL-037`**.

---

## Cosa questo piano NON fa

- **Non** introduce mutation testing generale. La classe «test debole ma non tautologico» resta scoperta, e il Task 5 la **dichiara**. La misura del 30 lug dice che la rete per le mutazioni *comportamentali* esiste già nel controllo 3 (i due superstiti su logica sono stati presi dalla suite intera: 7 e 147 test rossi).
- **Non** tocca `normalize.mjs`, `finding.schema.json`, `SKILL.md`, né alcun oracolo di sicurezza.
- **Non** chiude il buco del banco: `eval/reference-app` continua a non avere `tests/`, quindi il ramo AC del controllo 4 lì degrada. Le fixture di `eval/assertion-power/` coprono il gate di *questa* feature, non quel buco — che resta nel backlog e va scritto in `SESSION-STATE §6`.
