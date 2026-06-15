# 06-CHARACTERIZATION-TESTS — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Versione** | v0.1 (Chat C) |
| **Data** | 13 giugno 2026 |
| **Copre** | `L-COL-004` (cardine), `023`; serve `003`, `018`; **percorso critico del v1** (VISION §6, §10) |
| **Dipende da** | `01-ARCHITECTURE` v0.1 (§3.3, §4), `05-VERIFY-FIX-LOOP` v0.1 · **gemello brownfield di** `11-BLUEPRINT-ENGINE` |

---

## 1. Perché questo modulo esiste

È il gemello brownfield di `11`. Dove in `11` i **criteri precedono** il codice (greenfield: si scrive l'intento, poi si costruisce), qui la **baseline cattura** il comportamento di codice **già scritto**, senza un intento da cui partire. Senza questa rete non si può dimostrare "non ho rotto nulla" su codice non testato — e quindi non si può applicare una fix in sicurezza *(L-COL-004)*.

Per questo i characterization test sono sul **percorso critico del v1** *(L-COL-023)*: in REMEDIATE la remediation è piena, non solo detection, e una fix senza baseline è una scommessa. Concretamente, sono ciò che rende **eseguibili** i controlli 3 (regressioni) e 4 (conformità → **invarianza**) del checkpoint quando manca un blueprint (`01` §4).

È anche il punto in cui l'**asimmetria onesta** di VISION §6 diventa meccanica: il controllo 4, privo di criteri d'intento, degrada da "è giusto" a "fa ancora ciò che faceva". Questo modulo costruisce la rete che misura quel "ancora".

## 2. Cos'è un characterization test (e cosa non è)

Un characterization test **fotografa il comportamento attuale** del codice e lo blocca come asserzione — anche se quel comportamento è *sbagliato*. Non dice cosa il codice *dovrebbe* fare; dice cosa **fa adesso**. Per costruzione, l'intera baseline è **verde sul codice corrente**: è il suo significato.

Distinzione netta da tenere ferma:

| | Test di accettazione (`11`, BUILD) | Characterization test (`06`, REMEDIATE) |
|---|---|---|
| **Deriva da** | l'intento scritto prima (criteri di accettazione) | il comportamento osservato del codice esistente |
| **Asserisce** | "fa la cosa **giusta**" | "fa la **stessa** cosa di prima" |
| **Verde significa** | conformità alla specifica | invarianza comportamentale |
| **Esiste un intento?** | sì, esplicito | no — è ciò che manca |

La conseguenza è il nodo del §4: una baseline può pinnare anche comportamento **insicuro**, e una fix di sicurezza *deve* cambiarlo.

## 3. Il flusso di generazione

```
REMEDIATE: codice esistente, niente blueprint
        │
        ▼
1. INVENTARIO        struttura, ecosistema (v1: JS/TS+Supabase), superfici
        │
        ▼
2. PERCORSO CRITICO  la skill PROPONE l'insieme da caratterizzare → GATE UMANO (§5)
        │
        ▼
3. GENERA            test che osservano il comportamento attuale (§6)
        │
        ▼
4. ESEGUI            DEVONO passare sul codice corrente (per costruzione)
        │            se un test "caratterizzante" è rosso subito → è mal scritto, si corregge
        ▼
5. BASELINE          la suite verde diventa la rete su cui gira il loop (05)
```

La baseline alimenta poi i controlli 3–4 del checkpoint, e ogni fix la riesegue (`05` §6).

## 4. Il nodo: invarianza vs comportamento da cambiare

Il problema centrale di REMEDIATE. Un characterization test pinna il comportamento **attuale**. Una fix di sicurezza **cambia di proposito** quel comportamento (è il punto: l'accesso insicuro deve smettere). Se il controllo 3 fosse, ingenuamente, "nessun test prima verde ora rosso", **ogni fix di sicurezza fallirebbe**: ha appena cambiato il comportamento che il test caratterizzava. Inaccettabile.

Soluzione: la baseline è **partizionata** rispetto a ciascuna fix.

- **Asserzioni-guardia** — il comportamento *ortogonale* al finding (tutto il resto dell'app). **Devono** restare verdi; un loro rosso è una **regressione vera** → `verification-failed` (`05` §6).
- **Asserzioni-impattate** — la porzione che la fix *intende* cambiare (es. "il tenant A oggi **può** leggere le righe del tenant B" — un bug). Catturano il comportamento **pre-fix**. Applicando la fix, queste asserzioni vengono **aggiornate** al comportamento **post-fix atteso** (es. "il tenant A ora riceve insieme vuoto"), **gate umano**, come parte della fix.

Procedura nel loop (innesto su `05` §3):

1. Per il finding `F`, la skill identifica le asserzioni che coprono il comportamento che la fix cambierà (**impattate**) vs il resto (**guardia**).
2. **Gate umano**: approvare la fix **e** confermare il comportamento post-fix atteso per le asserzioni impattate. Qui l'umano dichiara l'intento *localmente, per quella fix* — la macchina non lo inventa (VISION §6, §8).
3. Applica → aggiorna le asserzioni impattate al comportamento atteso → riesegui: l'**oracolo** deve essere pulito (`F` sparito) **e** tutte le **guardia** verdi **e** le **impattate** verdi sul nuovo atteso.
4. Una **guardia** che si rompe = regressione → il loop la tratta come `verification-failed`.

**Chi giudica cosa, onestamente.** Che la fix abbia raggiunto il suo scopo lo dice **l'oracolo** riesieguito (l'RLS checker ora passa; gitleaks non trova il segreto), **non** un'asserzione d'intento. L'asserzione impattata aggiornata serve soprattutto a **guardare contro la re-introduzione** e contro rotture collaterali. Così la promessa resta quella di VISION §6: *oracolo pulito + tutto il resto invariato*, senza spacciare una conformità-a-intento che in brownfield non esiste.

## 5. Cos'è il "percorso critico del v1"

Non si caratterizza **tutta** l'app: sarebbe infattibile e contro la parsimonia. Si caratterizza la **fetta di comportamento** che le remediation in scope possono plausibilmente rompere. Per l'ecosistema v1 (JS/TS su Supabase), il percorso critico è l'unione di:

1. **Il raggio d'azione delle fix in scope** — le regioni di codice **adiacenti ai finding** del set verificato-a-zero (`secret` + `rls` + `dead-code`), così che il blast radius di ogni fix sia coperto.
2. **Auth e isolamento per tenant** — il comportamento governato da RLS, perché è la categoria killer di Supabase (`03` §5.4): cambiare una policy può **chiudere fuori utenti legittimi** o **esporre dati**. È il punto a più alto rischio di regressione.
3. **La superficie API pubblica / gli endpoint che mutano dati** — request → response (forma + status) sui percorsi user-facing principali.

Questo perimetro è un **giudizio**, non un fatto oracolabile: la skill lo **propone**, l'umano lo **approva** (human-in-the-loop). La copertura non è mai dichiarata completa *(L-COL-006)*: ciò che resta fuori è **dichiarato** (§7), non assunto sicuro.

## 6. Come si generano (ecosistema v1)

La skill usa il **test runner del progetto** — lo rileva (vitest / jest / `node:test` / altro), non lo impone. La forma dipende dalla natura del codice:

| Tipo di codice | Tecnica di caratterizzazione |
|---|---|
| Funzioni ~pure | golden-master / snapshot di `input → output` |
| Endpoint / handler | `richiesta → risposta` (corpo, **status**, header rilevanti) |
| Comportamento governato da RLS | il **pattern di accesso attuale** (chi legge/scrive cosa, ora) reso asserzioni — vedi §6.1 |
| Codice con effetti collaterali | effetti osservabili via test double, o **dichiarato** fuori copertura comportamentale (§7) |

### 6.1 Caratterizzare RLS senza DAST — il confine

RLS è applicato dal DB a **runtime**. Caratterizzare "il tenant A può/non può leggere le righe del tenant B" richiede di **eseguire query contro un DB con RLS attivo**. Questo **non** è il DAST su URL live che il v1 esclude (`O-COL-007 → v2`): è **integration testing locale** contro un DB di test, prassi standard per i progetti Supabase, eseguito nell'ambiente dell'utente (privacy preservata, `L-COL-013`).

Da qui una **copertura condizionata**, coerente con il "confine dichiarato" dell'RLS checker (`03` §5.4):

- **DB di test disponibile** (Supabase locale / istanza non-prod con le migration applicate) → i characterization test esercitano l'**applicazione reale** di RLS.
- **DB di test non disponibile** → la caratterizzazione comportamentale di RLS **degrada**: si appoggia al checker **statico** (`03` §5.4) + all'invarianza dei **percorsi di accesso a livello di codice**, e la skill **dichiara** il confine ("comportamento RLS non caratterizzato a runtime; mi appoggio al checker statico"). Mai un verde finto *(L-COL-006)*.

La modalità **introspection** dell'RLS checker (read-only su DB non-prod, `03` §5.4) e questo DB di test sono lo stesso tipo di risorsa: opt-in, locale, nulla esce dall'ambiente.

### 6.2 Non-determinismo ed effetti

Una snapshot di output non-deterministico è inutile (risorgerebbe rossa al run successivo). La skill **stabilizza ciò che può** — inietta il clock, semina l'RNG, isola la rete con test double — e **dichiara ciò che non può** caratterizzare in modo stabile, anziché pinnare rumore. Coerente con la regola generale: tutto ciò che *può* essere deterministico lo è; il resto è dichiarato, non finto.

## 7. Copertura dichiarata *(L-COL-006)*

La baseline accompagna sempre una **dichiarazione di copertura**, gemella lato comportamento di quella lato finding (`04` §10):

- **cosa** è caratterizzato (le aree del percorso critico §5 effettivamente coperte);
- **cosa no** e perché (fuori dal percorso critico; comportamento DB-enforced senza test DB §6.1; non-determinismo non stabilizzabile §6.2).

L'**assenza** di un characterization test su un comportamento **non** significa "sicuro da cambiare". Significa che quel comportamento **non è sotto rete**: una fix che lo tocca è fuori dalla garanzia di invarianza, e va detto.

## 8. Rapporto con i controlli del checkpoint

In REMEDIATE l'oracolo dei controlli 3–4 (`03` §2 li lascia a questo modulo e a `11`) è la suite di characterization:

- **Controllo 3 — regressioni.** Oracolo = le **asserzioni-guardia**: erano verdi, sono ancora verdi. Una guardia rotta = regressione.
- **Controllo 4 — conformità → invarianza.** La suite nel suo insieme pinna il comportamento; "invariante" = guardia verdi **e** impattate verdi sul comportamento post-fix dichiarato dall'umano (§4). **Nessuna** pretesa di conformità-a-intento (VISION §6).

In BUILD non è così: c'è un blueprint, quindi il controllo 4 usa i **test di accettazione** (`11`), non i characterization. Questo modulo è il **sostituto di REMEDIATE**.

## 9. Non solo REMEDIATE — qualunque fix su codice non testato

`L-COL-004` è più ampio della sola modalità: i characterization test sono **prerequisito di ogni fix su codice non testato**, generati **prima** della correzione. Quindi anche in **BUILD**, se un macrotask tocca **codice pre-esistente non testato** (legacy senza copertura), la skill genera prima la caratterizzazione della porzione toccata, poi procede. REMEDIATE è la modalità dove la caratterizzazione è **sempre** sul percorso critico; in BUILD scatta **quando** la fix incrocia codice senza rete.

## 10. Eredità ai moduli a valle

- **`05-VERIFY-FIX-LOOP`** (già a monte) — riesegue questa baseline a ogni tentativo di fix; la partizione guardia/impattate del §4 è ciò che impedisce al controllo 3 di leggere una fix di sicurezza come regressione.
- **`08-TRIAGE-EXPLANATION`** — la prioritizzazione può informare quali comportamenti entrano nel percorso critico (§5); la spiegazione di un finding RLS si lega al confine di copertura del §6.1.
- **`10-EVALUATION`** — sul gate di verifica, le fix prodotte sulla reference app **non devono rompere** i characterization test seminati; la reference app include il DB di test che rende esercitabile l'RLS a runtime (§6.1).
