# Design — Trueline: dipendenze project-local + attivazione via plugin

> **Origine.** Due gap emersi dal **dogfood reale** (REMEDIATE su ASV Officina, 2026-06-30):
> 1. su una macchina "non ottimizzata per programmare" Trueline non è eseguibile per intero — gli oracoli esterni (gitleaks/osv/semgrep/knip) richiedono una toolchain di sviluppo assente;
> 2. Trueline va invocata esplicitamente, mentre skill come superpowers si auto-attivano da un prompt rilevante.
>
> **Decisioni già prese col committente (brainstorming 2026-07-01):**
> - **Scope (opzione 1):** il **loop verificato (secret/RLS/dead-code) + dep-vuln** deve girare su macchina nuda; **semgrep** (injection/authz, *solo detection*) può **degradare onesto**.
> - **Distribuzione:** convertire Trueline in **plugin** con **hook `SessionStart`** (nudge di auto-attivazione + aggancio al preflight).
> - **Install:** default **project-local**, con scelta `project | global | skip`; consenso esplicito (`L-COL-005`).
> - **Docker NON è auto-installabile** dalla skill (system-level/admin/interattivo) — e con l'opzione 1 non serve.

## 1. Obiettivi / Non-obiettivi

**Obiettivi**
- O1. REMEDIATE/BUILD eseguibili su macchina **senza Go/Docker/Python**: gitleaks + osv-scanner scaricati come **binari prebuilt** project-local; knip via npm; rls_check built-in.
- O2. Install **consent-gated, one-shot**, con scelta **project-local (default) / global / skip**.
- O3. **Auto-attivazione** affidabile della skill da prompt rilevanti (audit/secure/remediate/RLS/blueprint…), via plugin + hook `SessionStart`.
- O4. **Engine verificato invariato** (oracoli/loop/checkpoint/conformance) → 20 pack + m5 restano BIT-invarianti.

**Non-obiettivi**
- NO auto-install di Docker/Go/Python (system-level, privilegiato) — `L-COL-005/024`.
- NO risolvere semgrep su macchina senza docker **né** python: degrada dichiarato (`L-COL-006`).
- NO modifiche alla logica di detection/fix degli oracoli.

## 2. Issue 1 — provisioning dipendenze project-local

### 2.1 Tiering per meccanismo d'install
| Oracolo | Categoria | Provisioning macchina-nuda | Toolchain |
|---|---|---|---|
| `rls_check` | RLS (verified) | built-in (viaggia con la skill) | nessuna |
| **gitleaks** | secret (verified) | **download binario release** → `.trueline/bin/` | nessuna (rete) |
| **osv-scanner** | dependency-vuln (detection) | **download binario release** → `.trueline/bin/` | nessuna (rete) |
| knip | dead-code (verified) | `npm i -D` project-local | node/npm |
| semgrep | injection/authz (detection) | docker → pip/pipx se Python → **degrada** | opzionale |

### 2.2 Nuovo installer "binary-release" in `preflight.mjs`
- Per gitleaks/osv: risolve **versione pinnata esatta** + `os`/`arch` → URL dell'asset GitHub release → **download via `node:https`/`fetch` built-in** (niente `curl`: funziona su Windows nudo) → estrazione → `chmod +x` → **ri-verifica versione** (riusa `parseVersion`/`versionAtLeast`).
  - osv-scanner release = **binario grezzo** (`osv-scanner_<os>_<arch>[.exe]`) → solo download + chmod.
  - gitleaks release = **`.tar.gz`** → estrazione con `tar` di sistema (presente Win10+/macOS/Linux); fallback: estrattore tar minimale built-in se `tar` assente.
  - Target dir: `<project>/.trueline/bin/` (project-local) oppure il canale global esistente.
  - Verifica d'integrità: confronto della versione post-install (e, se l'asset pubblica i checksum, confronto SHA256 — best-effort).
- Pin esatto delle versioni (estende `MINIMUM_VERSIONS` con una mappa `PINNED_VERSIONS` + URL template per asset).

### 2.3 UX di consenso (`preflight --install`)
- Rileva i mancanti → **una domanda**: `installo le dipendenze mancanti? [project (default) / global / skip]`.
- `project` → binari in `.trueline/bin/`, knip `npm i -D`. `global` → canali attuali (go/brew/docker). `skip` → nessun install, controlli dipendenti **degradano dichiarati**.
- Resta consent-gated (`L-COL-005`): senza consenso esplicito (o `--target=project|global`) non installa nulla. Nuovo flag `--target=project|global` (default `project`).
- La modalità REMEDIATE/BUILD, sul preflight rosso, **relaziona la proposta all'utente** e — sul suo ok — lancia `preflight --install --yes --target=<scelta>`.

### 2.4 Risoluzione runtime dei binari project-local
- `run_gitleaks.mjs`, `run_osv.mjs` e il PATH del loop cercano l'eseguibile in **`<project>/.trueline/bin/` PRIMA** di `~/go/bin` e del PATH di sistema.
- **Additivo / BIT-invariante:** se `.trueline/bin/` non esiste, comportamento identico a oggi (i gate dei 20 pack non cambiano).

