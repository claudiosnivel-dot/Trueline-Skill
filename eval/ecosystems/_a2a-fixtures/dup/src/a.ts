// computeAlpha — contiene il blocco duplicato (>=50 token) IDENTICO a computeBeta
// in src/b.ts. E' il difetto verbatim che jscpd deve rilevare.
export function computeAlpha(seed: number): number {
  let total = seed;
  total = total + 11 * 3 - 1;
  total = total + 12 * 3 - 2;
  total = total + 13 * 3 - 3;
  total = total + 14 * 3 - 4;
  total = total + 15 * 3 - 5;
  total = total + 16 * 3 - 6;
  total = total + 17 * 3 - 7;
  total = total + 18 * 3 - 8;
  total = total + 19 * 3 - 9;
  total = total + 20 * 3 - 10;
  return total;
}
