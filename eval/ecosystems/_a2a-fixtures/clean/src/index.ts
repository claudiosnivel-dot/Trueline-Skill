// Entry point della fixture clean (contrasto). Un solo modulo, un solo import
// usato: nessun dead-code (knip), nessun blocco duplicato (jscpd), nessun ciclo
// (madge), nessuna dir parallela (twin). Il controllo 1 deve essere VERDE.
import { formatNota } from "./format.js";

console.log(formatNota("ciao"));
