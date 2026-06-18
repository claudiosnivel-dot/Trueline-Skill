# 09-PACKAGING-DISTRIBUTION — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) — ex codename *Collaudo*, `O-COL-001` chiusa in Chat E |
| **Versione** | v0.1 (Chat E) |
| **Data** | 14 giugno 2026 |
| **Copre** | `O-COL-002` (canale), `O-COL-004` (presenza oracoli), `O-COL-009` (telemetria); meccanismo di `L-COL-007`, `009`, `013`, `014` |
| **Dipende da** | `02-SKILL-ANATOMY` v0.1 (albero spedito, progressive disclosure), `03-ORACLES` v0.2 (oracoli + ruleset da vendorizzare), `07-CONVENTIONS-THREATMODEL` v0.2 (i 3 reference di convenzioni), `12-LIFECYCLE-PROMPTS` v0.1 (i 3 prompt in `assets/prompts/`), `05-VERIFY-FIX-LOOP` v0.1 (`detect_deploy_coupling` + esecutori), `11-BLUEPRINT-ENGINE` v0.1 (`validate_blueprint` + template) |

---

## 1. Ruolo di questo modulo

Definisce come il **blueprint** (la progettazione, file `00`–`12`) diventa la **skill spedita** — un artefatto `.skill` installabile e cross-tool — e come quell'artefatto si distribuisce. Non aggiunge policy: confeziona quelle già decise. Tre domande, una sezione ciascuna: **cosa viaggia** dentro il pacchetto e cosa resta dipendenza esterna (§2–§3), **come si versiona** e **come si converte cross-tool** (§4–§5), **come si installa** mantenendo la fiducia (§6–§7).

Distinzione preliminare (da `02` §1), qui operativa: i file numerati di questa suite **non** vengono spediti; ciò che viaggia è l'albero `SKILL.md` + `scripts/` + `references/` + `assets/`, i cui `references/` contengono contenuto **distillato** dal blueprint. Il packaging è esattamente l'atto di quella distillazione.

> **Nome.** Con la chiusura di `O-COL-001`, il `name:` del frontmatter e la directory radice sono **`trueline`**. Il placeholder `collaudo` usato prima del lock è già stato sostituito in tutta la suite (sweep del rename Collaudo→Trueline, registrato in `SESSION-STATE`). Il tag decisioni resta `COL`.

## 2. Cosa viaggia nel `.skill` vs dipendenza esterna

La decisione di confezionamento più importante. Il criterio è netto: **viaggia ciò che è nostro e deve essere deterministico/offline; resta esterno ciò che è un binario di terzi.**

**Viaggia (bundle, MIT — `O-COL-003`):**

- **`SKILL.md`** — il corpo di livello 2 (`02` §5): intent-resolution + dispatch + invarianti + hook di preflight. Sotto le ~500 righe *(L-COL-014)*.
- **`scripts/`** — **tutto il nostro codice** *(L-COL-007: gira, non entra nel contesto)*: `preflight.*`, `checkpoint/run_checkpoint.*`, `findings/normalize.*`, `git/detect_deploy_coupling.*` (`05` §8.3), `blueprint/validate_blueprint.*` (`11` §5.1), e gli **wrapper** degli oracoli (`run_semgrep.*`, `run_gitleaks.*`, `run_osv.*`, `run_deadcode.*`) — script sottili che invocano i tool esterni con i flag pinnati (`03` §3). **L'`rls_check.*` viaggia per intero**: è l'unico oracolo che costruiamo noi (`03` §5.4).
- **`references/`** — il livello 3 caricato on demand: `modes/` (bootstrap/build/remediate), `blueprint/` (`atomic-task-schema.md`, `self-check-checklist.md`, `template/`), `oracles/semgrep-ai-ruleset/` (il ruleset curato **vendorizzato e version-pinned**, offline, licenza pulita — `03` §5.1) e `oracles/thresholds.md`, `conventions/` (`named-standards.md`, `forbidden-patterns.md`, `threat-model.md` — distillati da `07`), `findings/finding-model.md` (da `04`), e **`ecosystems/<id>/`** — ogni ecosistema è un *pack*: `ecosystem.json` (contratto-macchina) + `guide.md` (+ ruleset) *(SP-0, `L-COL-029`)*.
- **`assets/prompts/`** — i 3 prompt di lifecycle (`project-start`, `session-start`, `session-end`), che BOOTSTRAP **emette parametrizzati** *(L-COL-022, `12`)*.

