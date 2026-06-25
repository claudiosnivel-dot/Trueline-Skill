// =============================================================================
// BD-1 — ONDATA W4 (T2.2 keystone) — workflow di continuazione.
// -----------------------------------------------------------------------------
// W1->W3 sono GIA' COSTRUITE, verificate k=2 e su disco (run wf_0693a9c9-318):
//   T1.1 trueline/scripts/blueprint/ac_observability_check.mjs
//   T1.2 trueline/references/build-discipline.md + wiring (build.md/remediate.md/SKILL.md §2/02-SKILL-ANATOMY)
//   T1.3 eval/build-discipline/{overcomplicated-correct,orphan-injecting,ambiguous-ac}/{reference-app,seeded-blueprint}
//   T2.1 trueline/scripts/loop/build_discipline.mjs + run_loop.mjs (--fixture-app/--blueprint) + verify_workspace.mjs (sourceApp)
//
// Il run originale si fermo' a W3 per un GAP DI PRECONDIZIONE (non un difetto di T2.1):
// i 3 reference-app dei fixture non avevano un .git interno -> il loop verify-fix
// (assertIsolatedRepo) risolveva al repo ESTERNO e createWorkBranch lanciava RIFIUTO.
// L'ORCHESTRATORE ha provvisto il .git interno ai 3 fixture (mirror del canonico:
// git init + commit dei soli sorgenti, node_modules untracked) e ha RI-VERIFICATO
// T2.1 in seriale: tutti e 3 i sotto-controlli VERDI. Vedi sotto i valori esatti.
//
// Questo workflow costruisce SOLO T2.2 (build Opus + verifica adversariale Opus k=2).
// W5/T3.1 (no-regressione integrale seriale + git/merge + ledger L-COL-031) resta
// fuori dal workflow, all'orchestratore (gli agenti non toccano git, L-COL-024).
// =============================================================================

export const meta = {
  name: 'bd-1-w4',
  description: 'BD-1 ondata W4: costruisce l harness keystone eval/harness/build_discipline_check.mjs (3 sotto-test falsificabili + precondizione .git fixture = exit 2). Builder Opus + verifica adversariale Opus k=2; git solo nell orchestratore.',
  phases: [
    { title: 'W4', detail: 'T2.2 harness build_discipline_check (keystone) — 3 sotto-test falsificabili + exit 0/1/2' },
  ],
}

const PLAN = 'docs/superpowers/plans/2026-06-24-build-discipline.md'
const SPEC = 'docs/superpowers/specs/2026-06-24-build-discipline-design.md'

const INVARIANTS = `INVARIANTI DI BUILD (Trueline, vincolanti):
- Node ESM, SOLO moduli built-in (+ moduli trueline/scripts dep-free). Niente npm install di rete.
- DETERMINISMO (L-COL-002): niente Date.now()/Math.random() in codice gate-eseguito; id temp = pid+contatore; RUN_OPTS.createdAt = '1970-01-01T00:00:00.000Z'.
- Prosa/commenti in ITALIANO; identificatori/name/schemi in INGLESE.
- Scrivi i file nel working tree, ma NON eseguire ALCUN comando git (l'orchestratore possiede git, L-COL-024). Niente commit/branch/checkout/reset/add/init.
- Oracle-as-judge (L-COL-002): il "verde" e' l'exit/output reale di un comando, MAI una tua frase.
- Advisory MAI gate (L-COL-006): il tidy self-check (build_discipline.advisory) non e' MAI input di runCheckpoint; l'harness lo PROVA (flag settato E checkpoint verde simultanei).
- 0-contaminazione: ogni lavoro su COPIA isolata sotto eval/.tmp-verify; HEAD interno+ESTERNO invariati; fixture bit-identica; assertIsolatedRepo inline.
- Mai rivendicare "pulito/elegante" come verificato; mai "sicuro".
Leggi il piano ${PLAN} (task T2.2 + §7 della spec) e la spec ${SPEC} per il contesto pieno prima di scrivere.`

const TASK_RESULT = {
  type: 'object',
  required: ['task', 'files_written', 'gate_cmd', 'gate_exit', 'gate_pass', 'summary'],
  properties: {
    task: { type: 'string' },
    files_written: { type: 'array', items: { type: 'string' } },
    gate_cmd: { type: 'string', description: 'the exact shell command of the micro-gate you ran' },
    gate_exit: { type: 'number' },
    gate_pass: { type: 'boolean' },
    falsifiability: { type: 'string', description: 'how you demonstrated falsifiability (neutralize->FAIL->restore->PASS) for each of the 3 sub-tests, or n/a' },
    summary: { type: 'string' },
  },
}

