/**
 * First startup import: take custody before the command registry or plugins
 * evaluate. This path never enters the vault, agent records or ambient child
 * environment. Only pluginHost's literal binding grant exposes the callback.
 */
const file = process.env['AHPD_SERVICE_TOKEN_FILE'];
const tokenFile = process.env['HAB_ID_TOKEN_FILE'];
const bearer = process.env['HAB_ID_TOKEN'];
delete process.env['AHPD_SERVICE_TOKEN_FILE'];
delete process.env['HAB_ID_TOKEN_FILE'];
delete process.env['HAB_ID_TOKEN'];

/** The native host callback; unavailable startup custody is a named failure. */
export const serviceIdentityEnvironment = (): Readonly<{ HAB_ID_TOKEN_FILE: string }> => {
  if (!file) throw new Error('SERVICE_IDENTITY_UNAVAILABLE: no private service identity FILE pointer at startup');
  return Object.freeze({ HAB_ID_TOKEN_FILE: file });
};

/**
 * The identity this process was started with, kept past the scrub above for the one path that must vouch for a
 * child: `ahpd secrets exec`'s mint asks hab to prove the caller's resident identity (#39156 B), and hab's parent
 * selector reads exactly these names. Nothing else in this process is handed them; the wrapper's own child still
 * gets only a minted token file when it names a child.
 */
export const residentIdentity = (): Readonly<{ HAB_ID_TOKEN?: string; HAB_ID_TOKEN_FILE?: string; AHPD_SERVICE_TOKEN_FILE?: string }> =>
  Object.freeze({
    ...(bearer === undefined ? {} : { HAB_ID_TOKEN: bearer }),
    ...(tokenFile === undefined ? {} : { HAB_ID_TOKEN_FILE: tokenFile }),
    ...(file === undefined ? {} : { AHPD_SERVICE_TOKEN_FILE: file }),
  });
