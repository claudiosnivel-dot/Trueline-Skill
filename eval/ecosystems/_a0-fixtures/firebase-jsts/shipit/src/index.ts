// Entry point della fixture ship-it (firebase-jsts). Riferisce usedHelper cosi'
// knip la vede usata: nessun dead-code. NESSUN secret hardcoded.
import { usedHelper } from "./dead.js";

export const STARTUP_TOKEN = usedHelper();

console.log(`shipit fixture avviata, token=${STARTUP_TOKEN}`);
