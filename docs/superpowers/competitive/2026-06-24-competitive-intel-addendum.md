# ADDENDUM AL REPORT DI COMPETITIVE INTELLIGENCE â€” TRUELINE

## Blindatura dei wedge B (spec-driven / blueprint-first) e D (Supabase / RLS)

Il primo passaggio aveva istruito a fondo l'arena security-fix. Questo addendum mette sotto scrutinio profondo i due pivot su cui poggia la raccomandazione di posizionamento: **blueprint-first verified-BUILD** (arena B) e **Supabase-RLS verified-fix** (arena D). Ogni affermazione non ovvia Ã¨ tracciata alle fonti in Â§6.

---

## 1. VERDETTO IN TESTA

**Wedge 1 â€” blueprint-first + gate da oracolo deterministico di sicurezza come autoritÃ  del macrotask: GO (con guardia attiva).**
L'intersezione "disciplina blueprint-first di BUILD" Ã— "oracolo di sicurezza deterministico NON-LLM al confine del task" Ã¨ genuinamente vuota: chi ha la metÃ  BUILD (Spec Kit, BMAD, Kiro, IIKit) adjudica il "done" via LLM o umano [2][3][4][7]; chi ha l'oracolo deterministico (securecoder, Semgrep Skills) non ha la disciplina blueprint-first [11][12]. Il GO non Ã¨ un "siamo soli per sempre": securecoder e intent-integrity-kit sono a due passi non banali dalla paritÃ , e il meccanismo del gate Ã¨ banalmente copiabile [11][7].

**Wedge 2 â€” Supabase-RLS verified-fix loop dentro un agente: CAUTION (GO sulla posizione, NON sulla profonditÃ ).**
L'epicentro "apply â†’ ri-esegui lo STESSO oracolo fino a zero â†’ test verdi, dentro un coding agent come gate" Ã¨ vuoto: nessuno dei 12 profili D lo chiude [13â€“24]. Ma il wedge Ã¨ solido solo sull'asse posizione (in-agent + verifica legata-alla-patch + multi-dominio + local-only) e fragile sull'asse profonditÃ  RLS, dove supashield fa giÃ  DAST ri-eseguibile con rollback [15] e Supabase Agent Skills ha distribuzione 100Ã— superiore sullo stesso form factor [21]. CAUTION perchÃ© supashield Ã¨ "a un wrapper di distanza" dal loop.

---

## 2. ARENA B â€” MAPPA + CONVERGENZA

### Tabella dei framework

| Framework | AutoritÃ  del "done" | Gate sicurezza NON-LLM al confine? | Disciplina di BUILD | Rischio convergenza |
|---|---|---|---|---|
| **securecoder** [11] | deterministic-oracle (SAST re-run) + LLM su compliance | **SÃŒ** â€” pre-commit hook SAST-only, hard-block su severity (opt-in, su git-commit generico) | Assente (`/build` = LLM self-supervision) | **VERY HIGH** |
| **intent-integrity-kit** [7] | deterministic-oracle (hash-lock SHA256, REDâ†’GREEN, AST) | SÃ¬ ma tipo sbagliato â€” integritÃ  test/spec, mai sicurezza | Forte (task atomici, @FR-XXX, DoD = BDD chain) | **HIGH** |
| **Aider** [9] | generic-tests (exit-code, cap 3 reflection) | No (ma `--lint-cmd semgrep` possibile oggi; non gata, committa in rosso) | Debole/assente | HIGH (sul loop) |
| **TDAD** [8] | generic-tests (pytest impacted) | No (oracolo = test, non sicurezza) | Assente (anti-procedurale per tesi) | HIGH (sul meccanismo) |
| **Semgrep Skills** [12] | deterministic-oracle (ma giudica le REGOLE, non il fix) | No al confine task â€” CI solo illustrativo | Assente | MEDIUM-HIGH (primitivo), LOW (sintesi) |
| **GitHub Spec Kit** [2] | llm-self-check (`/analyze` read-only, non-blocking) | No â€” persino i CRITICAL non fermano | Forte (15-40 task atomici, "done when", test-first) | MEDIUM (bloccato su autoritÃ +intento) |
| **BMAD-METHOD** [3] | llm-self-check (gate TEA PASS/CONCERNS/FAIL) | No â€” `quality.pre_commit` Ã¨ lint/test generico utente | Forte (story one-dev-day, una-alla-volta, DoD 100%) | MEDIUM (â‰ˆ80% plumbing sul BUILD) |
| **Traycer** [10] | llm-self-check (GPT-5.1 rivede il diff) | No â€” gate = critica LLM + regression | Forte (fasi plan-first + acceptance + verify) | MEDIUM (mecc. corto, volontÃ  non osservata) |
| **Kiro / AWS** [1] | llm-self-check (PBT opzionale, non-blocking) | No â€” hook "Run Command" wireable ma non gata di default | Forte (EARS, waves, traceability) | LOW-MEDIUM |
| **Spec Workflow MCP** [6] | human (approva nel dashboard) | No â€” nessun meccanismo per eseguire comandi esterni | Buona (task atomici + Success prose) | LOW (net-new capability) |
| **Tessl** [4] | generic-tests (`[@test]`) + LLM su conformance | No su user-code (Snyk solo su skill del registry) | Media (spec/file, 1:1) | LOW-MEDIUM (pivot governance) |
| **tdd-guard** [5] | llm-self-check ("validates using AI") | No â€” verdetto TDD reso da LLM | Assente (micro-cadenza, no blueprint) | LOW (assioma opposto) |

