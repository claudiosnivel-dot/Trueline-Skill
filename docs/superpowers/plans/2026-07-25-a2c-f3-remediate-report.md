# A2c — F3: Report REMEDIATE del debito strutturale (dup/cycle/twin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Far EMERGERE dup/cycle/twin in un audit REMEDIATE come `report.structural_debt` (detection-only, non-bloccante, mai auto-fixato, `L-COL-030`) + coverage declaration, senza toccare `report.findings`, `collectFindings`, né la BIT-invarianza di m5.

**Architecture (decisione B, rivista):** `control1Hygiene` GIÀ computa dup/cycle/twin quando il manifest li dichiara (F1), ma `run_loop` **scarta** i `control.findings` nel serializzare `report.checkpoint` (`run_loop.mjs:424-427`). F3 **riusa** quei finding già calcolati (nessun re-run in `collectFindings` — evita il doppio-spawn e non tocca la baseline pre-fix): dopo il checkpoint, estrae la fetta d'igiene (`jscpd`/`cycle`/`twin`) da `cp.controls[id=1].findings` in `report.structural_debt`, e aggiunge una coverage entry. `report.findings` resta i risultati del loop (firewall `selectInScope`/`verified_set` invariato → dup/cycle/twin non vi entrano MAI).

**Tech Stack:** Node ESM built-in + `node:test`. Nessuna dipendenza nuova. Nessun cambio a `normalize.mjs`/`finding.schema.json`/`checkpoint.mjs`/`collectFindings`.

## Global Constraints

- **`L-COL-002/006`** — verdetto = oracolo; coverage declaration sempre presente; testo coverage SENZA `\b(sicuro|safe)\b` (m5:363 lo controlla).
- **`L-COL-030`** — dup/cycle/twin detection-only: **mai** in `report.findings`, mai `verified`, mai auto-fixati.
- **`L-COL-024`** — git solo nell'orchestratore; branch `feat/a2c-hygiene-activation`; `main` intatto (merge unico a fine A2c).
- **m5 INVARIANTE 56/56** — `report.findings` (F) non cambia (dup/cycle/twin esclusi da `selectInScope`, `verified_set`=[secret,rls,dead-code]); `report.structural_debt` è un campo NUOVO che m5 non asserisce; la coverage entry è additiva e senza "sicuro/safe". Il reference-app ha **0 cicli/0 twin/~0 dup** → `structural_debt` vuoto in m5 (comunque inerte).
- **BIT-invarianza** — pack che non dichiara duplication/architecture → nessun `report.structural_debt`, nessuna coverage entry d'igiene (guardia su `manifest.oracles.duplication||architecture`).

---

## File Structure

**Modificati:**
- `trueline/scripts/loop/run_loop.mjs` — helper esportato `extractStructuralDebt(controls)` + wiring dopo il checkpoint (`:427`) che popola `report.structural_debt` + coverage entry.

**Creati:**
- `trueline/scripts/loop/run_loop.a2c-f3.test.mjs` — unit di `extractStructuralDebt` + della coverage entry.

---

## Task 1: `extractStructuralDebt` + wiring in run_loop + coverage

**Files:**
- Modify: `trueline/scripts/loop/run_loop.mjs` (helper + wiring dopo `report.checkpoint = {...}`, `:427`).
- Test: `trueline/scripts/loop/run_loop.a2c-f3.test.mjs`

**Interfaces:**
- Produces: `export function extractStructuralDebt(controls)` → array `[{fingerprint, category, severity, oracle, location, evidence, baseline_status}]` dei soli finding d'igiene (`source_oracle.oracle ∈ {jscpd,cycle,twin}`) del controllo 1; `[]` se assente.
- Consumes: `cp.controls` da `runCheckpoint` (ogni controllo ha `.findings`); `manifest.oracles`.

- [ ] **Step 1: Scrivere il test**

