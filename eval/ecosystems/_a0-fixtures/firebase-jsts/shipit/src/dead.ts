// Helper realmente usato (importato e chiamato da src/index.ts): knip NON lo
// segnala. Nessun export morto -> controllo 1 (dead-code) VERDE.
export function usedHelper(): number {
  return 7;
}
