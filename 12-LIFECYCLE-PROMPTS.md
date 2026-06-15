# 12-LIFECYCLE-PROMPTS — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Versione** | v0.1 (Chat C) |
| **Data** | 13 giugno 2026 |
| **Copre** | `L-COL-022` (cardine); serve `015`, `016`, `009` |
| **Dipende da** | `01-ARCHITECTURE` v0.1, `02-SKILL-ANATOMY` v0.1 (§4, `assets/prompts/`), `11-BLUEPRINT-ENGINE` v0.1 (§4) |

---

## 1. Perché esistono — e cosa NON sono

I tre prompt sono il **fallback portabile tool-agnostico** del metodo blueprint-first. BOOTSTRAP li **emette parametrizzati sul blueprint** *(L-COL-022)*; non sono il **runtime** della skill.

La distinzione è il cuore del modulo:

- **Con la skill presente**, è la **BUILD mode** a *eseguire di fatto* ciò che i prompt descrivono — la disciplina è incorporata nel corpo `SKILL.md` e nei reference di modalità.
- **Senza la skill** — un tool che non carica lo standard SKILL.md, o un utente che vuole il loop manuale — i prompt permettono a una persona di far girare **a mano** la stessa disciplina, incollandoli all'agente. È il ponte di portabilità cross-tool *(L-COL-009)*.

Vivono in `assets/prompts/` (`02` §4): sono **artefatti di output** di BOOTSTRAP, **non** vengono eseguiti dalla skill come parte del proprio runtime *(L-COL-022)*.

> **Invariante del fallback.** Il percorso manuale **non** deve essere una disciplina più debole. Ogni prompt incorpora i non-negoziabili (§5), così le garanzie non si perdono quando si esce dalla skill.

## 2. I tre prompt

| Prompt | Quando | Cosa fa |
|---|---|---|
| `project-start.md` | una volta, all'avvio del progetto | orienta l'agente al blueprint, alle decisioni bloccate, al piano di macrotask e alle invarianti |
| `session-start.md` | a ogni apertura di sessione di lavoro | legge `SESSION-STATE`, sceglie il macrotask corrente, ne ripete task/criteri/test, prepara il branch |
| `session-end.md` | a ogni chiusura di sessione | verifica che il checkpoint sia girato, riassume gli esiti, aggiorna `SESSION-STATE`, registra lo stato git |

### 2.1 `project-start.md`

Apre il progetto a partire dal blueprint. Contenuto (parametrizzato §3):

- punta al blueprint (`00-INDEX` + moduli) come fonte del piano, e a `SESSION-STATE` come fonte di verità sullo stato vivo;
- enumera le **decisioni bloccate** rilevanti e il **piano di macrotask** con le dipendenze;
- stabilisce le **invarianti** di §5 come regole della casa per l'intero progetto;
- chiarisce l'ecosistema (v1: JS/TS su Supabase) e dove vivono baseline e budget.

### 2.2 `session-start.md`

Apre una sessione di lavoro:

- **leggi `SESSION-STATE`** (fonte di verità) prima di qualunque azione;
- **seleziona il macrotask corrente** rispettando le dipendenze del DAG;
- **ripeti** i task atomici del macrotask con i loro `definition_of_done` + `acceptance_criteria` + `target_tests` (`11` §3) — sono l'oracolo del controllo 4 in BUILD;
- **prepara il branch di lavoro** (`05` §8.1), mai lavorare su `main`;
- promemoria: al confine del macrotask **gira il checkpoint** (`01` §4) prima di committare.

### 2.3 `session-end.md`

Chiude una sessione di lavoro:

- conferma che il **checkpoint** è girato al confine del macrotask e ne riassume l'esito (verde/rosso per controllo, `fix_state` dei finding);
- **aggiorna `SESSION-STATE`** (macrotask fatti/in corso, baseline, budget consumato);
- **registra lo stato git**: branch, commit, stato del merge su `main`, e la nota di **deploy-coupling** (`05` §8.3);
- applica il **framing onesto**: "trovato e verificata la correzione di X" / "questi controlli sono passati", **mai** "è sicuro" *(L-COL-006)*.

## 3. Parametrizzazione

BOOTSTRAP riempie i template da `references/blueprint/template/` con gli **input dell'utente**, non con invenzioni dell'LLM (stessa regola di `01` §3.1 e `11` §4):

| Parametro | Fonte |
|---|---|
| nome progetto | input utente (BOOTSTRAP) |
| ecosistema | v1: JS/TS + Supabase |
| posizione del blueprint / di `SESSION-STATE` | layout generato da BOOTSTRAP |
| lista dei macrotask + dipendenze | il blueprint generato (`11`) |
| posizione di baseline e budget | `references/` / `.trueline/` (`03` §8, `05` §4) |

I prompt **rispecchiano** la disciplina della skill (stesso checkpoint, stesso modello git, stesse invarianti), così che percorso manuale e percorso-skill restino **coerenti**.

## 4. Rapporto con il runtime della skill

Esplicito, per non confondere i due piani *(L-COL-022)*:

- la skill **non** esegue questi prompt come step del proprio runtime; li **produce** e basta;
- ciò che i prompt descrivono a parole, in presenza della skill lo **fa** la BUILD mode tramite il corpo `SKILL.md` e i reference di modalità;
- il loro valore è **fuori** dalla skill: portabilità verso agenti che non caricano lo standard, e un loop manuale per chi lo preferisce.

## 5. Invarianti incorporate in ogni prompt

Il fallback porta con sé i non-negoziabili, così le garanzie reggono anche a mano:

- **Oracle-as-judge, mai LLM-as-judge** *(L-COL-002)*: nessun "è sicuro/ho sistemato" detto dall'agente.
- **Loop di verifica della fix obbligatorio** *(L-COL-003)*: applica → riesegui lo stesso oracolo → riesegui i test → accetta solo se sparito e nulla rotto.
- **Human-in-the-loop sulle fix; dead-code mai cancellato in autonomia** *(L-COL-005, L-COL-021)*.
- **Git a strati**: branch autonomo, merge su `main` gated dal verde, distruttive mai autonome, **deploy non supervisionato bloccato** *(L-COL-024, L-COL-025)*.
- **Nessun falso "via libera"; copertura sempre dichiarata** *(L-COL-006)*.

## 6. Eredità ai moduli a valle

- **`09-PACKAGING-DISTRIBUTION`** — i tre template viaggiano in `assets/prompts/` dentro il `.skill`; la conversione cross-tool deve preservarli come artefatti emettibili.
- **`10-EVALUATION`** — sul **gate di build** (VISION §10, punti 5–7), lo step BOOTSTRAP emette questi prompt: l'eval verifica che siano ben formati e parametrizzati sul blueprint seminato.