```js
// run_loop.a2c-f3.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStructuralDebt } from './run_loop.mjs';

const c1 = (findings) => [{ id: 1, name: 'dead-code', findings }, { id: 2, name: 'security', findings: [] }];

test('extractStructuralDebt: estrae SOLO i finding d\'igiene (jscpd/cycle/twin) del controllo 1', () => {
  const controls = c1([
    { fingerprint: 'a', category: 'dead-code', severity: 'LOW', source_oracle: { oracle: 'knip' }, location: {}, evidence: 'x', baseline_status: 'new' },
    { fingerprint: 'b', category: 'duplication', severity: 'LOW', source_oracle: { oracle: 'jscpd' }, location: { file: 'src/a.ts' }, evidence: 'clone', baseline_status: 'pre-existing' },
    { fingerprint: 'c', category: 'architecture', severity: 'LOW', source_oracle: { oracle: 'cycle' }, location: {}, evidence: 'cyc', baseline_status: 'pre-existing' },
    { fingerprint: 'd', category: 'architecture', severity: 'LOW', source_oracle: { oracle: 'twin' }, location: {}, evidence: 'twin', baseline_status: 'pre-existing' },
  ]);
  const sd = extractStructuralDebt(controls);
  assert.equal(sd.length, 3, 'dup+cycle+twin, NON dead-code');
  assert.deepEqual(sd.map((f) => f.oracle).sort(), ['cycle', 'jscpd', 'twin']);
  assert.ok(sd.every((f) => 'baseline_status' in f && 'fingerprint' in f));
  assert.ok(!sd.some((f) => f.oracle === 'knip'), 'dead-code NON e\' debito strutturale');
});

test('extractStructuralDebt: controllo 1 assente / senza igiene -> []', () => {
  assert.deepEqual(extractStructuralDebt([{ id: 2, name: 'security', findings: [] }]), []);
  assert.deepEqual(extractStructuralDebt(c1([{ fingerprint: 'a', category: 'dead-code', source_oracle: { oracle: 'knip' } }])), []);
  assert.deepEqual(extractStructuralDebt(null), []);
});
```

- [ ] **Step 2: Eseguire → FAIL** (`extractStructuralDebt` non esiste)

Run: `node --test trueline/scripts/loop/run_loop.a2c-f3.test.mjs`
Expected: FAIL — export mancante.

- [ ] **Step 3: Aggiungere il helper** — in `run_loop.mjs`, accanto agli altri helper top-level (es. dopo `collectFindings`, `:179`):

```js
// A2c/F3 — DEBITO STRUTTURALE per l'audit REMEDIATE. control1Hygiene GIA' computa
// dup/cycle/twin (F1) quando il manifest li dichiara, ma run_loop scarta i
// control.findings nel serializzare report.checkpoint. Qui li RIUSA (nessun re-run):
// estrae la fetta d'igiene del controllo 1 per report.structural_debt (detection-only,
// non-bloccante, mai auto-fixata — L-COL-030). dead-code (knip) NON e' debito
// strutturale (ha il suo gate delta). [] se il controllo 1 o i finding sono assenti.
const HYGIENE_ORACLES = new Set(['jscpd', 'cycle', 'twin']);
export function extractStructuralDebt(controls) {
  const c1 = Array.isArray(controls) ? controls.find((c) => c && c.id === 1) : null;
  const findings = (c1 && Array.isArray(c1.findings)) ? c1.findings : [];
  return findings
    .filter((f) => f.source_oracle && HYGIENE_ORACLES.has(f.source_oracle.oracle))
    .map((f) => ({
      fingerprint: f.fingerprint,
      category: f.category,
      severity: f.severity,
      oracle: f.source_oracle.oracle,
      location: f.location,
      evidence: f.evidence,
      baseline_status: f.baseline_status,
    }));
}
```

- [ ] **Step 4: Wiring dopo il checkpoint** — in `run_loop.mjs`, subito dopo il blocco `report.checkpoint = { … cp.controls.map(…) };` (`:424-427`), aggiungere:

```js
    // A2c/F3 — debito strutturale (report REMEDIATE) dai finding d'igiene GIA'
    // calcolati dal controllo 1 (nessun re-run). Guardia sul manifest -> BIT-invariante
    // per i pack senza dup/cycle. report.findings (loop) resta invariato.
    const declaresHygiene = Boolean(manifest && manifest.oracles
      && (manifest.oracles.duplication || manifest.oracles.architecture));
    if (declaresHygiene) {
      report.structural_debt = extractStructuralDebt(cp.controls);
      if (!report.coverage) report.coverage = { characterized: [], declared_uncovered: [] };
      if (Array.isArray(report.coverage.declared_uncovered)) {
        report.coverage.declared_uncovered.push({
          what: 'duplicazione verbatim >=min_tokens; cicli import JS/TS; directory clone-and-rename (twin)',
          why: 'igiene strutturale detection-only (L-COL-030): rilevata e riportata, MAI auto-fixata; i simboli RINOMINATI e le duplicazioni sotto min_tokens non sono coperti',
        });
      }
    }
```

(`manifest` è in scope: `run_loop.mjs:365` `const manifest = activeId ? loadManifest(activeId) : null;`. `cp` è `:423`.)

- [ ] **Step 5: Eseguire → PASS**

