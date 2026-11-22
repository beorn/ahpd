/**
 * First startup import: take custody before the command registry or plugins
 * evaluate. This path never enters the vault, agent records or ambient child
 * environment. Only pluginHost's literal binding grant exposes the callback.
 */
const file = process.env['AHPD_SERVICE_TOKEN_FILE'];
delete process.env['AHPD_SERVICE_TOKEN_FILE'];
delete process.env['HAB_ID_TOKEN_FILE'];
delete process.env['HAB_ID_TOKEN'];

/** The native host callback; unavailable startup custody is a named failure. */
export const serviceIdentityEnvironment = (): Readonly<{ HAB_ID_TOKEN_FILE: string }> => {
  if (!file) throw new Error('SERVICE_IDENTITY_UNAVAILABLE: no private service identity FILE pointer at startup');
  return Object.freeze({ HAB_ID_TOKEN_FILE: file });
};