### 2.5 Igiene & degradazione
- La skill garantisce `.trueline/` in `.gitignore` del progetto (binari + temp mai committati).
- semgrep senza docker/python, o download fallito (no rete) → controllo **dichiarato not-run** (`L-COL-006`), mai verde finto.

## 3. Issue 2 — conversione a plugin + hook SessionStart

### 3.1 Struttura plugin = **output di packaging**, non restructure del repo
**Il layout sorgente del repo NON cambia** (`trueline/SKILL.md`, `trueline/scripts/...`, `trueline/references/...` restano dove sono → i path dell'engine, gli script e i 20 pack non si toccano). È **`package_skill.mjs`** che **assembla** il layout-plugin a partire dalla sorgente:
```
<plugin-build>/               (output, layout plugin Claude Code)
├── .claude-plugin/plugin.json
├── hooks/hooks.json          ← SessionStart
└── skills/trueline/
    ├── SKILL.md
    └── references/  scripts/  assets/
```
- Invocazione → `/trueline:trueline` (namespaced). `plugin.json`: name/description/version.
- **Cross-tool preservato (`L-COL-009`):** il plugin è una distribuzione **additiva specifica di Claude Code**. La stessa `SKILL.md` + `scripts/` resta usabile su Codex/Cursor/Gemini come oggi (packaging `.skill` mantenuto in parallelo). L'**hook è CC-specifico**: su host senza hook l'attivazione **degrada all'invocazione esplicita** (dichiarato), il resto funziona identico.

### 3.2 Hook `SessionStart` (leggero — non blocca l'avvio)
- Inietta in contesto un **nudge di auto-attivazione**: *"Trueline disponibile per audit/remediation/blueprint su progetti JS/TS+Supabase. Se l'utente chiede di rivedere la sicurezza, fare un audit, mettere in sicurezza, remediate, o avviare/avanzare un progetto → invoca la skill trueline."* — l'equivalente del meccanismo superpowers.
- **Veloce**: stringa statica (o, opzionale, un check **file-only** velocissimo "repo JS/TS?" per restare silenzioso nei repo non pertinenti). **NON** lancia il preflight pesante ad ogni sessione.
- Il **preflight dipendenze resta lazy** (gira quando REMEDIATE/BUILD ingaggia, §4 del corpo), ora potenziato con l'install project-local (§2).

### 3.3 `description` + `when_to_use`
- Riscritti con **trigger multilingue** (audit, "metti in sicurezza", remediate, RLS, secret, blueprint, security review…) — cintura+bretelle oltre l'hook. L'eval di triggering (10 §7) resta il gate.

### 3.4 Packaging / eval
- `package_skill.mjs` impara a emettere il **layout plugin** (`.claude-plugin/plugin.json` + `hooks/` + `skills/trueline/...`) **in aggiunta** al `.skill` attuale (cross-tool preservato): due target dallo stesso sorgente.
- Eval di triggering (10 §7) invariato come gate della `description`.
- **Engine verificato non toccato** → batteria 20-pack + m5 BIT-invarianti.

## 4. Invarianti preservate
- `L-COL-002` oracle-as-judge: nessun cambiamento ai verdetti.
- `L-COL-005` consenso: nessun install senza consenso esplicito (incl. il nuovo binary-download).
- `L-COL-006` onestà: ciò che non si installa/non gira è **dichiarato** not-run, mai verde finto.
- `L-COL-024` git: lavoro su branch; merge `main` human-gated.
- `L-COL-029` engine manifest-driven: i tool/canali stanno nel preflight/manifest, non nel corpo.

## 5. Test / falsificabilità
- **Binary-download** (preflight): simula macchina nuda (`--simulate-missing`) → install project-local → verifica che l'eseguibile compaia in `.trueline/bin/` e che la versione sia ≥ pin. Falsificabile: rete/URL fasullo → degrada dichiarato, exit≠0, nessun verde.
- **Lookup `.trueline/bin/`**: un binario lì dev'essere usato dai wrapper con precedenza; rimosso → fallback a go/bin/PATH (BIT-invariante).
- **Consenso**: senza `--yes`/`--target` e senza TTY → non installa, lo dichiara.
- **Hook SessionStart**: il nudge è iniettato in contesto all'avvio (test del contenuto stdout dell'hook).
- **No-regressione engine**: full battery (m5 56/56 + 20 pack + keystones + lint) verde — le modifiche sono periferiche.

## 6. Rischi & migrazione
- **Cuore verificato intatto** (modifiche solo a preflight, wrapper-PATH, struttura plugin, hook, description) → rischio basso al core.
- **Codice nuovo da coprire con test:** binary-download (+ estrazione tar cross-OS), lookup `.trueline/bin/`, hook, layout plugin nel packaging.
- **Migrazione install:** da `~/.claude/skills/trueline` a plugin (marketplace o install locale del plugin) — da documentare; l'invocazione diventa namespaced.
- **`tar` su Windows:** presente da Win10; fallback estrattore minimale se assente.

## 7. Fuori scope
- Auto-install di Docker/Go/Python. Risoluzione di semgrep su macchina senza docker né python. Modifiche alla logica degli oracoli o al `verified_set` dei pack.
