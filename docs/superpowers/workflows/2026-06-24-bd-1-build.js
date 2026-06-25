// =============================================================================
// BD-1 BUILD WORKFLOW — disciplina di costruzione per la modalita BUILD
// -----------------------------------------------------------------------------
// Esegue le ONDATE W1->W4 del piano docs/superpowers/plans/2026-06-24-build-discipline.md
// (un builder per task + verifica adversariale Opus k=2; git SOLO nell'orchestratore).
//
// W5 (T3.1 = integrazione seriale + git/merge + ledger L-COL-031) NON e' in questo
// workflow: gli agenti non toccano git (L-COL-024). Dopo che il workflow ritorna VERDE,
// l'ORCHESTRATORE (main loop, prossima sessione) esegue T3.1 a mano.
//
// LANCIO (prossima sessione):
//   Workflow({ scriptPath: "<repo>/docs/superpowers/workflows/2026-06-24-bd-1-build.js" })
// Opzionale prima del lancio: review adversariale del piano (consigliata in BD-1).
// =============================================================================

export const meta = {
  name: 'bd-1-build',
  description: 'Build BD-1 (disciplina di costruzione BUILD) ondate W1->W4: ac_observability_check + reference/wiring + 3 fixture + run_loop build-path + harness keystone. Builder + verifica Opus k=2; git solo nell orchestratore (W5/T3.1 fuori dal workflow).',
  phases: [
    { title: 'W1', detail: 'T1.1 ac_observability_check (oracolo sibling) || T1.2 reference build-discipline.md + wiring' },
    { title: 'W2', detail: 'T1.3 i 3 fixture eval/build-discipline/ + .gitignore' },
    { title: 'W3', detail: 'T2.1 path build-discipline in run_loop (--fixture-app/--blueprint) + tidyAdvisory non-gate' },
    { title: 'W4', detail: 'T2.2 harness build_discipline_check (keystone) — 3 sotto-test falsificabili' },
  ],
}

const PLAN = 'docs/superpowers/plans/2026-06-24-build-discipline.md'
const SPEC = 'docs/superpowers/specs/2026-06-24-build-discipline-design.md'

const INVARIANTS = `INVARIANTI DI BUILD (Trueline, vincolanti):
- Node ESM, SOLO moduli built-in (+ moduli trueline/scripts dep-free). Niente npm install di rete.
- DETERMINISMO (L-COL-002): niente Date.now()/Math.random() in codice gate-eseguito; id temp = pid+contatore; RUN_OPTS.createdAt = '1970-01-01T00:00:00.000Z'.
- Prosa/commenti in ITALIANO; identificatori/name/schemi in INGLESE.
- Scrivi i file nel working tree, ma NON eseguire ALCUN comando git (l'orchestratore possiede git, L-COL-024). Niente commit/branch/checkout/reset/add.
- Oracle-as-judge (L-COL-002): il "verde" e' l'exit/output reale di un comando, MAI una tua frase. L'unico gate nuovo (ac_observability_check) e' deterministico.
- Advisory MAI gate (L-COL-006): il tidy self-check non entra MAI negli input di runCheckpoint.
- Corpo SKILL.md < ~500 righe, zero logica: l'unico edit al corpo e' UNA riga nella dispatch-table §2 (L-COL-014/L-COL-029).
- Default-path invariante: ogni cambio a run_loop/verify_workspace e' eval-only e ADDITIVO; senza i flag nuovi, output bit-identico (m1..m5 invariati).
- Mai rivendicare "pulito/elegante" come verificato; mai "sicuro".
Leggi il piano ${PLAN} e la spec ${SPEC} per il contesto pieno prima di scrivere.`

