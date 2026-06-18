import { verifiedSetFrom, control2CategoriesFrom, VERIFIED_ZERO_CATEGORIES } from './thresholds.mjs';
const m = { verified_set: ['secret','rls','dead-code'], oracles: { secret:{tool:'gitleaks'}, rls:{tool:'rls_check',role:'authz-surface'}, injection:{tool:'semgrep'}, authz:{tool:'semgrep'}, 'dead-code':{tool:'knip'} } };
const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
let ok = true;
// verifiedSetFrom riproduce il default v1
ok = eq(verifiedSetFrom(m), VERIFIED_ZERO_CATEGORIES) && ok;
// control2CategoriesFrom = verified_set "gate-abili" + injection/authz legati
ok = control2CategoriesFrom(m).has('injection') && control2CategoriesFrom(m).has('rls') && ok;
console.log(ok ? 'OK' : 'FAIL'); process.exit(ok ? 0 : 1);
