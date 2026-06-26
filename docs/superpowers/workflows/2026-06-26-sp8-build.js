// =============================================================================
// SP-8 BUILD WORKFLOW — firebase-jsts -> tier VERIFIED (secret + dead-code + authz)
// -----------------------------------------------------------------------------
// Esegue le ONDATE del plan docs/superpowers/plans/2026-06-26-sp8-firebase-jsts-verified.md
// (un builder per task + verifica adversariale Opus k=2; git SOLO nell'orchestratore).
//
//   W1: T1 fix_provider (authz+secret-fb) || T2 loop case authz || T3 run_loop collect/scope
//       || T5 manifest+registry || T6 GUARD test            (file disgiunti, indipendenti)
//   W2: T4 ecosystem_conformance kind->verified + armi authz  (dipende da T1-T3, T5)
//   W3: T7 verify_fix_check firebase-jsts                     (dipende da T1-T6)
//
// T8 (orchestratore, SERIALE, FUORI workflow; L-COL-024): provisioning inner-.git +
//   ecosystem_conformance firebase-jsts VERIFIED + falsificabile + no-regressione integrale
//   (m5 56/56 + 4 pack + build_discipline 21/21 + anti_tamper 49/49 + package_skill lint) +
//   0-contaminazione + ledger (L-COL-030 fase 2, scope onesto authz) + SESSION-STATE +
//   merge human-gated su main.
//
// PROOF BAR (deciso): oracolo STATICO firestore_rules_check ri-eseguito PULITO (emulatore
// Firestore non fattibile: JDK 8, no firebase-tools). Scope onesto L-COL-006.
//
// LANCIO: Workflow({ scriptPath: "<repo>/docs/superpowers/workflows/2026-06-26-sp8-build.js" })
// =============================================================================

export const meta = {
  name: 'sp8-build',
  description: 'Build SP-8: promuove firebase-jsts a tier VERIFIED (verified_set=[secret,dead-code,authz]). Fix-provider authz Firestore (if true->owner-scoped, prova oracolo statico) + fix secret serviceAccount.json + loop/run_loop/gate armi authz + manifest/registry + GUARD + verify_fix_check. Builder Opus/Sonnet, verifica Opus k=2; BIT-invariante (m5 56/56 + 4 pack invariati); git solo nell orchestratore (T8 fuori dal workflow).',
  phases: [
    { title: 'W1', detail: 'T1 fix_provider || T2 loop authz || T3 run_loop || T5 manifest/registry || T6 GUARD' },
    { title: 'W2', detail: 'T4 ecosystem_conformance kind->verified + armi authz (collect/pick)' },
    { title: 'W3', detail: 'T7 verify_fix_check firebase-jsts (FB-S1/S5/S3 -> verified)' },
  ],
}

const PLAN = 'docs/superpowers/plans/2026-06-26-sp8-firebase-jsts-verified.md'

const INVARIANTS = `INVARIANTI DI BUILD (Trueline SP-8, vincolanti):
- Node ESM, SOLO built-in (+ moduli trueline/scripts dep-free). Niente npm install di rete nel codice spedito.
- DETERMINISMO (L-COL-002): niente Date.now()/Math.random(); ordine stabile. Negli harness/test e' ammesso process.pid.
- Prosa/commenti in ITALIANO; identificatori/name/chiavi-schema in INGLESE.
- Scrivi i file nel working tree, ma NON eseguire ALCUN comando git (l'orchestratore possiede git, L-COL-024). Niente commit/branch/checkout/reset/add/init/provisioning.
- Oracle-as-judge (L-COL-002): 'verified'/'pulito' = exit/output reale di un oracolo (gitleaks WT / knip / firestore_rules_check), MAI una tua frase.
- BIT-INVARIANZA (cardine, rischio #1): ogni cambio e' ADDITIVO e guardato su cat==='authz' o serviceAccount.json/firestore.rules. I rami secret/rls/dead-code JS/Python restano BYTE-IDENTICI. Prova: pulisci eval/.tmp-verify, poi 'node eval/harness/m1_gate_check.mjs' exit 0 (m5 56/56 e i 4 pack li riverifica l'orchestratore).
- PROOF BAR authz = STATICO: firestore_rules_check ri-eseguito 0 finding sulla regola fixata. NON emulatore (non disponibile). Scope onesto (L-COL-006): controllo statico pulito, non invarianza runtime.
- RIUSO: l'oracolo firestore_rules_check.mjs e normalize.mjs (ramo firestore-rules->authz, CWE-862) ESISTONO GIA' (SP-5). NON modificarli. dead-code FB-S5 riusa fixDeadcodeTsSymbol (nessuna fix nuova).
Leggi il plan ${PLAN} (CODE-COMPLETE: copia il codice dei passi TDD del tuo task verbatim; dove il plan dice 'verifica la firma/const/output reale', FALLO leggendo il file reale e adatta).`

