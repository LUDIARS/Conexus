import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), shell: false, stdio: 'inherit', timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error('review_check_failed');
}
// Revisor uses a fresh checkout without node_modules. Install locked dev dependencies
// before compiling, with lifecycle scripts disabled and no command shell.
const npm = [resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(existsSync);
if (!npm) throw new Error('matching_npm_cli_missing');
run([npm, 'ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
run([resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json']);
const tests = readdirSync('dist/test').filter(name => name.endsWith('.test.js')).sort().map(name => resolve('dist/test', name));
if (!tests.length) throw new Error('no_tests_discovered');
run(['--test', ...tests]);
