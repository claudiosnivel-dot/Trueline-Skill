// =============================================================================
// BD-1 — W4 RE-VERIFY (round 2): verifica adversariale Opus k=2 dell'harness keystone
// build_discipline_check.mjs DOPO il FIX DI ROOT-CAUSE (radice temp PRIVATA per-pid che
// ELIMINA la contesa sulla .tmp-verify condivisa, invece di mascherarla col retry).
// Sola VERIFICA (niente build). Git solo in SOLA LETTURA. =============================

export const meta = {
  name: 'bd-1-w4-verify2',
  description: 'Verifica adversariale Opus k=2 (round 2) dell harness keystone build_discipline_check.mjs dopo il fix di root-cause (radice temp PRIVATA per-pid + cleanup never-throw + env-override additivo in verify_workspace). Barra dura: MAI un falso exit-1. Sola verifica.',
  phases: [
    { title: 'Verify', detail: 'k=2 adversariale: determinismo back-to-back (no falso exit-1) + anti-gaming + BIT-invarianza shipped' },
  ],
}

const HARNESS = 'eval/harness/build_discipline_check.mjs'
const VW = 'trueline/scripts/loop/verify_workspace.mjs'
const SPEC = 'docs/superpowers/specs/2026-06-24-build-discipline-design.md'
const PLAN = 'docs/superpowers/plans/2026-06-24-build-discipline.md'

const VERIFY = {
  type: 'object',
  required: ['gate_reproduced_pass', 'gamed', 'reasoning'],
  properties: {
    gate_reproduced_pass: { type: 'boolean', description: 'hai RI-ESEGUITO node eval/harness/build_discipline_check.mjs molte volte back-to-back e NON hai MAI osservato un falso exit-1 (rosso ambientale); l esito normale e exit 0 (21/21)' },
    gamed: { type: 'boolean', description: 'true se il retry/exit-2 puo mascherare un rosso reale, un sotto-test non e davvero falsificabile, git toccato, Date.now/Math.random nel codice NUOVO, o l env-override rompe la BIT-invarianza degli altri harness' },
    falsifiable_confirmed: { type: 'boolean', description: 'confermato neutralize->FAIL->restore->PASS per i 3 sotto-test su COPIE (mai working tree, mai git)' },
    bit_invariance_confirmed: { type: 'boolean', description: 'confermato che con env TRUELINE_TMP_VERIFY_ROOT NON impostata m1_gate_check (o un ecosystem_conformance) resta verde (default .tmp-verify invariato)' },
    exit1_false_red_count: { type: 'number', description: 'quante volte hai osservato un falso exit-1 (rosso ambientale, non un rosso d asserzione reale). DEVE essere 0.' },
    reasoning: { type: 'string' },
  },
}

