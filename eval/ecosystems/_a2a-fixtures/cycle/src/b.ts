// b.ts importa da a.ts (aShared): e' il lato "ritorno" del ciclo di import
// a -> b -> a. bHelper e' usata da a.ts (nessun export morto).
import { aShared } from "./a.js";

export function bHelper(): number {
  return aShared() + 2;
}
