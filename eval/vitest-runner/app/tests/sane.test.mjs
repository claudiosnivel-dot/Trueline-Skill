// covers: AC-1
import { it, expect } from 'vitest';
import { config } from '../src/config.mjs';

it('il tema espone i token attesi', () => {
  expect(config.theme).toEqual({ primary: '#123456', radius: 4 });
});
