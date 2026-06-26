// =============================================================================
// AT-1 FASE B BUILD WORKFLOW — trace-check AC<->tag covers (anti-tamper provenienza)
// -----------------------------------------------------------------------------
// Esegue le ONDATE del plan docs/superpowers/plans/2026-06-26-at-1b-trace-check.md
// (un builder per task + verifica adversariale Opus k=2; git SOLO nell'orchestratore).
//
// DAG REALE (corretto rispetto alla 1a bozza): fixture_trace_check (T2) importa
// textTracesAc da T1, e checkpoint.trace.test (T4) usa le fixture di T2 ->
//   W1: T1 checker  ||  T3 doc          (indipendenti)
//   W2: T2 fixture  (dipende da T1)
//   W3: T4 wiring   (dipende da T1, T2)
//   W4: T5 keystone (dipende da T1, T2, T4) — micro-gate = exit-2 precondizione
//                    (i .git dei fixture nuovi NON sono ancora provisionati)
//
// T6 (orchestratore, SERIALE, FUORI dal workflow; gli agenti non toccano git,
// L-COL-024): dopo il ritorno del workflow ->
//   1) bash eval/anti-tamper/provision_fixtures.sh   (inner-.git dei 6 fixture nuovi)
//   2) node eval/harness/anti_tamper_check.mjs  -> exit 0 (keystone A+B) + falsificabilita'
//   3) no-regressione SERIALE: fixture_trace_check, checkpoint.trace.test, build_discipline_check 21/21,
//      m5 56/56, ecosystem_conformance (5 pack), package_skill lint VERDE; 0-contaminazione
//   4) emendamento L-COL-032 (braccio trace-check -> locked) + SESSION-STATE
//   5) merge human-gated su main (L-COL-024)
//
// LANCIO: Workflow({ scriptPath: "<repo>/docs/superpowers/workflows/2026-06-26-at-1b-build.js" })
// =============================================================================

export const meta = {
  name: 'at-1b-build',
  description: 'Build AT-1 Fase B (trace-check AC<->tag covers, anti-tamper provenienza) ondate W1->W4: checker ac_assertion_trace_check (assertionTrace + textTracesAc string-aware) + 6 fixture trace + convenzione doc + precondizione trace in control4 (RED prima di eseguire, BIT-invariante) + keystone esteso. Builder Opus/Sonnet, verifica Opus k=2; git solo nell orchestratore (T6 fuori dal workflow).',
  phases: [
    { title: 'W1', detail: 'T1 checker ac_assertion_trace_check (Opus) || T3 convenzione doc (Sonnet)' },
    { title: 'W2', detail: 'T2 6 fixture trace + fixture_trace_check (Sonnet)' },
    { title: 'W3', detail: 'T4 precondizione trace in control4 + checkpoint.trace.test (Opus)' },
    { title: 'W4', detail: 'T5 keystone esteso (Opus; micro-gate = exit-2 precondizione pre-.git)' },
  ],
}

const PLAN = 'docs/superpowers/plans/2026-06-26-at-1b-trace-check.md'
const BRIEF = 'docs/superpowers/plans/2026-06-26-at-1b-trace-check-BRIEF.md'
const SPEC = 'docs/superpowers/specs/2026-06-25-anti-tamper-control4-design.md'