const VERIFY = {
  type: 'object',
  required: ['gate_reproduced_pass', 'gamed', 'reasoning'],
  properties: {
    gate_reproduced_pass: { type: 'boolean', description: 'you independently RE-RAN node eval/harness/build_discipline_check.mjs and it exited 0 as claimed' },
    gamed: { type: 'boolean', description: 'true if the harness games the gate (weakened/tautological assertion, hardcoded pass, faked output, advisory used as gate, git touched, Date.now/Math.random, sub-test not actually falsifiable, or precondition swallowed as false-green)' },
    falsifiable_confirmed: { type: 'boolean', description: 'you confirmed neutralize->FAIL->restore->PASS for the 3 sub-tests on a COPY (never the working tree, never git)' },
    reasoning: { type: 'string' },
  },
}

async function buildVerify(taskKey, phase, buildPrompt) {
  const built = await agent(`${INVARIANTS}\n\n=== TASK ${taskKey} ===\n${buildPrompt}\n\nDopo aver scritto il file, ESEGUI il micro-gate (node eval/harness/build_discipline_check.mjs) riportando comando esatto + exit. Ritorna TASK_RESULT.`,
    { label: `build:${taskKey}`, phase, schema: TASK_RESULT })
  if (!built) return { taskKey, built: null, verifiedOk: false, votes: [] }
  const votes = await parallel([0, 1].map((v) => () =>
    agent(`Sei un verificatore adversariale Opus (k=2) per Trueline BD-1, task ${taskKey} (harness keystone). Repo root = working dir. Il builder dichiara: file=${JSON.stringify(built.files_written)}; gate_cmd=\`${built.gate_cmd}\`; gate_exit=${built.gate_exit}; gate_pass=${built.gate_pass}; falsifiability=${built.falsifiability || 'n/a'}.\n\n${INVARIANTS}\n\nIl tuo compito: (1) RI-ESEGUI tu stesso \`node eval/harness/build_discipline_check.mjs\` e osserva l'exit (atteso 0, tutti i sotto-test PASS); (2) cerca il GAMING — asserzione indebolita/tautologica, sotto-test che non verifica davvero (es. legge una stringa fissa anziche' il report reale di run_loop), advisory usato come gate, exit-2 di precondizione mascherato da verde, output finto, git toccato, Date.now/Math.random introdotti; (3) conferma la FALSIFICABILITA dei 3 sotto-test su una COPIA (mai il working tree, mai git): (a) overcomplicated -> se forzi advisory_flag o checkpoint.green a divergere il gate DEVE fallire; (b) orphan -> con l'orfano il control1 dead-code e' RED, rimosso l'orfano sulla copia diventa GREEN; (c) ambiguous-ac -> ac_observability_check FAIL mentre validate_blueprint PASS, e neutralizzando il token vietato il sotto-test (c) DEVE cambiare esito; (4) verifica che l'harness tratti un fixture SENZA .git interno come precondizione (exit 2, banner), NON come falso verde. Default scettico: se non riproduci il PASS pulito, gate_reproduced_pass=false. Ritorna VERDICT.`,
      { label: `verify:${taskKey}.${v + 1}`, phase, schema: VERIFY })
  ))
  const real = votes.filter(Boolean)
  const verifiedOk = real.length >= 2 && real.filter((x) => x.gate_reproduced_pass && !x.gamed).length >= 2
  return { taskKey, built, votes: real, verifiedOk }
}

