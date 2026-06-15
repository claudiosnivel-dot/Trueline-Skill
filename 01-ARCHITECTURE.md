# 01-ARCHITECTURE — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Versione** | v0.1 (Chat A) |
| **Data** | 13 giugno 2026 |
| **Copre** | `L-COL-002`, `015`, `016`, `017`, `018`, `019`, `024`, `025` |
| **Dipende da** | `VISION-AND-CONSTRAINTS` v0.2, `00-INDEX` v1.0 |

---

## 1. Vista d'insieme

Trueline è una macchina a stati con tre modalità che condividono **un solo motore di verifica**. Il flusso, qualunque sia il punto d'ingresso, converge sempre sullo stesso gate: un macrotask di codice esiste → il **checkpoint** lo misura con oracoli deterministici → su verde la skill committa, e decide se e come toccare `main`.

```
              ┌─────────────────────────────────────────────────────┐
   invoke ──▶ │  RISOLUZIONE-INTENTO  (testa del corpo SKILL.md)     │
              │  → quale modalità? (conferma esplicita se ambiguo)   │
              └───────┬──────────────┬──────────────┬────────────────┘
                      │              │              │
                BOOTSTRAP          BUILD         REMEDIATE
                      │              │              │
            genera blueprint   prendi macrotask  inventaria + baseline
            (task atomici:     dal blueprint     (characterization test)
             DoD+criteri+test) │                 lancia oracoli
            self-check         costruisci         → findings strutturati
            emetti 3 prompt    │                 proponi fix human-gated
            scrivi SESSION-    │                       │
            STATE              ▼                       ▼
              │          ┌───────────────────────────────────┐
              │          │   CHECKPOINT  (confine macrotask)  │
              │          │   4 controlli, autorità = oracolo  │
              │          │   dead-code · sicurezza ·          │
              │          │   regressioni · conformità-logica  │
              │          └───────┬───────────────────────────┘
              │            verde │ rosso → loop fix / retry / stop
              │                  ▼
              │          ┌───────────────────────────────────┐
              │          │   MODELLO GIT A STRATI             │
              │          │   commit su branch (autonomo)      │
              │          │   merge su main? → gating          │
              │          └───────────────────────────────────┘
              │                  │
              ▼                  ▼
         aggiorna SESSION-STATE  e  prossimo macrotask
```

La risoluzione-intento e il dispatch sono l'unica logica nel corpo `SKILL.md`; tutto il peso (ruleset, template, reference) sta in file allegati caricati on demand e **solo per la modalità attiva** (`02-SKILL-ANATOMY`, `L-COL-014`).

## 2. Risoluzione-intento e dispatch *(L-COL-017)*

All'invocazione la skill classifica il contesto del repo e sceglie la modalità. La classificazione è deterministica dove può esserlo (presenza di file), e si ferma a **chiedere conferma** dove il segnale è debole.

