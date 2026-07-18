// a.ts importa da b.ts (bHelper) ed esporta aShared, che b.ts importa a sua volta:
// e' il lato "andata" del ciclo di import a -> b -> a.
import { bHelper } from "./b.js";

export function aMain(): number {
  return bHelper() + 1;
}

export function aShared(): number {
  return 10;
}
