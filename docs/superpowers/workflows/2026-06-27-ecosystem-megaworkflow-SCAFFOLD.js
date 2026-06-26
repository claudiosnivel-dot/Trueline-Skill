// =============================================================================
// ECOSYSTEM EXPANSION — MEGA WORKFLOW *SCAFFOLD* (NON eseguire così com'è)
// -----------------------------------------------------------------------------
// SCHELETRO parametrico di UNA FASE. Il "mega workflow" = questa fase istanziata
// in SEQUENZA (F1→F6 del brief), con gate SERIALE + merge human-gated TRA le fasi
// (disciplina: una milestone = un workflow + un gate + un merge, L-COL-024).
//
// La prossima sessione: (1) sceglie la fase + i pack (vedi PHASES sotto, dal brief
// docs/superpowers/plans/2026-06-27-ecosystem-expansion-megaworkflow-BRIEF.md §2/§4);
// (2) RIEMPIE i campi per-pack (detect signals, seeds, oracolo riuso/nuovo, fix);
// (3) raffina i prompt; (4) lancia con Workflow({scriptPath, args:{phase:'F1'}}).
//
// VINCOLI CHIAVE (dal brief):
// - DETECTION pack = pura DATA (manifest+fixture+registry) + 1 riga PACK_FIXTURES.
// - I file ENGINE sono CONDIVISI (ecosystem_conformance.mjs / fix_provider.mjs /
//   normalize.mjs / loop.mjs) -> gli edit engine NON vanno in parallelo (conflitti
//   di scrittura). Pattern: build DATA in parallelo per-pack, poi UN agente
//   "integrator" applica gli edit ENGINE in sequenza, poi verify per-pack.
// - Verifier SEMPRE Opus k=2 (BIT-invarianza = rischio #1). Builder Opus per
//   oracoli/fix/dispatch, Sonnet per manifest/fixture/registry/ruleset. Niente Haiku.
// - Git SOLO nell'orchestratore (provisioning .git + npm install tool dead-code +
//   commit + merge human-gated) = T-final FUORI dal workflow.
// - La VERITA' e' il gate SERIALE dell'orchestratore, mai il green/red sotto
//   concorrenza (lezione T7/SP-8: falso-rosso da tool assente nel sandbox).
// =============================================================================

export const meta = {
  name: 'eco-phase-build',
  description: 'SCAFFOLD: costruisce UNA fase dell espansione ecosistemi (pack data-puri in parallelo + integrazione engine serializzata + verify Opus k=2). Istanziare per fase (F1..F6) dal brief. Detection=data+1 riga; verified=+fix-provider; nuovo oracolo=+4 dispatch. Git solo nell orchestratore (T-final).',
  phases: [
    { title: 'Data', detail: 'manifest + fixture + registry + ruleset per ogni pack (Sonnet, parallelo)' },
    { title: 'Engine', detail: 'integrator: PACK_FIXTURES + oracoli/dispatch + fix-provider (Opus, SERIALE)' },
    { title: 'Verify', detail: 'ecosystem_conformance <id> per pack + BIT-invarianza (Opus k=2)' },
  ],
}

