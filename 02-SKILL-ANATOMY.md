# 02-SKILL-ANATOMY — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Versione** | v0.1 (Chat A) |
| **Data** | 13 giugno 2026 |
| **Copre** | `L-COL-007`, `009`, `014`, `016`, `017`, `022` |
| **Dipende da** | `01-ARCHITECTURE` v0.1 |

---

## 1. Distinzione preliminare: blueprint ≠ skill spedita

Due alberi di file da non confondere.

- **I file numerati `00`–`12`** (questa suite) sono il **blueprint**: la *progettazione* della skill. Non vengono spediti dentro la skill.
- **La skill spedita** è un albero diverso (`SKILL.md` + `scripts/` + `references/` + `assets/`). I suoi `references/` contengono contenuto *distillato* dal blueprint — il threat model di `07` diventa `references/conventions/threat-model.md`, lo schema del task di `11` diventa `references/blueprint/atomic-task-schema.md`, e così via.

Questo documento descrive **l'albero della skill spedita**.

## 2. Anatomia canonica e progressive disclosure *(L-COL-014)*

La skill rispetta i tre livelli di disclosure dello standard SKILL.md. Il vincolo operativo è che il **corpo del `SKILL.md` resti sotto le ~500 righe**, e che il contenuto pesante stia in `references/` caricato **on demand e solo per la modalità attiva**.

| Livello | Cosa | Quando entra nel contesto | Budget |
|---|---|---|---|
| **1 — frontmatter `description`** | Una manciata di frasi che dicono *cosa fa* e *quando attivarla*. È ciò che l'agente legge per decidere se triggerare la skill. | Sempre (preindicizzato). | minimo, trigger-accurate |
| **2 — corpo `SKILL.md`** | Risoluzione-intento + tabella di dispatch + invarianti condivise + puntatori ai reference di modalità. **Niente ruleset, niente template.** | Quando la skill triggera. | < ~500 righe |
| **3 — `references/` + `scripts/`** | Ruleset Semgrep, threat model, schema del task, template blueprint, soglie, ecosistema. Output degli oracoli (gli script *eseguono*, non entrano come codice). | On demand, **solo per la modalità attiva**. | illimitato a riposo, zero a contesto finché non serve |

Il guadagno di token (`L-COL-007`) sta nel livello 3: BUILD non carica mai i template di blueprint (sono roba di BOOTSTRAP), REMEDIATE non carica mai lo schema del task atomico, e nessuna modalità tiene in contesto il codice degli oracoli.

## 3. Il frontmatter

```yaml
---
name: trueline            # O-COL-001 chiusa → Trueline. Il tag decisioni resta COL.
description: >
  Lifecycle skill per progetti di coding JS/TS su Supabase. Genera un blueprint
  con task atomici verificabili, costruisce un macrotask alla volta, e verifica
  ogni macrotask con oracoli deterministici (security, segreti, RLS, dead-code)
  prima di committare. Tre modalità: BOOTSTRAP (nuovo progetto), BUILD (avanza il
  blueprint), REMEDIATE (bonifica codice esistente). Da usare quando si avvia,
  si avanza o si mette in sicurezza un progetto JS/TS su Supabase con un agente.
---
```

La `description` è l'unico gancio di triggering cross-tool *(L-COL-009)*: deve nominare ecosistema (JS/TS + Supabase), le tre modalità, e i verbi d'innesco ("avvia / avanza / bonifica"). L'eval di triggering vive in `10-EVALUATION`.

## 4. Layout della skill spedita

```
trueline/                              # nome = O-COL-001
├── SKILL.md                           # livello 2: intent-resolution + dispatch + invarianti
├── scripts/                           # oracoli ed esecutori — output-only nel contesto (L-COL-007)
│   ├── preflight.(sh|py)              # rileva tool mancanti + remote/auth git → propone install (O-COL-004)
│   ├── oracles/
│   │   ├── run_semgrep.*              # Semgrep + ruleset AI curato
│   │   ├── run_gitleaks.*             # segreti
│   │   ├── run_osv.*                  # osv-scanner, dipendenze
│   │   ├── rls_check.*                # RLS checker custom (Supabase)
│   │   └── run_deadcode.*             # knip / ts-prune / depcheck (L-COL-020)
│   ├── checkpoint/
│   │   └── run_checkpoint.*           # orchestra i 4 controlli → verdetto + findings normalizzati
│   ├── findings/
│   │   └── normalize.*                # output grezzo oracoli → finding model (04)
│   ├── blueprint/
│   │   └── validate_blueprint.*       # self-check STRUTTURALE deterministico (vedi 11 §self-check)
│   └── git/
│       └── detect_deploy_coupling.*   # L-COL-025: main → deploy automatico?
├── references/                        # livello 3: caricati on demand, per modalità attiva
│   ├── modes/
│   │   ├── bootstrap.md
│   │   ├── build.md
│   │   └── remediate.md
│   ├── blueprint/
│   │   ├── atomic-task-schema.md      # L-COL-019 (definito in 11)
│   │   ├── self-check-checklist.md    # parte SEMANTICA del self-check (11)
│   │   └── template/                  # suite-template in stile-utente (00-INDEX, VISION, moduli…)
│   ├── oracles/
│   │   ├── semgrep-ai-ruleset/        # il ruleset pesante curato (03)
│   │   └── thresholds.md              # soglie di severità per il controllo "sicurezza"
│   ├── conventions/
│   │   ├── named-standards.md         # standard nominati (07)
│   │   ├── forbidden-patterns.md      # pattern vietati (07)
│   │   └── threat-model.md            # step di enumerazione adversariale (07)
│   ├── findings/
│   │   └── finding-model.md           # schema del finding (04)
│   └── ecosystems/
│       └── supabase-jsts/             # ecosistema v1 = pack manifest-driven (SP-0, L-COL-029)
│           ├── ecosystem.json         #   contratto-macchina (validato da validate_ecosystem)
│           └── guide.md               #   prosa per-modalità (+ futuro ruleset/ per stack)
└── assets/
    └── prompts/                       # L-COL-022: OUTPUT di BOOTSTRAP, non runtime
        ├── project-start.md
        ├── session-start.md
        └── session-end.md
```

