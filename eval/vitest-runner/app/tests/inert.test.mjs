// covers: AC-1
// Tautologia voluta: il lato atteso e' lo stesso binding che config usa, quindi
// l'asserzione resta verde qualunque valore abbia TOKENS.
import { it, expect } from 'vitest';
import { config } from '../src/config.mjs';
import { TOKENS } from '../src/tokens.mjs';

it('il tema espone i token', () => {
  expect(config.theme).toEqual(TOKENS);
});