Run: `node --test trueline/scripts/loop/run_loop.a2c-f3.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
rm -f ./NUL 2>/dev/null
git add trueline/scripts/loop/run_loop.mjs trueline/scripts/loop/run_loop.a2c-f3.test.mjs
git commit -m "feat(a2c): F3 — report.structural_debt (dup/cycle/twin) in REMEDIATE + coverage (riuso control1)"
```

---

## Task 2: Gate SERIALE + ledger

**Files:** `00-INDEX.md` (nota F3 su `L-COL-034`), `SESSION-STATE.md`, `trueline/references/modes/remediate.md` (report.structural_debt).

- [ ] **Step 1: Unit F3 + non-regressione run_loop**

Run: `node --test trueline/scripts/loop/run_loop.a2c-f3.test.mjs` → PASS; se esistono, `node --test trueline/scripts/loop/run_loop.scope.test.mjs trueline/scripts/loop/run_loop.a0.test.mjs` → PASS (esistenza-only, invariati).

- [ ] **Step 2: m5 INVARIANTE 56/56**

Run: `node eval/harness/m5_gate_check.mjs` → **56/56** (report.findings invariato; structural_debt vuoto sul reference-app; coverage entry additiva senza "sicuro/safe"). Se exit 2 = precondizione ambiente (ri-provare su macchina capace).

- [ ] **Step 3: Non-regressione keystone (SERIALE)**

`a2c_hygiene_activation_check` 6/6 · `a2a_hygiene_check` 5/5 · `build_discipline_check` 21/21 (control1 invariato — F3 non tocca checkpoint) · `package_skill` lint VERDE.

- [ ] **Step 4: Prova end-to-end del report (falsificabile, orchestratore)**

Su una copia provvigionata della fixture `_a2c-fixtures/dup-cycle-debt`, eseguire un audit REMEDIATE e verificare che `report.structural_debt` sia **popolato** (>=1 dup + >=1 cycle) e che il checkpoint resti VERDE (report-only). Comando (orchestratore, temp copy): `node trueline/scripts/loop/run_loop.mjs <copia> --mode=remediate` → JSON con `structural_debt.length >= 2`. Documentare output. (Se run_loop end-to-end sulla fixture è troppo pesante/instabile, provare l'invariante via `extractStructuralDebt` sui `cp.controls` di un `runCheckpoint(mode:'remediate')` diretto sulla fixture — stesso fatto d'oracolo.)

- [ ] **Step 5: Ledger + dispatch**

`00-INDEX §4`: emendare la nota `L-COL-034` (F3: report REMEDIATE via `extractStructuralDebt`, riuso control1, `report.structural_debt` non-bloccante). `SESSION-STATE`: riga 9 + §6. `remediate.md`: 1 riga su `report.structural_debt`.

- [ ] **Step 6: Commit ledger**

```bash
rm -f ./NUL 2>/dev/null
git add 00-INDEX.md SESSION-STATE.md trueline/references/modes/remediate.md
git commit -m "docs(a2c): ledger/stato F3 — report.structural_debt REMEDIATE + dispatch"
```

- [ ] **Step 7: STOP — A2c completa (F1+F2+F3), merge unico human-gated**

Presentare all'utente: A2c completa, gate verde, branch pronto; chiedere l'ok per il **merge unico** `--no-ff` su `main` + push + install (plugin) riallineato.

---

## Self-Review

**1. Spec coverage** — spec §7 (report REMEDIATE non-bloccante + coverage) → T1 (`report.structural_debt` + coverage); §2.4 → T1. Decisione B (riuso control1) è più snella dell'approccio collectFindings dell'indagine e copre lo stesso intento senza re-run/costo m5.

**2. Placeholder scan** — codice reale in ogni step; Step 4 offre un fallback esplicito se il run_loop end-to-end è instabile.

**3. Type consistency** — `extractStructuralDebt(controls)` (T1) usa `c.id===1`/`c.findings`/`source_oracle.oracle` coerenti con `control1Hygiene` (checkpoint.mjs) e con `cp.controls` di `runCheckpoint`. `HYGIENE_ORACLES` = {jscpd,cycle,twin} coerente coi `source_oracle.oracle` dei normalizer (normalize.mjs). `declaresHygiene` legge `manifest.oracles.duplication/architecture` (le stesse chiavi di F1/F2).

**Rischi noti** — (a) m5: se `control1Hygiene` degrada dup/cycle sul reference-app (tool assenti), `structural_debt` è vuoto — corretto/onesto, m5 verde. (b) `report.coverage` esiste solo con `--characterize` (m5 lo passa); il ramo inizializza `coverage` se assente per l'audit senza characterize. (c) testo coverage privo di "sicuro/safe" (m5:363).