const TASK_RESULT = {
  type: 'object',
  required: ['task', 'files_written', 'gate_cmd', 'gate_exit', 'gate_pass', 'summary'],
  properties: {
    task: { type: 'string' },
    files_written: { type: 'array', items: { type: 'string' } },
    gate_cmd: { type: 'string', description: 'comando esatto del micro-gate del task' },
    gate_exit: { type: 'number' },
    gate_pass: { type: 'boolean' },
    bit_invariance: { type: 'string', description: 'come hai provato la BIT-invarianza (m1 exit 0 / ramo additivo), o n/a' },
    falsifiability: { type: 'string', description: 'rompi->FAIL->ripristina->PASS, o n/a' },
    summary: { type: 'string' },
  },
}

const VERIFY = {
  type: 'object',
  required: ['gate_reproduced_pass', 'gamed', 'bit_invariant', 'reasoning'],
  properties: {
    gate_reproduced_pass: { type: 'boolean', description: 'hai RI-ESEGUITO il micro-gate e passa' },
    gamed: { type: 'boolean', description: 'true se gioca il gate (gate indebolito/tautologico, output finto, git toccato, Date.now/Math.random, oracolo firestore/normalize modificato, default-path alterato)' },
    bit_invariant: { type: 'boolean', description: 'i rami secret/rls/dead-code esistenti restano byte-identici (m1 exit 0 / cambio puramente additivo)' },
    reasoning: { type: 'string' },
  },
}

async function buildVerify(taskKey, phase, buildPrompt, builderModel, verifyExtra = '') {
  const opts = { label: `build:${taskKey}`, phase, schema: TASK_RESULT }
  if (builderModel) opts.model = builderModel
  const built = await agent(`${INVARIANTS}\n\n=== TASK ${taskKey} ===\n${buildPrompt}\n\nSegui i passi TDD del task nel plan. Dopo aver scritto i file, ESEGUI il micro-gate riportando comando esatto + exit. Ritorna TASK_RESULT.`, opts)
  if (!built) return { taskKey, built: null, verifiedOk: false, votes: [] }
  const votes = await parallel([0, 1].map((v) => () =>
    agent(`Sei un verificatore adversariale Opus (k=2) per Trueline SP-8 (firebase-jsts verified), task ${taskKey}. Repo root = working dir. Il builder dichiara: file=${JSON.stringify(built.files_written)}; gate_cmd=\`${built.gate_cmd}\`; gate_exit=${built.gate_exit}; gate_pass=${built.gate_pass}.\n\n${INVARIANTS}\n\nCompito: (1) RI-ESEGUI il gate command, osserva l'exit; (2) cerca il GAMING — gate indebolito/tautologico, output finto, git toccato, Date.now/Math.random, l'oracolo firestore_rules_check/normalize MODIFICATO (vietato: esistono gia'), e SOPRATTUTTO la BIT-INVARIANZA (pulisci eval/.tmp-verify poi 'node eval/harness/m1_gate_check.mjs' exit 0; i rami secret/rls/dead-code esistenti NON devono cambiare comportamento); (3) dove applicabile conferma la falsificabilita'. ${verifyExtra} Default scettico. Ritorna VERDICT.`,
      { label: `verify:${taskKey}.${v + 1}`, phase, schema: VERIFY })
  ))
  const real = votes.filter(Boolean)
  const verifiedOk = real.length >= 2 && real.filter((x) => x.gate_reproduced_pass && !x.gamed && x.bit_invariant).length >= 2
  return { taskKey, built, votes: real, verifiedOk }
}