const TASK_RESULT = {
  type: 'object',
  required: ['task', 'files_written', 'gate_cmd', 'gate_exit', 'gate_pass', 'summary'],
  properties: {
    task: { type: 'string' },
    files_written: { type: 'array', items: { type: 'string' }, description: 'paths created/modified (relative to repo root)' },
    gate_cmd: { type: 'string', description: 'the exact shell command of the micro-gate you ran' },
    gate_exit: { type: 'number', description: 'exit code observed' },
    gate_pass: { type: 'boolean', description: 'did the micro-gate pass per the plan GATE column' },
    falsifiability: { type: 'string', description: 'how you demonstrated the gate is falsifiable (neutralize -> FAIL -> restore -> PASS), or n/a' },
    summary: { type: 'string' },
  },
}

const VERIFY = {
  type: 'object',
  required: ['gate_reproduced_pass', 'gamed', 'reasoning'],
  properties: {
    gate_reproduced_pass: { type: 'boolean', description: 'you independently RE-RAN the gate command and it passed as claimed' },
    gamed: { type: 'boolean', description: 'true if the work games the gate (weakened gate, hardcoded/tautological, faked output, git touched, Date.now/Math.random, or gate not actually falsifiable)' },
    falsifiable_confirmed: { type: 'boolean', description: 'you confirmed the neutralize->FAIL->restore->PASS where applicable' },
    reasoning: { type: 'string' },
  },
}

async function buildVerify(taskKey, phase, buildPrompt) {
  const built = await agent(`${INVARIANTS}\n\n=== TASK ${taskKey} ===\n${buildPrompt}\n\nDopo aver scritto i file, ESEGUI il micro-gate del task (la colonna GATE del piano), riportando comando esatto + exit. Ritorna TASK_RESULT.`,
    { label: `build:${taskKey}`, phase, schema: TASK_RESULT })
  if (!built) return { taskKey, built: null, verifiedOk: false, votes: [] }
  const votes = await parallel([0, 1].map((v) => () =>
    agent(`Sei un verificatore adversariale Opus (k=2) per Trueline BD-1, task ${taskKey}. Repo root = working dir. Il builder dichiara: file=${JSON.stringify(built.files_written)}; gate_cmd=\`${built.gate_cmd}\`; gate_pass=${built.gate_pass}; falsifiability=${built.falsifiability || 'n/a'}.\n\n${INVARIANTS}\n\nIl tuo compito: (1) RI-ESEGUI tu stesso il gate command e osserva l'exit; (2) cerca il GAMING — gate indebolito, asserzione tautologica/hardcoded, output finto, git toccato, Date.now/Math.random introdotti, file fuori scope, oppure il gate NON realmente falsificabile; (3) dove applicabile, conferma la falsificabilita (neutralizza il fix -> il gate DEVE fallire -> ripristina -> passa) su una COPIA temporanea o ripristinando, MAI lasciando il working tree sporco e MAI usando git. Default scettico: se non riesci a riprodurre il PASS pulito, gate_reproduced_pass=false. Ritorna VERDICT.`,
      { label: `verify:${taskKey}.${v + 1}`, phase, schema: VERIFY })
  ))
  const real = votes.filter(Boolean)
  const verifiedOk = real.length >= 2 && real.filter((x) => x.gate_reproduced_pass && !x.gamed).length >= 2
  return { taskKey, built, votes: real, verifiedOk }
}

// ---------------------------------------------------------------------------
const T1_1 = `Costruisci T1.1 — l'oracolo sibling \`trueline/scripts/blueprint/ac_observability_check.mjs\` (NON modificare validate_blueprint ne lo schema del task).
- SPECCHIA \`trueline/scripts/blueprint/validate_blueprint.mjs\`: stessi import built-in, riusa il loader (extractYamlBlocks + loadAllTasks + nonEmptyStr) o replica la sua logica; CLI \`node ac_observability_check.mjs [dir] [--json]\`; default dir = eval/seeded-blueprint; report JSON \`{ tool:'ac_observability_check', blueprint_dir, task_count, ok, checks:[{name,ok,detail}] }\`; \`process.exit(allOk?0:1)\`.
- CHECK unico \`(1) AC_OBSERVABILITY\`: per ogni task, per ogni \`acceptance_criteria[].then\`, FAIL se il \`then\` contiene (substring, case-insensitive) uno dei token vietati VERBATIM di self-check-checklist.md §6: "funziona bene", "robusto", "sicuro", "performante", "user-friendly". detail = elenco \`task_id/ac_id\` offensivi, separati da ' | '.
- MICRO-GATE: \`node trueline/scripts/blueprint/ac_observability_check.mjs eval/seeded-blueprint --json\` DEVE uscire 0 (ok:true: il blueprint canonico non ha token vietati). FALSIFICABILITA: crea in una dir temporanea (poi RIMUOVILA) un blueprint con un \`then: "il sistema funziona bene"\` e verifica exit 1; ripristina. NON toccare git.`

