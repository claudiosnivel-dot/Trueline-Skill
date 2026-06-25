# Trueline â€” Competitive Intelligence Report

## 1. TL;DR

- **Il "verified-fix loop" non e piu un differenziatore tecnico: e commodity nel 2026.** Snyk Agent Fix re-esegue lo stesso scanner SAST per validare ogni candidate fix [1][2], e AquilaX/Mobb/Pixee chiudono loop analoghi. Tre dei sette claim di unicita sono stati REFUTATI 3/3.
- **La difendibilita reale e l'INTERSEZIONE di quattro vincoli** (oracolo deterministico-only + locale-puro-gratis + epicentro Supabase RLS + disciplina blueprint-first), non una singola feature. Presi singolarmente sono tutti copiati o copiabili; insieme nessuno li tiene.
- **Snyk e la minaccia numero uno.** Ha gia il loop deterministico re-scan-a-zero [1][2] E lo ha impacchettato come Agent Skill cross-tool ufficiale (`snyk/studio-recipes`, Apache-2.0, v1.1.0) che lancia anche la test suite [3] â€” la forma stessa di Trueline esiste gia, spedita da un vendor con 35.000+ fix curati [4].
- **L'epicentro Supabase RLS e quasi vuoto.** Tra 24 profili, l'UNICO con capacita RLS reale e Aikido, ma e DAST dinamico detection-only (estrae l'anon key, tenta read/write) [5], complementare e non sostitutivo del checker statico + verified-fix di Trueline. Finestra aperta ma probabilmente breve.
- **"Code-never-leaves" non e piu raro come PROPRIETA** (CybeDefend air-gapped, Snyk Code Local Engine, Semgrep locale [6][7]); resta vero che negli altri e gated/paid/Enterprise mentre in Trueline e default-gratis-senza-account.
- **Due asset per-accumulo, non-tecnici, sono il vero fossato:** la curatela RLS/AI-mistakes (analoga ai 35.000 fix di Snyk [4]) e la disciplina blueprint-first con onesta epistemica. Inimitabili per i commerciali senza autosabotare la narrativa di vendita.
- **I due gap di prodotto piu urgenti â€” triage del rumore e grounding delle patch â€” sono assorbibili in v1 senza violare la tesi oracle-as-judge.** Quasi ogni competitor serio ha costruito il proprio fossato sulla riduzione falsi positivi (Endor ~95%, Pixee fino a 98%, ZeroPath 75% [8][9][10]).
- **Lo svantaggio distributivo e autoinflitto e rimovibile:** install manuale da GitHub vs onboarding "3-click"/"<5 min" dei concorrenti. Pubblicare la skill via marketplace (`skills add`, gia usato da Pixee e Apiiro [11][12]) chiude il gap senza toccare il modello local-only.
- **Lo scenario di lungo periodo piu insidioso e la convergenza degli spec-driven framework** (Kiro/Spec Kit/BMAD) verso hook deterministici in-loop â€” attaccherebbe l'unico claim 0/3 che oggi regge. Modello gia dimostrato da SonarQube plugin per Claude Code e Semgrep Guardian [13][14].
- **Rischio di categoria, non solo di feature:** Amazon Q in wind-down verso Kiro [15] mostra che persino i giganti consolidano in questo spazio. Una skill non finanziata e strutturalmente fragile a una mossa di un incumbent â€” la difesa e correre su RLS+blueprint mentre il loop e ancora vantaggio percepito.

---

## 2. Mappa competitiva

Note: "oracle-as-judge" = il verdetto e emesso da uno scanner deterministico non-LLM; "LLM-as-judge" = il modello/agente valida il proprio lavoro. "verifica-fix" = esiste un gate re-scan-a-zero + test sul fix. "Dato unknown" segnalato esplicitamente dove i profili non lo riportano.

### Arena A â€” Security & Fix AI-code

| Competitor | Form factor | Oracle vs LLM judge | Verifica-fix | Overlap |
|---|---|---|---|---|
| **Snyk Agent Fix** [1][2] | SaaS + IDE + PR bot + CLI; skill cross-tool `snyk-fix` [3] | hybrid (security = oracolo deterministico Snyk Code; logica funzionale = LLM-evaluator) | parziale (re-scan-a-zero SI; test-suite utente NO in IDE [16], SI nella skill `snyk-fix` [3]) | diretto |
| **GitHub Copilot Autofix** [17] | SaaS GitHub-only; PR inline | no (detection CodeQL deterministica; fix LLM, verdetto demandato all'umano) | parziale (re-scan CodeQL sul PR e advisory, non gate; nessun test auto) | diretto |
| **Semgrep (Autofix/Assistant/Guardian)** [14][18] | CLI OSS locale + SaaS + MCP + Guardian plugin cross-tool | hybrid (detection = engine deterministico; triage/fix = LLM) | parziale (Guardian: regenerate-until-clean re-scan-a-zero [14]; nessun gate test; Autofix PR senza re-scan) | diretto |
| **Checkmarx One Assist** [19][20] | SaaS + IDE (VS Code/JetBrains/Cursor/Windsurf/Kiro) + MCP | hybrid (agente "valida il proprio lavoro" + re-scan SAST AI-augmented Checkmarx) | parziale (re-scan-a-zero su Accept SI; test-suite utente non documentata) | diretto |
| **Veracode Fix** [21] | SaaS cloud + IDE + CLI + GitHub Action | no (fix = ML/RAG proprietario; chiusura = re-scan manuale) | parziale (build-verification automatica; re-scan finding MANUALE) | diretto |
| **Endor Labs (AI SAST)** [22][23] | SaaS + CLI + MCP locale + GitHub App; on-prem Outpost | hybrid (Code API deterministico + Opengrep; triage/remediation = agenti LLM) | parziale (re-verify solo advisory; nessun test) | adiacente |
| **Aikido (AutoFix)** [5][24] | SaaS cloud + Git apps + IDE + web UI | hybrid (detection OSS forkati deterministici; triage LLM + confidence score) | parziale (re-scan del file editato; nessun test-suite; confidence H/M/L) | diretto |
| **Qwiet/Harness SAST** [25] | SaaS cloud (CPG) + IDE + PR | yes (validator = agenti LLM "Catherine/Nova") | no (re-analyze MANUALE per docs) | adiacente |
| **Mobb (+ Bugsy OSS)** [26][27] | SaaS + IDE + MCP; Bugsy CLI MIT | hybrid (template deterministici curati + GenAI) | parziale (re-scan = standard offline di curatela, non gate per-fix; nessun test) | diretto/adiacente |
| **Pixee (Pixeebot)** [28][29] | SaaS + GitHub App + pixee-cli skills (Apache-2.0) [11] | hybrid (codemod AST deterministici + "MagicMods" LLM; Fix Evaluation Agent = LLM) | parziale (test-suite + build + regression gate SI; re-scan-a-zero dello scanner originale NON documentato) | adiacente |
| **ZeroPath** [9][30] | SaaS + CLI + MCP + plugin Claude Code MIT | yes ("win function implemented by an LLM" [31]) | parziale (re-scan engine proprio LLM-native + unit-test generato; non la suite esistente) | diretto/adiacente |
| **Amplify Security** [32] | SaaS + GitHub App/Action + GitLab + Console CLI alpha | yes (agente valida, confidence scoring) | parziale (validazione agent-side LLM; gate deterministico non documentato) | adiacente |
| **Apiiro AutoFix (+ CLI skills)** [12][33] | SaaS ASPM + IDE MCP + CLI agent skills | hybrid (detection scanner + validazione = contesto ASPM/policy + agente) | parziale (diff-scan CI/CD; re-run-a-zero + test non documentati) | diretto |
| **Amazon Q Developer** [34] | SaaS cloud (Bedrock) + IDE + CLI; **in wind-down verso Kiro** [15] | hybrid (detection detectors; fix LLM) | no (re-scan MANUALE; nessun test) | diretto |
| **SonarQube AI CodeFix** [13][35] | SaaS + Server self-host + IDE + plugin Claude Code | hybrid (detection = analyzer deterministico non-LLM; fix = LLM, Apply/Decline umano) | parziale (re-scan possibile ma non obbligatorio; plugin Claude Code: hook PostToolUse re-scan, solo analisi, nessun test [13]) | diretto |
| **GitLab Duo (Agentic SAST)** [36][37] | Piattaforma-nativa GitLab (SaaS/Self-Managed/Dedicated) | hybrid (detection Advanced SAST Semgrep-based; patch + confidence = LLM) | parziale (CI pipeline auto-validate; nessun gate finding-a-zero; chiusura = umano) | adiacente |
| **Safeguard (Griffin AI)** [38] | SaaS enterprise + CLI + MCP + GitHub; cloud/on-prem/air-gapped | hybrid (reachability deterministica pre-fix; fix = Griffin AI, "test evidence" AI-generata) | parziale (test-suite cliente + CI/policy + canary/rollback; re-scan-a-zero stesso scanner NON documentato) | adiacente |
| **DryRun Security** [39][40] | SaaS GitHub/GitLab app + MCP + Remediation Skill | yes (COVER model: verifica = ragionamento AI, suppression) | parziale (re-poll AI dopo ogni commit; nessun re-scan deterministico, nessun test) | adiacente |
| **Gecko Security** [41][42] | SaaS + GitHub PR bot + CI/CD; Enterprise on-prem | hybrid (detection: PoC exploit dinamico; fix: refine multi-agente LLM) | parziale (detection verificata via exploit PoC; fix = refine LLM, nessun re-scan-a-zero + test) | diretto |
| **Almanax (ALMX-1)** [43][44] | SaaS + GitHub/CI/CD; deploy own-infra opzionale | yes (modelli ALMX + LLM decidono vuln e validita fix) | parziale/unknown (copy dice "generates and validates fixes" [45], meccanismo non disclosed) | adiacente |

### Arena B â€” Spec-driven AI-dev

| Competitor | Form factor | Oracle vs LLM judge | Verifica-fix | Overlap |
|---|---|---|---|---|
| **AWS Kiro, GitHub Spec Kit, BMAD-Method, Tessl** | Framework/IDE spec-driven (impongono spec/piani a monte) | LLM e/o test generici come autorita del "done", NON oracoli di sicurezza deterministici [claim STANDS 0/3] | n/a (non hanno gate oracolo-di-sicurezza al confine del macrotask) | adiacente (rischio di convergenza) |

Nota: i profili strutturati forniti NON includono schede dedicate per Kiro/Spec Kit/BMAD/Tessl con campo `sources`. Questi nomi compaiono solo nel claim-check (claim STANDS 0/3) e nella lente differenziazione; pertanto non sono citabili con URL specifici e i loro dettagli di prodotto restano **unknown** oltre quanto affermato nel claim verificato.

### Arena C â€” Agent-Skill ecosystem (SKILL.md cross-tool)

| Competitor | Form factor | Oracle vs LLM judge | Verifica-fix | Overlap |
|---|---|---|---|---|
| **Snyk `snyk-fix` skill** [3] | SKILL.md ufficiale + comando Cursor (`snyk/studio-recipes`, Apache-2.0, v1.1.0) | oracolo (re-scan Snyk = giudice) | SI â€” re-scan-a-zero + test-suite (npm test/pytest) + lint; revert di TUTTO se non pulito [3] | diretto |
| **StackHawk agent-skills** [3] | SKILL.md cross-tool (Claude Code, Cursor, Codex, OpenCode, Copilot, Antigravity) | oracolo DAST HawkScan ("done means done and secure") | SI â€” re-scan DAST a zero ("repeat until exit 0") [3] | diretto |
| **Pixee pixee-cli skills** [11] | `npx skills add pixee/pixee-cli` (Apache-2.0), thin-client verso cloud | hybrid (vedi Arena A) | parziale (vedi Arena A) | adiacente |
| **Apiiro CLI agent skills** [12] | `npx skills add apiiro/cli-releases`, richiede login/cloud | hybrid | parziale | adiacente |
| **DryRun / ZeroPath / Endor skills** [40][30][23] | skill/plugin per Claude Code/Cursor/Codex, thin-client verso SaaS | yes / yes / hybrid | parziale | adiacente |
| **Semgrep Guardian** [14] | plugin (MCP + hook + Skills) per Claude Code/Cursor/Windsurf/Copilot/Kiro | hybrid (re-scan deterministico; triage LLM) | parziale (regenerate-until-clean; nessun test) | diretto |

### Arena D â€” Supabase-RLS

| Competitor | Form factor | Oracle vs LLM judge | Verifica-fix | Overlap |
|---|---|---|---|---|
| **Aikido (Supabase RLS check)** [5] | DAST live-probe SaaS (estrae anon key, enumera tabelle public-schema, tenta read/write, classifica PII) | n/a (detection dinamica empirica) | NO â€” detection-only, nessun RLS autofix [5] | adiacente/complementare |
| **Tutti gli altri (~19 profili)** | â€” | â€” | â€” | nessuna capacita RLS ("None/None found" esplicito nei profili) |

Nota: il profilo Supabase Security Advisor / database linter non e fornito come scheda JSON con `sources`; compare solo nel claim-check [STANDS 1/3]: rileva tabelle RLS-disabled e problemi di policy ma NON propone-e-verifica fix e non gira come gate per-commit in un agente. Senza URL nei profili, resta **non citabile** qui.

---

## 3. Dove Trueline vince e dove e esposto

### Dove vince (regge all'attacco)

**Unico a livello di intersezione.** I due claim mai refutati (0/3) sono entrambi composti:
- Blueprint atomico (DoD + acceptance + target test) + un macrotask alla volta + gate oracolo non-LLM al confine [claim STANDS 0/3]. Nessun framework spec-driven mainstream lo combina; i ~20 security vendor sono tutti remediation/detection, zero hanno modalita BOOTSTRAP/BUILD greenfield.
- Nessuna security skill SKILL.md/Cursor-rules/Codex offre un loop verificato specifico per secrets+RLS+dead-code su Supabase JS/TS [claim STANDS 0/3].

**Oracolo-come-giudice categorico.** La maggioranza dei concorrenti e `hybrid` (Snyk [1], Semgrep [18], Checkmarx [19], Endor [22], Aikido [5], Mobb [26], Pixee [28], Apiiro [33], GitLab Duo [36], Amazon Q [34], SonarQube [35]) e diversi apertamente `yes` (Qwiet/Harness [25], Amplify [32], DryRun [39], ZeroPath [30], Gecko [41], Almanax [43]). Anche chi rispetta il verdetto deterministico sul lato sicurezza usa un LLM-evaluator per la correttezza funzionale (Snyk [16]) o demanda all'umano (Copilot Autofix [17]). Trueline e l'unico per cui la regola e categorica su OGNI verdetto.

**Epicentro Supabase RLS.** Nessuno dei profili ha un RLS-policy checker statico. L'unico con qualcosa di RLS-specifico e Aikido, ma e DAST dinamico detection-only [5] â€” meccanismo ortogonale e complementare, non un fix verificato statico su policy/migration.

### Dove e esposto â€” i claim REFUTATI e i controesempi

**REFUTATO 3/3 â€” "Nessuno fa gate del fix re-eseguendo lo stesso oracolo a zero + test suite, rifiutando il verdetto dell'LLM".**
> Controesempio: **Snyk Agent Fix** ri-esegue lo STESSO scanner (Snyk Code SAST) per ogni candidate fix, iterando "until the finding is suppressed without introducing new findings"; lo scanner deterministico e la fonte di verita: *"If any fix recommendation doesn't pass any of our SAST tests, we won't show it to you"* [1][2].
> **Sfumatura che salva (parzialmente) Trueline:** Snyk Agent Fix in IDE NON esegue la test suite dell'utente â€” lo dice esplicitamente al developer di testare a mano [16]. Quindi il claim va riscritto chirurgicamente: "nessuno fa re-scan-a-zero AND test-suite-utente-verde come gate combinato obbligatorio sul repo dell'utente" regge contro Snyk-in-IDE ma NON contro la skill `snyk-fix` che lancia npm test/pytest [3], ne contro AquilaX (citata nel claim-check, ma senza profilo/URL fornito).

**REFUTATO 3/3 â€” "Nessuna Agent Skill cross-tool impacchetta il loop come gate obbligatorio".**
> Controesempio letale: la **Snyk `snyk-fix` agent skill** (`snyk/studio-recipes`, Apache-2.0, v1.1.0) â€” SKILL.md vera + comando Cursor (cross-tool), con fase Validation che ri-esegue lo stesso scan Snyk E lancia la test suite + lint; se non produce un fix pulito fa revert di TUTTO [3]. Piu **StackHawk agent-skills** (Claude Code, Cursor, Codex, OpenCode, Copilot, Antigravity) che ri-scannano l'oracolo DAST HawkScan a zero ("done means done and secure", "repeat until exit 0") [3]. La forma stessa di Trueline esiste gia, spedita da un vendor con 35.000+ fix curati [4].

**REFUTATO 3/3 â€” "Code-never-leaves e un differenziatore genuino vs i grandi fixer".**
> Controesempi: **CybeDefend Cybe AutoFix** (air-gapped, "Your code never leaves your infrastructure", regression test incluso) [6]; **Snyk Code Local Engine** (no-upload, on-prem) [16]; **Semgrep** ("analyzes code locally... by default, code is never uploaded") [7]. Quel che resta vero: negli altri e gated/paid/Enterprise, in Trueline e default-gratis-senza-account.

**REGGE 1/3 â€” Supabase Security Advisor** rileva ma non propone-e-verifica fix e non gira come gate per-commit in un agente [claim STANDS 1/3]. (Nessun URL nei profili: dato di prodotto oltre questo **unknown**.)

---

## 4. Gap di feature da colmare (ordinati per impatto)

**GAP 1 â€” Reachability/exploitability triage (filtro falsi positivi).** Chi lo fa: Endor (~95% FP elimination [22]), Pixee (fino a 98% [28]), ZeroPath (75% [30]), Aikido (~95% noise reduction [24]), Semgrep Assistant (>95% accuratezza FP-categorization [18]), Checkmarx "Attackability" [19], Apiiro [33], Safeguard (~80% meno FP [38]). Colpisce OGNI run. **â†’ ASSORBIRE in v1**, in forma deterministico-o-trasparente (prioritizzazione/soppressione pattern noti-sicuri; su RLS distinguere "tabella esposta con PII" da "tabella interna"). LLM confinato a spiegazione/prioritizzazione, mai al verdetto.

**GAP 2 â€” Substrato di grounding per le patch.** Chi lo fa: Snyk (35.000+ fix + CodeReduce, ~80-85% accuracy [4][1]), Veracode (RAG, 70-80% accept [21]), Pixee/Mobb (120+/100+ codemod AST deterministici [28][26]), Endor (Code API context [22]). **â†’ ASSORBIRE in v1, scope ristretto:** 20-30 pattern/template di remediation deterministici per secrets/RLS/dead-code (template policy RLS corrette per i pattern comuni Supabase). Il template e deterministico, l'oracolo continua a giudicare.

**GAP 4 â€” Metriche di outcome pubblicate.** Chi lo fa: Pixee/Amplify 76% merge rate [28][32], Snyk ~80-85% [1], GitHub ">2/3" e ~7x [17], Aikido ~85% [24], Mobb ~99% MTTR [26]. Trueline e pre-release, zero dati. **â†’ ASSORBIRE in v1 come strumentazione interna** (finding-driven-to-zero rate, test-still-green rate), pubblicare appena disponibili. Coerente con l'anti-overclaim: si misura cio che l'oracolo dichiara.

**GAP 5 â€” Validazione "no regressioni" oltre la sola test-suite.** Chi lo fa: Pixee/Veracode (build-verification automatica scarta patch non-compilanti [28][21]), Aikido/ZeroPath (unit-test generato col fix [24][30]). **â†’ ASSORBIRE in v1 in forma minima:** build/compile check come pre-gate deterministico prima del test-run; characterization-test baseline esplicito quando la copertura e bassa.

**GAP 8 â€” Distribuzione a basso attrito (marketplace).** Chi lo fa: GitHub Autofix default-on [17], plugin installabili via `npx skills add` per Pixee [11], Apiiro [12], ZeroPath [30], DryRun [40]. Trueline si installa manualmente da GitHub. **â†’ ASSORBIRE in v1 se a basso costo:** pubblicare via `skills add`/marketplace. Non viola alcun vincolo (resta OSS, locale, no SaaS). Sembra limitazione accidentale piu che scelta.

**GAP 3 â€” Supply-chain/dependency remediation (osv-scanner gia presente).** Chi lo fa: Safeguard (postinstall via trustedDependencies, 100 livelli [38]), Endor (minimum-safe-version PR [22]), Semgrep Supply Chain [18], Snyk/Aikido. osv-scanner e gia nello stack e il verdetto e binario. **â†’ RIMANDARE a v2 (primo candidato all'espansione del loop).**

**GAP 9 â€” Conferma dinamica/exploit-based dei finding (RLS live-probe).** Chi lo fa: Aikido (probe DAST live su Supabase, classifica PII [5]) â€” l'unico che tocca l'epicentro RLS, con approccio complementare; Gecko/ZeroPath (PoC exploit [41][9]). **â†’ RIMANDARE a v2 (estensione piu strategica dell'epicentro):** un probe dinamico opt-in trasformerebbe il verdetto RLS da "policy sembra sbagliata" a "esposizione confermata".

**GAP 6 â€” Ampiezza del loop oltre i 3 casi (altre classi OWASP).** Chi lo fa: tutti i SAST (Snyk, Checkmarx, Veracode, Mobb, Pixee). **â†’ RIMANDARE a v2 con trade-off esplicito:** espandere il loop a classi dove l'oracolo SAST e piu rumoroso rischia di erodere la garanzia "fixed=zero". Detection-only sul resto e onesto in v1.

**GAP 7 â€” Esecuzione real-time per-file (post-tool hook).** Chi lo fa: Semgrep Guardian (hook PostToolUse, regenerate-until-clean [14]), SonarQube plugin per Claude Code [13], Checkmarx Developer Assist [19]. **â†’ RIMANDARE a v2 (valutare):** in tensione col modello a checkpoint; non deve scavalcare il gate del macrotask.

**GAP 10 â€” BYO-LLM / on-prem LLM. â†’ IGNORARE.** Trueline gira gia dentro l'agente dell'utente; il modello e quello dell'host. Il gap non esiste in pratica.

**GAP 11 â€” Dashboard org-wide, governance, RBAC, compliance. â†’ IGNORARE in v1.** Appartiene a un eventuale SaaS futuro; costruirlo ora contraddirrebbe il posizionamento locale-OSS.

**GAP 12 â€” Auto-merge / autonomia end-to-end. â†’ IGNORARE (anti-requisito).** Chi lo fa: GitLab Duo [36], Safeguard (auto-merged PR [38]), Snyk Agent Fix (commit diretto in PR [16]). E esattamente cio che Trueline rifiuta per design (human-in-the-loop). Da difendere come confine deliberato nel messaging.

**Pattern dominante:** i competitor battono Trueline soprattutto su triage del rumore (Gap 1) e grounding delle patch (Gap 2), entrambi assorbibili senza violare la tesi oracle-as-judge.

---

## 5. Mercato & GTM

**Pricing â€” Trueline e un outlier strutturale.** Il mercato si distribuisce su tre fasce:
- *Self-serve/per-developer:* Snyk freeâ†’~$25/dev/meseâ†’~$1.260/dev/anno [46]; Semgrep CE gratis, poi $35/contributor/mese [47]; Aikido freeâ†’~$300/~$600/mese flat-rate unlimited-users [48]; Mobb $0 su repo pubbliciâ†’$40/dev/mese [49]; Checkmarx Developer Assist $25/mese [50]; Amplify free â‰¤10 devâ†’$20/utente/mese [32]; Amazon Q freeâ†’Pro $19/mese (ma in wind-down [15]); SonarQube LOC-based, Team da ~$32/mese [51].
- *Outcome-based/"paghi il problema risolto":* Pixee "pay per vulnerability resolved, not per seat" [52]; Apiiro $23.400/anno, MOQ 50 seat [33]; Safeguard inference-budget-driven, no listino [38].
- *Enterprise opaca:* Veracode ~$15k-$100k+/anno [53]; Checkmarx One ~$59k-$70k/anno [54]; ZeroPath floor $1.000/mese + $60/dev [30]; GitLab Duo Ultimate ~$99/dev/mese + Duo Enterprise ~$39/dev/mese [37].

Pattern ricorrenti: freemium-su-OSS-pubblico quasi universale; gate monetario = repo privato; spostamento da per-seat a outcome/consumption-based (Pixee, Safeguard, Apiiro, GitHub metered da aprile 2025 [17]). L'analogo piu vicino di Trueline sono Semgrep CE, Bugsy (Mobb OSS, MIT [27]) e Codemodder di Pixee (AGPL [29]) â€” ma in tutti l'OSS e esca per il SaaS. Trueline e l'unico in cui il prodotto completo e gratuito e locale: simultaneamente arma di adozione (zero attrito/procurement/data-egress) e problema di monetizzazione (nessun punto di cattura del valore ancora).

**Distribuzione.** Il form-factor "agent skill cross-tool" si e gia affollato in 6-12 mesi: Pixee [11], Apiiro [12], DryRun [40], Semgrep Guardian [14], ZeroPath [30] â€” MA ognuno e un thin-client che si autentica al cloud del vendor. Nessuno e "code-never-leaves, runs-entirely-local, no-telemetry, no-account". Implicazioni:
- L'install manuale da GitHub e il singolo svantaggio distributivo piu grande, ed e completamente sotto il controllo di Trueline. Onboarding concorrenti: "3-click" (Pixeebot [28]), "<5 min" (DryRun [40]), "zero-config default-on" (Copilot Autofix [17]).
- No-marketplace = no-discovery e no-social-proof (es. "454 installs" DryRun [40]).
- No-telemetria e un differenziatore di trust autentico ma invisibile finche non lo si nomina: e cio su cui ZeroPath/Pixee/Aikido fanno salti mortali ("zero-data-retention", "sandbox then deleted" [30][52][5]) proprio perche di default il codice esce. Messaggio da mettere in cima.

**Raccomandazione distributiva:** mantenere il kernel local-only ma passare da "git clone manuale" a pubblicazione su marketplace di agent skill (`skills add`). Unico cambiamento che chiude il gap di adozione preservando integralmente la tesi.

**SaaS-wrapper (fuori scope v1).** Entrerebbe nel quadrante piu saturo (Snyk, Checkmarx, Veracode, Aikido, Semgrep, ZeroPath, Pixee, Endor, Apiiro, Safeguard â€” finanziati: Pixee ~$15M seed [29], Endor usato da OpenAI/Snowflake/Atlassian [22], Safeguard FedRAMP HIGH/IL7 [38]). Difendibile SOLO se: (a) conserva l'oracle-as-judge come SLA contrattuale ("un fix conta come fatto solo quando l'oracolo deterministico riporta zero e nessun test si rompe" â€” claim che i concorrenti cloud strutturalmente non possono fare); (b) offre self-hosted/BYO-runtime per non perdere il segmento privacy-first. Il target "founder non tecnici senza terminale" e scoperto: solo Aikido si rivolge a non-terminal users con web UI [5], ma senza epicentro RLS ne verified-fix loop.

**Wedge sfruttabili, in ordine di forza:**
1. *Supabase + RLS* â€” il piu forte e difendibile. Tra 24 profili, una sola capacita RLS (Aikido, DAST live-probe detection-only [5]); tutti gli altri "None/None found". Epicentro letteralmente vuoto, complementare ad Aikido (probe dinamico vs policy statica + fix).
2. *Skill cross-tool genuinamente locale* â€” sotto-segmento "senza account, senza egress" scoperto (consulenti, freelance su NDA, settori regolati, privacy-conscious). Da raggiungere via marketplace.
3. *Coppia secrets + RLS + dead-code sotto un unico loop verificato* â€” nessuno la unifica; il dead-code-removal verificato (knip/ts-prune/depcheck) non compare in alcun profilo.
4. *Disciplina blueprint-first / BUILD greenfield* â€” tutti i competitor sono remediation-only/brownfield. Sposta Trueline fuori dall'arena security-fix affollata, in una categoria adiacente ("verified agentic build discipline") dove i rivali diretti sono gli agenti di coding generici, non questi tool.

**I 3 rischi di mercato principali:**
1. *Erosione del wedge RLS da un incumbent (alto/imminente).* Un ruleset RLS e il tipo di cosa che Semgrep, Aikido (che ha gia il probe + integrazione partner Supabase [5]) o un vendor custom-rule aggiungono in un ciclo. Semgrep e insieme l'oracolo primario di Trueline E un competitor diretto via Guardian/Autofix [14]: se aggiungesse regole RLS, eroderebbe il wedge dall'interno usando lo stesso motore. Finestra ora e probabilmente breve.
2. *Commoditizzazione del "verified fix" (alto/strutturale).* Il delta di Trueline e sottile e tecnico ("re-scan-a-zero AND test-suite verde, deciso da oracolo NON-LLM"). Man mano che i loop dei competitor si stringono (Pixee [28], Safeguard [38], Guardian [14]), diventa difficile da comunicare a un buyer non tecnico.
3. *Svantaggio di distribuzione/credibilita/capitale (alto/persistente).* Trueline e v1 single-repo, install-manuale, senza marketplace/metriche/compliance/funding. I competitor portano trazione (Semgrep ~3M scan/settimana [14], ZeroPath 300k scan/mese [30], Amplify "100k+ PR a 50+ aziende" [32]), badge SOC2/ISO/FedRAMP, partnership ufficiali (Semgrep partner di Cursor e Claude Code [14]). Amazon Q in wind-down verso Kiro [15] mostra la fragilita strutturale di una skill non finanziata. Mitigazione: marketplace + messaggio trust local-only + difesa di categoria (build-lifecycle, non solo fixer).

---

## 6. I competitor da tenere d'occhio (3-5)

1. **Snyk** â€” minaccia numero uno: ha gia loop deterministico re-scan-a-zero [1][2] E la skill cross-tool `snyk-fix` con test suite [3], piu 35.000 fix [4] e scala; gli manca solo Supabase/RLS e il blueprint.
2. **Semgrep** â€” dipendenza-che-puo-diventare-concorrente: e l'oracolo primario di Trueline E un rivale via Guardian (regenerate-until-clean locale [14]); un pacchetto di regole RLS curate eroderebbe il wedge dall'interno.
3. **Aikido** â€” unico con QUALSIASI capacita RLS reale (DAST live-probe [5]) e condivide il DNA OSS di Trueline (Opengrep/Betterleaks/Trivy/OSV [24]); se aggiunge un RLS autofix diventa il rivale piu credibile sull'epicentro.
4. **AWS Kiro** (+ Spec Kit/BMAD) â€” rischio di convergenza di lungo periodo: dove AWS sta migrando Amazon Q [15]; se uno spec-driven framework adotta hook di sicurezza deterministici in-loop, arriva alla sintesi di Trueline da un'altra direzione e attacca l'unico claim 0/3 che regge. (Dettagli di prodotto **unknown**: nessun profilo JSON fornito.)
5. **Pixee** â€” esemplifica la commoditizzazione del gate fix (test+build+regression prima del PR, 76% merge [28]) e della forma skill (`npx skills add pixee/pixee-cli` [11]); benchmark di come comunicare un loop verificato a mercato.

---

## 7. Fonti

**Snyk Agent Fix / snyk-fix skill / Snyk Code Local Engine**
[1] https://snyk.io/blog/building-ai-trust-with-snyk-code-and-snyk-agent-fix/
[2] https://snyk.io/blog/find-auto-fix-prioritize-intelligently-snyks-ai-powered-code/
[3] (snyk-fix agent skill, repo `snyk/studio-recipes`, SKILL.md `command_directives/synchronous_remediation/skills/snyk-fix/SKILL.md`; StackHawk agent-skills `github.com/stackhawk/agent-skills` â€” citati come controesempio nel claim-check; URL repo specifici non riportati come campo `sources` nei profili)
[4] https://snyk.io/blog/deepcode-ai-vulnerability-autofixing/
[16] https://docs.snyk.io/snyk-data-and-governance/how-snyk-handles-your-data
[46] https://snyk.io/plans/
Altre: https://snyk.io/articles/snyk-dcaif-under-the-hood/ ; https://snyk.io/blog/ai-code-security-snyk-autofix-deepcode-ai/ ; https://github.com/snyk/deepcode_ai_fix ; https://snyk.io/platform/deepcode-ai/ ; https://docs.snyk.io/scan-with-snyk/snyk-code

**GitHub Copilot Autofix**
[17] https://docs.github.com/en/code-security/concepts/code-scanning/copilot-autofix-for-code-scanning
Altre: https://docs.github.com/en/code-security/responsible-use/responsible-use-autofix-code-scanning ; https://github.blog/news-insights/product-news/found-means-fixed-introducing-code-scanning-autofix-powered-by-github-copilot-and-codeql/ ; https://github.blog/changelog/2024-08-14-copilot-autofix-for-codeql-code-scanning-alerts-is-now-generally-available/ ; https://github.blog/changelog/2025-03-04-introducing-github-secret-protection-and-github-code-security/ ; https://github.blog/changelog/2025-10-28-assign-code-scanning-alerts-to-copilot-for-automated-fixes-in-public-preview/

**Semgrep (Autofix / Assistant / Guardian)**
[7] https://docs.semgrep.dev/semgrep-assistant/privacy
[14] https://docs.semgrep.dev/guardian
[18] https://docs.semgrep.dev/semgrep-assistant/overview
[47] https://semgrep.dev/pricing/
Altre: https://semgrep.dev/blog/2026/semgrep-autofix-public-beta/ ; https://docs.semgrep.dev/semgrep-code/triage-remediation/autofix ; https://semgrep.dev/blog/2026/introducing-semgrep-guardian-real-time-security-for-ai-written-code/ ; https://semgrep.dev/products/product-updates/detect-risks-in-ai-generated-code-with-semgrep-guardian/ ; https://docs.semgrep.dev/writing-rules/autofix ; https://github.com/semgrep/mcp ; https://dev.to/rahulxsingh/semgrep-pricing-in-2026-open-source-vs-team-vs-enterprise-costs-3dic

**Checkmarx One Assist / Developer Assist**
[19] https://checkmarx.com/blog/agentic-ai-vulnerability-prevention/
[20] https://docs.checkmarx.com/en/34965-549181-using-developer-assist-for-detection-and-remediation.html
[50] https://dev.checkmarx.com/
[54] https://beaglesecurity.com/blog/article/checkmarx-pricing.html
Altre: https://checkmarx.com/blog/introducing-ai-security-champion-with-auto-remediation-for-sast/ ; https://checkmarx.com/product/checkmarx-one-assist/ ; https://checkmarx.com/product/triage-and-remediation/ ; https://checkmarx.com/product/developer-assist/ ; https://checkmarx.com/press-releases/checkmarx-expands-auto-remediation-with-new-mobb-integration-for-sast/ ; https://marketplace.visualstudio.com/items?itemName=checkmarx.cx-dev-assist

**Veracode Fix**
[21] https://docs.veracode.com/r/About_Veracode_Fix
[53] https://checkthat.ai/brands/veracode/pricing
Altre: https://www.veracode.com/products/fix/ ; https://docs.veracode.com/r/review_verify ; https://github.com/veracode/veracode-fix ; https://www.securityscientist.net/blog/12-questions-and-answers-about-veracode-fix/ ; https://appsecsanta.com/veracode

**Endor Labs**
[8] https://www.prnewswire.com/news-releases/endor-labs-debuts-ai-native-multi-modal-sast-marking-a-new-era-in-code-flaw-detection-302619629.html
[22] https://www.endorlabs.com/learn/introducing-ai-sast-that-thinks-like-a-security-engineer
[23] https://docs.endorlabs.com/secure-ai-coding/mcp-server/claude-code
Altre: https://www.endorlabs.com/use-cases/sast ; https://www.endorlabs.com/platform ; https://www.endorlabs.com/pricing ; https://www.endorlabs.com/learn/endor-labs-cursor-building-the-security-foundation-for-agentic-coding ; https://appsecsanta.com/endor-labs

**Aikido Security**
[5] https://help.aikido.dev/dast-surface-monitoring/attack-surface-scanning
[24] https://www.aikido.dev/open-source
[48] https://www.aikido.dev/pricing
Altre: https://www.aikido.dev/code/autofix ; https://www.aikido.dev/features/ai-sast-iac-autofix ; https://help.aikido.dev/autofix-and-remediation/overview-aikido-autofix ; https://help.aikido.dev/autofix-and-remediation/scope/ai-autofix-for-sast-and-iac-issues.md ; https://supabase.com/partners/integrations/aikido-security

**Qwiet AI / Harness SAST**
[25] https://docs.shiftleft.io/sast/autofix
Altre: https://qwiet.ai/news-press/qwiet-ai-expands-integrations-and-autofix-capabilities-to-empower-developers-in-shipping-secure-software-faster/ ; https://www.prnewswire.com/news-releases/harness-strengthens-its-application-security-business-with-acquisition-of-qwiet-ai-302569086.html ; https://www.harness.io/products/application-security-testing

**Mobb (+ Bugsy)**
[26] https://docs.mobb.ai/mobb-user-docs/supported-stable-fixes
[27] https://github.com/mobb-dev/bugsy
[49] https://www.mobb.ai/pricing
Altre: https://www.mobb.ai/features ; https://www.mobb.ai/blog/ai-code-remediation-guide ; https://docs.mobb.ai/mobb-user-docs/whats-new-with-mobb ; https://www.prnewswire.com/news-releases/mobb-announces-general-availability-of-its-ai-powered-automated-vulnerability-fixer-301889916.html ; https://docs.mobb.ai/mobb-user-docs/llms-full.txt ; https://content.mobb.ai/blog/meet-bugsy

**Pixee**
[28] https://www.pixee.ai/vulnops
[29] https://github.com/pixee/codemodder-java
[11] https://github.com/pixee/pixee-cli
[52] https://www.pixee.ai/pricing
Altre: https://www.pixee.ai/ ; https://www.pixee.ai/platform ; https://www.pixee.ai/triage-automation ; https://www.pixee.ai/sca-triage ; https://www.pixee.ai/blog/best-automated-remediation-tools-2026 ; https://www.pixee.ai/blog/java-vulnerability-remediation-automated-fixes ; https://docs.pixee.ai/ ; https://github.com/marketplace/pixeebot-automated-code-fixes ; https://aicodereview.cc/tool/pixee/

**ZeroPath**
[9] https://zeropath.com/products/sast
[30] https://zeropath.com/trust-center
[31] https://zeropath.com/blog/0day-discoveries
Altre: https://zeropath.com/ ; https://zeropath.com/pricing ; https://zeropath.com/faq ; https://zeropath.com/blog/how-zeropath-works ; https://zeropath.com/blog/introducing-zeropath-v1 ; https://github.com/ZeroPathAI/zeropath-agent-plugin ; https://www.rsaconference.com/library/press-release/finalists-announced-for-rsac-innovation-sandbox-contest-2026

**Amplify Security**
[32] https://aws.amazon.com/marketplace/pp/prodview-mj7b22bmjhupe
Altre: https://amplify.security/product ; https://amplify.security/products ; https://docs.amplify.security/llms-full.txt ; https://blogs.amplify.security/blog/ai-appsec-vendors-auto-fix-code ; https://amplify.security/blog/ai-appsec-vendors-auto-fix-code ; https://joshua.hu/llm-engineer-review-sast-security-ai-tools-pentesters

**Apiiro AutoFix Agent (+ CLI agent skills)**
[12] https://github.com/apiiro/cli-releases
[33] https://aws.amazon.com/marketplace/pp/prodview-g7uwpqwze7cow
Altre: https://apiiro.com/autofix-agent/ ; https://apiiro.com/blog/a-completely-new-way-to-fix-design-and-code-risks-meet-apiiros-autofix-agent/ ; https://apiiro.com/blog/security-tools-were-built-for-humans-we-built-one-for-ai-agents-introducing-apiiro-cli/ ; https://www.helpnetsecurity.com/2026/04/10/apiiro-cli-turns-ai-coding-assistants-into-full-stack-security-engineers/ ; https://apiiro.com/blog/confidence-in-agentic-code-fixes-is-rising-but-not-without-a-strong-aspm-program/

**Amazon Q Developer**
[15] https://aws.amazon.com/blogs/devops/amazon-q-developer-end-of-support-announcement/
[34] https://aws.amazon.com/blogs/devops/code-security-scanning-with-amazon-q-developer/
Altre: https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/address-scan-findings.html ; https://aws.amazon.com/q/developer/faqs/ ; https://aws.amazon.com/q/developer/pricing/ ; https://docs.aws.amazon.com/codeguru/latest/security-ug/end-of-support.html

**SonarQube AI CodeFix**
[13] https://www.sonarsource.com/blog/now-available-sonarqube-plugin-for-claude-code/
[35] https://docs.sonarsource.com/sonarqube-cloud/administering-sonarcloud/ai-features/enable-ai-codefix.md
[51] https://www.sonarsource.com/products/sonarqube/cloud/new-pricing-plans/
Altre: https://www.sonarsource.com/solutions/ai/ai-codefix/ ; https://docs.sonarsource.com/sonarqube-cloud/standards/managing-rules/rules-for-ai-codefix.md ; https://docs.sonarsource.com/sonarqube-server/instance-administration/ai-features/enable-ai-codefix.md

**GitLab Duo (Agentic SAST Vulnerability Resolution)**
[36] https://docs.gitlab.com/user/application_security/vulnerabilities/agentic_vulnerability_resolution/
[37] https://about.gitlab.com/pricing/
Altre: https://docs.gitlab.com/user/duo_agent_platform/flows/foundational_flows/agentic_sast_vulnerability_resolution/ ; https://www.helpnetsecurity.com/2026/04/17/gitlab-18-11-agentic-ai/ ; https://docs.gitlab.com/user/application_security/sast/advanced_sast_coverage/ ; https://docs.gitlab.com/user/gitlab_duo/data_usage/ ; https://www.pixee.ai/blog/gitlab-security-automation-pipeline-to-fixes

**Safeguard (Griffin AI)**
[38] https://safeguard.sh/resources/blog/the-case-for-autonomous-remediation-now
Altre: https://safeguard.sh/ ; https://safeguard.sh/products/griffin-ai ; https://safeguard.sh/pricing ; https://safeguard.sh/resources/blog/mitigate-npm-install-scripts-without-breaking-builds ; https://safeguard.sh/resources/blog/codeql-vs-snyk-buyer-comparison-2026 ; https://github.com/griffinbank/griffin-mcp-server

**DryRun Security**
[39] https://www.dryrun.security/faqs
[40] https://docs.dryrun.security/dryrun-skill
Altre: https://www.dryrun.security/ ; https://www.dryrun.security/product/sast ; https://www.dryrun.security/resources/csa-guide ; https://docs.dryrun.security/ ; https://github.com/marketplace/dryrun-security-app ; https://www.globenewswire.com/news-release/2026/02/03/3230986/0/en/DryRun-Security-Introduces-the-DeepScan-Agent-for-Rapid-Full-Codebase-Security.html

**Gecko Security**
[41] https://www.gecko.security/
[42] https://news.ycombinator.com/item?id=44747204
Altre: https://www.ycombinator.com/launches/M40-gecko-security-your-ai-security-engineer ; https://github.com/orgs/Gecko-Security/repositories ; https://github.com/Gecko-Security/audits

**Almanax (ALMX-1)**
[43] https://almanax.ai/
[44] https://almanax.ai/blog/almx-1-achieves-sota-performance-in-web3-vulnerability-detection
[45] https://partners.circle.com/partner/almanax
Altre: https://www.almanax.ai/blog/releasing-almx-1-5-and-the-web3-security-atlas ; https://theaiinsider.tech/2025/01/27/almanax-secures-1m-to-advance-ai-driven-web3-security-solutions/ ; https://www.producthunt.com/products/almanax

**CybeDefend (controesempio "code-never-leaves", claim-check)**
[6] (CybeDefend "Cybe AutoFix" air-gapped â€” citato nel claim-check; URL non riportato come campo `sources` nei profili JSON forniti)

---

*Note di tracciabilita:* I riferimenti [3] (Snyk `snyk-fix` skill, StackHawk agent-skills) e [6] (CybeDefend), oltre ad AquilaX/Mobb-as-corroboration/Legit Security, provengono dalla sezione VERIFICA CLAIM, non da profili JSON con campo `sources`. Per questi, gli URL/repo precisi NON sono forniti nei dati strutturati e quindi non sono stati inventati. AWS Kiro, GitHub Spec Kit, BMAD-Method, Tessl, e Supabase Security Advisor compaiono solo nel claim-check (Arene B e D) senza profilo dedicato: i loro dettagli di prodotto oltre l'affermazione verificata sono **unknown** e non citabili con URL.