Note:
- **`scripts/` = oracoli ed esecutori.** Girano deterministici; nel contesto entra solo il loro output normalizzato.
- **`references/ecosystems/`** è il punto di estensione **reso un fatto in SP-0** *(L-COL-029)*: un ecosistema è una cartella `<id>/` con `ecosystem.json` (contratto-macchina, validato da `validate_ecosystem`) + `guide.md` (+ ruleset). L'engine lo risolve via `scripts/ecosystem/resolve.mjs`; aggiungere uno stack = **dati + (dove serve) un oracolo**, senza toccare il corpo.
- **`assets/prompts/`** sono *template* che BOOTSTRAP parametrizza ed emette; la skill non li esegue come parte del proprio runtime *(L-COL-022)*.

## 5. Il corpo del `SKILL.md` (livello 2)

Ordine e contenuto del corpo, entro le ~500 righe:

1. **Intent-resolution** *(L-COL-017)* — classifica il contesto del repo (tabella di `01` §2), propone la modalità, e **chiede conferma nei casi ambigui**. È la prima cosa che il corpo fa.
2. **Tabella di dispatch** — mappa modalità → reference da caricare (§6).
3. **Invarianti condivise** — il nucleo che vale in tutte e tre le modalità, tenuto nel corpo perché governa ogni azione:
   - oracle-as-judge, mai LLM-as-judge *(L-COL-002)*;
   - human-in-the-loop sulle fix; dead-code mai cancellato in autonomia *(L-COL-005, L-COL-021)*;
   - modello git a strati: branch autonomo, merge su `main` gated dal verde, distruttive mai autonome *(L-COL-024)*; deploy-coupling → gate anche sul verde *(L-COL-025)*;
   - nessun falso "via libera" *(L-COL-006)*.
4. **Hook di preflight** — invoca `scripts/preflight.*` prima di qualunque operazione che richieda gli oracoli o il push.
5. **Puntatori** — per il resto, il corpo rimanda ai reference di modalità; non duplica il loro contenuto.

Se il corpo si avvicina al limite, il candidato allo spostamento in `references/` è sempre il *dettaglio di modalità*, mai un'invariante (l'invariante deve restare visibile a ogni run).

## 6. Caricamento per modalità *(disclosure di livello 3)*

Ogni modalità tira **solo** i reference che le servono. Questo è il cuore della parsimonia.

| Reference | BOOTSTRAP | BUILD | REMEDIATE |
|---|:---:|:---:|:---:|
| `modes/bootstrap.md` | ● | | |
| `modes/build.md` | | ● | |
| `modes/remediate.md` | | | ● |
| `build-discipline.md` (disciplina di costruzione, `L-COL-031`) | | ● | ● |
| `blueprint/atomic-task-schema.md` | ● | ○ (consuma i criteri) | |
| `blueprint/self-check-checklist.md` | ● | | |
| `blueprint/template/` | ● | | |
| `oracles/*` (ruleset, soglie) | | ● | ● |
| `conventions/*` (standard, vietati, threat model) | ○ (per scrivere i task) | ● | ● |
| `findings/finding-model.md` | | ● | ● |
| `ecosystems/<attivo>/guide.md` (risolto da `resolve.mjs`) | ● | ● | ● |

● = caricato · ○ = caricato parzialmente / solo la parte rilevante.

In BUILD, lo schema del task è già "speso" nel blueprint: BUILD non rilegge l'intero schema, **consuma i criteri di accettazione** del task come oracolo del controllo conformità-logica *(L-COL-019)*. È l'aggancio fra le due metà reso concreto a livello di file caricati.

## 7. Cosa eredita questo documento ai moduli a valle

- **`03-ORACLES`** popola `scripts/oracles/` e `references/oracles/`; definisce il formato di output che `findings/normalize.*` consuma.
- **`04-FINDINGS-MODEL`** definisce `references/findings/finding-model.md`.
- **`07-CONVENTIONS-THREATMODEL`** popola `references/conventions/`.
- **`09-PACKAGING-DISTRIBUTION`** confeziona quest'albero in `.skill` e gestisce la conversione cross-tool e la presenza degli oracoli.
- **`11-BLUEPRINT-ENGINE`** definisce `references/blueprint/` e lo script `scripts/blueprint/validate_blueprint.*`.