const T1_2 = `Costruisci T1.2 — reference della disciplina + wiring (sorgente di spec §5.1-5.3 e §5.5).
- CREA \`trueline/references/build-discipline.md\`: i 3 momenti della costruzione (Think-Before / test-first-che-traduce-l-AC / scrittura minima-e-chirurgica) + la disciplina di fix root-cause-before-patch (§5.2bis) + il confine oracle-as-judge (§5.3) + attribuzione MIT alle linee guida Karpathy (forrestchang/multica-ai).
- MODIFICA \`trueline/references/modes/build.md\`: aggiungi la riga \`references/build-discipline.md\` alla tabella "Reference caricati in BUILD"; espandi lo step 2 "Costruisce i task atomici" coi 3 momenti; aggiungi i bullet di SCRITTURA alla sezione "## Disciplina BUILD" con la linea "questi guidano la scrittura, l'oracolo resta il giudice".
- MODIFICA \`trueline/SKILL.md\` §2 (dispatch-table per-modalita): aggiungi UNA riga \`references/build-discipline.md\` (BUILD si, REMEDIATE si) nello STESSO formato delle righe esistenti. Nessun'altra logica nel corpo. Verifica che SKILL.md resti < 500 righe.
- MODIFICA \`02-SKILL-ANATOMY.md\` §6 (lista di caricamento per-modalita) e \`trueline/references/modes/remediate.md\` (nota: in REMEDIATE attivi i momenti 1+3 + la disciplina di fix; il momento 2 test-first e' superato dalla baseline di caratterizzazione).
- MICRO-GATE: esegui il lint strutturale di packaging (trova lo script, cfr. 09 §3 — es. \`node trueline/scripts/package/package_skill.mjs --lint\` o l'entry reale; leggilo) e verifica VERDE (file referenziato esiste, 0 riferimenti orfani); verifica \`SKILL.md\` < 500 righe. NON toccare git.`

