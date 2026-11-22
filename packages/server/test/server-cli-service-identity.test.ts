import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { cli, config, home, put } from './cli.js';

// A cold native entry, not an import after plugins have already evaluated:
// module-level plugin code and its default-inheritance child must both be clean.
it('takes service custody before plugin module code and exposes it only through the binding grant', async () => {
  const plugin = join(home, 'identity.mjs');
  const marker = join(home, 'identity.json');
  writeFileSync(join(home, 'plugin.json'), JSON.stringify({ id: 'identity', main: './identity.mjs' }));
  writeFileSync(plugin, `
    import { writeFileSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    const names = ['AHPD_SERVICE_TOKEN_FILE', 'HAB_ID_TOKEN_FILE', 'HAB_ID_TOKEN'];
    const ambient = Object.fromEntries(names.map(name => [name, process.env[name] !== undefined]));
    const child = JSON.parse(execFileSync(process.execPath, ['-e',
      'console.log(JSON.stringify(Object.fromEntries(' + JSON.stringify(names) + '.map(name => [name, process.env[name] !== undefined]))))'
    ], { encoding: 'utf8' }));
    export function apply(host) {
      writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ ambient, child, source: host.serviceIdentityEnvironment('src_km') }));
      throw new Error('identity probe complete');
    }
  `);
  put({ plugins: [{ source: plugin, grants: ['service-env:src_km'] }] });
  const said = await cli(['--config-file', config, '--no-update-check'], { env: {
    AHPD_SERVICE_TOKEN_FILE: '/private/fixture-service-token',
    HAB_ID_TOKEN_FILE: '/private/legacy-must-not-leak',
    HAB_ID_TOKEN: 'fixture-raw-must-not-leak',
  } });
  expect(said.stderr + said.stdout).toContain('identity probe complete');
  const clean = { AHPD_SERVICE_TOKEN_FILE: false, HAB_ID_TOKEN_FILE: false, HAB_ID_TOKEN: false };
  expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({
    ambient: clean,
    child: clean,
    source: { HAB_ID_TOKEN_FILE: '/private/fixture-service-token' },
  });
}, 30_000);
