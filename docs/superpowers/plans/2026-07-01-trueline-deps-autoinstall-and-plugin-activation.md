# Trueline — dipendenze project-local + attivazione via plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere Trueline eseguibile su una macchina nuda (dipendenze project-local, install consent-gated) e auto-attivabile (plugin Claude Code + hook SessionStart), senza toccare l'engine verificato.

**Architecture:** Due fasi indipendenti. Fase 1 estende `preflight.mjs` con un installer binary-release (gitleaks/osv → `<project>/.trueline/bin/` via `node:https`) e fa cercare i wrapper in quella dir. Fase 2 insegna a `package_skill.mjs` ad assemblare un layout-plugin (manifest + hook SessionStart) dalla stessa sorgente, in aggiunta al `.skill`. L'engine (oracoli/loop/checkpoint/conformance) NON si tocca.

**Tech Stack:** Node ESM (solo built-in: `node:https`, `node:child_process`, `node:fs`, `node:os`, `node:zlib`), `tar` di sistema, gitleaks/osv-scanner release binaries, formato plugin Claude Code.

## Global Constraints

- Solo moduli **built-in** Node negli script spediti (niente npm deps, niente `curl`). — verbatim dalla spec.
- **Consenso esplicito** prima di ogni install (`L-COL-005`); senza `--yes`/`--target` e senza TTY → non installa, lo dichiara.
- **Onestà** (`L-COL-006`): ciò che non si installa/non gira è dichiarato *not-run*, mai verde finto.
- **BIT-invarianza dell'engine verificato**: `m5` 56/56 + 20 pack `ecosystem_conformance` + `anti_tamper` 49/49 + `build_discipline` 21/21 + `package_skill` lint VERDE devono restare verdi. Tutte le aggiunte sono additive (path assenti → comportamento odierno).
- **Cross-tool** (`L-COL-009`): la sorgente `trueline/SKILL.md` + `scripts/` resta valida fuori da Claude Code; il layout-plugin è un target di packaging AGGIUNTIVO; l'hook è CC-specifico (altrove → invocazione esplicita, dichiarata).
- **git** (`L-COL-024`): lavoro su `feat/deps-autoinstall-plugin`, mai `main`; commit per task.
- Versioni pinnate **esatte**: gitleaks `8.18.0`, osv-scanner `1.6.0` (≥ i minimi già in `MINIMUM_VERSIONS`). knip resta `npm i -D` project-local; semgrep resta docker/pip → degrada.

---

## FASE 1 — Dipendenze project-local

### Task 1: Mappa versioni pinnate + risoluzione asset per OS/arch

**Files:**
- Modify: `trueline/scripts/preflight.mjs` (dopo `MINIMUM_VERSIONS`, ~riga 122)
- Test: `trueline/scripts/preflight.assets.test.mjs` (create)

**Interfaces:**
- Produces: `PINNED_VERSIONS = { gitleaks: '8.18.0', 'osv-scanner': '6.0.0'→'1.6.0' }`; `resolveAsset(tool, plat, arch) -> { url, archive: 'tar.gz'|'raw', binName }` (esportati per il test).

- [ ] **Step 1: Test che fallisce** — `resolveAsset` per le 3 piattaforme principali:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAsset } from './preflight.mjs';

