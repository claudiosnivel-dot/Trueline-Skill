// Entry point della fixture cycle. Usa aMain cosi' l'intero grafo e' raggiungibile
// da un entry (knip NON segnala dead-code): l'UNICO difetto e' il ciclo di import
// a.ts <-> b.ts che madge deve rilevare (categoria architecture, oracle=cycle).
import { aMain } from "./a.js";

console.log(aMain());