**Resta esterno (NON bundle — preflight, `O-COL-004`):**

- I **binari di terzi**: `semgrep`, `gitleaks`, `osv-scanner`, e i tool dead-code `knip`/`ts-prune`/`depcheck`. **Non vendorizziamo binari** (`03` §4): il preflight li rileva, confronta una versione minima pinnata, e **propone** l'install (mai esegue senza consenso, `L-COL-005`).

**Razionale.** Bundlare il nostro codice MIT + il ruleset curato (offline, licenza pulita) preserva determinismo e parsimonia di token *(L-COL-007)* e la postura privacy-first *(L-COL-013)*. Non vendorizzare binari di terzi evita problemi di licenza, peso, staleness e architettura-OS, e mantiene l'install **controllabile** che è parte della fiducia (§7).

## 3. Il packaging: `package_skill.*` → file `.skill`

Uno script di build (`package_skill.*`) assembla l'albero spedito a partire dalle fonti del blueprint, lo valida, ne pinna le versioni ed emette il `.skill`. Deterministico e riproducibile.

Cosa fa, in ordine:

1. **Assembla** `SKILL.md` + `scripts/` + `references/` + `assets/` nell'albero canonico di `02` §4, con radice `trueline/`.
2. **Distilla** i `references/conventions/` da `07` (§4 → `forbidden-patterns.md`, §5 → standard RLS in `named-standards.md`, §6 → `threat-model.md`) e `references/findings/finding-model.md` da `04`. Il ruleset Semgrep curato è copiato e **version-pinned** (`03` §5.1).
3. **Lint strutturale del pacchetto** (deterministico, esito binario — gemello di `validate_blueprint` ma applicato alla *skill*): `SKILL.md` < ~500 righe *(L-COL-014)*; frontmatter con `name` + `description` non vuoti; **ogni file referenziato dal corpo/dai modes esiste**; i **3 prompt** presenti; il **ruleset** presente; **ogni manifest `ecosystems/<id>/ecosystem.json` valido** (`validate_ecosystem`, *SP-0*); nessun riferimento orfano. Rosso → il pacchetto **non** si emette.
4. **Stampa un manifest** di versioni: versione skill (SemVer, §4), versione del ruleset curato, versioni minime degli oracoli (da preflight, `03` §4), e gli **ecosistemi supportati con versione e `tier`** (`verified` se `verified_set`≠∅, altrimenti `detection`) per id *(SP-0)*.
5. **Emette** l'archivio `.skill`.

Lo script è esso stesso un artefatto prodotto in implementazione, con il suo gate (vedi `DYNAMIC-WORKFLOWS` e §9).

## 4. Versioning

- **Skill**: SemVer. Una modifica al corpo/alle invarianti o al set di controlli è minor/major; una correzione di reference è patch.
- **Ruleset curato**: versione **propria e pinnata** (`03` §5.1). Aggiungere/cambiare regole = bump del ruleset, tracciato nel manifest. È il punto di estensione di `02` §4.
- **Oracoli esterni**: versioni **minime** pinnate nel preflight (`03` §4); il manifest le registra perché i risultati siano riproducibili (e la regressione di `10` deterministica).
- **Ecosistema**: la skill dichiara quale/i ecosistema/i supporta. v1 = `supabase-jsts`; v2 aggiunge file sotto `references/ecosystems/` (`firebase.md`, `nextjs-api.md`…) **senza toccare il corpo** *(O-COL-005, `02` §4)*.

## 5. Conversione cross-tool *(L-COL-009)*

Lo standard `SKILL.md` è la lingua franca; riferimento primario **Claude Code**, ma lo stesso artefatto gira su Codex/Cursor/Gemini CLI e altri agenti compatibili. La conversione verso un tool deve **preservare quattro proprietà**:

