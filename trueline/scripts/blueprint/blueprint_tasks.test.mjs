// blueprint_tasks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTasks } from './blueprint_tasks.mjs';

test('loadTasks legge i task e normalizza covers scalare ad array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bt-'));
  writeFileSync(join(dir, '01.md'), [
    '```yaml',
    '- id: T-1',
    '  macrotask: m',
    '  objective: o',
    '  definition_of_done: [d]',
    '  acceptance_criteria:',
    '    - id: AC-1',
    '      given: g',
    '      when: w',
    '      then: t',
    '  target_tests:',
    '    - file: "tests/a.test.mjs"',
    '      covers: AC-1',            // scalare, non lista
    '```',
  ].join('\n'));
  const tasks = loadTasks(dir);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].target_tests[0].covers, ['AC-1']); // normalizzato
  assert.equal(tasks[0].target_tests[0].file, 'tests/a.test.mjs');
});
