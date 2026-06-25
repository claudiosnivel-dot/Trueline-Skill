// =============================================================================
// AT-1 FASE A BUILD WORKFLOW — il controllo 4 esegue i target_test per-AC
// -----------------------------------------------------------------------------
// Esegue le ONDATE W1->W4 del plan docs/superpowers/plans/2026-06-25-at-1a-control4-runs-target-tests.md
// (un builder per task + verifica adversariale Opus k=2; git SOLO nell'orchestratore).
//
// W5/T3.1 (provisioning .git dei fixture + harness keystone + no-regressione SERIALE
// + merge) NON e' nel workflow: gli agenti non toccano git (L-COL-024). Dopo che il
// workflow ritorna, l'ORCHESTRATORE (prossima sessione) esegue T3.1 a mano:
//   1) bash eval/anti-tamper/provision_fixtures.sh  (inner-.git dei fixture)
//   2) node eval/harness/anti_tamper_check.mjs  -> exit 0 (keystone) + falsificabilita'
//   3) no-regressione SERIALE: build_discipline_check, m5 56/56, ecosystem_conformance
//      (5 pack), run_eval, package_skill lint  -> tutti VERDE; 0-contaminazione
//   4) commit logici gia' fatti dagli step (qui solo il merge) -> merge human-gated su main
//
// LANCIO (prossima sessione, dopo PROMPT-SESSION-START + "vai"):
//   Workflow({ scriptPath: "<repo>/docs/superpowers/workflows/2026-06-25-at-1a-build.js" })
// Consigliata prima del lancio: rilettura del plan (e' code-complete, 8 task TDD).
// =============================================================================

export const meta = {
  name: 'at-1a-build',
  description: 'Build AT-1 Fase A (controllo 4 esegue i target_test per-AC) ondate W1->W4: loader replicato + run_file (node --test) + ramo AC-acceptance in control4 + plumbing run_checkpoint/run_loop + fixture node:test + harness. Builder + verifica Opus k=2; git solo nell orchestratore (T3.1 fuori dal workflow).',
  phases: [
    { title: 'W1', detail: 'A1 loader || A2 run_file || A3 manifest run_file || A7 fixture files' },
    { title: 'W2', detail: 'A4 ramo AC-acceptance in control4 (build+--blueprint, precedenza, floor anti-vacuo)' },
    { title: 'W3', detail: 'A5 run_checkpoint --blueprint || A6 run_loop forwarding' },
    { title: 'W4', detail: 'A8 harness anti_tamper_check (keystone; micro-gate = exit-2 precondizione pre-.git)' },
  ],
}

const PLAN = 'docs/superpowers/plans/2026-06-25-at-1a-control4-runs-target-tests.md'
const SPEC = 'docs/superpowers/specs/2026-06-25-anti-tamper-control4-design.md'

const INVARIANTS = `INVARIANTI DI BUILD (Trueline, vincolanti):
- Node ESM, SOLO moduli built-in (+ moduli trueline/scripts dep-free). Niente npm install di rete.
- DETERMINISMO (L-COL-002): niente Date.now()/Math.random() in codice gate-eseguito; RUN_OPTS.createdAt='1970-01-01T00:00:00.000Z'; ordine di scansione stabile (.sort()).
- Prosa/commenti in ITALIANO; identificatori/name/schemi in INGLESE.
- Scrivi i file nel working tree, ma NON eseguire ALCUN comando git (l'orchestratore possiede git, L-COL-024). Niente commit/branch/checkout/reset/add/init.
- Oracle-as-judge (L-COL-002): il "verde" e' l'exit/output reale di un comando, MAI una tua frase.
- BIT-invarianza: senza --blueprint, il checkpoint e' BYTE-IDENTICO a oggi (m5 56/56 invariato). Ogni cambio e' ADDITIVO con default legacy.
- Onesta' (L-COL-006): VERDE controllo 4 = (file in scope ∧ >=1 test eseguito ∧ esce 0); NON implica che l'asserzione eserciti l'AC.
- run_file v1 = "node --test {file}" (zero-install); spawnSync ARRAY-ARGV (no shell).
- Loader: validate_blueprint NON esporta nulla -> il modulo nuovo blueprint_tasks.mjs REPLICA il loader (da ac_observability_check); NON toccare validate_blueprint/ac_observability_check.
Leggi il plan ${PLAN} (code-complete, segui i passi TDD del task) e la spec ${SPEC} per il contesto.`