// ---------------------------------------------------------------------------
const T1 = `Costruisci TASK 1 (plan §"Task 1") — \`trueline/scripts/loop/fix_provider.mjs\` + \`fix_provider.test.mjs\`. Aggiungi: resolver \`resolveFirestoreFileInCopy\`; \`fixFirestoreRules(dir,finding)\` (riscrive \`allow ...: if true;\` -> owner-scoped \`request.auth != null && request.auth.uid == resource.data.ownerId\` cosi' firestore_rules_check ri-eseguito da 0 finding; tollera \`if true\` e \`if (true)\`); \`fixSecretFbS1(dir,finding)\` (neutralizza il valore "private_key" in serviceAccount.json -> "" cosi' gitleaks WT pulito, file intatto); 2 rami in \`selectKnownFix\` (PRIMA del ramo secret-Python r.506: cat==='authz' && firestore.rules -> fixFirestoreRules; cat==='secret' && serviceAccount.json -> fixSecretFbS1). NON toccare i rami config.ts/rls/dead-code esistenti. MICRO-GATE: \`node --test trueline/scripts/loop/fix_provider.test.mjs\` PASS (authz->oracolo pulito, secret->PEM neutralizzato, BIT-invarianza config.ts).`

const T2 = `Costruisci TASK 2 (plan §"Task 2") — \`trueline/scripts/loop/loop.mjs\`: aggiungi const \`FIRESTORE_RULES_CHECK = resolve(ORACLES,'firestore_rules_check.mjs')\` (dopo RUN_DEADCODE r.43) e nel switch di \`rerunOracleFor\` (PRIMA del default r.102) il \`case 'authz': oracle='firestore-rules'; scope='working-tree'; res=run(FIRESTORE_RULES_CHECK,[dir]); break;\`. Esporta \`rerunOracleFor\` se non gia' esportata (additivo). Crea \`loop.trace.test.mjs\` (rerunOracleFor authz: regola if true -> finding authz; regola owner-scoped -> 0 finding). VERIFICA leggendo firestore_rules_check.mjs che l'output JSON abbia .findings e che NON serva un flag (analogo a rls_check). MICRO-GATE: \`node --test trueline/scripts/loop/loop.trace.test.mjs\` PASS + BIT-invarianza \`node eval/harness/m1_gate_check.mjs\` exit 0 (pulisci eval/.tmp-verify prima).`

const T3 = `Costruisci TASK 3 (plan §"Task 3") — \`trueline/scripts/loop/run_loop.mjs\`: in \`collectFindings\` (dopo knip, prima di semgrep) aggiungi un run di firestore_rules_check su \`dir\` -> \`norm('firestore-rules', fr.json, 'working-tree')\` (se fr.json.findings e' array); in \`selectInScope\` (dopo il ramo dead-code, prima del secret) aggiungi \`if (f.category==='authz'){ if(baseName(f.location.file)==='firestore.rules') push(f); continue; }\`. Aggiungi la const FIRESTORE_RULES_CHECK (riusa ORACLES). Esporta selectInScope/collectFindings se servono al test. Crea \`run_loop.scope.test.mjs\` (authz ammesso SOLO se nel verified_set del manifest). MICRO-GATE: \`node --test trueline/scripts/loop/run_loop.scope.test.mjs\` PASS + BIT-invarianza \`node eval/harness/m1_gate_check.mjs\` exit 0 (senza manifest il default v1 esclude authz).`