### Ranking del rischio di convergenza (dal piÃ¹ facile al piÃ¹ difficile)

1. **securecoder** [11] â€” VERY HIGH. Ha giÃ : oracle-verified fix loop (ri-esegue il SAST originante, il finding canonico deve sparire, no nuovo finding â‰¥ severity, rollback+retry max 3), pre-commit hook SAST-only NON-LLM che hard-blocca, e **forma identica a Trueline** (skill locale multi-host, OSS, no telemetria). Gli mancano: la metÃ  BUILD (planner blueprint) e il verticale RLS. **Gap reale sfruttabile: il suo fix loop NON esegue mai la test-suite del progetto** â€” solo ri-esegue lo scanner [11].
2. **intent-integrity-kit** [7] â€” HIGH. Possiede i due pezzi piÃ¹ difficili: gate meccanico NON-LLM al confine task/commit e infrastruttura anti-tamper a 4 layer (pre-commit + post-commit + CI + PreToolUse) indurita contro `--no-verify`. La catena di hook Ã¨ esattamente dove si innesterebbe uno step Semgrep/gitleaks/osv. Due passi non banali: verified-FIX loop + verticale RLS (improbabile per un progetto deliberatamente domain-agnostic).
3. **Aider** [9] â€” HIGH sul loop. Loop deterministico applyâ†’re-runâ†’fix keyed sull'exit-code, ri-esegue il comando identico; `--lint-cmd "semgrep --error"` possibile oggi. Ma committa anche in rosso (cap 3), zero blueprint, zero intento di sicurezza.
4. **TDAD** [8] â€” HIGH sul meccanismo. pytest pass/fail Ãˆ il verdetto, artefatto AST deterministico al confine, regola "porta a zero prima di submit". Corto nel meccanismo, lungo nel contenuto di dominio (no RLS, Python-only) e nel blueprint.
5. **Semgrep Skills** [12] â€” MEDIUM-HIGH primitivo / LOW sintesi. Ãˆ l'oracolo stesso impacchettato come skill, con loop test-gated dove il motore emette il verdetto â€” ma giudica la **correttezza delle regole**, non il fix; zero disciplina di build.
6. **GitHub Spec Kit** [2] â€” MEDIUM. Macchineria di confine presente; bloccato su autoritÃ +intento, non sul plumbing. Il maintainer ha respinto `/speckit.verify` a "extension first": verifica deterministica **fuori scope core per scelta** [2].
7. **BMAD-METHOD** [3] â€” MEDIUM. â‰ˆ80% del plumbing c'Ã¨ sul BUILD (`quality.pre_commit` exit-code-driven); basterebbe far cadere `semgrep/gitleaks/osv` e ridefinire il gate TEA sull'exit-code. Gli manca il contenuto/IP (ruleset AI-mistakes + RLS checker) e la disciplina oracolo-come-unica-autoritÃ .
8. **Traycer** [10] â€” MEDIUM. Cammino meccanico corto (potrebbe shell-out a scanner e trattarne l'exit-code), ma il business Ã¨ costruito sull'inferenza LLM; volontÃ  strategica non osservata.
9. **Kiro / AWS** [1] â€” LOW-MEDIUM. Hook = substrato tecnico, ma manca primitiva di veto-by-default e l'intento (qualitÃ  = correttezza funzionale via PBT). Risorse enormi se decidesse.
10. **Spec Workflow MCP** [6] â€” LOW. Ben posizionato sui task atomici, ma **nessun meccanismo per eseguire comandi esterni**: il gate Ã¨ net-new, non un config flip. Worldview = umano-come-autoritÃ .
11. **Tessl** [4] â€” LOW-MEDIUM. Pedigree Snyk + $125M, ma il pivot Jan-2026 verso governance legge come ritiro dalla tesi spec-as-source; engine closed beta, non-deterministico, JS-only.
12. **tdd-guard** [5] â€” LOW. Substrato hook riusabile, ma ancorato all'assioma **opposto** (LLM-as-judge). Convergere = inversione di tesi.

**Pattern chiave:** il rischio si concentra dove **forma + filosofia dell'oracolo coincidono giÃ ** (securecoder, IIKit, Semgrep Skills, TDAD, Aider). I framework spec-driven puri (Spec Kit, Kiro, Traycer) sono lontani non per plumbing ma per **autoritÃ ** â€” costruiti sull'LLM/umano-come-giudice, invertirlo Ã¨ un cambio di worldview.

---

## 3. ARENA D â€” MAPPA + VUOTO

### Tabella dei tool Supabase/RLS

| Tool | Detection / Fix | Verifica-fix (re-run a zero) | Gira come gate in-agent? | ProfonditÃ  RLS | Form factor | Overlap |
|---|---|---|---|---|---|---|
| **supashield** [15] | fix-suggest (`FIX: CREATE POLICY`, non applica) | **No** (ma `test` Ã¨ DAST ri-eseguibile con ROLLBACK) | No â€” CLI standalone, `--json` per CI | **Profonda**: audit + lint + coverage + DAST CRUD per ruolo + export-pgtap + snapshot/diff + spec `policy.yaml` | cli | complementary |
| **Supabase Security Advisor (Splinter)** [13] | fix-suggest (Assistant LLM scrive SQL, MCP `apply_migration`) | No â€” "ri-esegui get_advisors regolarmente" = manuale | Solo via MCP su DB cloud live, non repo | ~29 lint catalogo (0013/0008/0003/0010/0015/0024â€¦) | platform-feature | adjacent |
| **Splinter (linter)** [14] | detection-only | No (stateless) | No | Static SQL su catalogo, no DAST | platform-feature | complementary |
| **VibeAppScanner / VAS** [16] | fix-suggest | No â€” "re-scan to verify" manuale dell'intera app | No â€” SaaS su URL deployato | DAST anon-key (unauth + cross-user), CVE-2025-48757 | web-app | adjacent |
| **VibeEval** [17] | fix-suggest | No â€” "Deploy, rescan, repeat until zero" (curl) | No â€” SaaS; MCP per "real-time", non gate bloccante | DAST PostgREST attacker-style, request/response | web-app | complementary |
| **SecurifyAI Burp ext.** [18] | detection-only | No â€” "rerun the scanner" manuale | No â€” GUI Burp human-driven | DAST table-enum + SELECT/INSERT dry-run + row-count | chrome-extension | complementary |
| **renantrendt rls-tests-gen** [19] | test-generation (LLM autore) | No (nessun fix; test riscritti ogni run, non-det.) | No â€” CLI npx | DAST test-gen via Claude, service-role key | oss-script | complementary |
| **Supabase Agent Skills** [21] | guidance-only | No â€” rimanda a Splinter/Advisor | **SÃ¬ come contesto, NO come gate** (non puÃ² far fallire) | Prosa advisory, nessun detector proprio | skill-or-plugin | complementary |
| **SupaRalph** [20] | fix-suggest ("Copy Findings for AI") | No â€” re-scan manuale | No â€” dashboard + GitHub Action (puÃ² fallire build) | DAST 277 vettori, 100+ RLS (USING(true), bypass) | oss-script | complementary |
| **Supaguard** [22] | fix-suggest | No â€” "rescan to verify" manuale | No â€” SaaS; CI hook triggera scan hosted | DAST PostgREST + crawl bundle JS + PII/PCI | web-app | adjacent |
| **hand-dot rls-checker** [23] | detection-only | No â€” re-browse manuale | No â€” estensione Chrome browse-time | DAST euristico (~39 tabelle hardcoded, soglia â‰¥30 righe) | chrome-extension | complementary |
| **sahilahluwalia checker** [24] | detection-only | No | No â€” web app client-side | DAST anon CRUD, dormiente (1 star, no license) | web-app | complementary |

**Categoria E â€” verified-fix loop dentro un agente (apply â†’ re-run stesso oracolo â†’ zero â†’ test verdi): NESSUNO.** Vuoto confermato [13â€“24].

### Il vicino piÃ¹ pericoloso: supashield

**supashield** [15] Ã¨ la minaccia reale perchÃ© **possiede giÃ  i pezzi del loop, separatamente**: detector statico (`audit`/`lint`), probe DAST CRUD per ruolo **ri-eseguibile e con ROLLBACK** (profonditÃ  RLS che l'oracolo statico di Trueline non ha), generazione test (`export-pgtap`), spec atteso (`.supashield/policy.yaml`), output `--json` "for AI/CI integration". **Gli manca solo l'orchestrazione del loop.** Il giorno in cui un wrapper (uno SKILL.md) fa `audit â†’ suggerisci FIX â†’ applica â†’ ri-esegui test fino a zero â†’ pgTAP verdi`, supashield diventa un verified-fix loop RLS â€” Ã¨ a **un solo livello di orchestrazione** dall'epicentro.

I suoi limiti strutturali (la trincea di Trueline): Ã¨ una **CLI standalone**, non gira in-agent come gate per-macrotask; richiede **connection string live** (credenziali DB sulla macchina, contro il "niente lascia la macchina"); dipende dall'utente che scrive bene `policy.yaml`; Ã¨ **RLS-only** â€” niente secrets, niente dead-code, niente loop unificato [15].

**Non pericolosi (solo complementari):** tutta la categoria DAST/probe (VAS, VibeEval, SupaRalph, Supaguard, estensioni Chrome/Burp) testa un'app **giÃ  deployata** dall'esterno â€” ortogonale: vivono post-deploy, Trueline vive pre-deploy/in-repo [16][17][18][20][22][23]. Possono diventare alleati narrativi. Il generatore renantrendt Ã¨ lo spauracchio vivente del LLM-as-judge [19].

---

## 4. RI-VERIFICA DEI 4 CLAIM STRATEGICI

**Claim B-oracle-gate** â€” *nessun framework blueprint-first impone un gate da oracolo di sicurezza deterministico NON-LLM al confine di ogni task prima di proseguire; la loro autoritÃ  del "done" Ã¨ LLM, test generici o umano.*
â†’ **REGGE (0/3 refutato).** Tutti e 12 i profili B confermano: chi ha il blueprint adjudica via LLM/umano [1][2][3][4][6][10], chi ha il gate deterministico o giudica le regole non il fix [12], o gata l'integritÃ  test non la sicurezza [7]. **Quasi-controesempio (non confuta):** securecoder ha sÃ¬ un gate SAST-only NON-LLM che hard-blocca, ma su **git-commit generico opt-in**, non al confine di un task pianificato, e non ha disciplina blueprint â€” https://github.com/nerdy-krishna/securecoder [11]. Il claim regge perchÃ© richiede *entrambe* le metÃ  sotto un'unica autoritÃ .

**Claim D-advisor** â€” *Splinter/Security Advisor rileva RLS ma NON propone-E-verifica fix automatici e non gira come gate per-commit dentro un agente.*
â†’ **REGGE (0/3 refutato).** Splinter Ã¨ detection-only [14]; l'Advisor aggiunge l'Assistant LLM che scrive SQL e MCP `apply_migration`, ma **nessuna ri-esecuzione automatica di `get_advisors` legata alla patch nÃ© gate sui test** â€” i doc dicono "ri-esegui get_advisors regolarmente", scarico manuale sull'umano â€” https://supabase.com/docs/guides/database/database-advisors [13]. Il fix path richiede un progetto cloud connesso (OAuth/project_ref), non Ã¨ un gate sul repo.

**Claim D-verified-rls-loop** â€” *fra i tool community/commerciali Supabase-RLS, NESSUNO offre un loop oracle-VERIFICATO (apply â†’ re-run stesso checker a zero â†’ test verdi); sono detection-only, scaffolding, dashboard o suggerimenti one-shot.*
â†’ **REGGE (0/3 refutato).** Ogni competitor ferma la verifica a un'azione **manuale e fuori-banda**: "rescan" [16], "rerun the scanner" [18], "Deploy, rescan, repeat" [17], "Copy Findings for AI" [20]. supashield Ã¨ il piÃ¹ vicino ma **suggerisce e non applica, non ri-esegue** â€” https://github.com/Rodrigotari1/supashield [15]. renantrendt genera test ma Ã¨ LLM-autore, non-deterministico, nessun fix [19].

**Claim CD-combo-skill** â€” *nessuna skill/plugin pubblicata bundla secrets + RLS + dead-code sotto UN loop oracle-verificato per progetti Supabase JS/TS.*
â†’ **REGGE (0/3 refutato).** Sul versante D: Supaguard/VAS/VibeEval hanno secrets+RLS ma in **report separati**, nessuno ha dead-code, nessuno unifica in un loop [16][17][22]. Supabase Agent Skills (stesso form factor) Ã¨ **passivo, non un gate** [21]. Sul versante B: securecoder copre secrets (Gitleaks) + deps (OSV) ma **zero RLS, zero dead-code, e non esegue i test** [11]; Semgrep Skills Ã¨ single-oracle [12]. La combinazione secrets+RLS+dead-code sotto un loop human-gated non esiste nei dati.

---

## 5. EFFETTO NETTO SULLA RACCOMANDAZIONE DI POSIZIONAMENTO

I due pivot **reggono allo scrutinio profondo**, ma con un aggiustamento di asse obbligatorio sul Wedge 2.

**Cosa NON cambia:**
- L'intersezione blueprint-first Ã— oracolo-deterministico-di-sicurezza Ã¨ genuinamente vuota (Wedge 1, GO) [1â€“12].
- Il verified-fix loop RLS in-agent Ã¨ genuinamente vuoto (Wedge 2, GO sulla posizione) [13â€“24].
- Tutti e 4 i claim reggono a 0/3. La raccomandazione di posizionamento del passaggio 1 non viene smentita.

**Cosa cambia / si raffina:**
1. **Il fossato NON Ã¨ il meccanismo, Ã¨ la sintesi + il contenuto dell'oracolo.** Il gate deterministico Ã¨ terreno comune verso cui tutti convergono (securecoder lo ha giÃ  spedito; Aider/IIKit/TDAD ce l'hanno in qualche forma) [11][9][7][8]. Difendere "abbiamo un gate deterministico" Ã¨ perdente. Difendibile Ã¨: **blueprint + oracolo-come-autoritÃ  + verified-fix con test-gate + verticale RLS**, tenuti insieme.
2. **Sul Wedge 2, rivendicare POSIZIONE, non PROFONDITÃ€ RLS.** Su profonditÃ  Trueline perde contro il DAST (supashield prova l'exploitability a runtime con rollback; le estensioni/SaaS provano la reachability reale) [15][16][17]. La rivendicazione corretta Ã¨ "loop legato-alla-patch + oracle-as-judge + in-agent + local-only + multi-dominio", non "troviamo piÃ¹ bug RLS".
3. **Due differenziatori specifici regalati dai dati, da blindare nel messaggio:**
   - **"findingâ†’zero AND nessun test rotto"**: securecoder, il vicino piÃ¹ pericoloso sul versante B, **non esegue mai la test-suite nel fix loop** â€” solo ri-esegue lo scanner [11]. Il test-gate Ã¨ strettamente piÃ¹ forte e va reso messaggio centrale.
   - **Anti-tamper dell'autoritÃ **: IIKit ha giÃ  chiuso l'attacco "LLM edita il test per matchare il bug" con hash-lock SHA256 a 4 layer [7]. Se l'oracolo Ã¨ l'autoritÃ , va reso a prova di manomissione â€” lezione da assorbire, non da reinventare.
4. **Due minacce da monitorare per nome**, entrambe a due passi non banali dalla paritÃ : **securecoder** (piÃ¹ vicino su forma+oracolo, gli mancano BUILD+RLS+test-gate) [11] e **supashield** (piÃ¹ vicino sui pezzi del loop RLS, gli manca l'orchestrazione + multi-dominio + in-agent) [15]. La finestra di "due passi" Ã¨ il tempo per rendere RLS+multi-dominio incopiabili.

**In una riga:** i due pivot reggono; la raccomandazione di posizionamento del passaggio 1 va confermata ma **riassata** â€” vendere la *sintesi e il loop legato-alla-patch con test-gate*, non il gate isolato nÃ© la profonditÃ  RLS â€” e completare per primo il fossato multi-dominio (secrets+RLS+dead-code sotto un solo loop) che nessun RLS-only puÃ² copiare in fretta.

---

## 6. FONTI

URL presenti SOLO nei profili JSON. Dove un dato Ã¨ "unknown" Ã¨ segnalato in linea. Numerazione usata nelle note [n].

### Arena B

**[1] Kiro (AWS)** â€” https://kiro.dev/ Â· https://kiro.dev/docs/specs/ Â· https://kiro.dev/docs/specs/correctness/ Â· https://kiro.dev/blog/property-based-testing/ Â· https://kiro.dev/docs/hooks/ Â· https://kiro.dev/docs/steering/ Â· https://kiro.dev/docs/privacy-and-security/data-protection/ Â· https://kiro.dev/blog/general-availability/ Â· https://kiro.dev/pricing/ Â· https://kiro.dev/faq/

**[2] GitHub Spec Kit** â€” https://github.com/github/spec-kit Â· https://github.github.com/spec-kit/ Â· https://github.com/github/spec-kit/blob/main/spec-driven.md Â· https://github.com/github/spec-kit/blob/main/templates/commands/analyze.md Â· https://github.com/github/spec-kit/discussions/1662 Â· https://developer.microsoft.com/blog/spec-driven-development-spec-kit

**[3] BMAD-METHOD** â€” https://github.com/bmad-code-org/BMAD-METHOD Â· https://docs.bmad-method.org/reference/testing/ Â· https://docs.bmad-method.org/reference/agents/ Â· https://docs.bmad-method.org/reference/workflow-map/ Â· https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise Â· https://bmad-code-org.github.io/bmad-method-test-architecture-enterprise/explanation/tea-overview/ Â· https://docs.bmad-method.org/tutorials/getting-started/

**[4] Tessl (Framework + Registry)** â€” https://tessl.io/ Â· https://docs.tessl.io/use/spec-driven-development-with-tessl Â· https://docs.tessl.io/introduction-to-tessl/how-tessl-works.md Â· https://github.com/tesslio/spec-driven-development-tile Â· https://github.com/tesslio/spec-driven-development-tile/blob/main/skills/work-review/SKILL.md Â· https://tessl.io/blog/tessl-launches-spec-driven-framework-and-registry/ Â· https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html (pricing: unknown / non pubblicato)

**[5] tdd-guard (nizos)** â€” https://github.com/nizos/tdd-guard Â· https://raw.githubusercontent.com/nizos/tdd-guard/main/README.md Â· https://github.com/nizos/tdd-guard/blob/main/docs/validation-model.md Â· https://raw.githubusercontent.com/nizos/tdd-guard/main/docs/configuration.md Â· https://claudelog.com/claude-code-mcps/tdd-guard/

**[6] Spec Workflow MCP (Pimzino)** â€” https://github.com/Pimzino/spec-workflow-mcp Â· https://github.com/Pimzino/spec-workflow-mcp/blob/main/docs/WORKFLOW.md Â· https://github.com/Pimzino/spec-workflow-mcp/blob/main/docs/TOOLS-REFERENCE.md Â· https://raw.githubusercontent.com/Pimzino/spec-workflow-mcp/main/src/markdown/templates/tasks-template.md Â· https://github.com/Pimzino/claude-code-spec-workflow Â· https://www.npmjs.com/package/@pimzino/spec-workflow-mcp

**[7] intent-integrity-kit (Tessl Labs)** â€” https://github.com/intent-integrity-chain/kit Â· https://github.com/intent-integrity-chain Â· https://raw.githubusercontent.com/intent-integrity-chain/kit/main/CHANGELOG.md Â· https://raw.githubusercontent.com/intent-integrity-chain/kit/main/FRAMEWORK-PRINCIPLES.md Â· https://tessl.io/registry/tessl-labs/intent-integrity-kit/2.7.5 (pricing kit: unknown / OSS MIT, termini piattaforma non dichiarati)

**[8] TDAD (pepealonso95)** â€” https://github.com/pepealonso95/TDAD Â· https://raw.githubusercontent.com/pepealonso95/TDAD/main/tdad/SKILL.md Â· https://arxiv.org/abs/2603.17973 Â· https://arxiv.org/html/2603.17973v1 Â· https://thelgtm.dev/tdad-test-driven-agentic-development-reducing-code-regressions-by-70/

**[9] Aider** â€” https://github.com/aider-ai/aider Â· https://aider.chat/docs/usage/lint-test.html Â· https://aider.chat/2024/09/26/architect.html Â· https://aider.chat/docs/usage/modes.html Â· https://raw.githubusercontent.com/Aider-AI/aider/main/aider/coders/base_coder.py Â· https://aider.chat/docs/git.html Â· https://aider.chat/docs/more/analytics.html

**[10] Traycer** â€” https://traycer.ai/ Â· https://traycer.ai/blog/multi-model-architecture Â· https://docs.traycer.ai/tasks/verification Â· https://docs.traycer.ai/tasks/phases Â· https://docs.traycer.ai/account/pricing Â· https://www.augmentcode.com/tools/traycer-vs-intent Â· https://marketplace.visualstudio.com/items?itemName=Traycer.traycer-vscode

**[11] securecoder (nerdy-krishna)** â€” https://github.com/nerdy-krishna/securecoder Â· https://raw.githubusercontent.com/nerdy-krishna/securecoder/main/README.md Â· https://raw.githubusercontent.com/nerdy-krishna/securecoder/main/CHANGELOG.md Â· https://raw.githubusercontent.com/nerdy-krishna/securecoder/main/skills/security/securecoder-fix/SKILL.md Â· https://raw.githubusercontent.com/nerdy-krishna/securecoder/main/skills/security/securecoder-review/SKILL.md Â· https://raw.githubusercontent.com/nerdy-krishna/securecoder/main/skills/security/securecoder-build/SKILL.md

**[12] Semgrep Skills (semgrep/skills)** â€” https://github.com/semgrep/skills Â· https://github.com/semgrep/skills/blob/main/skills/semgrep/SKILL.md Â· https://raw.githubusercontent.com/semgrep/skills/main/skills/semgrep/references/workflow.md Â· https://raw.githubusercontent.com/semgrep/skills/main/README.md Â· https://github.com/vercel-labs/skills Â· https://www.npmjs.com/package/skills

### Arena D

**[13] Supabase Security Advisor / Database Advisors** â€” https://supabase.com/docs/guides/database/database-advisors Â· https://supabase.com/docs/guides/database/database-advisors?lint=0013_rls_disabled_in_public Â· https://supabase.com/docs/guides/database/database-advisors?lint=0003_auth_rls_initplan Â· https://github.com/supabase/mcp Â· https://supabase.com/docs/guides/getting-started/mcp Â· https://supabase.com/docs/reference/cli/supabase-db-lint Â· https://supabase.com/blog/supabase-security-2025-retro

**[14] Supabase Splinter (linter)** â€” https://github.com/supabase/splinter Â· https://supabase.github.io/splinter/ Â· https://supabase.github.io/splinter/0013_rls_disabled_in_public/ Â· https://supabase.github.io/splinter/0008_rls_enabled_no_policy/ Â· https://github.com/orgs/supabase/discussions/26584 Â· https://github.com/supabase/cli/issues/3839 Â· https://github.com/supabase/splinter/pull/28

**[15] supashield (Rodrigotari1)** â€” https://github.com/Rodrigotari1/supashield Â· https://raw.githubusercontent.com/Rodrigotari1/supashield/main/README.md Â· https://dev.to/rodrigotari1/i-built-a-cli-to-test-supabase-rls-policies-30aa Â· https://github.com/Rodrigotari1/supashield/releases Â· https://github.com/orgs/supabase/discussions/39954 Â· https://news.ycombinator.com/item?id=45607925 (anno release v0.3.0: unknown â€” fonti discordanti 2025 vs Feb 2026, npm 403)

**[16] VibeAppScanner / VAS** â€” https://vibeappscanner.com/rls-checker Â· https://vibeappscanner.com/ Â· https://vibeappscanner.com/what-is-vibe-app-scanner Â· https://vibeappscanner.com/supabase-security Â· https://vibeappscanner.com/security-issue/lovable-missing-rls Â· https://dev.to/solobillions/i-tested-every-vibe-coding-security-scanner-2026-heres-what-actually-works-p9k (pricing: tier variano fra listing; canonici free / $19 / $99-mo)

**[17] VibeEval** â€” https://vibe-eval.com/supabase-rls-checker/ Â· https://vibe-eval.com/ Â· https://vibe-eval.com/vibe-code-scanner/ Â· https://vibe-eval.com/security/cursor Â· https://vibe-eval.com/backend-security/supabase-rls-guide/

**[18] SecurifyAI Supabase RLS Scanner (Burp ext.)** â€” https://securifyai.co/supabase-rls-scanner-open-source-supabase-security-audit-tool/ Â· https://github.com/Securify-AI/Supabase-RLS-Extension Â· https://securifyai.co/blog/how-to-test-supabase-row-level-security-using-an-open-source-scanner/ Â· https://chromewebstore.google.com/detail/supaexplorer-supabase-api/fggagnanncngmpachliaplleicdjdplp

**[19] supabase-ai-rls-tests-generator (renantrendt)** â€” https://github.com/renantrendt/supabase-ai-rls-tests-generator Â· https://www.npmjs.com/package/supabase-ai-rls-tests-generator Â· https://registry.npmjs.org/supabase-ai-rls-tests-generator

**[20] SupaRalph (vibeship-suparalph)** â€” https://github.com/vibeforge1111/vibeship-suparalph Â· https://raw.githubusercontent.com/vibeforge1111/vibeship-suparalph/main/README.md Â· https://suparalph.vibeship.co/ Â· https://github.com/vibeforge1111/vibeship-scanner Â· https://github.com/vibeforge1111

**[21] Supabase Agent Skills** â€” https://github.com/supabase/agent-skills Â· https://github.com/supabase/agent-skills/blob/main/skills/supabase/SKILL.md Â· https://github.com/supabase/agent-skills/blob/main/skills/supabase-postgres-best-practices/SKILL.md Â· https://github.com/supabase/agent-skills/blob/main/skills/supabase-postgres-best-practices/references/security-rls-basics.md Â· https://supabase.com/blog/supabase-agent-skills Â· https://supabase.com/blog/postgres-best-practices-for-ai-agents

**[22] Supaguard** â€” https://www.supaguard.pro/ Â· https://www.producthunt.com/products/supaguard Â· https://huntscreens.com/en/products/supaguard Â· https://supaguard.dev/ (confidence: medium; prezzo PRO mensile: unknown / non pubblicato in testo indicizzabile)

**[23] hand-dot/supabase-rls-checker** â€” https://github.com/hand-dot/supabase-rls-checker Â· https://deepwiki.com/hand-dot/supabase-rls-checker Â· https://chromewebstore.google.com/detail/supabase-rls-checker/mklgkhbdilmbfjnnclabobnledggcada Â· https://github.com/hand-dot/supabase-rls-checker/releases Â· https://chrome-stats.com/d/mklgkhbdilmbfjnnclabobnledggcada

**[24] sahilahluwalia/Supabase-RLS-Checker** â€” https://github.com/sahilahluwalia/Supabase-RLS-Checker Â· https://raw.githubusercontent.com/sahilahluwalia/Supabase-RLS-Checker/main/README.md Â· https://api.github.com/repos/sahilahluwalia/Supabase-RLS-Checker Â· https://supabase-checker.sahilahluwalia.com/ (no LICENSE, last push 2025-08-24, dormiente)