test('gitleaks asset linux x64 -> tar.gz con url della release pinnata', () => {
  const a = resolveAsset('gitleaks', 'linux', 'x64');
  assert.match(a.url, /gitleaks\/releases\/download\/v8\.18\.0\/.*linux.*x64.*\.tar\.gz/);
  assert.equal(a.archive, 'tar.gz');
  assert.equal(a.binName, 'gitleaks');
});
test('osv win x64 -> binario grezzo .exe', () => {
  const a = resolveAsset('osv-scanner', 'win32', 'x64');
  assert.match(a.url, /osv-scanner\/releases\/download\/.*windows.*amd64\.exe/);
  assert.equal(a.archive, 'raw');
  assert.equal(a.binName, 'osv-scanner.exe');
});
test('tool senza asset noto -> null', () => assert.equal(resolveAsset('semgrep', 'linux', 'x64'), null));
```

- [ ] **Step 2: Esegui — fallisce** (`resolveAsset` non esportato).
Run: `node --test trueline/scripts/preflight.assets.test.mjs` · Expected: FAIL.

- [ ] **Step 3: Implementa** `PINNED_VERSIONS` + `resolveAsset` + `export`. Mappa `process.platform`→{linux,darwin,windows}, `process.arch`→{x64:amd64, arm64}. Costruisci gli URL `https://github.com/<owner>/<repo>/releases/download/v<ver>/<asset>` (gitleaks `gitleaks_8.18.0_<os>_<arch>.tar.gz`; osv `osv-scanner_<os>_<arch>[.exe]`). Ritorna `null` per tool senza asset (semgrep/knip).

- [ ] **Step 4: Esegui — passa.** Run: `node --test trueline/scripts/preflight.assets.test.mjs` · Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add trueline/scripts/preflight.mjs trueline/scripts/preflight.assets.test.mjs
git commit -m "feat(preflight): mappa versioni pinnate + resolveAsset per gitleaks/osv"
```

### Task 2: Downloader binary-release → `.trueline/bin/`

**Files:**
- Modify: `trueline/scripts/preflight.mjs` (nuova funzione `downloadBinaryRelease`)
- Test: `trueline/scripts/preflight.download.test.mjs` (create) — usa un server `node:http` locale che serve un finto asset (tar.gz e raw), NESSUNA rete esterna.

**Interfaces:**
- Consumes: `resolveAsset` (Task 1).
- Produces: `async downloadBinaryRelease(tool, destDir, { urlOverride }) -> { ok, path, version|null, detail }` (esportata). Scarica via `node:https` (o `http` per il test via `urlOverride`), segue i redirect (GitHub → S3), estrae (`tar.gz`→`tar -xzf` di sistema in `destDir`; `raw`→scrive il file), `chmod 0o755` su POSIX, poi verifica la versione eseguendo `<bin> version`/`--version` e riusando `parseVersion`.

- [ ] **Step 1: Test che fallisce** — server locale serve un raw byte-blob come "osv" e verifica che venga scritto + reso eseguibile:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadBinaryRelease } from './preflight.mjs';

test('downloadBinaryRelease (raw) scrive il binario nel destDir', async () => {
  const srv = createServer((_q, r) => { r.writeHead(200); r.end('#!/bin/sh\necho fake 1.6.0\n'); });
  await new Promise((res) => srv.listen(0, res));
  const port = srv.address().port;
  const dest = mkdtempSync(join(tmpdir(), 'tl-dl-'));
  const out = await downloadBinaryRelease('osv-scanner', dest, { urlOverride: `http://127.0.0.1:${port}/osv`, archive: 'raw', binName: 'osv-scanner' });
  srv.close();
  assert.equal(out.ok, true);
  assert.ok(existsSync(out.path));
  assert.match(readFileSync(out.path, 'utf8'), /fake 1\.6\.0/);
});
```

- [ ] **Step 2: Esegui — fallisce.** Run: `node --test trueline/scripts/preflight.download.test.mjs` · Expected: FAIL.

- [ ] **Step 3: Implementa** `downloadBinaryRelease`: GET con `node:https`/`http` (redirect 30x → ri-richiesta), buffer → file in `destDir` (raw) o `<tmp>/asset.tgz` + `spawnSync('tar', ['-xzf', tgz, '-C', destDir])` (tar.gz; se `tar` assente → `{ ok:false, detail:'tar non disponibile' }`); `chmodSync(bin, 0o755)` su non-Windows; version-check best-effort. Mai stampare segreti; diagnostica su stderr.

- [ ] **Step 4: Esegui — passa.** Run: `node --test trueline/scripts/preflight.download.test.mjs` · Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add trueline/scripts/preflight.mjs trueline/scripts/preflight.download.test.mjs
git commit -m "feat(preflight): downloadBinaryRelease project-local (node:https + tar di sistema)"
```