const INVARIANTS = `INVARIANTI DI BUILD (Trueline AT-1 Fase B, vincolanti):
- Node ESM, SOLO moduli built-in (+ moduli trueline/scripts dep-free). Niente npm install di rete.
- DETERMINISMO (L-COL-002): niente Date.now()/Math.random() in codice spedito; ordine stabile (.sort()/localeCompare). Negli harness/test e' ammesso process.pid.
- Prosa/commenti in ITALIANO; identificatori/name/chiavi-schema in INGLESE.
- Scrivi i file nel working tree, ma NON eseguire ALCUN comando git (l'orchestratore possiede git, L-COL-024). Niente commit/branch/checkout/reset/add/init/provision_fixtures.sh.
- Oracle-as-judge (L-COL-002): il "verde" e' l'exit/output reale di un comando, MAI una tua frase.
- BIT-invarianza: la precondizione trace vive SOLO nel ramo mode==='build' && blueprintDir && manifest.test_runner.run_file di control4Conformance; il ramo legacy resta BYTE-IDENTICO (m5 56/56 invariato). Ogni cambio e' ADDITIVO.
- RIUSO (no replica): il checker IMPORTA loadTasks da trueline/scripts/blueprint/blueprint_tasks.mjs (gia' su main). NON replicare il parser YAML; NON toccare validate_blueprint/ac_observability_check/blueprint_tasks.
- Onesta' (L-COL-006): la presenza-del-tag e' un FLOOR deterministico, NON prova di fedelta' semantica (advisory).
- string-aware: un // dentro una STRINGA non apre un commento (chiude la gameabilita' tag-in-stringa); id ancorato (AC-1 != AC-10).
Leggi il plan ${PLAN} (CODE-COMPLETE: copia il codice dei passi TDD del tuo task verbatim), il brief ${BRIEF} e la spec ${SPEC} (§5.3/§5.4/§5.5/§7) per il contesto.`

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
    gamed: { type: 'boolean', description: 'true se il task gioca il gate (gate indebolito/tautologico, output finto, git toccato, Date.now/Math.random, BIT-invarianza rotta, default-path alterato, parser replicato invece di importare loadTasks)' },
    falsifiable_confirmed: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
}

async function buildVerify(taskKey, phase, buildPrompt, builderModel, verifyExtra = '') {
  const opts = { label: `build:${taskKey}`, phase, schema: TASK_RESULT }
  if (builderModel) opts.model = builderModel
  const built = await agent(`${INVARIANTS}\n\n=== TASK ${taskKey} ===\n${buildPrompt}\n\nSegui i passi TDD del task nel plan (copia il codice verbatim). Dopo aver scritto i file, ESEGUI il micro-gate del task riportando comando esatto + exit. Ritorna TASK_RESULT.`,
    opts)
  if (!built) return { taskKey, built: null, verifiedOk: false, votes: [] }
  const votes = await parallel([0, 1].map((v) => () =>
    agent(`Sei un verificatore adversariale Opus (k=2) per Trueline AT-1 Fase B, task ${taskKey}. Repo root = working dir. Il builder dichiara: file=${JSON.stringify(built.files_written)}; gate_cmd=\`${built.gate_cmd}\`; gate_exit=${built.gate_exit}; gate_pass=${built.gate_pass}.\n\n${INVARIANTS}\n\nIl tuo compito: (1) RI-ESEGUI tu stesso il gate command e osserva l'exit; (2) cerca il GAMING — gate indebolito/tautologico, output finto, git toccato, Date.now/Math.random, parser YAML replicato (deve IMPORTARE loadTasks), e SOPRATTUTTO la BIT-invarianza (un cambio a checkpoint NON deve alterare il default/legacy-path: pulisci eval/.tmp-verify poi \`node eval/harness/m1_gate_check.mjs\` exit 0); (3) dove applicabile conferma la falsificabilita'. ${verifyExtra} Default scettico. Ritorna VERDICT.`,
      { label: `verify:${taskKey}.${v + 1}`, phase, schema: VERIFY })
  ))
  const real = votes.filter(Boolean)
  const verifiedOk = real.length >= 2 && real.filter((x) => x.gate_reproduced_pass && !x.gamed).length >= 2
  return { taskKey, built, votes: real, verifiedOk }
}

// ---------------------------------------------------------------------------
const T1 = `Costruisci TASK 1 (plan §"Task 1") — \`trueline/scripts/blueprint/ac_assertion_trace_check.mjs\` + \`ac_assertion_trace_check.test.mjs\`. Il checker IMPORTA loadTasks da ./blueprint_tasks.mjs (NO replica del parser); esporta \`textTracesAc(text, acId)\` (PURA, string-aware: scandisce char-by-char tracciando stato di stringa ' " \` e block-comment /* */; un marcatore di commento dentro una stringa NON apre un commento; regex covers:\\\\s*<id>\\\\b ancorata) e \`assertionTrace(tasks, appDir, inScope)->{ok,detail,untracked}\` (AC valutato sse >=1 file coprante in-scope; tracciato per-AC GLOBALE; tag spurio ignorato) + CLI <blueprint-dir> <app-dir> [--json] con guard "run solo se invocato direttamente". MICRO-GATE: \`node --test trueline/scripts/blueprint/ac_assertion_trace_check.test.mjs\` PASS (>=14 test, incluso il caso tag-in-stringa = false e l'ancoraggio AC-1 != AC-10).`