// ---------------------------------------------------------------------------
const T2_2 = `Costruisci T2.2 (KEYSTONE) — l'harness \`eval/harness/build_discipline_check.mjs\` (gated su T1.1,T1.2,T1.3,T2.1, TUTTE gia' su disco e verdi).

CONTESTO ESATTO (riprodotto in seriale dall'orchestratore — usalo per ancorare le asserzioni ai NOMI DI CAMPO REALI del report di run_loop):
- DRIVER per ogni fixture: \`node trueline/scripts/loop/run_loop.mjs --eval --mode=build [--characterize] --fixture-app=<eval/build-discipline/<fix>/reference-app> --blueprint=<eval/build-discipline/<fix>/seeded-blueprint>\` -> stampa un report JSON su stdout (exit 0).
- I 3 reference-app dei fixture HANNO ORA un \`.git\` interno (provisionato dall'orchestratore; mirror del canonico: solo i sorgenti tracciati, node_modules untracked). createVerifyWorkspace copia la sorgente INCLUSO \`.git\` -> la copia in eval/.tmp-verify e' un repo isolato.
- Forma reale del report (chiavi top-level): mode, evalMode, workspace, fixtureMutated, findings, checkpoint, git, ecosystem, baselineSize, ok, cleanedUp. SOLO col path build+fixture compare anche \`build_discipline\`.
- (a) overcomplicated-correct (--characterize): \`report.build_discipline.advisory===true\` && \`report.build_discipline.complexity_flag===true\` && \`report.checkpoint.green===true\` SIMULTANEAMENTE (tutti e 4 i controlli verdi: dead-code/security/regressions/conformance). \`build_discipline.notes\` elenca {file:'src/pricing/validators.ts', markers:7, threshold:3, ...}. L'advisory NON e' un gate (verde a checkpoint verde).
- (b) orphan-injecting (no --characterize): \`report.checkpoint.controls[0].name==='dead-code'\` && \`report.checkpoint.controls[0].green===false\` (detail '1 dead-code NUOVO introdotto'); \`build_discipline.complexity_flag===false\`. Falsificabile: rimuovendo l'export orfano (src/legacy/unused.ts) SULLA COPIA -> control1 diventa green.
- (c) ambiguous-ac: \`node trueline/scripts/blueprint/ac_observability_check.mjs <ambiguous-ac/seeded-blueprint> --json\` exit 1 (FAIL (1) AC_OBSERVABILITY) MENTRE \`node trueline/scripts/blueprint/validate_blueprint.mjs <stessa dir> --json\` exit 0 (i due oracoli ortogonali).

SPECCHIA \`eval/harness/ecosystem_conformance.mjs\` / \`eval/harness/m5_gate_check.mjs\`:
- shebang + import built-in (node:fs/node:path/node:url/node:child_process); ROOT = resolve a partire da __dirname; \`cleanupAllVerifyWorkspaces()\` in testa (da trueline/scripts/loop/verify_workspace.mjs); helper \`nodeRun\` (spawnSync con PATH+GO_BIN come gli altri harness) e \`assert(name, ok, detail)\` che accumula in checks[]; tally finale + \`process.exit(...)\`.
- COPIA isolata per-fixture (per i sotto-test che la richiedono, es. (b) che muta sulla copia): riusa il pattern copyPackFixture/createVerifyWorkspace (id pid+contatore, \`.git\` incluso) sotto eval/.tmp-verify; \`assertIsolatedRepo\` inline (toplevel copia != ROOT e != fixture originale); a fine: HEAD interno del fixture + HEAD ESTERNO invariati, fixture bit-identica, nessun residuo .tmp-verify.

PRECONDIZIONE (robustezza — esattamente il gap che ha bloccato W3): in testa, verifica che (i) ogni \`eval/build-discipline/<fix>/reference-app/.git\` esista e (ii) ogni seeded-blueprint esista e (iii) node sia eseguibile. Se una precondizione manca -> stampa un banner '(precondizione mancante)' e \`process.exit(2)\` — MAI un falso verde, MAI exit 0/1 ambiguo. (exit 2 = precondizione; 0 = tutti i sotto-test PASS; 1 = un sotto-test FAIL.)

NON includere la no-regressione integrale pesante (m1..m5/ecosystem_conformance/run_eval/package_skill): e' T3.1 SERIALE dell'orchestratore, fuori da questo harness.

MICRO-GATE: \`node eval/harness/build_discipline_check.mjs\` esce 0 con i 3 sotto-test (a)/(b)/(c) PASS. FALSIFICABILITA da dimostrare e riportare in 'falsifiability': per ciascun sotto-test, neutralizza la condizione su una COPIA (a: forza advisory/checkpoint a divergere; b: rimuovi l'orfano; c: rimuovi il token vietato) -> il rispettivo sotto-test FALLISCE -> ripristina -> PASS. Inoltre: rinominando temporaneamente un \`.git\` di fixture l'harness DEVE uscire 2 (precondizione), poi ripristina. NON toccare git del repo esterno; lascia il working tree PULITO.`

// ---------------------------------------------------------------------------
phase('W4')
log('W4 — T2.2 harness build_discipline_check (keystone) — build Opus + verifica Opus k=2')
const t22 = await buildVerify('T2.2', 'W4', T2_2)
log(`W4 ${t22.verifiedOk ? 'VERDE' : 'NON-VERDE'}`)

return {
  done: t22.verifiedOk,
  next_step: t22.verifiedOk
    ? 'ORCHESTRATORE (main loop): W5/T3.1 — riesecuzione SERIALE del gate integrale (build_discipline_check + falsificabilita + no-regressione m5 56/56, m1..m4, ecosystem_conformance tutti i pack, run_eval, package_skill lint) + 0-contaminazione, poi commit logici, ledger L-COL-031 in 00-INDEX, SESSION-STATE, merge human-gated su main (L-COL-024). Ricorda di documentare la provisione orchestratore del .git interno dei fixture.'
    : 'W4 non verde: ispeziona t22 prima di T3.1.',
  result: t22,
}