1. **Progressive disclosure** (i 3 livelli di `02` §2): frontmatter sempre indicizzato, corpo al trigger, `references/` on demand **per modalità attiva**.
2. **Gli script come allegati eseguibili** *(L-COL-007)*: il loro codice resta fuori dal contesto, entra solo l'output normalizzato.
3. **I 3 prompt come artefatti emettibili** *(L-COL-022, `12` §6)*: devono sopravvivere come **output di BOOTSTRAP**, non come runtime.
4. **Il caricamento per modalità** (`02` §6): ogni modalità tira solo i suoi reference.

**Degradazione dichiarata, mai finta** *(eco di `L-COL-006` al livello packaging)*. Dove un tool di destinazione non ha una capacità — niente caricamento on-demand, o niente esecuzione di script — la conversione **lo dichiara** anziché simulare. In concreto: un tool che non esegue gli oracoli **non può** emettere verdetti verificati lì, e va detto; in quel caso il **fallback portabile** sono i 3 prompt di lifecycle (`12`), che fanno girare a mano la stessa disciplina. La conversione non finge mai una capacità assente.

## 6. Presenza e install degli oracoli *(O-COL-004)*

Ricapitolazione operativa da `03` §4, lato pacchetto:

- Il `.skill` spedisce lo **script di preflight** + il **manifest di versioni**; **non** spedisce binari.
- Il preflight rileva ogni tool (`command -v` / `npx --no-install`), confronta la versione minima, e **propone** l'install adatto all'OS (gate umano, `L-COL-005`). Un tool senza canale di install disponibile è **dichiarato non installabile** e il suo controllo **degrada a "non eseguito"** — mai un verde finto *(L-COL-006)*.
- L'`rls_check.*` non ha dipendenze esterne oltre al runtime JS/TS: viaggia con la skill e funziona sempre.

## 7. Distribuzione e install manuale *(O-COL-002, L-COL-013, O-COL-009)*

- **Canale v1: repo GitHub + install manuale.** Nessun marketplace: una skill di security **esegue script**, quindi un install controllabile è parte della fiducia *(O-COL-002)*. Si clona/scarica il repo e si colloca l'albero nella directory delle skill dell'agente.
- **Namespace.** Il brand check (Chat E) ha trovato l'handle `github.com/trueline` **occupato** da un account non legato al dev-tooling: il repo vive quindi sotto un **tuo** namespace (org dedicata o repo `trueline` sul tuo account); il `name:` della skill è indipendente dall'handle. Il pacchetto npm `trueline` è **libero**, se in futuro un sotto-strumento venisse pubblicato.
- **Licenza**: **MIT** in v1 *(O-COL-003)* — kernel adottabile; l'eventuale wrapper SaaS è a parte (VISION §12).
- **Telemetria: nessuna** *(O-COL-009)*. Il pacchetto porta i default `--metrics=off` dove esistono (`03`); niente fa "phone home". osv-scanner, online di default, invia **solo nome+versione** dei pacchetti e ha `--offline` documentato (`03` §5.3).
- **Integrità.** Poiché l'install esegue codice, il repo controllabile **è** il canale di fiducia; una release firmata / provenance è una comodità rinviabile a v2.

## 8. Cosa questo modulo NON copre

- **Non è un marketplace/registry** né un meccanismo di **auto-update** in v1 (`O-COL-002`).
- **Non vendorizza binari di terzi** (`03` §4); non introduce telemetria (`O-COL-009`).
- **Non è il wrapper SaaS** (VISION §12): il packaging confeziona il **kernel**, non un runtime gestito.
- **Non fissa le soglie** (`03` §7) né lo schema (`04`): le impacchetta soltanto.

## 9. Eredità ai moduli a valle

- **`10-EVALUATION`** — i due parity gate (VISION §10) girano sulla skill **confezionata** (o sull'albero sorgente equivalente); il gate di build esercita BOOTSTRAP→BUILD come spedita, e l'eval di triggering della `description` (`10` §7) verifica il gancio cross-tool di §5. La correttezza della conversione (la skill triggera, i reference si caricano per modalità, i prompt si emettono) è spot-checkabile lì.
- **`DYNAMIC-WORKFLOWS`** — `package_skill.*` e il lint strutturale del §3 sono prodotti in implementazione: il loro **gate** (assembla un `.skill` valido che passa il lint?) è uno dei gate dei task del workflow.