| Segnale osservato | Modalità | Confidenza |
|---|---|---|
| `SESSION-STATE.md` + blueprint presenti, repo con codice | **BUILD** | alta |
| Repo vuoto o quasi (nessun sorgente sostanziale, niente blueprint) | **BOOTSTRAP** | alta |
| Codice sorgente sostanziale **senza** blueprint né `SESSION-STATE` | **REMEDIATE** | alta |
| Blueprint presente ma `SESSION-STATE` assente, o codice presente + blueprint parziale | **ambiguo → chiedi** | — |
| Conflitto fra segnali (es. blueprint dice fase X, lo stato del codice ne suggerisce un'altra) | **ambiguo → chiedi** | — |

Regola dura: **nei casi ambigui la skill non sceglie da sola**. Espone cosa ha visto e propone la modalità più probabile, ma attende conferma esplicita prima di costruire o modificare alcunché. Questo è coerente con `L-COL-005` (human-in-the-loop) e protegge dal caso peggiore — far partire REMEDIATE che modifica codice quando l'utente voleva BUILD, o viceversa.

Indizi di classificazione (euristici, dettaglio in `02`): presenza/assenza di `00-INDEX.md`+`SESSION-STATE.md` nella radice del progetto blueprint; conteggio e maturità dei sorgenti; presenza di una directory di blueprint riconoscibile. Gli indizi alimentano la *proposta*; non sostituiscono la conferma nei casi ambigui.

## 3. Le tre pipeline

### 3.1 BOOTSTRAP — dal nulla al piano

Ingresso: repo vuoto/quasi, niente blueprint. **Non produce codice.**

1. **Raccolta intento** — la skill raccoglie obiettivo del progetto, ecosistema (v1: JS/TS su Supabase), vincoli. Input dell'utente, non invenzione dell'LLM.
2. **Generazione blueprint** — produce il blueprint nel formato-utente (suite di file in stile `00-INDEX` + moduli), scomposto in **task atomici** ciascuno con **definition-of-done + criteri di accettazione + test target** *(L-COL-019)*. Lo schema del task e i template stanno in `11-BLUEPRINT-ENGINE`.
3. **Self-check** — la skill passa una **checklist** sul blueprint generato (la qualità del blueprint non è oracolabile: si rende affidabile con checklist + template, non con vibes). La checklist verifica almeno: ogni task atomico ha i tre campi obbligatori; i criteri sono misurabili; i test target sono nominati; le dipendenze fra task sono esplicite; non ci sono task "fantasma" senza criteri.
4. **Emissione dei 3 prompt** — `project-start`, `session-start`, `session-end`, parametrizzati sul blueprint, come fallback portabile tool-agnostico *(L-COL-022)*. Non sono runtime della skill: con la skill, è la BUILD mode a eseguirli di fatto.
5. **Istanzia `SESSION-STATE`** — fotografa lo stato iniziale (blueprint pronto, nessun macrotask costruito).

Uscita verso BUILD: alla sessione successiva, blueprint + `SESSION-STATE` presenti → il dispatch sceglie BUILD.

### 3.2 BUILD — un macrotask alla volta

Ingresso: blueprint + `SESSION-STATE`. È il loop di costruzione.

1. **Seleziona il macrotask corrente** da `SESSION-STATE`/blueprint (rispettando le dipendenze).
2. **Costruisce** i task atomici del macrotask sul **branch di lavoro** (mai direttamente su `main`).
3. **Checkpoint** al confine del macrotask (§4). Qui la conformità-logica si ancora ai **criteri di accettazione** dei task atomici *(L-COL-019)*: è ciò che impedisce all'LLM di giudicare sé stesso.
4. Su **verde** → commit atomico sul branch (messaggio che cita il task ID e l'esito del checkpoint), poi **modello git** (§5) per il merge su `main`. Su **rosso** → loop di fix (§4.2) / retry / stop.
5. **Aggiorna `SESSION-STATE`** e passa al macrotask successivo.

**Promessa BUILD** (vedi asimmetria, VISION §6): *conformità alla specifica* — fa ciò che il task diceva, niente morto, niente vuln note, niente regressioni.

### 3.3 REMEDIATE — bonifica del brownfield

Ingresso: codice esistente sostanziale, niente blueprint. Remediation piena *(L-COL-023)*, non solo detection.

1. **Inventario** del codebase (struttura, ecosistema, superfici).
2. **Baseline di caratterizzazione** — genera i characterization test che catturano il comportamento *attuale* (`06-CHARACTERIZATION-TESTS`). Sono sul **percorso critico**: senza baseline non si può dimostrare l'invarianza di una fix su codice senza specifica.
3. **Lancia gli oracoli** (security + dead-code, `03-ORACLES`) → **findings strutturati** (`04-FINDINGS-MODEL`).
4. **Triage e spiegazione** (`08`) — l'LLM prioritizza e traduce; non emette verdetti.
5. **Propone fix human-gated** e le verifica col **loop** (§4.2): applica → riesegui lo stesso oracolo → riesegui i characterization test → accetta solo se il finding è azzerato e nulla si è rotto.
6. Lavora su **branch**; il merge su `main` resta un **"vai" umano** *(L-COL-024)*.

**Promessa REMEDIATE**: il controllo di conformità-logica **degrada** a *invarianza comportamentale* — "fa ancora ciò che faceva", non "è giusto". Detto in chiaro all'utente.

## 4. Il checkpoint *(L-COL-018)*

Gira al confine di **ogni macrotask completato** (BUILD) ed è il motore di verifica anche dentro il loop di REMEDIATE. Quattro controlli, ciascuno ancorato a un oracolo. **L'LLM non decide l'esito di nessuno dei quattro.**

| # | Controllo | Oracolo (fonte di verità) | Verde quando |
|---|---|---|---|
| 1 | **Dead code** | knip / ts-prune / depcheck *(L-COL-020)* | nessun nuovo morto introdotto; il morto pre-esistente è *segnalato*, non cancellato in autonomia *(L-COL-021)* |
| 2 | **Sicurezza** | Semgrep (+ ruleset AI curato) · gitleaks · osv-scanner · RLS checker *(L-COL-008)* | nessun finding di severità ≥ soglia nelle categorie in scope |
| 3 | **Regressioni** | suite di test esistente (BUILD) / characterization (REMEDIATE) | nessun test prima verde ora rosso |
| 4 | **Conformità-logica** | test di accettazione del task atomico (BUILD) / invarianza characterization (REMEDIATE) | i criteri di accettazione *(L-COL-019)* sono soddisfatti / il comportamento è invariato |

Nota sull'asimmetria fra controllo 3 e 4: in BUILD sono distinti — *regressioni* = "non ho rotto ciò che funzionava", *conformità* = "fa ciò che doveva". In REMEDIATE collassano verso la stessa baseline di caratterizzazione, perché manca un intento contro cui misurare la conformità. Questo collasso **è** l'asimmetria onesta della VISION §6, qui resa meccanica.

### 4.1 Dove sta l'LLM *(L-COL-002)*

La linea è netta e attraversa tutto il diagramma:

- **L'oracolo decide** — produce il fatto, e il fatto è il verdetto. Verde/rosso è una proprietà dell'output dell'oracolo, mai una frase dell'LLM.
- **L'LLM esegue, traduce, prioritizza, propone** — orchestra l'invocazione degli oracoli, normalizza l'output nel finding model, prioritizza i finding, li spiega in linguaggio semplice, e propone patch. **Non emette mai "è sicuro", "ho sistemato", "via libera".**

Gli oracoli sono script allegati: il loro codice resta fuori dal contesto, entra solo il loro output normalizzato *(L-COL-007)*. L'LLM ragiona sul finding model strutturato *(L-COL-011)*, non sul rumore grezzo né sui propri prior.

### 4.2 Loop di fix e checkpoint rosso

Quando un controllo è rosso, la skill non procede. Entra nel **loop di verifica della fix** *(L-COL-003)*: propone una correzione (human-gated, `L-COL-021`), la applica, **riesegue lo stesso oracolo** che ha trovato il problema e **riesegue i test**, e accetta solo se il finding è sparito **e** nulla si è rotto. La policy di retry/scarto (quanti tentativi, cap di token/tempo) è `O-COL-006` (Chat C). Finché il checkpoint non è verde, **non si committa al di là del branch e non si tocca `main`**.

## 5. Modello git a strati *(L-COL-024, L-COL-025)*

Il principio: **a pubblicare su `main` è il verdetto deterministico dell'oracolo, mai l'LLM-che-dice-fatto.** Il gate umano governa la *sostanza* delle fix; il checkpoint verde è la tua approvazione permanente a *pubblicare* — tranne dove pubblicare significa deployare.

### 5.1 Tre strati di autorità

| Strato | Operazioni | Autorità |
|---|---|---|
| **Branch di lavoro** | `git init`, `checkout -b`, stage, commit, push del branch | **Autonoma.** Additivo, isolato, reversibile. Commit atomici al confine di ogni macrotask → storia revertabile per task. |
| **Merge su `main`** | merge / fast-forward / PR-merge verso `main` | **Gated dal checkpoint verde** (autorità = oracolo). Asimmetria per modalità sotto. |
| **Operazioni distruttive** | `push --force`, `reset --hard` su branch pushato, rebase di storia pubblicata, delete branch | **Mai autonome.** Sempre gate umano esplicito (coerente con "nessuna azione irreversibile", `L-COL-005`). |

### 5.2 Asimmetria sul merge a `main`

- **BUILD** → su checkpoint verde, **merge su `main` autonomo**. Il verde significa conformità alla specifica del task: promessa forte.
- **REMEDIATE** → branch autonomo, ma il merge su `main` resta un **"vai" umano**. Pubblicare una bonifica la cui correttezza non è mai stata ancorata a un intento non è qualcosa che la skill fa da sé.

### 5.3 Gate di deploy *(L-COL-025)*

Prima di **qualunque** merge autonomo su `main` (quindi rilevante solo per il caso BUILD-verde), la skill **rileva se `main` è accoppiato a un deploy automatico**:

- workflow GitHub Actions che deploya su push a `main`;
- auto-deploy Cloudflare Pages / Workers (`wrangler` con deploy on push, integrazione Git);
- `vercel.json` / `netlify.toml` con deploy automatico;
- hook/branch di deploy Supabase.

Se `main` è **deploy-coupled**, il merge autonomo è **sospeso**: torna human-gated *anche sul verde*, perché un merge autonomo su `main` deploy-coupled = **deploy autonomo in produzione**, raggio troppo ampio (caso concreto: Gestionale Officina su Supabase + Cloudflare, live). In alternativa, la skill può **ridirigere l'autonomia su un branch `staging`**, lasciando il salto `staging → main`/prod all'umano.

> **Nota (meccanismo congelato — Chat C, `L-COL-025`).** Il deploy-coupling usa il **mix fail-safe**: auto-detect dei segnali → esito registrato in `SESSION-STATE` (`main_deploy_coupled: true | false | unknown`) → confermato **una volta** con l'utente; in caso di ambiguità o mancata conferma si **assume coupled** (merge human-gated). Dettaglio del meccanismo in `05` §8.3.

### 5.4 Preflight git

Il *push* richiede remote + auth già configurati: la skill non li inventa. Parallelo al preflight degli oracoli (`O-COL-004`):

- remote/auth assenti → la skill **committa in locale** sul branch e lo dichiara, senza fallire silenziosamente;
- in BOOTSTRAP chiede l'URL del remote **una volta** e lo registra in `SESSION-STATE`.

## 6. Flusso dati e confini

- **Input nel contesto**: blueprint, `SESSION-STATE`, output normalizzato degli oracoli, finding model. Il codice sorgente entra nel contesto solo per le porzioni che l'LLM deve leggere/modificare.
- **Fuori dal contesto**: il codice degli oracoli (sono script eseguiti, `L-COL-007`), l'intero codebase non rilevante al task corrente.
- **Mai fuori dall'ambiente utente**: nulla viene trasmesso a terzi *(L-COL-013)*. Nessuna telemetria *(O-COL-009)*.
- **Interfaccia fra i moduli**: il **finding model** (`04`) è il contratto fra oracoli (`03`), loop (`05`) e triage (`08`). Lo schema del **task atomico** (`11`) è il contratto fra BOOTSTRAP (genera) e BUILD (consuma, e ne usa i criteri come oracolo di conformità).

## 7. Cosa resta aperto per i moduli a valle

- **`02-SKILL-ANATOMY`** — come il corpo `<500 righe` instrada le tre modalità e carica i `references/` solo per quella attiva.
- **`03-ORACLES`** — invocazione concreta, soglie di severità per il controllo 2, sezione dead-code per il controllo 1, preflight presenza.
- **`05-VERIFY-FIX-LOOP`** — policy retry/scarto (`O-COL-006`), meccanismo preciso di merge/PR, e congelamento del gate di deploy (§5.3).
- **`06-CHARACTERIZATION-TESTS`** — generazione della baseline che alimenta i controlli 3 e 4 in REMEDIATE.
- **`11-BLUEPRINT-ENGINE`** — schema del task atomico e checklist di self-check citati in §3.1.
