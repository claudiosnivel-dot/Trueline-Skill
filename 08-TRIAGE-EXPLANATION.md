# 08-TRIAGE-EXPLANATION — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Versione** | v0.1 (Chat D) |
| **Data** | 13 giugno 2026 |
| **Copre** | meccanismo di `L-COL-002` (cardine qui), `006`, `011`, `021`; **`L-COL-028` — policy conservativa sui falsi positivi (promossa a lock dedicato in Chat E)** |
| **Dipende da** | `01-ARCHITECTURE` v0.1 (§4.1 dove sta l'LLM), `03-ORACLES` v0.2 (§5.5, §7, allowlist), `04-FINDINGS-MODEL` v0.2 (§5 stati, §9 consumo, §10 report), `05-VERIFY-FIX-LOOP` v0.1 (consuma i finding `triaged`) |

---

## 1. Perché questo modulo esiste — ed è il più rischioso

Triage e spiegazione sono le attività dove **l'LLM fa di più**: riordina, traduce, segnala sospetti falsi positivi. Sono anche, per la stessa ragione, il punto dove `L-COL-002` (oracle-as-judge, mai LLM-as-judge) corre il **rischio più alto** di erodersi: da "riordino e traduco i fatti dell'oracolo" a "decido cosa conta" è un passo corto. Il compito di questo modulo è tenere il ruolo dell'LLM **ristretto** — utile e attivo, ma mai giudice.

Una riga regge tutto: **l'LLM riordina e traduce i fatti dell'oracolo; non li riscrive e non emette verdetti.**

## 2. Il confine: cosa l'LLM può e non può fare qui

Estende `01` §4.1 e `04` §9.

| L'LLM **può** | L'LLM **non può** |
|---|---|
| **prioritizzare** (ordinare) i finding (§3) | cambiare `severity` o `category` |
| **tradurre** in linguaggio semplice (§4) | marcare `verified`/risolto |
| **segnalare un sospetto FP** con evidenza concreta (§5) | sopprimere / scartare un finding |
| **proporre** una voce di allowlist o una direzione di fix | dire "è sicuro" / "via libera" |
| scrivere `notes`, muovere `detected → triaged` | contare un finding come gestito senza oracolo/umano |

`verified` resta dell'**oracolo** (`05` §3); l'accettazione di un rischio resta dell'**umano** (`04` §5). L'LLM sta in mezzo, e non oltrepassa.

## 3. Prioritizzazione spietata

L'LLM produce un **ordine** per l'attenzione umana e per la sequenza del loop di fix (`05` §5), **più** una motivazione in `notes`. Non è un re-scoring: l'ordine **non cambia ciò su cui il checkpoint fa gate** (lo fanno le soglie, `03` §7).

**Input** (tutti dal finding model, nessuno inventato):

- `severity` (dall'oracolo, **immutabile**);
- `category` + politica di blocco (`03` §7: `secret` sempre-blocca; `rls` dipende da `scope_relevance`; ecc.);
- `scope_relevance` (`in-scope`/`out-of-scope` per il macrotask corrente, BUILD);
- `baseline_status` (`new` vs `pre-existing`);
- contesto OWASP/CWE (§3 di `07`) e segnali di sfruttabilità nei metadati dell'oracolo.

**Funzione d'ordine** (documentata, riproducibile — non a sensazione):

```
blocca-sempre (secret)  ▸  nuovo & sopra-soglia  ▸  in-scope  ▸
severità  ▸  categoria-killer (rls/authz su Supabase)  ▸  pre-existing/advisory in coda
```

**"Spietata"** = far emergere **i pochi che contano** in cima e non seppellire l'umano sotto l'advisory; il debito pre-esistente (BUILD) sta in coda, non inchioda il round. L'ordine è una **raccomandazione**; il cancello resta oracolo + soglie (eco di `05` §6: verifica per-finding vs ri-valutazione del checkpoint).

## 4. Spiegazione in linguaggio semplice

Trasforma un finding strutturato e secco (rule_id, CWE, riga) in qualcosa su cui agire. Quattro elementi:

1. **Cos'è** — in una frase, senza gergo non spiegato.
2. **Perché conta** — citando lo **standard nominato** di `07` (es. "viola **A01:2025** / lo standard RLS nominato R3"), **non** un parere.
3. **Dove** — da `location` (file, riga, simbolo).
4. **Direzione della fix** — da `remediation_hint` (oracolo/convenzione, `04`); **non** un verdetto dell'LLM.

Vincoli:

- **Mai gonfiare la certezza**, mai "è sicuro"; lo stato resta quello del finding (un problema **rilevato**, non un'assoluzione).
- **Segreti mai in chiaro** nell'evidenza (`04` §7).
- **Proporzionato**: non spiegare a fondo un LOW advisory come un CRITICAL.
- **Framing onesto** *(L-COL-006)*: si spiega il problema e — quando esiste — la **correzione verificata**; mai un "sei al sicuro" globale.

## 5. Gestione conservativa dei falsi positivi — il ruolo *ristretto* dell'LLM

**La tensione.** I SAST (Semgrep) e il dead-code (knip: import dinamici, magia del framework — `03` §5.5) producono falsi positivi. L'LLM è il triatore naturale. Ma se può **liquidare** un finding, ridiventa giudice e la tesi oracle-first crolla. La policy esiste per dare all'LLM un ruolo **utile e ristretto** senza farne un giudice.

### 5.1 La policy *(`L-COL-028`)*

- L'LLM può **(a)** marcare un finding come **sospetto falso positivo** con **evidenza concreta** (un sito di import dinamico, una convenzione del framework, una fixture di test, un candidato per l'allowlist) e **(b)** abbassarne la **priorità di presentazione**. **Non** può rimuoverlo, marcarlo risolto, cambiarne la severità, né contarlo come gestito.
- Un sospetto-FP è **portato all'umano** con la motivazione; **solo l'umano** ne dispone (→ `accepted-risk`, oppure conferma-e-allowlist). L'LLM **non lo lascia mai cadere in silenzio**: il finding resta nel modello e nel report finché l'umano non agisce.
- **Bias di default: nel dubbio, si tiene.** Asimmetria: un falso "è un falso positivo" **è** il falso via libera che `L-COL-006` vieta (costo = una vulnerabilità spedita); un finding vero ma rumoroso costa solo tempo di revisione. Quindi conservativo.
- **Requisito di evidenza.** Un sospetto-FP deve puntare a evidenza **concreta e controllabile**, mai "secondo me va bene". Senza evidenza, non è un flag-FP: resta un finding normale.

### 5.2 Il percorso durevole = l'allowlist deterministica

Il pezzo elegante: un FP **confermato** non vive nella testa dell'LLM, vive nella **config che l'oracolo legge**.

- I FP confermati si codificano nell'**allowlist versionata**: `.gitleaks.toml` (`03` §5.2), ignore di knip (`03` §5.5), `# nosemgrep`/ignore di config — **non** silenziati nel contesto dell'LLM.
- L'LLM **propone** la voce di allowlist (con l'evidenza come commento di giustificazione); l'**umano approva**; la voce viene **committata**. Al run successivo è **l'oracolo stesso** a non emettere più quel finding: la soppressione è **dell'oracolo**, non dell'LLM. `L-COL-002` resta intatto **anche** sulla gestione dei FP.

### 5.3 Il dead-code è il caso più affilato *(già lock, `L-COL-021`)*

- I FP di knip (import dinamici, entry point del framework, file referenziati da config) sono comuni. L'LLM può segnalare "probabile entry point del framework — sospetto FP di knip", ma **le rimozioni non sono mai automatiche** *(L-COL-021)*: l'umano approva.
- Un elemento **segnalato-ma-non-rimosso** è **riportato come ancora presente** (un finding `dead-code` che l'umano ha scelto di non toccare / ha messo in allowlist), **mai** azzerato in silenzio.
- La fix durevole per un FP ricorrente di knip è la **config ignore/entry di knip** (proposta → approvata → committata): stesso pattern dell'allowlist.

### 5.4 Cosa NON è

Non è soppressione dell'LLM, non è re-scoring, non è un "punteggio di confidenza" che fa gate. Il checkpoint continua a fare gate su **severità dell'oracolo + soglie + baseline-delta** (`03` §7). Il flag-FP tocca **solo** l'ordine di presentazione e la coda di revisione umana, **mai** il cancello.

### 5.5 Lock dedicato — `L-COL-028`

Era **meccanismo** di `L-COL-002` (LLM non giudice), `L-COL-006` (niente falso via libera) e `L-COL-021` (rimozioni dead-code non automatiche); in **Chat E** è stata **promossa a lock dedicato `L-COL-028`** — è la scelta non ovvia che tiene l'LLM utile ma non-giudice sulla gestione dei FP (tensione centrale del progetto), e merita un ID stabile. La `SESSION-STATE` e il Decision Ledger (`00-INDEX` §4) la registrano come `L-COL-028`. *(L'annotazione speculare su `validate_blueprint` in `11` §5.3 è stata invece sciolta mantenendolo **meccanismo** di `L-COL-019`.)*

## 6. Dove sta nel pipeline

Tra la detection (`03` → `04`) e il loop (`05`):

```
oracoli → finding `detected`
        │
        ▼  TRIAGE/EXPLAIN (08): ordina · spiega · flagga sospetti-FP (con evidenza)
        │      scrive notes · NON tocca severity · NON dichiara verified
        ▼
   finding `triaged`  ──▶  loop di verifica della fix (05), in ordine di priorità
```

`08` scrive `notes` e muove a `triaged`; non altera `severity`, non emette verdetti, non promuove a `verified` (`04` §9, §5). Alimenta: `05` (ordine + flag-FP + proposte di allowlist) e il **report** (`04` §10) — dove la *coverage declaration* è il gemello, lato onestà, di queste spiegazioni: si popola il livello leggibile **senza** mai rivendicare sicurezza.

## 7. Cosa questo modulo NON copre

- **Non decide verdetti** (lo fa l'oracolo, `L-COL-002`); **non** fissa soglie (`03` §7); **non** applica fix (`05`); **non** genera baseline (`06`) né blueprint (`11`).
- La spiegazione è **prosa per l'umano**: non è un oracolo e non entra **mai** nella logica di `verified`/blocco.

## 8. Eredità ai moduli a valle

- **`09-PACKAGING-DISTRIBUTION`** — triage/spiegazione sono **guidati da prompt** (uno dei pochi step genuinamente LLM): vivono nelle invarianti del corpo `SKILL.md` + nella guida dei `references/modes/`, **non** in uno script-oracolo. Il packaging preserva la policy FP nei reference caricati; le config di allowlist viaggiano **col progetto**, non con la skill.
- **`10-EVALUATION`** — la policy FP è verificata sulla reference app: i **FP seminati** devono essere **portati-non-scartati** (e la voce di allowlist proposta dev'essere ben formata); i **veri positivi** seminati **non** devono mai essere liquidati come FP; l'ordine di priorità deve mettere i finding bloccanti sopra l'advisory.