### Task 3: `--target=project|global` + consenso project/global/skip nel flusso install

**Files:**
- Modify: `trueline/scripts/preflight.mjs` (`runInstall`, parsing flag, prompt)
- Modify: `trueline/scripts/preflight.test.mjs` — il default `--target=project` cambia l'azione proposta per gitleaks/osv (download project-local invece di `go install`); T2/T4 (asserzioni storiche `go install`) ora invocano con `--target=global`, e si aggiungono T2b/T4b per il default project-local. Suite di nuovo VERDE (9/9).
- Test: `trueline/scripts/preflight.target.test.mjs` (create) — invoca la CLI con `--json` e `--install --target=project --dry-run --simulate-missing=gitleaks` e asserisce il piano (project-local, nessun comando globale).

**Interfaces:**
- Consumes: `downloadBinaryRelease` (Task 2), `resolveAsset` (Task 1).
- Produces: nuovo flag `--target=project|global` (default `project`); `projectBinDir(projectDir) -> '<projectDir>/.trueline/bin'`.

- [ ] **Step 1: Test che fallisce** — `--install --target=project --dry-run` su gitleaks mancante pianifica un download project-local, non `go install`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const run = (args) => spawnSync(process.execPath, ['trueline/scripts/preflight.mjs', ...args], { encoding: 'utf8' });

test('--target=project pianifica download project-local per gitleaks', () => {
  const r = run(['--install', '--yes', '--target=project', '--dry-run', '--simulate-missing=gitleaks', '--only=gitleaks', '.']);
  assert.match(r.stdout, /\.trueline[/\\]bin/);
  assert.doesNotMatch(r.stdout, /go install/);
});
```

- [ ] **Step 2: Esegui — fallisce.** Run: `node --test trueline/scripts/preflight.target.test.mjs` · Expected: FAIL.

- [ ] **Step 3: Implementa** — parsing `--target`; in `runInstall`, per tool con `resolveAsset` non-null e `target==='project'` esegui `downloadBinaryRelease(tool, projectBinDir(PROJECT_DIR_ARG||cwd))` (rispettando `--dry-run`); `target==='global'` → comportamento attuale (`install_cmd`); knip resta `npm i -D` nel projectDir; prompt interattivo `[project/global/skip]` quando manca il consenso non-interattivo. `skip` → niente install, dichiarato.

- [ ] **Step 4: Esegui — passa.** Run: `node --test trueline/scripts/preflight.target.test.mjs` · Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add trueline/scripts/preflight.mjs trueline/scripts/preflight.target.test.mjs
git commit -m "feat(preflight): --target=project|global + consenso one-shot (default project-local)"
```

### Task 4: Wrapper + loop cercano in `<project>/.trueline/bin/` (additivo)

**Files:**
- Modify: `trueline/scripts/oracles/run_gitleaks.mjs` (`resolveGitleaksBin`, ~righe 59-79; passare `dir`)
- Modify: `trueline/scripts/oracles/run_osv.mjs` (risoluzione bin analoga)
- Modify: `trueline/scripts/loop/run_loop.mjs` (`runOracle`/`GO_BIN`, ~righe 61-66: aggiungi `<dir>/.trueline/bin` al PATH)
- Test: `trueline/scripts/oracles/bin_lookup.test.mjs` (create)

**Interfaces:**
- Produces: precedenza di risoluzione `<dir>/.trueline/bin/<exe>` → `$HOME/go/bin` → PATH. Se `.trueline/bin` assente → identico a oggi (BIT-invariante).

- [ ] **Step 1: Test che fallisce** — con un finto `gitleaks` in `<tmp>/.trueline/bin/`, `resolveGitleaksBin(tmp)` lo restituisce:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGitleaksBin } from './run_gitleaks.mjs';

