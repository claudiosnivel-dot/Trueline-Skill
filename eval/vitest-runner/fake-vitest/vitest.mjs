// fake-vitest/vitest.mjs — vitest FINTO per i test dell'adattatore di run_file (VR-1).
//
// Imita la sola superficie che run_file.mjs usa del vitest vero: bin dichiarato nel
// package.json accanto, `run <file> --reporter=json --outputFile=<p>`, report in formato
// Jest-compatibile, exit 0 solo a run riuscito. L'esito lo decide un marcatore nel file
// target: `FAKE:pass N`, `FAKE:fail`, `FAKE:empty` (file senza test: come vitest 5.1.0
// con --passWithNoTests, misurato, suite `passed` senza asserzioni ed exit 0), `FAKE:excluded`
// (o nessun marcatore: file non incluso dalla config), `FAKE:other` (passa, ma il filtro
// ha incluso anche un altro file, che fallisce). Ogni invocazione si annota in
// calls.log accanto a questo file, cosi' i test vedono QUALE runner e' partito e con
// quali argomenti. I test lo copiano in <app>/node_modules/vitest/.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
appendFileSync(join(dirname(fileURLToPath(import.meta.url)), 'calls.log'), `${JSON.stringify(args)}\n`);
const out = (args.find((a) => a.startsWith('--outputFile=')) || '').slice('--outputFile='.length);
if (args[0] !== 'run' || !out || !args.includes('--reporter=json')) process.exit(2);

const file = args[1];
const src = existsSync(file) ? readFileSync(file, 'utf8') : '';
const m = /FAKE:(\w+)(?:\s+(\d+))?/.exec(src) || [];
const mode = m[1] || 'excluded';
const ok = (n) => Array.from({ length: n }, (_, i) => ({ title: `t${i}`, status: 'passed' }));

let results = [];
if (mode === 'pass') results = [{ name: file, status: 'passed', assertionResults: ok(Number(m[2] || 1)) }];
if (mode === 'fail') results = [{ name: file, status: 'failed', assertionResults: [...ok(1), { title: 'f', status: 'failed' }] }];
if (mode === 'other') results = [{ name: file, status: 'passed', assertionResults: ok(1) }, { name: `${file}.altro.test.ts`, status: 'failed', assertionResults: [{ title: 'x', status: 'failed' }] }];
if (mode === 'empty') results = [{ name: file, status: 'passed', message: '', assertionResults: [] }];

const success = results.every((r) => r.status === 'passed');
writeFileSync(out, JSON.stringify({ success, testResults: results }));
process.exit(success ? 0 : 1);