const T3 = `Costruisci TASK 3 (plan §"Task 3") — documenta la convenzione \`covers: <AC-id>\` in commento. In \`trueline/references/build-discipline.md\` §2 Momento 2 SOSTITUISCI il paragrafo del forward-ref (righe ~82-84 "La meccanizzazione piena ... fase moat successiva ...") col paragrafo "Convenzione di provenienza (meccanizzata, AT-1 Fase B)" del plan (cita ac_assertion_trace_check.mjs, per-AC globale, ancorato, string-aware, floor L-COL-006). In \`trueline/references/blueprint/atomic-task-schema.md\` aggiungi la sezione "Provenienza del target_test — tag covers:" dopo "DoD vs acceptance_criteria". NON toccare lo schema del task ne' validate_blueprint ne' SKILL.md. MICRO-GATE: \`grep -q "covers: <AC-id>" trueline/references/build-discipline.md && grep -q "ac_assertion_trace_check" trueline/references/build-discipline.md && grep -q "covers:" trueline/references/blueprint/atomic-task-schema.md && echo DOC-OK\` stampa DOC-OK; e SKILL.md NON modificato.`

const T2 = `Costruisci TASK 2 (plan §"Task 2") — i 6 fixture \`eval/anti-tamper/{tampered-untagged,tag-in-stringa,ac-multi-file,covers-scalare,tag-spurio,mixed-coverage}\` (ciascuno seeded-blueprint/01.md + reference-app/{package.json,src/index.mjs,tests/*.test.mjs}, contenuti VERBATIM dal plan; mixed-coverage NON ha tests/b.test.mjs) + \`eval/anti-tamper/fixture_trace_check.mjs\` (importa textTracesAc da T1 e loadTasks; valida ortogonalita' + stato-tag) + estendi \`eval/anti-tamper/provision_fixtures.sh\` (aggiungi i 6 id alla lista FIXTURES). NON eseguire git ne' provision_fixtures.sh. MICRO-GATE: \`node eval/anti-tamper/fixture_trace_check.mjs\` exit 0 (== FIXTURE_TRACE_CHECK: PASS, 12/12). (Dipende da T1: ac_assertion_trace_check.mjs esiste gia' su disco.)`

const T4 = `Costruisci TASK 4 (plan §"Task 4") — la precondizione di TRACE in \`trueline/scripts/checkpoint/checkpoint.mjs::control4Conformance\` + \`checkpoint.trace.test.mjs\`. Aggiungi \`import { assertionTrace } from '../blueprint/ac_assertion_trace_check.mjs';\` dopo l'import di run_file (r.45). INSERISCI, TRA il return di in-scope-vuoto (r.451) e \`const fails = [];\` (r.452), il blocco: const trace = assertionTrace(tasks, referenceApp, inScope); if (!trace.ok) return {id:4,name:'conformance',status:'red',green:false,detail:\\\`target_test non tracciabile all'AC — oracolo non valido: \\\${trace.detail}\\\`}; — ADDITIVO, dentro il ramo AC esistente. MICRO-GATE: \`node --test trueline/scripts/checkpoint/checkpoint.trace.test.mjs\` PASS (3 test: BIT-invarianza legacy=degraded, tampered-untagged=RED-trace-prima-dell-esecuzione [detail "non tracciabile", NON "test rosso"/"vacuo"], faithful=verde) E BIT-invarianza \`node eval/harness/m1_gate_check.mjs\` exit 0 (pulisci eval/.tmp-verify prima). (Dipende da T1 import e T2 fixture.)`

const T5 = `Costruisci TASK 5 (plan §"Task 5") — ESTENDI \`eval/harness/anti_tamper_check.mjs\` (NON creare un sibling): aggiungi const TRACE_FIXTURES (i 6 fixture) + const ALL_FIXTURES={...FIXTURES,...TRACE_FIXTURES}; usa ALL_FIXTURES in checkPreconditions, nello snapshot 0-contam di main(), e in assertHygiene; aggiungi retagInCopy(copyDir,relFile,{removeAc,addAc}); aggiungi i sotto-test (7)..(13) [tampered-untagged, tag-in-stringa, ac-multi-file (+falsif untag->RED), covers-scalare, tag-spurio, mixed-coverage (+falsif), ortogonalita' validate_blueprint] e cablali in main() dopo subTestFlagNotDisk(); aggiorna banner/titolo a "Fase A+B". I 25 check Fase A restano INVARIATI. NON toccare git ne' provisionare i .git dei fixture nuovi. MICRO-GATE (i .git dei 6 fixture nuovi NON sono provisionati in questo workflow): \`node eval/harness/anti_tamper_check.mjs\` esce **2** (precondizione .git assente per i fixture nuovi) con banner '(precondizione mancante)', NON un crash ne' un falso verde. (Il gate pieno exit 0 lo eseguira' l'orchestratore in T6 dopo provision_fixtures.sh.) Verifica anche, leggendo il codice, che i 25 check Fase A e le 6 funzioni sotto-test Fase A siano intatti.`