const T1_3 = `Costruisci T1.3 — i 3 fixture sotto \`eval/build-discipline/\` (gated su T1.1: l'oracolo ac_observability_check esiste gia').
Per OGNI fixture crea \`reference-app/\` (mirror minimale di eval/reference-app: package.json type:module, tsconfig.json, knip.json con entry src/index.ts, src/index.ts + file necessari) e \`seeded-blueprint/\` (dir di *.md con un blocco \`\`\`yaml, shape identica a eval/seeded-blueprint/01-prenotazioni.md: id/title/macrotask/depends_on/objective/definition_of_done/acceptance_criteria[given,when,then]/target_tests[file,covers]).
- \`overcomplicated-correct/\`: implementazione CORRETTA ma SOVRA-ASTRATTA (es. >=3 classi/strategy per un compito banale); i target_tests passano; zero dead-code/vuln/regressione nuovi.
- \`orphan-injecting/\`: come sopra MA con un export NUOVO inutilizzato (specchio di src/legacy/unused.ts / S8) raggiungibile-da-nessuno dall'entry knip.
- \`ambiguous-ac/\`: seeded-blueprint STRUTTURALMENTE VALIDO (passa validate_blueprint) ma con un \`then:\` che contiene un token vietato (es. "il sistema funziona bene").
- MODIFICA \`.gitignore\` (root): aggiungi \`eval/build-discipline/*/reference-app/\` (le reference-app sono inner-repo/node_modules); i \`seeded-blueprint/\` restano TRACKED.
- PROVVIGIONAMENTO OFFLINE DELLE DIPENDENZE (VINCOLANTE — niente npm install di rete, L-COL-002/build-invariants): ogni \`reference-app/\` DEVE avere \`knip\` e \`typescript\` dentro il PROPRIO \`node_modules\`, perche' (a) \`run_deadcode\`/knip si risolve PER-PROGETTO da \`<dir>/node_modules/knip/bin/knip.js\` (o \`.bin/knip\`) e (b) il typecheck usa il \`tsc\` locale (\`<dir>/node_modules/.bin/tsc\`). Provvigionali COPIANDO dal canonico \`eval/reference-app/node_modules\` — che li porta gia' offline (\`knip\`, \`typescript\`, e gli shim in \`.bin\`) — es. \`cpSync\` dell'intero \`node_modules\` nel fixture, oppure copia mirata di \`knip\`+\`typescript\`+\`.bin\`. MAI \`npm install\`/\`npx --install\` di rete; MAI dipendere da un knip/tsc globale. Le \`node_modules\` dei fixture sono gitignorate (riga \`.gitignore\` sopra), quindi la copia non sporca il tracked.
- MICRO-GATE: per i 3 \`seeded-blueprint\` -> \`node trueline/scripts/blueprint/validate_blueprint.mjs <dir> --json\` exit 0 (tutti strutturalmente validi); \`node trueline/scripts/blueprint/ac_observability_check.mjs <ambiguous-ac/seeded-blueprint> --json\` exit 1, mentre sugli altri due exit 0; ogni reference-app typecheck/build OK (con le dipendenze provvigionate per copia, come sopra) — verifica esplicitamente che \`run_deadcode\` giri sul fixture (\`node trueline/scripts/oracles/run_deadcode.mjs <reference-app>\` risolve il binario knip locale). NON toccare git.`

const T2_1 = `Costruisci T2.1 — path build-discipline ADDITIVO in run_loop + tidyAdvisory (gated su T1.3).
- CREA \`trueline/scripts/loop/build_discipline.mjs\`: export \`tidyAdvisory(referenceApp, { runOpts })\` -> \`{ advisory:true, complexity_flag:boolean, notes:[...] }\`. Segnale DETERMINISTICO di complessita (es. conteggio di marcatori di sovra-astrazione: \`class \`/\`abstract \`/\`interface \` per file oltre soglia). NIENTE Date.now/Math.random.
- MODIFICA \`trueline/scripts/loop/verify_workspace.mjs\`: aggiungi parametro ADDITIVO \`sourceApp\` a \`createVerifyWorkspace\` (default = CANONICAL_REFERENCE_APP); i guardrail di destroyVerifyWorkspace restano invariati.
- MODIFICA \`trueline/scripts/loop/run_loop.mjs\`: aggiungi i flag eval-only \`--fixture-app=<dir>\` (passato come sourceApp a createVerifyWorkspace) e \`--blueprint=<dir>\`; nel path build con questi flag, calcola \`tidyAdvisory\` e attaccalo a \`report.build_discipline\`. SENZA i flag, comportamento IDENTICO a oggi.
- MICRO-GATE: (1) DEFAULT BIT-INVARIANTE: \`node trueline/scripts/loop/run_loop.mjs --eval --mode=remediate\` produce JSON con shape invariata e il gate m1 resta verde (\`node eval/harness/m1_gate_check.mjs\` exit 0); (2) con \`--fixture-app=<copia overcomplicated-correct>\`: report.build_discipline.advisory===true && report.build_discipline.complexity_flag===true E report.checkpoint.green===true SIMULTANEAMENTE (advisory NON e' input di runCheckpoint); (3) con \`--fixture-app=<copia orphan-injecting>\`: report.checkpoint.controls[0].green===false (control1 dead-code). Usa copie isolate. NON toccare git.`

