#!/usr/bin/env node
// a2b_arch_check.mjs — keystone A2b. Verità = FATTO d'oracolo (L-COL-002).
// Gate falsificabile di arch_check (contratto di altitudine, BUILD-only, gate
// assoluto). Sub-test ancorati al controllo 1 del checkpoint sui fixture:
//   direct:red         violazione diretta ui->data -> controllo 1 ROSSO (blocker arch).
//   transitive:red     laundering ui->domain->data (mode default) -> ROSSO.
//   direct-mode:green  la STESSA topologia con mode:direct -> VERDE.
//   conformant:green   nessuna violazione -> VERDE (contratto che aggancia moduli reali).
//   vacuity:degr       regola con strato a 0 moduli -> arch:degr -> NON verde.
//   absolute:red       violazione già in baseline -> BLOCCA comunque (gate assoluto).
//   allow:reported     violazione allow-listed -> VERDE ma finding presente (accepted-risk).
//   bit-invariance     senza --blueprint (mode remediate) -> nessun ramo arch.
//
// PRECONDIZIONE (passo d'ORCHESTRATORE, L-COL-024): ogni fixture ha node_modules/knip
// risolvibile (run_deadcode, controllo 1 sempre-attivo) e node_modules/madge (arch_check
// via buildModuleGraph). provision_fixtures.sh li installa project-local. Senza, il
// controllo 1 DEGRADA/ERRORE (mai falso verde, L-COL-006) e i sotto-test falliscono.
//
// Node ESM, solo built-in. Exit 0 se tutti i sub-test passano, 1 altrimenti, 2 su
// precondizione mancante (fixture assente).
import { control1Hygiene } from '../../trueline/scripts/checkpoint/checkpoint.mjs';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ecosystems', '_a2b-fixtures');
const RUN = { runId: 'a2b', createdAt: '1970-01-01T00:00:00.000Z' };
const MANIFEST = { languages: ['ts'] }; // graph-capable; NIENTE oracles.dup/arch (dup/cycle non girano)

let fails = 0;
const check = (name, cond, detail) => {
  if (!cond) { fails++; console.log(`  [FAIL] ${name} — ${detail}`); } else console.log(`  [ok]   ${name}`);
};
const need = (s) => { const d = resolve(FIX, s); if (!existsSync(d)) { console.error(`precondizione: fixture ${d} assente`); process.exit(2); } return d; };
// control1 in BUILD col blueprint del fixture (sottodir blueprint/).
const c1 = (dir, { baseline = new Set(), mode = 'build', bp = true } = {}) =>
  control1Hygiene(dir, { manifest: MANIFEST, runOpts: RUN, baseline, mode, blueprintDir: bp ? join(dir, 'blueprint') : null });
const archBlockers = (h) => h.blockers.filter((b) => b.source_oracle.oracle === 'arch');

const direct = need('direct');
const hDir = c1(direct);
check('direct:red', hDir.green === false && archBlockers(hDir).length >= 1, `atteso ROSSO con blocker arch, visto green=${hDir.green} detail=${hDir.detail}`);

const transitive = need('transitive');
const hTr = c1(transitive);
check('transitive:red', hTr.green === false && archBlockers(hTr).length >= 1, `laundering ui->domain->data deve dare ROSSO, visto green=${hTr.green} detail=${hTr.detail}`);

const trDirect = need('transitive-direct');
const hTrD = c1(trDirect);
check('direct-mode:green', hTrD.green === true, `mode:direct NON deve catturare il laundering (VERDE), visto green=${hTrD.green} detail=${hTrD.detail}`);

const conformant = need('conformant');
const hConf = c1(conformant);
check('conformant:green', hConf.green === true, `contratto rispettato -> VERDE, visto green=${hConf.green} detail=${hConf.detail}`);

const vac = need('vacuous-deadrule');
const hVac = c1(vac);
check('vacuity:degr', hVac.green === false && /arch:degr/.test(hVac.detail), `regola morta -> arch:degr (NON verde), visto green=${hVac.green} detail=${hVac.detail}`);

// absolute: la violazione di 'direct' già in baseline deve BLOCCARE comunque.
const dirFps = new Set(archBlockers(hDir).map((b) => b.fingerprint));
const hAbs = dirFps.size > 0 ? c1(direct, { baseline: dirFps }) : null;
check('absolute:red', hAbs && hAbs.green === false && archBlockers(hAbs).length >= 1, `arch pre-esistente deve BLOCCARE (assoluto), visto green=${hAbs && hAbs.green}`);

const allow = need('allowlisted');
const hAllow = c1(allow);
check('allow:reported', hAllow.green === true && hAllow.findings.some((f) => f.source_oracle.oracle === 'arch' && f.fix_state === 'accepted-risk'),
  `violazione allow-listed -> VERDE + finding accepted-risk, visto green=${hAllow.green} detail=${hAllow.detail}`);

// bit-invariance: senza blueprint (mode remediate) il ramo arch è assente.
const hBit = c1(direct, { mode: 'remediate', bp: false });
check('bit-invariance', archBlockers(hBit).length === 0, `senza --blueprint/REMEDIATE nessun arch, visto ${archBlockers(hBit).length}`);

console.log(fails === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
