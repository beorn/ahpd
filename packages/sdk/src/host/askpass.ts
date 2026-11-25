import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The helper `sudo -A`, `ssh` and `git` run when a command needs a password.
 *
 * The programs name a helper through an environment variable - `SUDO_ASKPASS`,
 * `SSH_ASKPASS`, `GIT_ASKPASS` - and run it with the prompt as its first
 * argument, reading the answer from its standard output. The helper here sends
 * the prompt to the host over the local socket it names, waits for the answer,
 * and prints it. It is a Node program because the host already runs Node and a
 * Windows machine has no `sh` to write one in.
 */

/** The Node program the wrappers run. */
const ASKPASS_PROGRAM = `'use strict';
const fs = require('node:fs');
const net = require('node:net');
const socketPath = process.env.AHPD_SHELL_AUTH_SOCKET;
const token = process.env.AHPD_SHELL_AUTH_TOKEN;
const prompt = process.argv[2] || '';
if (!socketPath || !token) process.exit(1);
const connection = net.createConnection(socketPath);
let heard = '';
let answered = false;
let ended = false;
const stop = (code) => {
  if (ended) return;
  ended = true;
  process.exit(code);
};
const socketInode = () => {
  try {
    const fd = connection._handle && connection._handle.fd;
    if (typeof fd === 'number' && fd >= 0) {
      const target = fs.readlinkSync('/proc/self/fd/' + fd);
      if (target.startsWith('socket:[') && target.endsWith(']')) {
        const inode = Number(target.slice(8, -1));
        if (Number.isSafeInteger(inode) && inode > 0) return inode;
      }
    }
  }
  catch {
    // The connection's own descriptor could not be named; the scan below does.
  }
  try {
    const found = [];
    for (const name of fs.readdirSync('/proc/self/fd')) {
      try {
        const target = fs.readlinkSync('/proc/self/fd/' + name);
        if (!target.startsWith('socket:[') || !target.endsWith(']')) continue;
        const inode = Number(target.slice(8, -1));
        if (Number.isSafeInteger(inode) && inode > 0) found.push(inode);
      }
      catch {
        // The descriptor closed while it was read.
      }
    }
    return found.length === 1 ? found[0] : null;
  }
  catch {
    return null;
  }
};
connection.setEncoding('utf8');
connection.on('connect', () => {
  connection.write(JSON.stringify({ token, prompt, pid: process.pid, socket: socketInode() }) + '\\n');
});
connection.on('data', (chunk) => {
  heard += chunk;
  const newline = heard.indexOf('\\n');
  if (newline < 0) return;
  let answer;
  try {
    answer = JSON.parse(heard.slice(0, newline)).answer;
  }
  catch {
    stop(1);
    return;
  }
  if (typeof answer !== 'string') {
    stop(1);
    return;
  }
  answered = true;
  process.stdout.write(answer + '\\n', () => stop(0));
});
connection.on('error', () => stop(1));
connection.on('close', () => {
  if (!answered) stop(1);
});
`;

/** One path through a shell, quoted so a space in it is the path's own. */
const quoted = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/** One path through `cmd.exe`, quoted the way it reads its own command line. */
const windowsQuoted = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/** The files that make the helper runnable, and the one this platform names. */
export interface AskpassFiles {
  /** The Node program the wrappers run. */
  program: string;
  /** The `sh` wrapper `SUDO_ASKPASS`, `SSH_ASKPASS` and `GIT_ASKPASS` name on POSIX. */
  shell: string;
  /** The `cmd.exe` wrapper they name on Windows. */
  command: string;
  /** The wrapper this platform's programs can run. */
  wrapper: string;
}

/**
 * Write the helper and its wrappers into `folder`, which belongs to the host.
 *
 * The tools run the wrapper directly, so the `sh` one is executable; the
 * program is read by Node and the `.cmd` one by `cmd.exe`, which do not need
 * it. The folder is the host's own and owner-only, and the host removes it
 * with the socket.
 */
export function writeAskpass(
  folder: string,
  node: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): AskpassFiles {
  const program = join(folder, 'askpass.js');
  const shell = join(folder, 'askpass.sh');
  const command = join(folder, 'askpass.cmd');
  writeFileSync(program, ASKPASS_PROGRAM, { mode: 0o600 });
  writeFileSync(shell, `#!/bin/sh\nexec ${quoted(node)} ${quoted(program)} "$@"\n`, { mode: 0o700 });
  chmodSync(shell, 0o700);
  writeFileSync(command, `@echo off\r\n${windowsQuoted(node)} ${windowsQuoted(program)} %*\r\n`, { mode: 0o600 });
  return { program, shell, command, wrapper: platform === 'win32' ? command : shell };
}