// ---------------------------------------------------------------------------
phase('W1')
log('W1 — T1 checker (Opus) || T3 convenzione doc (Sonnet)')
const w1 = await parallel([
  () => buildVerify('T1', 'W1', T1, undefined, 'Verifica che textTracesAc gestisca: commento di coda (code; // covers: AC-1 = true), stringa ("// covers: AC-1" = false), # e -- , block /* */, e che il parser sia IMPORTATO (no 3a replica).'),
  () => buildVerify('T3', 'W1', T3, 'sonnet', 'Verifica che SKILL.md NON sia modificato e che lo schema del task / validate_blueprint NON siano toccati.'),
])
const w1ok = w1.every((r) => r && r.verifiedOk)
log(`W1 ${w1ok ? 'VERDE' : 'NON-VERDE'} — ${w1.map((r) => `${r.taskKey}:${r.verifiedOk ? 'ok' : 'KO'}`).join(' ')}`)
if (!w1ok) return { stopped_at: 'W1', w1 }

phase('W2')
log('W2 — T2 6 fixture trace + fixture_trace_check (Sonnet)')
const t2 = await buildVerify('T2', 'W2', T2, 'sonnet', 'Verifica che fixture_trace_check IMPORTI textTracesAc (non re-implementi la detezione) e che tag-in-stringa risulti NON tracciante, mixed-coverage abbia b.test.mjs ASSENTE su disco.')
if (!t2.verifiedOk) { log('W2 NON-VERDE'); return { stopped_at: 'W2', w1, t2 } }

phase('W3')
log('W3 — T4 precondizione trace in control4 + checkpoint.trace.test (Opus)')
const t4 = await buildVerify('T4', 'W3', T4, undefined, 'Verifica con cura la BIT-invarianza: il ramo legacy/remediate deve restare BYTE-IDENTICO (m5 path); la precondizione vive SOLO dentro il ramo AC (mode build && blueprintDir && run_file). Conferma che il RED su tampered-untagged sia di TRACE (avviene PRIMA dell esecuzione: detail "non tracciabile", non "test rosso").')
if (!t4.verifiedOk) { log('W3 NON-VERDE'); return { stopped_at: 'W3', w1, t2, t4 } }

phase('W4')
log('W4 — T5 keystone esteso (micro-gate = exit-2 precondizione pre-.git)')
const t5 = await buildVerify('T5', 'W4', T5, undefined, 'Il micro-gate ATTESO e\' exit 2 (i .git dei fixture nuovi non sono provisionati): conferma exit==2 + banner, NON un crash. Verifica leggendo il codice che i 25 check Fase A e le 6 sotto-funzioni Fase A siano INTATTI e che ALL_FIXTURES sia usato in precondizione/snapshot/igiene.')
log(`W4 ${t5.verifiedOk ? 'VERDE' : 'NON-VERDE'}`)

return {
  done: t5.verifiedOk,
  next_step: t5.verifiedOk
    ? 'ORCHESTRATORE (T6, SERIALE, fuori-workflow, L-COL-024): (1) bash eval/anti-tamper/provision_fixtures.sh; (2) node eval/harness/anti_tamper_check.mjs -> exit 0 (keystone A+B: 25 Fase A + trace 7..13 + falsificabilita\') ; (3) no-regressione SERIALE: fixture_trace_check 12/12, checkpoint.trace.test, build_discipline_check 21/21, m5 56/56, ecosystem_conformance 5 pack, package_skill lint VERDE, 0-contaminazione; (4) emenda L-COL-032 (trace-check locked) + SESSION-STATE; (5) merge human-gated su main.'
    : 'W4 non verde: ispeziona t5 prima di T6.',
  results: { w1, t2, t4, t5 },
}