test('resolveGitleaksBin preferisce <dir>/.trueline/bin', () => {
  const d = mkdtempSync(join(tmpdir(), 'tl-bin-'));
  const bin = join(d, '.trueline', 'bin');
  mkdirSync(bin, { recursive: true });
  const exe = join(bin, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  writeFileSync(exe, '#!/bin/sh\n'); try { chmodSync(exe, 0o755); } catch {}
  assert.equal(resolveGitleaksBin(d), exe);
});
```

- [ ] **Step 2: Esegui — fallisce** (`resolveGitleaksBin` non esportato / non prende `dir`).
Run: `node --test trueline/scripts/oracles/bin_lookup.test.mjs` · Expected: FAIL.

- [ ] **Step 3: Implementa** — `resolveGitleaksBin(dir)` antepone `join(dir, '.trueline', 'bin', exe)` ai candidati + `export`; chiamata aggiornata in `main()` con `dir`. Stessa modifica in `run_osv.mjs`. In `run_loop.mjs runOracle`, PATH = `<dir>/.trueline/bin` + `GO_BIN` + PATH.

- [ ] **Step 4: Esegui — passa.** Run: `node --test trueline/scripts/oracles/bin_lookup.test.mjs` · Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add trueline/scripts/oracles/run_gitleaks.mjs trueline/scripts/oracles/run_osv.mjs trueline/scripts/loop/run_loop.mjs trueline/scripts/oracles/bin_lookup.test.mjs
git commit -m "feat(oracles): risoluzione bin project-local .trueline/bin (additivo, BIT-invariante)"
```

### Task 5: `.gitignore` `.trueline/` + degradazione semgrep dichiarata

**Files:**
- Modify: `trueline/references/modes/remediate.md` (+ `build.md`): documenta che la skill assicura `.trueline/` in `.gitignore` del progetto e che senza docker/python semgrep degrada *not-run*.
- Modify: `trueline/scripts/preflight.mjs` (nota semgrep: se né docker né pip/pipx → `non-installable`, già gestito; verifica il messaggio).
- Test: nessun test nuovo (doc + verifica messaggio esistente via `--json --simulate-missing=semgrep`).

- [ ] **Step 1:** Aggiungi in `remediate.md`/`build.md` 2 righe: "(a) la skill aggiunge `.trueline/` al `.gitignore` del progetto prima di scaricare i binari; (b) se semgrep non è disponibile (no docker/python) injection/authz **degradano** a not-run, dichiarato (`L-COL-006`)."
- [ ] **Step 2: Verifica** che `node trueline/scripts/preflight.mjs --json --simulate-missing=semgrep` riporti `status` coerente (`missing` se docker/pip presenti, `non-installable` altrimenti). Expected: JSON coerente, exit 0.
- [ ] **Step 3: Commit.**
```bash
git add trueline/references/modes/remediate.md trueline/references/modes/build.md trueline/scripts/preflight.mjs
git commit -m "docs(modes): .gitignore .trueline/ + degradazione semgrep dichiarata"
```

### Task 6: Gate no-regressione Fase 1 (BIT-invarianza engine)

**Files:** nessuna modifica — solo esecuzione gate.

- [ ] **Step 1:** Smoke dei test nuovi: `node --test trueline/scripts/preflight.assets.test.mjs trueline/scripts/preflight.download.test.mjs trueline/scripts/preflight.target.test.mjs trueline/scripts/oracles/bin_lookup.test.mjs` → tutti PASS.
- [ ] **Step 2:** No-regressione (DB-live + semgrep-docker su): `node eval/harness/m5_gate_check.mjs` (56/56) + 3 pack rappresentativi `node eval/harness/ecosystem_conformance.mjs postgres-jsts|supabase-py|firebase-jsts` + `node trueline/scripts/packaging/package_skill.mjs --no-archive` (lint VERDE). Expected: tutti verdi (le aggiunte sono additive; `.trueline/bin` assente nei fixture → path odierno).
- [ ] **Step 3:** *(orchestratore)* full battery `gate2_battery.sh` (20 pack + m5 + keystones) → 0 FAIL. Commit non necessario (nessuna modifica); registrare l'esito.

---

## FASE 2 — Plugin Claude Code + hook SessionStart

### Task 7: `package_skill.mjs` assembla il layout-plugin (aggiuntivo al `.skill`)

**Files:**
- Modify: `trueline/scripts/packaging/package_skill.mjs` (nuovo step `--plugin <outdir>`)
- Create (asset sorgente): `trueline/.claude-plugin/plugin.json`, `trueline/hooks/hooks.json` (sorgenti versionati, assemblati nel layout)
- Test: `trueline/scripts/packaging/package_skill.plugin.test.mjs` (create)

**Interfaces:**
- Produces: con `--plugin <dir>`, emette `<dir>/.claude-plugin/plugin.json` + `<dir>/hooks/hooks.json` + `<dir>/skills/trueline/{SKILL.md,references,scripts,assets}` (riusa `copyTree`/`isExcluded`). Il `.skill` esistente resta invariato (default).

- [ ] **Step 1: Test che fallisce** — `--plugin <tmp>` produce la struttura attesa + manifest valido:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('--plugin assembla .claude-plugin + hooks + skills/trueline', () => {
  const out = mkdtempSync(join(tmpdir(), 'tl-plugin-'));
  const r = spawnSync(process.execPath, ['trueline/scripts/packaging/package_skill.mjs', '--plugin', out, '--no-archive'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(existsSync(join(out, '.claude-plugin', 'plugin.json')));
  assert.ok(existsSync(join(out, 'hooks', 'hooks.json')));
  assert.ok(existsSync(join(out, 'skills', 'trueline', 'SKILL.md')));
  const mf = JSON.parse(readFileSync(join(out, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(mf.name, 'trueline');
});
```

- [ ] **Step 2: Esegui — fallisce.** Run: `node --test trueline/scripts/packaging/package_skill.plugin.test.mjs` · Expected: FAIL.

- [ ] **Step 3: Implementa** — sorgenti `trueline/.claude-plugin/plugin.json` (`{name:"trueline",version:<skillSemver>,description:...}`) e `trueline/hooks/hooks.json` (Task 8); in `package_skill.mjs` aggiungi il ramo `--plugin <dir>`: `copyTree(SKILL_SRC, join(dir,'skills','trueline'))` (riuso, con le stesse esclusioni) + copia di `.claude-plugin/` e `hooks/`. Mantieni il `.skill` come default (cross-tool). **NB:** `.claude-plugin/` e `hooks/` non devono finire nel `.skill` — aggiorna `isExcluded`/`BUNDLE_TOP` perché il `.skill` resti identico (verifica con Task 10).

- [ ] **Step 4: Esegui — passa.** Run: `node --test trueline/scripts/packaging/package_skill.plugin.test.mjs` · Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add trueline/scripts/packaging/package_skill.mjs trueline/scripts/packaging/package_skill.plugin.test.mjs trueline/.claude-plugin/plugin.json trueline/hooks/hooks.json
git commit -m "feat(packaging): target --plugin (layout Claude Code, additivo al .skill)"
```

### Task 8: Hook SessionStart (nudge di auto-attivazione)

**Files:**
- Modify: `trueline/hooks/hooks.json` (contenuto dell'hook)
- Create: `trueline/hooks/session_start_nudge.mjs` (emette il nudge su stdout; built-in only)
- Test: `trueline/hooks/session_start_nudge.test.mjs` (create)

**Interfaces:**
- Produces: hook `SessionStart` che esegue `node hooks/session_start_nudge.mjs`; lo script stampa su stdout un nudge che nomina i trigger (audit/secure/remediate/RLS/secret/blueprint) e dice "invoca la skill trueline".

- [ ] **Step 1: Test che fallisce** — lo script stampa un nudge con le parole-chiave:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('session_start_nudge cita trueline + i trigger', () => {
  const r = spawnSync(process.execPath, ['trueline/hooks/session_start_nudge.mjs'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /trueline/i);
  assert.match(r.stdout, /audit|secur|remediat|RLS|blueprint/i);
});
```

- [ ] **Step 2: Esegui — fallisce.** Run: `node --test trueline/hooks/session_start_nudge.test.mjs` · Expected: FAIL.

- [ ] **Step 3: Implementa** `session_start_nudge.mjs` (stringa statica, veloce, niente preflight) + `hooks.json` che lo invoca su `SessionStart`. Il nudge: "Trueline è disponibile per audit di sicurezza / remediation / blueprint su progetti JS/TS+Supabase. Se l'utente chiede di rivedere la sicurezza, fare un audit, mettere in sicurezza, remediate, o avviare/avanzare un progetto, invoca la skill trueline."

- [ ] **Step 4: Esegui — passa.** Run: `node --test trueline/hooks/session_start_nudge.test.mjs` · Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add trueline/hooks/hooks.json trueline/hooks/session_start_nudge.mjs trueline/hooks/session_start_nudge.test.mjs
git commit -m "feat(plugin): hook SessionStart nudge di auto-attivazione"
```

### Task 9: `description` + `when_to_use` con trigger multilingue

**Files:**
- Modify: `trueline/SKILL.md` (frontmatter)
- Test: riusa l'eval di triggering esistente (`eval/harness/` per la `description`, 10 §7).

- [ ] **Step 1:** Riscrivi il frontmatter `description` aggiungendo trigger espliciti multilingue e un `when_to_use`: parole "security review/audit/metti in sicurezza/fai un audit/remediate/bonifica/RLS/secret/blueprint/avvia progetto/avanza macrotask". Mantieni < limite caratteri della description.
- [ ] **Step 2: Verifica** l'eval di triggering: trova ed esegui l'harness che valida la `description` (es. `node eval/harness/<triggering>.mjs` o il criterio 5 di `m5`/run_eval) → trigger positivi su BOOTSTRAP/BUILD/REMEDIATE, negativi sugli irrilevanti. Expected: verde.
- [ ] **Step 3: Commit.**
```bash
git add trueline/SKILL.md
git commit -m "feat(skill): description+when_to_use con trigger multilingue (auto-attivazione)"
```

### Task 10: Gate no-regressione Fase 2 + `.skill` invariato

**Files:** nessuna modifica — solo gate.

- [ ] **Step 1:** Test nuovi Fase 2: `node --test trueline/scripts/packaging/package_skill.plugin.test.mjs trueline/hooks/session_start_nudge.test.mjs` → PASS.
- [ ] **Step 2:** **`.skill` invariato**: `node trueline/scripts/packaging/package_skill.mjs` (default) → lint VERDE + l'albero `.skill` NON contiene `.claude-plugin/`/`hooks/` (i sorgenti plugin sono esclusi dal `.skill`). Verifica: il manifest/tree del `.skill` è identico a prima della Fase 2 (diff dell'elenco file).
- [ ] **Step 3:** *(orchestratore)* full battery `gate2_battery.sh` (20 pack + m5 + keystones + lint) → 0 FAIL. Registrare l'esito.
- [ ] **Step 4:** *(facoltativo, manuale)* installare il plugin in `~/.claude/plugins/` (o marketplace locale) e verificare che `/trueline:trueline` risolva e che il nudge compaia all'avvio. — fuori dal gate automatico (richiede un host CC).

---

## Self-review (eseguito)
- **Copertura spec:** §2.1→T1/T4, §2.2→T1/T2, §2.3→T3, §2.4→T4, §2.5→T5; §3.1/3.4→T7, §3.2→T8, §3.3→T9; §4 invarianti→T6/T10; §5 test→ogni task TDD. Nessun requisito scoperto.
- **Placeholder:** nessun TBD/TODO; codice di test concreto in ogni task.
- **Coerenza tipi:** `resolveAsset`/`downloadBinaryRelease`/`resolveGitleaksBin(dir)`/`projectBinDir`/`--target`/`--plugin` usati coerentemente tra i task.
- **Nota build:** i task che modificano file grandi (preflight.mjs, package_skill.mjs) richiedono che l'esecutore legga il file corrente per gli ancoraggi esatti; le funzioni nuove sono specificate per intero.