// --- Catalogo pack per fase (dal brief §2/§4 — RIEMPIRE i dettagli per-pack) ---
// Ogni pack: { id, tier:'detection'|'verified', newOracle:bool, builder spec ... }
const PHASES = {
  F1: [
    { id: 'firebase-py',          tier: 'verified',  newOracle: false }, // riuso firestore_rules_check + fix keyed-by-path (py)
    { id: 'supabase-storage-jsts',tier: 'verified',  newOracle: false }, // estendi rls_check (token storage + RLS005)
  ],
  F2: [
    { id: 'appwrite-jsts',  tier: 'verified', newOracle: true },  // appwrite_perms_check (JSON): floor ("any")->("users")
    { id: 'pocketbase-jsts',tier: 'verified', newOracle: true },  // pocketbase_rules_check (JSON): floor ""  ⚠ null=SAFE
  ],
  F3: [
    { id: 'hasura-jsts',  tier: 'verified', newOracle: true },    // hasura_metadata_check + YAML reader dep-free
    { id: 'amplify-jsts', tier: 'verified', newOracle: true },    // appsync_auth_check (SDL @auth); Gen2 detection-only
  ],
  F4: [ // nuovi linguaggi, DETECTION-floor (pura data + ruleset semgrep)
    { id: 'postgres-go',  tier: 'detection', newOracle: false }, // rls_check riuso; floor-only prima del verified (F5)
    { id: 'rails-rb',     tier: 'detection', newOracle: false }, // route-authz semgrep (GA)
    { id: 'laravel-php',  tier: 'detection', newOracle: false },
    { id: 'spring-java',  tier: 'detection', newOracle: false }, // (+spring-kt opzionale)
    { id: 'dotnet-cs',    tier: 'detection', newOracle: false }, // packages.lock.json abilitato nel fixture
    { id: 'flutter-dart', tier: 'detection', newOracle: false }, // authz = backend reuse (rls/firestore)
    { id: 'phoenix-ex',   tier: 'detection', newOracle: true  }, // semgrep experimental -> valuta oracolo router/plug
  ],
  F5: [ // promozioni VERIFIED dei linguaggi fattibili
    { id: 'postgres-go',  tier: 'verified', newOracle: false }, // dead-code go (x/tools/deadcode) + go_deadcode_edit + fixSecretGoS1; RLS riusa fixRlsPgS3
    { id: 'flutter-dart', tier: 'verified', newOracle: false }, // dead-code dart analyze + dart fix + fixSecretDartS1
    { id: 'laravel-php',  tier: 'verified', newOracle: false }, // Psalm dead-code + php_deadcode_edit + fixSecretPhpS1
    // gli altri linguaggi: verified_set=[secret] (fixSecret<Lang>S1); dead-code detection-only (Ruby) o private-only
  ],
  // F0 (prereq) + F6 (NoSQL): content-detection in resolve.mjs PRIMA, poi:
  F6: [
    { id: 'cloudflare-d1-jsts', tier: 'detection', newOracle: false }, // marker wrangler.toml; Workers fetch(req,env) context
    { id: 'mongodb-jsts',       tier: 'detection', newOracle: false }, // ⚠ collisione: serve Fase 0 (content-detect)
    { id: 'dynamodb-jsts',      tier: 'detection', newOracle: false }, // ⚠ collisione
  ],
}

const BRIEF = 'docs/superpowers/plans/2026-06-27-ecosystem-expansion-megaworkflow-BRIEF.md'
const INVARIANTS = `INVARIANTI (Trueline eco-expansion):
- Node ESM solo built-in; determinismo (no Date.now/Math.random); prosa IT, identificatori EN.
- NON toccare git (orchestratore, L-COL-024). NON modificare gli oracoli/normalize ESISTENTI se non additivamente.
- BIT-INVARIANZA (rischio #1): ogni edit engine e' ADDITIVO; m5 56/56 + 5 pack esistenti invariati. Prova: m1_gate_check exit 0 (pulisci eval/.tmp-verify).
- DETECTION = manifest+fixture+registry (+ruleset se semgrep) + 1 riga PACK_FIXTURES; nessun fix-provider.
- VERIFIED = + fix-provider (selectKnownFix) + verify_fix_check; prova = oracolo ri-eseguito PULITO.
- Nuovo oracolo TOOL = +4 dispatch (detectCategory/collectFindingsForLoop/canonOracle in conformance, normalize, rerunOracleFor).
Leggi ${BRIEF} (template task §1, ricette per-pack §2/§5) e un pack esistente analogo (es. eval/ecosystems/postgres-py/ + firebase-jsts/).`

const PACK_RESULT = {
  type: 'object',
  required: ['pack', 'files_written', 'gate_cmd', 'gate_exit', 'gate_pass', 'summary'],
  properties: {
    pack: { type: 'string' }, files_written: { type: 'array', items: { type: 'string' } },
    gate_cmd: { type: 'string' }, gate_exit: { type: 'number' }, gate_pass: { type: 'boolean' },
    engine_edits: { type: 'string', description: 'edit ai file ENGINE condivisi (PACK_FIXTURES/dispatch/fix), o "none (solo data)"' },
    summary: { type: 'string' },
  },
}
const VERIFY = {
  type: 'object',
  required: ['gate_reproduced_pass', 'gamed', 'bit_invariant', 'reasoning'],
  properties: {
    gate_reproduced_pass: { type: 'boolean' }, gamed: { type: 'boolean' },
    bit_invariant: { type: 'boolean', description: 'm5 + 5 pack esistenti invariati; edit additivi' },
    reasoning: { type: 'string' },
  },
}