const T5 = `Costruisci TASK 5 (plan §"Task 5") — DATI. In \`trueline/references/ecosystems/firebase-jsts/ecosystem.json\`: version 1.0.0->1.1.0; verified_set []->["secret","dead-code","authz"]; aggiungi una nota onesta (authz verified = firestore_rules_check statico pulito, NON runtime/emulatore, L-COL-006). In \`eval/ecosystems/firebase-jsts/registry.json\`: aggiungi top-level verified_set=["secret","dead-code","authz"], milestone "SP-8", e flip expected_fix_state -> "verified" per FB-S1 (secret), FB-S5 (dead-code), FB-S3 (authz); FB-S2/FB-S4 restano "detection-only". MICRO-GATE: \`node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/firebase-jsts/ecosystem.json\` exit 0.`

const T6 = `Costruisci TASK 6 (plan §"Task 6") — \`eval/ecosystems/firebase-jsts/reference-app/tests/characterization.test.mjs\` (GUARD, node:test, importa SOLO src/dead.ts -> dependency-free, niente firebase-admin, niente segreti). PRIMA leggi \`eval/ecosystems/firebase-jsts/reference-app/src/dead.ts\` per la firma reale di usedHelper e l'estensione import corretta (.ts via strip-types Node25, o il file reale). Il GUARD asserisce che usedHelper resta vivo+corretto dopo la remediation. MICRO-GATE: \`node --test eval/ecosystems/firebase-jsts/reference-app/tests/characterization.test.mjs\` PASS (>=1 test, 0 fail). NON eseguire git (il commit nell'inner .git lo fa l'orchestratore).`

const T4 = `Costruisci TASK 4 (plan §"Task 4") — \`eval/harness/ecosystem_conformance.mjs\`: PACK_FIXTURES['firebase-jsts'].kind 'detection'->'verified' (fixtureApp/registry invariati); in \`collectFindingsForLoop\` (prima di return out) aggiungi l'arma authz (bindings.authz.tool==='firestore_rules_check' -> nodeRun firestore + normForLoop('firestore-rules', j, 'working-tree') se j.findings array); in \`pickSeedFinding\` (prima di return undefined) aggiungi l'arma cat==='authz' (match per anchor.file suffix + anchor.match_path === f.location.symbol). VERIFICA che la const FIRESTORE_RULES_CHECK esista gia' (SP-5); se no aggiungila. NON toccare la criterion 3 (e' generica; il blocco RLS-runtime resta saltato da vset.includes('rls')=false). MICRO-GATE (il gate pieno e' del T8 orchestratore — serve toolchain+.git): verifica il PARSING \`node -e "import('./eval/harness/ecosystem_conformance.mjs')"\` exit 0 e che il routing instradi firebase-jsts a runVerifiedBody (ispeziona). (Dipende da T1-T3, T5.)`

const T7 = `Costruisci TASK 7 (plan §"Task 7") — \`eval/ecosystems/firebase-jsts/verify_fix_check.mjs\`, MIRROR di \`eval/ecosystems/postgres-jsts/verify_fix_check.mjs\` (leggilo). 10 stadi: snapshot integrita' -> copia isolata sotto eval/.tmp-verify-fb/<pid>-<n> (.git incluso) -> createWorkBranch -> collectFloorFindings (gitleaks WT+history, knip, + firestore_rules_check -> normalize('firestore-rules',...,'working-tree')) -> pickSeed per anchor del registry -> runFindingLoop per FB-S1/FB-S5/FB-S3 -> ASSERISCI fix_state: FB-S1->verified, FB-S5->verified, FB-S3->verified (firestore ri-eseguito 0 finding) -> re-run indipendente (gitleaks WT pulito, knip non flagga unusedHelper, firestore pulito) -> GUARD node --test exit 0 >=1 pass -> igiene (temp pulito, fixture bit-identica, HEAD esterno invariato). Precondizione: se reference-app/.git manca -> banner + process.exit(2). Radice temp privata per-pid, cleanup never-throw, determinismo (lezioni BD-1). MICRO-GATE (il pieno e' del T8 seriale): i .git del fixture esistono gia'; se la toolchain e' presente \`node eval/ecosystems/firebase-jsts/verify_fix_check.mjs\` esce 0 (o 2 se .git assente); almeno il parsing deve riuscire. (Dipende da T1-T6.)`

