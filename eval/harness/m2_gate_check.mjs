#!/usr/bin/env node
// m2_gate_check.mjs — GATE M2 (motore di blueprint: 11 + 12).
//
// Asserisce, in modo DETERMINISTICO (L-COL-002: verde = output reale di comando,
// mai una frase), il gate headline di M2 (10 §4, criterio 5):
//
//   A) validate_blueprint esce PULITO (exit 0) sul blueprint seminato (fixture
//      valida di eval/seeded-blueprint), con tutti i controlli strutturali OK.
//   B) validate_blueprint REJECTS un blueprint MALFORMATO (esito negativo, exit 1):
//      fixture usa-e-getta in eval/.tmp-m2-negative (gitignorata), poi ripulita.
//      Verifica che ciascuno dei 5 controlli strutturali sappia bocciare.
//   C) SELF-CHECK semantico presente/applicabile: la checklist 11 §5.2 esiste e
//      contiene i punti 6–10 (misurabilità, atomicità, copertura, baseline di
//      sicurezza, niente task fantasma).
//   D) I 3 PROMPT DI LIFECYCLE (12) ben formati e PARAMETRIZZATI: esistono
//      project-start / session-start / session-end in assets/prompts/, ciascuno
//      con i placeholder di parametrizzazione (12 §3) e le 5 invarianti non
//      negoziabili incorporate (12 §5).
//   E) NESSUNA REGRESSIONE: i gate M0 (present, detection) e M1 (m1_gate)
//      escono ancora 0; nessuna copia temp residua.
//
// Esce 0 se TUTTI i criteri passano, 1 altrimenti.
//
// Node ESM, solo moduli built-in: nessun npm install, nessuna rete.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const VALIDATE_BP = resolve(ROOT, 'trueline', 'scripts', 'blueprint', 'validate_blueprint.mjs');
const SEEDED_BP = resolve(ROOT, 'eval', 'seeded-blueprint');
const CHECKLIST = resolve(ROOT, 'trueline', 'references', 'blueprint', 'self-check-checklist.md');
const PROMPTS_DIR = resolve(ROOT, 'trueline', 'assets', 'prompts');
const TMP_NEG = resolve(ROOT, 'eval', '.tmp-m2-negative');
const RUN_EVAL = resolve(ROOT, 'eval', 'harness', 'run_eval.mjs');
const M1_GATE = resolve(ROOT, 'eval', 'harness', 'm1_gate_check.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

function nodeRun(script, args) {
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('============================================================');
console.log(' GATE M2 — motore di blueprint (11 validate_blueprint + self-check; 12 prompt)');
console.log(`   validate_blueprint : ${VALIDATE_BP}`);
console.log(`   blueprint seminato : ${SEEDED_BP}`);
console.log('============================================================');
console.log('');

// --- A) validate_blueprint PULITO sul blueprint seminato ---------------------
console.log('1) validate_blueprint sul blueprint seminato (atteso: PULITO, exit 0):');
const ok = nodeRun(VALIDATE_BP, [SEEDED_BP, '--json']);
let okReport = null;
try { okReport = JSON.parse(ok.stdout); } catch { /* gestito sotto */ }
assert('validate_blueprint esce 0 sul seminato', ok.status === 0, `exit=${ok.status}`);
assert('output JSON parsabile con ok=true', okReport && okReport.ok === true,
  okReport ? `task_count=${okReport.task_count}` : 'JSON non parsabile');
const expectedChecks = ['(1) REQUIRED_FIELDS', '(2) AC_COVERAGE', '(3) DAG_VALID', '(4) UNIQUE_IDS', '(5) MACROTASK_OWNERSHIP'];
const presentChecks = okReport ? okReport.checks.map((c) => c.name) : [];
assert('tutti i 5 controlli strutturali presenti e OK',
  okReport && expectedChecks.every((n) => okReport.checks.find((c) => c.name === n && c.ok)),
  `controlli=[${presentChecks.join(', ')}]`);

// --- B) validate_blueprint RIFIUTA un blueprint malformato -------------------
console.log('');
console.log('2) validate_blueprint su blueprint MALFORMATO (atteso: REJECT, exit 1):');
// Fixture negativa usa-e-getta (in eval/.tmp-m2-*, gitignorata). Viola tutti e
// 5 i controlli: campo mancante, AC orfano, dep inesistente, id duplicato,
// macrotask vuoto.
try { rmSync(TMP_NEG, { recursive: true, force: true }); } catch { /* idempotente */ }
mkdirSync(TMP_NEG, { recursive: true });
const malformed = [
  '# Blueprint MALFORMATO — fixture negativa del gate M2 (usa-e-getta)',
  '',
  '```yaml',
  '- id: T-900',
  '  title: "Task con AC orfano, dep inesistente, senza target_tests"',
  '  macrotask: "broken"',
  '  depends_on: [T-404]            # (3) riferimento a id INESISTENTE',
  '  objective: >',
  '    Task deliberatamente malformato.',
  '  definition_of_done:',
  '    - "Un artefatto osservabile"',
  '  acceptance_criteria:',
  '    - id: AC-900-1',
  '      given: "x"',
  '      when: "y"',
  '      then: "z"',
  '    - id: AC-900-2               # (2) criterio ORFANO: non coperto da target_tests',
  '      given: "a"',
  '      when: "b"',
  '      then: "c"',
  '  target_tests:                  # presente ma copre solo AC-900-1',
  '    - file: "tests/x.test.ts"',
  '      covers: [AC-900-1]',
  '',
  '- id: T-900                      # (4) ID DUPLICATO',
  '  title: "Task senza macrotask e senza target_tests"',
  '  macrotask: ""                  # (5) macrotask VUOTO',
  '  depends_on: []',
  '  objective: >',
  '    Manca target_tests.          # (1) campo obbligatorio assente',
  '  definition_of_done:',
  '    - "Cosa"',
  '  acceptance_criteria:',
  '    - id: AC-900-3',
  '      given: "g"',
  '      when: "w"',
  '      then: "t"',
  '```',
  '',
].join('\n');
writeFileSync(resolve(TMP_NEG, '01-broken.md'), malformed, 'utf8');

const bad = nodeRun(VALIDATE_BP, [TMP_NEG, '--json']);
let badReport = null;
try { badReport = JSON.parse(bad.stdout); } catch { /* gestito sotto */ }
assert('validate_blueprint esce 1 sul malformato', bad.status === 1, `exit=${bad.status}`);
assert('output JSON con ok=false', badReport && badReport.ok === false,
  badReport ? `ok=${badReport.ok}` : 'JSON non parsabile');
// Verifica che ciascun controllo strutturale sappia bocciare il proprio difetto.
const failed = badReport ? badReport.checks.filter((c) => !c.ok).map((c) => c.name) : [];
for (const ctl of expectedChecks) {
  assert(`controllo ${ctl} BOCCIA il difetto`, failed.includes(ctl),
    failed.includes(ctl) ? 'FAIL come atteso' : 'non ha bocciato (falso verde!)');
}

// Cleanup della fixture negativa (niente residui temp).
try { rmSync(TMP_NEG, { recursive: true, force: true }); } catch { /* best effort */ }
assert('fixture negativa rimossa (nessun residuo temp)', !existsSync(TMP_NEG),
  existsSync(TMP_NEG) ? 'directory ancora presente' : 'assente');

// --- B2/B3/B4) Robustezza del parser e fedelta dei controlli -----------------
// L'oracolo del piano (11 §5.1) deve: (i) ACCETTARE i blueprint validi scritti
// negli idiomi YAML che la spec §3 dichiara supportati; (ii) RIFIUTARE i difetti
// di contenuto, non solo quelli "di forma"; (iii) avere i template gate-ati.
// Ogni fixture e usa-e-getta sotto eval/.tmp-m2-* (gitignorata) e poi rimossa.
const TMP_ROB = resolve(ROOT, 'eval', '.tmp-m2-rob');
function writeAndValidate(filename, lines) {
  try { rmSync(TMP_ROB, { recursive: true, force: true }); } catch { /* idempotente */ }
  mkdirSync(TMP_ROB, { recursive: true });
  writeFileSync(resolve(TMP_ROB, filename), lines.join('\n'), 'utf8');
  const r = nodeRun(VALIDATE_BP, [TMP_ROB, '--json']);
  let rep = null; try { rep = JSON.parse(r.stdout); } catch { /* gestito */ }
  try { rmSync(TMP_ROB, { recursive: true, force: true }); } catch { /* best effort */ }
  return { status: r.status, rep };
}

console.log('');
console.log('2b) Idiomi YAML VALIDI del subset 11 §3 (atteso: ACCETTA, exit 0):');
// P1: covers come block-sequence multilinea (equivalente all'inline [A, B])
const p1 = writeAndValidate('01.md', [
  '```yaml', '- id: T-P1', '  title: "covers block-sequence"', '  macrotask: "m"', '  depends_on: []',
  '  objective: >', '    Task valido con covers scritto come block-sequence.',
  '  definition_of_done:', '    - "Artefatto osservabile"',
  '  acceptance_criteria:',
  '    - id: AC-P1-1', '      given: "g"', '      when: "w"', '      then: "t"',
  '    - id: AC-P1-2', '      given: "g"', '      when: "w"', '      then: "t"',
  '  target_tests:', '    - file: "tests/p1.test.ts"', '      covers:', '        - AC-P1-1', '        - AC-P1-2',
  '```', '',
]);
assert('P1 covers come block-sequence ACCETTATA', p1.status === 0 && p1.rep && p1.rep.ok === true,
  p1.rep ? `ok=${p1.rep.ok} exit=${p1.status}` : `exit=${p1.status}`);

// P2: commenti di riga intera dentro le liste (prima del 1o item DoD; tra due AC)
const p2 = writeAndValidate('01.md', [
  '```yaml', '- id: T-P2', '  title: "commenti nelle liste"', '  macrotask: "m"', '  depends_on: []',
  '  objective: >', '    Task valido con commenti di riga dentro le liste.',
  '  definition_of_done:', '    # commento prima del primo item (YAML idiomatico, cfr esempio §3)', '    - "Artefatto osservabile"',
  '  acceptance_criteria:',
  '    - id: AC-P2-1', '      given: "g"', '      when: "w"', '      then: "t"',
  '    # commento tra due criteri', '    - id: AC-P2-2', '      given: "g"', '      when: "w"', '      then: "t"',
  '  target_tests:', '    - file: "tests/p2.test.ts"', '      covers: [AC-P2-1, AC-P2-2]',
  '```', '',
]);
assert('P2 commenti di riga dentro le liste ACCETTATI', p2.status === 0 && p2.rep && p2.rep.ok === true,
  p2.rep ? `ok=${p2.rep.ok} exit=${p2.status}` : `exit=${p2.status}`);

// P3: block scalar (folded) dentro un item AC, con prosa multilinea reale
const p3 = writeAndValidate('01.md', [
  '```yaml', '- id: T-P3', '  title: "block scalar in AC"', '  macrotask: "m"', '  depends_on: []',
  '  objective: >', '    Task valido con un then come block scalar.',
  '  definition_of_done:', '    - "Artefatto osservabile"',
  '  acceptance_criteria:',
  '    - id: AC-P3-1', '      given: "g"', '      when: "w"',
  '      then: >', '        esito osservabile descritto', '        su piu righe come folded scalar',
  '  target_tests:', '    - file: "tests/p3.test.ts"', '      covers: [AC-P3-1]',
  '```', '',
]);
assert('P3 block scalar dentro item AC ACCETTATO', p3.status === 0 && p3.rep && p3.rep.ok === true,
  p3.rep ? `ok=${p3.rep.ok} exit=${p3.status}` : `exit=${p3.status}`);

console.log('');
console.log('2c) Difetti di CONTENUTO (atteso: RIFIUTA, exit 1):');
// N1: definition_of_done con item stringa-vuota (lista non vuota ma vacua)
const n1 = writeAndValidate('01.md', [
  '```yaml', '- id: T-N1', '  title: "DoD vacuo"', '  macrotask: "m"', '  depends_on: []',
  '  objective: >', '    Task con definition_of_done fatto di stringhe vuote.',
  '  definition_of_done:', '    - ""', '    - ""',
  '  acceptance_criteria:', '    - id: AC-N1-1', '      given: "g"', '      when: "w"', '      then: "t"',
  '  target_tests:', '    - file: "tests/n1.test.ts"', '      covers: [AC-N1-1]',
  '```', '',
]);
assert('N1 DoD con item vuoti RIFIUTATO', n1.status === 1 && n1.rep && n1.rep.ok === false,
  n1.rep ? `ok=${n1.rep.ok} exit=${n1.status}` : `exit=${n1.status}`);

// N2: target_test senza campo file (test non "nominato", schema §3)
const n2 = writeAndValidate('01.md', [
  '```yaml', '- id: T-N2', '  title: "target_test senza file"', '  macrotask: "m"', '  depends_on: []',
  '  objective: >', '    Task con un target_test privo di file.',
  '  definition_of_done:', '    - "Artefatto osservabile"',
  '  acceptance_criteria:', '    - id: AC-N2-1', '      given: "g"', '      when: "w"', '      then: "t"',
  '  target_tests:', '    - covers: [AC-N2-1]',
  '```', '',
]);
assert('N2 target_test senza file RIFIUTATO', n2.status === 1 && n2.rep && n2.rep.ok === false,
  n2.rep ? `ok=${n2.rep.ok} exit=${n2.status}` : `exit=${n2.status}`);

// N3: task con id vuoto (non deve essere scartato silenziosamente)
const n3 = writeAndValidate('01.md', [
  '```yaml',
  '- id: ""', '  title: "id vuoto"', '  macrotask: "m"', '  depends_on: []',
  '  objective: >', '    Task con id vuoto: di per se invalido.',
  '  definition_of_done:', '    - "x"',
  '  acceptance_criteria:', '    - id: AC-N3-1', '      given: "g"', '      when: "w"', '      then: "t"',
  '  target_tests:', '    - file: "tests/n3.test.ts"', '      covers: [AC-N3-1]',
  '- id: T-N3', '  title: "task valido di contrasto"', '  macrotask: "m"', '  depends_on: []',
  '  objective: >', '    Task valido per dare un blocco-task riconoscibile.',
  '  definition_of_done:', '    - "x"',
  '  acceptance_criteria:', '    - id: AC-N3-2', '      given: "g"', '      when: "w"', '      then: "t"',
  '  target_tests:', '    - file: "tests/n3b.test.ts"', '      covers: [AC-N3-2]',
  '```', '',
]);
assert('N3 task con id vuoto RIFIUTATO', n3.status === 1 && n3.rep && n3.rep.ok === false,
  n3.rep ? `ok=${n3.rep.ok} exit=${n3.status} task_count=${n3.rep.task_count}` : `exit=${n3.status}`);

console.log('');
console.log('2d) Copertura template: 01-example-macrotask valida PULITO (11 §4, atteso exit 0):');
const EXAMPLE_TPL = resolve(ROOT, 'trueline', 'references', 'blueprint', 'template', '01-example-macrotask.template.md');
let tplOk = false, tplDetail = 'example template assente';
if (existsSync(EXAMPLE_TPL)) {
  try { rmSync(TMP_ROB, { recursive: true, force: true }); } catch { /* idempotente */ }
  mkdirSync(TMP_ROB, { recursive: true });
  writeFileSync(resolve(TMP_ROB, '01-example.md'), readFileSync(EXAMPLE_TPL, 'utf8'), 'utf8');
  const t = nodeRun(VALIDATE_BP, [TMP_ROB, '--json']);
  let trep = null; try { trep = JSON.parse(t.stdout); } catch { /* gestito */ }
  try { rmSync(TMP_ROB, { recursive: true, force: true }); } catch { /* best effort */ }
  tplOk = t.status === 0 && trep && trep.ok === true;
  tplDetail = trep ? `ok=${trep.ok} task_count=${trep.task_count}` : `exit=${t.status}`;
}
assert('01-example-macrotask.template.md valida pulito', tplOk, tplDetail);
assert('nessun residuo temp 2b-2d', !existsSync(TMP_ROB), existsSync(TMP_ROB) ? 'residuo' : 'assente');

// --- C) Self-check semantico presente/applicabile (11 §5.2) ------------------
console.log('');
console.log('3) Self-check checklist semantica presente e applicabile (11 §5.2):');
assert('self-check-checklist.md esiste', existsSync(CHECKLIST), CHECKLIST);
const checklistTxt = existsSync(CHECKLIST) ? readFileSync(CHECKLIST, 'utf8').toLowerCase() : '';
const semanticPoints = [
  ['6 misurabilità', /6\.\s*misurabilit/],
  ['7 atomicità', /7\.\s*atomicit/],
  ['8 copertura', /8\.\s*copertura/],
  ['9 baseline di sicurezza', /9\.\s*baseline/],
  ['10 niente task fantasma', /10\.\s*niente task fantasma/],
];
for (const [label, re] of semanticPoints) {
  assert(`checklist contiene il punto ${label}`, re.test(checklistTxt),
    re.test(checklistTxt) ? 'presente' : 'mancante');
}

// --- D) I 3 prompt di lifecycle ben formati e parametrizzati (12) ------------
console.log('');
console.log('4) I 3 prompt di lifecycle ben formati e parametrizzati (12 §3, §5):');
const prompts = ['project-start.md', 'session-start.md', 'session-end.md'];
// Parametri attesi (12 §3) — almeno questi placeholder devono comparire.
const requiredParams = ['{{project_name}}', '{{session_state_path}}', '{{macrotask_plan_with_dependencies}}'];
// Invarianti non negoziabili (12 §5) — TUTTI i riferimenti L-COL che ogni prompt
// deve incorporare NEL TESTO EMESSO (incl. L-COL-021 dead-code e L-COL-025 deploy).
const requiredInvariants = ['L-COL-002', 'L-COL-003', 'L-COL-005', 'L-COL-006', 'L-COL-021', 'L-COL-024', 'L-COL-025'];

for (const p of prompts) {
  const fp = resolve(PROMPTS_DIR, p);
  if (!existsSync(fp)) { assert(`${p} esiste`, false, fp); continue; }
  const txt = readFileSync(fp, 'utf8');
  assert(`${p} esiste`, true, '');
  // ben formato: contiene un blocco "da incollare" in un fence ```. I controlli
  // di sostanza si applicano SOLO al contenuto del fence (12 §5: gli invarianti
  // devono stare nel testo EMESSO, non nelle note non-incollabili).
  const fenceMatch = txt.match(/```[a-z]*\r?\n([\s\S]*?)```/);
  const fenced = fenceMatch ? fenceMatch[1] : '';
  assert(`${p} ha un blocco prompt fenced`, Boolean(fenceMatch), fenceMatch ? 'fence presente' : 'nessun fence ```');
  // parametrizzato: i placeholder chiave presenti NEL FENCE
  const missParams = requiredParams.filter((q) => !fenced.includes(q));
  assert(`${p} parametrizzato nel fence (placeholder 12 §3)`, missParams.length === 0,
    missParams.length ? `mancano: ${missParams.join(', ')}` : `placeholder presenti`);
  // invarianti incorporate NEL FENCE (12 §5)
  const missInv = requiredInvariants.filter((q) => !fenced.includes(q));
  assert(`${p} incorpora le invarianti nel fence (12 §5)`, missInv.length === 0,
    missInv.length ? `mancano: ${missInv.join(', ')}` : 'tutte le invarianti citate');
}

// --- E) Nessuna regressione su present / detection / m1_gate -----------------
console.log('');
console.log('5) Nessuna regressione sui gate M0 (present, detection) e M1:');
const pres = nodeRun(RUN_EVAL, ['--mode=present']);
assert('gate M0 present ancora EXIT 0', pres.status === 0, `exit=${pres.status}`);
const det = nodeRun(RUN_EVAL, ['--mode=detection']);
assert('gate M0 detection ancora EXIT 0', det.status === 0, `exit=${det.status}`);
const m1 = nodeRun(M1_GATE, []);
assert('gate M1 ancora EXIT 0', m1.status === 0, `exit=${m1.status}`);

// --- Esito -------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE M2 RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
