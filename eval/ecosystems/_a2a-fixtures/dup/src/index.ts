// Entry point della fixture dup. Usa entrambe le funzioni cosi' knip NON le
// segnala come dead-code: l'UNICO difetto della fixture e' il blocco duplicato
// verbatim dentro computeAlpha/computeBeta (jscpd, categoria duplication).
import { computeAlpha } from "./a.js";
import { computeBeta } from "./b.js";

console.log(computeAlpha(1) + computeBeta(2));
