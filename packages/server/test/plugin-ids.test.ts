import { expect, it, vi } from 'vitest';
import { IMPORT_CASE_MS } from '../../../tools/wait.ts';

vi.setConfig({ testTimeout: IMPORT_CASE_MS });

/*
 * The id each plugin this repository ships exports: its package name without
 * the `@ahpd/` scope, a slug that a route, an owner and a root config key
 * carry as it is.
 */

const PLUGINS: [string, string][] = [
  ['agent-acp', '../../agent-acp/src/plugin.js'],
  ['agent-claude', '../../agent-claude/src/plugin.js'],
  ['agent-cofold', '../../agent-cofold/src/plugin.js'],
  ['agent-pi', '../../agent-pi/src/plugin.js'],
  ['bot', '../../bot/src/plugin.js'],
  ['computer', '../../computer/src/plugin.js'],
  ['push', '../../push/src/plugin.js'],
  ['tunnel-devtunnel', '../../tunnel-devtunnel/src/plugin.js'],
  ['webhook', '../../webhook/src/plugin.js'],
];

for (const [id, path] of PLUGINS) {
  it(`${path} exports the id ${id}`, async () => {
    const module = await import(path) as { name?: unknown };
    expect(module.name).toBe(id);
  });
}