// ---------------------------------------------------------------------------
phase('W1')
log('W1 — T1 fix_provider || T2 loop authz || T3 run_loop || T5 dati || T6 GUARD')
const w1 = await parallel([
  () => buildVerify('T1', 'W1', T1, undefined, 'Verifica che fixFirestoreRules renda firestore_rules_check 0 finding e che fixSecretFbS1 tolga il PEM senza rompere il JSON; i rami config.ts/rls/dead-code INVARIATI.'),
  () => buildVerify('T2', 'W1', T2, undefined, 'Verifica che il case authz ri-esegua davvero l oracolo (non un mock) e che il default/legacy del switch sia invariato (m1 exit 0).'),
  () => buildVerify('T3', 'W1', T3, undefined, 'Verifica che senza manifest (default v1) authz NON entri in scope (BIT-invariante) e che collectFindings raccolga firestore solo additivamente.'),
  () => buildVerify('T5', 'W1', T5, 'sonnet', 'Verifica che validate_ecosystem passi e che il registry flippi SOLO FB-S1/S5/S3 (FB-S2/S4 restano detection-only).'),
  () => buildVerify('T6', 'W1', T6, 'sonnet', 'Verifica che il GUARD importi SOLO dead.ts (no firebase-admin, no segreti) e passi con node --test.'),
])
const w1ok = w1.every((r) => r && r.verifiedOk)
log(`W1 ${w1ok ? 'VERDE' : 'NON-VERDE'} — ${w1.map((r) => `${r.taskKey}:${r.verifiedOk ? 'ok' : 'KO'}`).join(' ')}`)
if (!w1ok) return { stopped_at: 'W1', w1 }

phase('W2')
log('W2 — T4 ecosystem_conformance kind->verified + armi authz')
const t4 = await buildVerify('T4', 'W2', T4, undefined, 'Verifica che la criterion 3 NON sia toccata e che il routing firebase->runVerifiedBody sia corretto; il gate pieno e\' del T8.')
if (!t4.verifiedOk) { log('W2 NON-VERDE'); return { stopped_at: 'W2', w1, t4 } }

phase('W3')
log('W3 — T7 verify_fix_check firebase-jsts')
const t7 = await buildVerify('T7', 'W3', T7, undefined, 'Verifica che il gate sia il MIRROR di postgres-jsts + ramo firestore, con asserzioni su FATTI degli oracoli (fix_state), precondizione .git->exit2, igiene/0-contaminazione.')
log(`W3 ${t7.verifiedOk ? 'VERDE' : 'NON-VERDE'}`)

return {
  done: t7.verifiedOk,
  next_step: t7.verifiedOk
    ? 'ORCHESTRATORE (T8, SERIALE, fuori-workflow, L-COL-024): (1) provisiona/commit inner-.git del fixture firebase (GUARD+sorgenti nuovi); (2) gate SERIALE: fix_provider/loop/run_loop unit, verify_fix_check, ecosystem_conformance firebase-jsts VERIFIED (~40), + falsificabile (rompi fixFirestoreRules->FB-S3 non verified->FAIL); (3) no-regressione integrale: ecosystem_conformance {supabase-jsts=m5 56, supabase-py/postgres-py 40, postgres-jsts 36}, m5 56/56, build_discipline 21/21, anti_tamper 49/49, package_skill lint VERDE (firebase-jsts 1.1.0 verified); 0-contaminazione; (4) ledger (L-COL-030 fase 2, scope onesto authz) + SESSION-STATE; (5) merge human-gated su main + install riallineato.'
    : 'W3 non verde: ispeziona t7 prima di T8.',
  results: { w1, t4, t7 },
}
