# 11-BLUEPRINT-ENGINE — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Versione** | v0.1 (Chat A) |
| **Data** | 13 giugno 2026 |
| **Copre** | `L-COL-019` (cardine), `015`, `016`, `018`, `022` |
| **Dipende da** | `01-ARCHITECTURE` v0.1, `02-SKILL-ANATOMY` v0.1 |

---

## 1. Perché questo modulo esiste

È l'aggancio fra le due metà della skill. La verifica oracle-first sa misurare sicurezza, segreti, RLS, dead-code e regressioni — fatti deterministici. **Non** sa misurare la conformità del codice all'*intento*, perché l'intento non è un fatto nel codice. L'unico modo per renderlo misurabile è scriverlo prima, in modo atomico e con criteri testabili: a quel punto la conformità-logica del checkpoint (`01` §4, controllo 4) ha un oracolo — i **test di accettazione del task** — invece di ricadere nell'LLM-che-giudica-sé-stesso.

Da qui il cardine: **ogni task atomico DEVE portare definition-of-done + criteri di accettazione + test target** *(L-COL-019)*. Un blueprint con anche un solo task privo di questi tre campi non è valido e BUILD non lo consuma.

La qualità *semantica* del blueprint a sua volta non è oracolabile (un criterio può essere ben formato ma stupido). Si rende affidabile con **template + checklist di self-check**, non con vibes — e la parte di self-check che *può* essere deterministica viene spinta su uno script (§5).

## 2. Gerarchia: progetto → macrotask → task atomico

- **Progetto** — l'intero blueprint generato da BOOTSTRAP.
- **Macrotask** — unità al cui **confine gira il checkpoint** *(L-COL-018)*. Raggruppa task atomici coerenti (es. "autenticazione", "endpoint prenotazioni"). È l'unità di commit atomico su git *(L-COL-024)*.
- **Task atomico** — la più piccola unità di lavoro; porta sempre i tre campi obbligatori. Più task atomici verdi compongono un macrotask verde.

Regola di taglio: un task atomico è "atomico" se è costruibile e verificabile entro un ciclo, e se i suoi criteri sono esprimibili come poche asserzioni testabili. Se non lo è, va spezzato.

## 3. Schema del task atomico *(L-COL-019)*

Identificatori in inglese, prosa in italiano (convenzione di progetto). Formato di riferimento (YAML; il template completo sta in `references/blueprint/template/`):

```yaml
- id: T-014                         # ID stabile, non riusato
  title: "Endpoint creazione prenotazione con RLS"
  macrotask: "prenotazioni"
  depends_on: [T-009, T-011]        # DAG esplicito, niente cicli

  objective: >                      # COSA deve ottenere (prosa)
    Esporre un endpoint che crea una prenotazione per l'utente autenticato,
    isolata per tenant via RLS.

  definition_of_done:               # IL LAVORO è completo quando…  (osservabile)
    - "Endpoint POST /bookings implementato"
    - "Migration con policy RLS su table bookings applicata"
    - "Input validato lato server (no fiducia nel client)"

  acceptance_criteria:              # COME si prova che fa la cosa giusta (testabile)
    - id: AC-014-1
      given: "utente autenticato del tenant A"
      when: "crea una prenotazione"
      then: "la riga è scritta con tenant_id = A"
    - id: AC-014-2
      given: "utente del tenant A"
      when: "tenta di leggere prenotazioni del tenant B"
      then: "riceve insieme vuoto (RLS blocca)"
    - id: AC-014-3
      given: "payload senza campo obbligatorio"
      when: "chiama l'endpoint"
      then: "riceve 400, nessuna scrittura"

  target_tests:                     # i criteri resi eseguibili — l'oracolo del controllo 4
    - file: "tests/bookings.create.test.ts"
      covers: [AC-014-1, AC-014-2, AC-014-3]

  security_notes:                   # opzionale: aggancio al threat model (07)
    - "RLS isolation per tenant — categoria killer Supabase"
    - "Nessun segreto nel codice dell'endpoint"

  out_of_scope:                     # opzionale: argine allo scope creep
    - "Cancellazione prenotazione (T-016)"
```

**DoD vs acceptance_criteria** — distinzione deliberata, non ridondanza:
- *definition_of_done* = "il lavoro c'è" (artefatti prodotti, osservabili).
- *acceptance_criteria* = "e fa la cosa giusta" (asserzioni comportamentali). **Sono questi** che il controllo conformità-logica usa come oracolo.

**target_tests** è il ponte da criterio a eseguibile: ogni `acceptance_criteria` deve essere coperto da almeno un test nominato. In BUILD, "verde sul controllo 4" significa: questi test passano.

**Contratto di altitudine (A2b, opzionale)** — oltre ai task, il blueprint può dichiarare in `00-INDEX.md` un blocco **globale** `architecture: { layers, forbidden, allow }` (gli strati sono una proprietà del progetto, non del singolo task). Schema e regole nel [`references/blueprint/atomic-task-schema.md`](references/blueprint/atomic-task-schema.md) (§ "Contratto di altitudine"). Se presente, `validate_blueprint` ne valida la forma (controllo condizionale, §5.1); in BUILD `arch_check` verifica le regole `forbidden` contro il grafo import reale come gate assoluto.

## 4. Template del blueprint (output di BOOTSTRAP)

BOOTSTRAP genera il blueprint **nel formato-utente** già in uso negli altri progetti, così da essere familiare e portabile:

- `00-INDEX.md` — mappa, piano di build, **decision ledger** (`L-…`/`O-…`), manifest.
- `VISION-AND-CONSTRAINTS.md` — perché, per chi, non-goals, vincoli, parity gate.
- `SESSION-STATE.md` — fonte di verità sullo stato vivo del progetto-utente.
- moduli numerati `01-…`, `02-…` — scomposti in macrotask, ciascuno con i suoi task atomici secondo lo schema §3.

I template parametrici vivono in `references/blueprint/template/`. La parametrizzazione prende: nome progetto, ecosistema (v1: JS/TS + Supabase), obiettivo, vincoli — input dell'utente, non invenzione.

> Nota sulle due `SESSION-STATE`. Quella generata qui è la **fonte di verità del progetto-utente** (consumata poi da BUILD). È un'istanza diversa dalla `SESSION-STATE` del *blueprint di Trueline stesso*. Stesso pattern, istanze distinte — da non confondere.

## 5. Self-check sul blueprint generato

La skill non procede a BUILD con un blueprint che non passa il self-check (specularmente al loop di verifica della fix, ma applicato al *piano*). Il self-check è in due parti.

### 5.1 Parte strutturale — deterministica (script)

`scripts/blueprint/validate_blueprint.*` è un **oracolo del piano**: controlli meccanici, esito binario, fuori dal contesto. Verifica almeno:

1. **Campi obbligatori** — ogni task atomico ha `objective`, `definition_of_done`, `acceptance_criteria`, `target_tests` non vuoti. *(enforcement diretto di `L-COL-019`)*
2. **Linkage** — ogni `acceptance_criteria` è coperto da ≥1 `target_tests`; nessun criterio orfano.
3. **DAG** — `depends_on` non contiene cicli; nessun riferimento a `id` inesistente.
4. **ID** — unici, non riusati.
5. **Appartenenza** — ogni task atomico dichiara un `macrotask` esistente.
6. **Contratto di altitudine** *(condizionale, A2b)* — SOLO se il blueprint dichiara un blocco `architecture:`: strati con selettore glob non vuoto, ≥1 regola `forbidden` verso strati dichiarati, `mode` noto (`ARCH_CONTRACT_WELL_FORMED`). Assente il blocco, il controllo **non viene emesso** (nessun falso rosso). Il blocco è documentato in [`references/blueprint/atomic-task-schema.md`](references/blueprint/atomic-task-schema.md).

Coerente con la filosofia del progetto: tutto ciò che *può* essere deterministico lo è. La parte semantica, che non può esserlo, resta guidata dall'LLM ma vincolata da checklist (sotto).

### 5.2 Parte semantica — checklist guidata (LLM, vincolato)

`references/blueprint/self-check-checklist.md`. L'LLM passa il blueprint contro:

6. **Misurabilità** — ogni criterio è osservabile/testabile; "funziona bene", "robusto", "sicuro" da soli **falliscono**. Un criterio deve dire *cosa* si osserva.
7. **Atomicità** — nessun mega-task; ogni task è costruibile+verificabile in un ciclo.
8. **Copertura** — i macrotask insieme coprono l'obiettivo; nessun salto "e poi succede la magia".
9. **Baseline di sicurezza** — ogni task che tocca dati/auth nomina la considerazione RLS/segreti pertinente (aggancio al threat model `07`); per l'ecosistema v1 questo è il punto a più alto rischio.
10. **Niente task fantasma** — nessuna unità senza criteri (ridondante con lo strutturale, ma tenuta come rete semantica).

### 5.3 Esito

- **Strutturale rosso** → blueprint **rifiutato**; la skill lo corregge e ri-valida. Non si avanza.
- **Semantico con rilievi** → la skill propone le revisioni all'utente (human-in-the-loop, `L-COL-005`); il blueprint si chiude solo dopo.

> **Risolto (Chat E).** `validate_blueprint.*` **resta meccanismo** di `L-COL-019` — nessun lock dedicato; l'annotazione di promozione è stata sciolta (`00-INDEX` §4, nota di riconciliazione Chat E; §5, annotazioni sciolte).

## 6. Come questo alimenta il checkpoint

L'output di questo modulo è ciò che rende verificabile la metà "build" della skill:

- BUILD seleziona un macrotask → costruisce i suoi task atomici → al confine, il **controllo conformità-logica** (`01` §4) esegue i `target_tests` dei task come oracolo. Verde = criteri soddisfatti = *conformità alla specifica* (promessa forte, VISION §6).
- In REMEDIATE non c'è blueprint d'origine: il controllo conformità-logica non ha criteri d'intento e **degrada a invarianza** via characterization test (`06`). È l'asimmetria onesta, qui spiegata dal lato del perché: senza questo modulo a monte, non c'è specifica contro cui misurare.

## 7. Eredità ai moduli a valle

- **`06-CHARACTERIZATION-TESTS`** è il gemello brownfield di questo modulo: dove qui i criteri *precedono* il codice, lì la baseline *cattura* il comportamento di codice già scritto.
- **`12-LIFECYCLE-PROMPTS`** definisce i 3 prompt che BOOTSTRAP emette a valle del blueprint *(L-COL-022)*.
- **`10-EVALUATION`** include il **blueprint seminato** per il gate di build (VISION §10, punti 5–7): un blueprint di prova i cui task devono passare `validate_blueprint.*` e il self-check.
