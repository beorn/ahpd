import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { cli, config, home, put } from './cli.js';

// A cold native entry, not an import after plugins have already evaluated:
// module-level plugin code and its default-inheritance child must both be clean.
it.each([true, false])('takes service custody before plugin code and refuses record env refs (startup identity: %s)', async (available) => {
  const plugin = join(home, 'identity.mjs');
  const marker = join(home, 'identity.json');
  writeFileSync(join(home, 'plugin.json'), JSON.stringify({ id: 'identity', main: './identity.mjs' }));
  writeFileSync(plugin, `
    import { writeFileSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    import { resolved, AGENT_SECRETS, CONNECTOR_SECRETS } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../../sdk/src/channels/owners.ts')).href)};
    const names = ['AHPD_SERVICE_TOKEN_FILE', 'HAB_ID_TOKEN_FILE', 'HAB_ID_TOKEN'];
    const ambient = Object.fromEntries(names.map(name => [name, process.env[name] !== undefined]));
    const child = JSON.parse(execFileSync(process.execPath, ['-e',
      'console.log(JSON.stringify(Object.fromEntries(' + JSON.stringify(names) + '.map(name => [name, process.env[name] !== undefined]))))'
    ], { encoding: 'utf8' }));
    export async function apply(host) {
      let source;
      try { source = host.serviceIdentityEnvironment('src_km'); }
      catch (error) { source = error.message.split(':')[0]; }
      const gaps = [];
      // These are the exact shared resolution paths used to open agent records
      // (nested env) and connectors (top-level secret refs).
      for (const [config, rules] of [
        [{ env: { PRIVATE: { fromEnv: names[0] }, FILE: { fromEnv: names[1] } } }, AGENT_SECRETS],
        [{ secret: { fromEnv: names[0] } }, CONNECTOR_SECRETS],
        [{ secret: { fromEnv: names[1] } }, CONNECTOR_SECRETS],
      ]) {
        try { gaps.push(await resolved(config, 'host', undefined, rules)); }
        catch (error) { gaps.push(error.gaps.map(gap => gap.ref)); }
      }
      writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ ambient, child, source, gaps }));
      process.exit(0);
    }
  `);
  put({ plugins: [{ source: plugin, grants: ['service-env:src_km'] }] });
  const said = await cli(['--config-file', config, '--no-update-check'], { env: {
    ...(available ? { AHPD_SERVICE_TOKEN_FILE: '/private/fixture-service-token' } : {}),
    HAB_ID_TOKEN_FILE: '/private/legacy-must-not-leak',
    HAB_ID_TOKEN: 'fixture-raw-must-not-leak',
  }, ...(available ? {} : { unset: ['AHPD_SERVICE_TOKEN_FILE'] }) });
  expect(said.code, said.stderr + said.stdout).toBe(0);
  const clean = { AHPD_SERVICE_TOKEN_FILE: false, HAB_ID_TOKEN_FILE: false, HAB_ID_TOKEN: false };
  expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({
    ambient: clean,
    child: clean,
    source: available ? { HAB_ID_TOKEN_FILE: '/private/fixture-service-token' } : 'SERVICE_IDENTITY_UNAVAILABLE',
    gaps: [['env:AHPD_SERVICE_TOKEN_FILE', 'env:HAB_ID_TOKEN_FILE'], ['env:AHPD_SERVICE_TOKEN_FILE'], ['env:HAB_ID_TOKEN_FILE']],
  });
}, 30_000);
