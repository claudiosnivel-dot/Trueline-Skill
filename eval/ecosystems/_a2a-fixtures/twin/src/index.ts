// Entry point della fixture twin. Usa TUTTI e sei i simboli delle due dir sorelle
// cosi' knip NON segnala dead-code e madge non trova cicli: l'UNICO segnale e' la
// coppia di directory parallele commesse/preventivi (twin, detection-only).
import { useAccontoCommessa } from "./commesse/useAccontoCommessa.js";
import { useElencoCommessa } from "./commesse/useElencoCommessa.js";
import { DettaglioCommessa } from "./commesse/DettaglioCommessa.js";
import { useAccontoPreventivo } from "./preventivi/useAccontoPreventivo.js";
import { useElencoPreventivo } from "./preventivi/useElencoPreventivo.js";
import { DettaglioPreventivo } from "./preventivi/DettaglioPreventivo.js";

console.log(
  useAccontoCommessa(),
  useElencoCommessa(),
  DettaglioCommessa(),
  useAccontoPreventivo(),
  useElencoPreventivo(),
  DettaglioPreventivo(),
);