const T2_2 = `Costruisci T2.2 (KEYSTONE) — l'harness \`eval/harness/build_discipline_check.mjs\` (gated su T1.1,T1.2,T1.3,T2.1).
- SPECCHIA \`eval/harness/m5_gate_check.mjs\` / \`eval/harness/ecosystem_conformance.mjs\`: shebang + import built-in + ROOT = resolve(__dirname,'..','..'); \`cleanupAllVerifyWorkspaces()\` in testa; helper \`nodeRun\` (spawnSync, PATH+GO_BIN), \`assert(name,ok,detail)\` con checks[], tally finale \`process.exit(allOk?0:1)\`; copia isolata per-fixture via \`copyPackFixture\`-style (id pid+contatore, .git incluso) sotto eval/.tmp-verify; assertIsolatedRepo inline (toplevel copia != ROOT e != fixture originale); assertHygiene (fixture bit-identica, HEAD interno+ESTERNO invariati).
- ASSERZIONI (i 3 sotto-test falsificabili della spec §7), guidando run_loop --eval --mode=build --fixture-app/--blueprint per fixture:
  (a) overcomplicated-correct -> advisory_flag===true && cp.green===true (advisory non-gate).
  (b) orphan-injecting -> checkpoint control1 (dead-code) FAIL; rimosso l'orfano sulla COPIA -> verde (falsificabile).
  (c) ambiguous-ac -> ac_observability_check FAIL mentre validate_blueprint PASS (i due oracoli ortogonali).
- EXIT 0/1/2 (2 = precondizione, es. test-runner assente -> banner + process.exit(2), mai falso verde). NON includere la no-regressione integrale pesante (e' T3.1 seriale dell'orchestratore).
- MICRO-GATE: \`node eval/harness/build_discipline_check.mjs\` esce 0 con tutti i sotto-test PASS, ed e' falsificabile (neutralizza un sotto-test su copia -> FAIL -> ripristino). NON toccare git.`

// ---------------------------------------------------------------------------
phase('W1')
log('W1 — T1.1 (ac_observability_check) || T1.2 (reference + wiring)')
const w1 = await parallel([
  () => buildVerify('T1.1', 'W1', T1_1),
  () => buildVerify('T1.2', 'W1', T1_2),
])
const w1ok = w1.every((r) => r && r.verifiedOk)
log(`W1 ${w1ok ? 'VERDE' : 'NON-VERDE'} — ${w1.map((r) => `${r.taskKey}:${r.verifiedOk ? 'ok' : 'KO'}`).join(' ')}`)
if (!w1ok) return { stopped_at: 'W1', w1 }

phase('W2')
log('W2 — T1.3 (3 fixture)')
const t13 = await buildVerify('T1.3', 'W2', T1_3)
if (!t13.verifiedOk) { log('W2 NON-VERDE'); return { stopped_at: 'W2', w1, t13 } }

phase('W3')
log('W3 — T2.1 (run_loop build-path + tidyAdvisory)')
const t21 = await buildVerify('T2.1', 'W3', T2_1)
if (!t21.verifiedOk) { log('W3 NON-VERDE'); return { stopped_at: 'W3', w1, t13, t21 } }

phase('W4')
log('W4 — T2.2 (harness build_discipline_check, keystone)')
const t22 = await buildVerify('T2.2', 'W4', T2_2)
log(`W4 ${t22.verifiedOk ? 'VERDE' : 'NON-VERDE'}`)

return {
  done: t22.verifiedOk,
  next_step: t22.verifiedOk
    ? 'ORCHESTRATORE (main loop): esegui W5/T3.1 — riesecuzione SERIALE del gate integrale (build_discipline_check + falsificabilita + no-regressione m5 56/56, m1..m4, ecosystem_conformance tutti i pack, run_eval, package_skill lint) + 0-contaminazione, poi commit logici, ledger L-COL-031 in 00-INDEX, SESSION-STATE, merge human-gated su main (L-COL-024).'
    : 'W4 non verde: ispeziona t22 prima di T3.1.',
  results: { w1, t13, t21, t22 },
}
