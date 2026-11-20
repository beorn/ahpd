import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { admitCustody } from '../../src/session/custody.js';
import { childProcessOf, connectAcp } from '../../src/connection.js';

const [prefix, log, mode, command] = process.argv.slice(2);
if (!prefix || !log || !mode || !command) throw new Error('custody-host needs prefix, log, mode and child runtime');
const held = await admitCustody(prefix, 1000, 'crash-fixture', true);
if (!held.write('spawning', null) || held.spawnGuard === undefined || held.inheritedFd === undefined) throw new Error('Qualified admission missing');
let childPid: number | undefined;
if (mode === 'after-spawn') {
  const child = connectAcp({ command, args: [fileURLToPath(new URL('./acp-server.mjs', import.meta.url)), '--adopt-spawn-guard'],
    extraStdio: [held.inheritedFd], env: { ACP_LOG: log, HAB_ACP_SPAWN_GUARD: JSON.stringify({ ...held.spawnGuard, fd: 3, opening: held.opening }) },
    handlers: { update: () => {} },
  });
  childPid = childProcessOf(child)?.pid;
  if (childPid === undefined) throw new Error('Actual transport child has no PID');
  held.releaseInherited();
}
process.stdout.write(`${JSON.stringify({ record: JSON.parse(readFileSync(`${prefix}.custody`, 'utf8')), childPid })}\n`);
// The test kills this actual host before it can stamp a child or initialize.
process.stdin.resume();
setInterval(() => {}, 1000);