// --- Helpers (mirror SP-8) — RIEMPIRE i prompt per-pack ----------------------
function dataPrompt(p) {
  return `Costruisci i FILE DATA del pack ${p.id} (tier ${p.tier}) — SOLO data, NIENTE engine edits, NIENTE git.\n`
    + `Vedi ${BRIEF} §1 (template) e la ricetta del pack in §2/§5.\n`
    + `1) references/ecosystems/${p.id}/ecosystem.json (validate_ecosystem exit 0)\n`
    + `2) [se authz=semgrep] references/ecosystems/${p.id}/ruleset/${p.id}-authz.yml (+ test)\n`
    + `3) eval/ecosystems/${p.id}/reference-app/ (SEED markers + contrasti 0-FP + lockfile + manifest-lingua) + registry.json\n`
    + `MICRO-GATE: node trueline/scripts/ecosystem/validate_ecosystem.mjs references/ecosystems/${p.id}/ecosystem.json -> exit 0.`
}
function enginePrompt(packs) {
  return `INTEGRATOR (SERIALE) — applica TUTTI gli edit ENGINE per i pack [${packs.map((p) => p.id).join(', ')}], in sequenza, ADDITIVI e BIT-invarianti.\n`
    + `Per ogni pack: aggiungi la riga PACK_FIXTURES in eval/harness/ecosystem_conformance.mjs (kind=${'<tier>'}).\n`
    + `Per i pack con newOracle: crea scripts/oracles/<x>_check.mjs + normalize branch + alias + rerunOracleFor case + detectCategory/collectFindingsForLoop arm (4 punti).\n`
    + `Per i pack verified: aggiungi i rami fix in selectKnownFix (fix_provider.mjs) + crea eval/ecosystems/<id>/verify_fix_check.mjs.\n`
    + `MICRO-GATE: node -e "import('./eval/harness/ecosystem_conformance.mjs')" exit 0 + BIT-invarianza node eval/harness/m1_gate_check.mjs exit 0 (pulisci eval/.tmp-verify).`
}

async function buildPack(p, phaseTitle) {
  const built = await agent(`${INVARIANTS}\n\n${dataPrompt(p)}`,
    { label: `data:${p.id}`, phase: phaseTitle, schema: PACK_RESULT, model: 'sonnet' })
  return { pack: p.id, built }
}

// --- Corpo (parametrico sulla fase via args.phase) ---------------------------
const phaseKey = (args && args.phase) || 'F1'
const packs = PHASES[phaseKey]
if (!packs) return { error: `fase sconosciuta: ${phaseKey}; valide: ${Object.keys(PHASES).join(',')}` }
log(`Eco-expansion fase ${phaseKey} — pack: ${packs.map((p) => p.id).join(', ')}`)

phase('Data')
const data = await parallel(packs.map((p) => () => buildPack(p, 'Data')))
const dataOk = data.every((d) => d && d.built && d.built.gate_pass)
log(`Data ${dataOk ? 'VERDE' : 'NON-VERDE'}`)
if (!dataOk) return { stopped_at: 'Data', data }

phase('Engine')
// SERIALE: un solo integrator applica tutti gli edit engine (no conflitti di scrittura).
const eng = await agent(`${INVARIANTS}\n\n${enginePrompt(packs)}`,
  { label: `engine:${phaseKey}`, phase: 'Engine', schema: PACK_RESULT })
if (!eng || !eng.gate_pass) { log('Engine NON-VERDE'); return { stopped_at: 'Engine', data, eng } }

phase('Verify')
// k=2 per-pack: ri-esegue ecosystem_conformance <id> + cerca gaming + BIT-invarianza.
const verdicts = await parallel(packs.map((p) => () =>
  parallel([0, 1].map((v) => () =>
    agent(`Verificatore adversariale Opus (k=2) per il pack ${p.id} (tier ${p.tier}). ${INVARIANTS}\n`
      + `RI-ESEGUI node eval/harness/ecosystem_conformance.mjs ${p.id} e osserva l'esito; cerca gaming (gate indebolito, oracolo esistente modificato non-additivamente, git toccato); conferma BIT-invarianza (m5/5 pack invariati). NB: il green/red pieno e' del gate SERIALE dell'orchestratore (tool dead-code potrebbero mancare nel sandbox -> falso rosso). Ritorna VERDICT.`,
      { label: `verify:${p.id}.${v + 1}`, phase: 'Verify', schema: VERIFY })))
    .then((vs) => ({ pack: p.id, votes: vs.filter(Boolean) }))))

return {
  phase: phaseKey,
  next_step: `ORCHESTRATORE (T-final, SERIALE, fuori-workflow): per ogni pack [${packs.map((p) => p.id).join(', ')}]: provisiona inner-.git del fixture (+ npm install tool dead-code se serve); ecosystem_conformance <id> PASS; no-regressione integrale (m5 56/56 + 5 pack + anti_tamper 49/49 + build_discipline 21/21 + package_skill lint); 0-contaminazione; falsificabilita' (verified); ledger (L-COL-030 fase 2 / L-COL-029 additivi) + SESSION-STATE; merge human-gated. Poi la fase successiva.`,
  results: { data, eng, verdicts },
}