const PROMPT = `Sei un verificatore adversariale Opus (k=2) per Trueline BD-1: l'harness KEYSTONE \`${HARNESS}\` DOPO un FIX DI ROOT-CAUSE dell'orchestratore. Repo root = working dir. Leggi ${PLAN} (T2.2), ${SPEC} §7, e i diff di \`${HARNESS}\` e \`${VW}\`.

STORIA. Round 1: l'harness era FLAKY back-to-back. Causa radice (confermata): il driver SPEDITO run_loop→createVerifyWorkspace→cpSync RACE su Windows sulla radice temp CONDIVISA eval/.tmp-verify (chmod ENOENT/EPERM/ENOTEMPTY) sotto esecuzioni back-to-back; inoltre cleanupAllVerifyWorkspaces() poteva RILANCIARE e crashare l'harness con un falso exit-1.

FIX DI ROOT-CAUSE (questo round verifica QUESTO):
1. \`${VW}\`: TMP_VERIFY_ROOT ora onora un override env TRUELINE_TMP_VERIFY_ROOT (ADDITIVO; env ASSENTE → default eval/.tmp-verize invariato → BIT-invariante per m1..m5/ecosystem_conformance).
2. \`${HARNESS}\`: usa una radice temp PRIVATA per-invocazione eval/.tmp-bd-<pid> (imposta l'env PRIMA di ogni spawn → i run_loop FIGLI la ereditano). Nessun'altra esecuzione (altri harness, run back-to-back con pid diverso, m1 concorrente) tocca questa radice → la contesa cpSync/chmod e' ELIMINATA, non mascherata. La pulizia e' cleanBdTmp() che NON LANCIA MAI (un lock transitorio diventa al piu' un exit-2 ONESTO via precondAbort, MAI un falso exit-1). assertHygiene tollera una radice vuota-ma-locked (readdirSync in try/catch).
L'orchestratore ha gia' osservato 14/14 run back-to-back exit 0 (21/21) ANCHE girando in CONCORRENZA con m1_gate_check (su .tmp-verify default), 0-contaminazione; m1 verde (BIT-invarianza). driveBuildStable(K=4) resta come BACKSTOP, ma il caso normale ora non lo esercita.

NOTA DI SCOPE: il Date.now() a run_loop.mjs:324 e' codice SPEDITO PRE-ESISTENTE (budget del loop), inerte sul path fixture (inScope=[]); FUORI SCOPE BD-1. Concentrati sul fix dell'HARNESS + l'override di ${VW}.

IL TUO COMPITO (scettico, default rifiuto). LA BARRA DURA: l'harness non deve MAI produrre un FALSO exit-1 (un rosso AMBIENTALE: crash di cpSync/cleanup, lock temp, forma degradata). Un falso exit-1 anche UNA sola volta → exit1_false_red_count>=1 e gate_reproduced_pass=false.
1) DETERMINISMO/ROBUSTEZZA: esegui \`node ${HARNESS}\` MOLTE volte back-to-back SENZA pulire (almeno 12; meglio anche 2-3 processi in PARALLELO per indurre carico). L'esito NORMALE dev'essere exit 0 (21/21). Conta i FALSI exit-1 (devono essere 0). Un exit-2 ONESTO e' tollerato SOLO se raro e dovuto a stress ambientale auto-indotto estremo (NON un falso verde, NON un falso rosso) — annotalo ma NON e' di per se' un fallimento della barra dura; un exit-1 ambientale SI'.
2) IL RETRY/EXIT-2 NON MASCHERA ROSSI REALI (anti-gaming). Su COPIE (mai working tree, mai git): (b) lascia l'orfano → control1 RED dev'essere riportato (exit 1 d'ASSERZIONE reale), non ritentato in verde ne' convertito in exit-2; introduci una forma ben formata con asserzione falsa → exit 1 reale, non 0/2. Leggi driveBuildStable: ritenta solo su (status!=0 || !report || !checkpoint.controls || (requireGreen && green!=true)); subTestB usa requireGreen=false.
3) EXIT-2 ONESTO: precondAbort scatta solo su precondizione reale (.git fixture mancante → exit 2 con banner; provalo su una COPIA dell'albero) o instabilita' ambientale dopo K tentativi, MAI come scappatoia da un rosso d'asserzione ben formato.
4) FALSIFICABILITA dei 3 sotto-test su COPIE (neutralize→FAIL→restore→PASS): (a) togli interface/class/abstract da validators.ts → complexity_flag=false → §7.2a FALLISCE; (b) rimuovi src/legacy/unused.ts → control1 verde → (b) FALLISCE; (c) togli il token vietato dal then → ac_observability_check exit 0 → (c) FALLISCE.
5) BIT-INVARIANZA dello shipped: con env TRUELINE_TMP_VERIFY_ROOT NON impostata, \`node eval/harness/m1_gate_check.mjs\` resta verde (default .tmp-verify invariato); leggi il diff di ${VW} e conferma che e' un override puramente additivo.
6) 0-CONTAMINAZIONE: HEAD esterno 371776f e HEAD interni fixture (b0cfe86/74b591a/dcda500) invariati; nessun residuo eval/.tmp-bd-* o eval/.tmp-verify lasciato da te; nessun Date.now/Math.random nel codice NUOVO dell'harness.

Ritorna VERDICT. gate_reproduced_pass=true SOLO se exit1_false_red_count===0 e l'esito normale e' exit 0; gamed=true se il retry/exit-2 maschera un rosso reale o l'override rompe la BIT-invarianza. NON eseguire comandi git mutanti.`

// ---------------------------------------------------------------------------
phase('Verify')
log('Re-verify k=2 (round 2) — fix di root-cause: radice temp privata per-pid')
const votes = await parallel([0, 1].map((v) => () =>
  agent(PROMPT, { label: `verify2.${v + 1}`, phase: 'Verify', schema: VERIFY })
))
const real = votes.filter(Boolean)
const verifiedOk = real.length >= 2
  && real.filter((x) => x.gate_reproduced_pass && !x.gamed && (x.exit1_false_red_count === 0)).length >= 2
log(`Re-verify (round 2) ${verifiedOk ? 'VERDE (k=2)' : 'NON-VERDE'}`)

return {
  verifiedOk,
  next_step: verifiedOk
    ? 'ORCHESTRATORE: W5/T3.1 — riesecuzione SERIALE del gate integrale (build_discipline_check + falsificabilita + no-regressione m5 56/56, m1..m4, ecosystem_conformance tutti i pack, run_eval, package_skill lint) + 0-contaminazione, commit logici, ledger L-COL-031, SESSION-STATE, merge human-gated su main (L-COL-024). Documentare: provisione orchestratore del .git interno dei fixture + fix anti-flaky (radice temp privata per-pid + env-override additivo in verify_workspace).'
    : 'Re-verify round 2 non verde: ispeziona i voti (in particolare exit1_false_red_count).',
  votes: real,
}