const TASK_RESULT = {
  type: 'object',
  required: ['task', 'files_written', 'gate_cmd', 'gate_exit', 'gate_pass', 'summary'],
  properties: {
    task: { type: 'string' },
    files_written: { type: 'array', items: { type: 'string' } },
    gate_cmd: { type: 'string', description: 'il comando esatto del micro-gate del task (i test TDD del plan)' },
    gate_exit: { type: 'number' },
    gate_pass: { type: 'boolean' },
    falsifiability: { type: 'string', description: 'come hai mostrato che il gate e\' falsificabile (rompi -> FAIL -> ripristina -> PASS), o n/a' },
    summary: { type: 'string' },
  },
}

const VERIFY = {
  type: 'object',
  required: ['gate_reproduced_pass', 'gamed', 'reasoning'],
  properties: {
    gate_reproduced_pass: { type: 'boolean', description: 'hai RI-ESEGUITO il micro-gate e passa come dichiarato' },
    gamed: { type: 'boolean', description: 'true se il task gioca il gate (gate indebolito/tautologico, output finto, git toccato, Date.now/Math.random, BIT-invarianza rotta, default-path alterato)' },
    falsifiable_confirmed: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
}

async function buildVerify(taskKey, phase, buildPrompt) {
  const built = await agent(`${INVARIANTS}\n\n=== TASK ${taskKey} ===\n${buildPrompt}\n\nSegui i passi TDD del task nel plan. Dopo aver scritto i file, ESEGUI il micro-gate del task riportando comando esatto + exit. Ritorna TASK_RESULT.`,
    { label: `build:${taskKey}`, phase, schema: TASK_RESULT })
  if (!built) return { taskKey, built: null, verifiedOk: false, votes: [] }
  const votes = await parallel([0, 1].map((v) => () =>
    agent(`Sei un verificatore adversariale Opus (k=2) per Trueline AT-1 Fase A, task ${taskKey}. Repo root = working dir. Il builder dichiara: file=${JSON.stringify(built.files_written)}; gate_cmd=\`${built.gate_cmd}\`; gate_exit=${built.gate_exit}; gate_pass=${built.gate_pass}.\n\n${INVARIANTS}\n\nIl tuo compito: (1) RI-ESEGUI tu stesso il gate command e osserva l'exit; (2) cerca il GAMING — gate indebolito/tautologico, output finto, git toccato, Date.now/Math.random, e SOPRATTUTTO la BIT-invarianza (un cambio a checkpoint/run_loop NON deve alterare il default-path: prova \`node eval/harness/m1_gate_check.mjs\` exit 0 dopo aver pulito eval/.tmp-verify); (3) dove applicabile conferma la falsificabilita'. Default scettico. Ritorna VERDICT.`,
      { label: `verify:${taskKey}.${v + 1}`, phase, schema: VERIFY })
  ))
  const real = votes.filter(Boolean)
  const verifiedOk = real.length >= 2 && real.filter((x) => x.gate_reproduced_pass && !x.gamed).length >= 2
  return { taskKey, built, votes: real, verifiedOk }
}

// ---------------------------------------------------------------------------
const A1 = `Costruisci A1 — \`trueline/scripts/blueprint/blueprint_tasks.mjs\` (loader REPLICATO + esportato) + test. REPLICA verbatim extractYamlBlocks+parseTasks+loadAllTasks+nonEmptyStr da \`trueline/scripts/blueprint/ac_observability_check.mjs\`; esporta \`loadTasks(dir)\` che normalizza \`covers\` ad array (scalar->[scalar]). MICRO-GATE: \`node --test trueline/scripts/blueprint/blueprint_tasks.test.mjs\` PASS. NON toccare validate_blueprint/ac_observability_check.`
const A2 = `Costruisci A2 — \`trueline/scripts/checkpoint/run_file.mjs\` (\`runTargetFile(appDir,file,template)->{error,testCount,passed,detail}\`) + test. Esegue "node --test {file}" via spawnSync ARRAY-ARGV (no shell), cwd=app, PATH+GO_BIN; parsa il riassunto TAP (\`# tests N\`/\`# fail N\`). MICRO-GATE: \`node --test trueline/scripts/checkpoint/run_file.test.mjs\` PASS (3 test: passa / vuoto=testCount 0 / fallisce).`
const A3 = `Costruisci A3 — aggiungi \`"run_file": "node --test {file}"\` a \`test_runner\` in \`trueline/references/ecosystems/supabase-jsts/ecosystem.json\` (additivo, non rimuovere \`detect\`). MICRO-GATE: \`node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/supabase-jsts/ecosystem.json\` exit 0.`
const A7 = `Costruisci A7 (SOLO i FILE; l'inner-.git lo fa l'orchestratore) — i 4 fixture \`eval/anti-tamper/{faithful,failing,empty,partial}/{reference-app,seeded-blueprint}\` con file \`node:test\` reali (package.json type:module, tests/a.test.mjs, seeded-blueprint/01.md nel formato di eval/seeded-blueprint/01-prenotazioni.md; faithful=passa, failing=fallisce, empty=nessun test(), partial=2 target_test ma 1 solo file su disco). Aggiungi a \`.gitignore\` la riga \`eval/anti-tamper/*/reference-app/\`. CREA \`eval/anti-tamper/provision_fixtures.sh\` (mirror di eval/build-discipline/provision_fixtures.sh: git init + commit dei soli sorgenti, idempotente) ma NON eseguirlo. MICRO-GATE: per ogni fixture \`node --test eval/anti-tamper/<id>/reference-app/tests/a.test.mjs\` si comporta come atteso (faithful exit 0; failing exit !=0; empty 0 test) e \`node trueline/scripts/blueprint/validate_blueprint.mjs eval/anti-tamper/<id>/seeded-blueprint --json\` exit 0.`
const A4 = `Costruisci A4 — il ramo AC-acceptance in \`trueline/scripts/checkpoint/checkpoint.mjs::control4Conformance\` (firma +blueprintDir=null,+manifest=null; ramo SOLO se mode==='build' && blueprintDir && manifest.test_runner.run_file, PRIMA del ramo characterization -> PREEMPTA; risolve inScope=target_test il cui file esiste, .sort(); inScope vuoto->degradato; per ciascuno runTargetFile, testCount<1->RED vacuo, !passed->RED, error->status error) + \`runCheckpoint\` passa blueprintDir+manifest a control4. Importa loadTasks (A1) e runTargetFile (A2). + test \`control4_ac.test.mjs\`. MICRO-GATE: \`node --test trueline/scripts/checkpoint/control4_ac.test.mjs\` PASS (6 test) E BIT-invarianza \`node eval/harness/m1_gate_check.mjs\` exit 0 (pulisci eval/.tmp-verify prima).`
const A5 = `Costruisci A5 — plumbing \`--blueprint\` in \`trueline/scripts/checkpoint/run_checkpoint.mjs\` (parseArgs +case --blueprint -> flags.blueprint default null; runOn destruttura+propaga blueprintDir a runCheckpoint, anche nel retry measureAttempts; le 2 chiamate a runOn passano blueprint:flags.blueprint) + test \`run_checkpoint_args.test.mjs\`. MICRO-GATE: \`node --test trueline/scripts/checkpoint/run_checkpoint_args.test.mjs\` PASS.`
const A6 = `Costruisci A6 — in \`trueline/scripts/loop/run_loop.mjs\` la chiamata \`runCheckpoint(ws.dir, {...})\` (cerca \`runCheckpoint(\`) passa \`blueprintDir\` (gia' letto dal flag --blueprint). MICRO-GATE: BIT-invarianza senza flag — \`node trueline/scripts/loop/run_loop.mjs --eval --mode=remediate\` exit 0, shape del report invariata; \`node eval/harness/m1_gate_check.mjs\` exit 0 (pulisci eval/.tmp-verify prima).`
const A8 = `Costruisci A8 — \`eval/harness/anti_tamper_check.mjs\` (mirror di eval/harness/build_discipline_check.mjs: radice temp PRIVATA per-pid eval/.tmp-at-<pid>, cleanup never-throw, copia isolata per-fixture, assert(name,ok,detail), driva il binario SPEDITO \`node trueline/scripts/checkpoint/run_checkpoint.mjs --in-place <copia> --blueprint <bp> --mode build\` e asserisce controls[3].green; sotto-test faithful/failing/empty/partial/not-built/flag-not-disk/0-contaminazione; PRECONDIZIONE: se i .git dei fixture mancano -> banner + process.exit(2)). NOTA: in questo workflow i .git dei fixture NON sono ancora provisionati (lo fa l'orchestratore in T3.1) -> il MICRO-GATE qui e': \`node eval/harness/anti_tamper_check.mjs\` esce **2** (precondizione .git assente) con banner, NON un falso verde ne' un crash. (Il gate pieno exit 0 lo eseguira' l'orchestratore dopo provision_fixtures.sh.)`

// ---------------------------------------------------------------------------
phase('W1')
log('W1 — A1 loader || A2 run_file || A3 manifest || A7 fixture files')
const w1 = await parallel([
  () => buildVerify('A1', 'W1', A1),
  () => buildVerify('A2', 'W1', A2),
  () => buildVerify('A3', 'W1', A3),
  () => buildVerify('A7', 'W1', A7),
])
const w1ok = w1.every((r) => r && r.verifiedOk)
log(`W1 ${w1ok ? 'VERDE' : 'NON-VERDE'} — ${w1.map((r) => `${r.taskKey}:${r.verifiedOk ? 'ok' : 'KO'}`).join(' ')}`)
if (!w1ok) return { stopped_at: 'W1', w1 }

phase('W2')
log('W2 — A4 ramo AC-acceptance in control4')
const a4 = await buildVerify('A4', 'W2', A4)
if (!a4.verifiedOk) { log('W2 NON-VERDE'); return { stopped_at: 'W2', w1, a4 } }

phase('W3')
log('W3 — A5 run_checkpoint --blueprint || A6 run_loop forwarding')
const w3 = await parallel([
  () => buildVerify('A5', 'W3', A5),
  () => buildVerify('A6', 'W3', A6),
])
const w3ok = w3.every((r) => r && r.verifiedOk)
log(`W3 ${w3ok ? 'VERDE' : 'NON-VERDE'}`)
if (!w3ok) return { stopped_at: 'W3', w1, a4, w3 }

phase('W4')
log('W4 — A8 harness anti_tamper_check (micro-gate = exit-2 precondizione pre-.git)')
const a8 = await buildVerify('A8', 'W4', A8)
log(`W4 ${a8.verifiedOk ? 'VERDE' : 'NON-VERDE'}`)

return {
  done: a8.verifiedOk,
  next_step: a8.verifiedOk
    ? 'ORCHESTRATORE (T3.1, SERIALE, fuori-workflow): (1) bash eval/anti-tamper/provision_fixtures.sh; (2) node eval/harness/anti_tamper_check.mjs -> exit 0 (keystone) + falsificabilita\'; (3) no-regressione SERIALE: build_discipline_check 21/21, m5 56/56, ecosystem_conformance 5 pack, run_eval, package_skill lint VERDE, 0-contaminazione; (4) commit logici + merge human-gated su main (L-COL-024). Poi: plan Fase B (trace-check AC<->tag).'
    : 'W4 non verde: ispeziona a8 prima di T3.1.',
  results: { w1, a4, w3, a8 },
}
