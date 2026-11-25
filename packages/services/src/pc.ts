/**
 * process-compose's REST API, reached over its Unix socket (#38277).
 *
 * Never TCP: the socket is a file only this machine's user can open, and the
 * token in `X-PC-Token-Key` is a second lock on it. Only the routes the driver
 * needs are here, and each is one bounded request with a timeout, because the
 * whole AHP round trip from Hightea has ten seconds.
 *
 * Reload is `POST /project/configuration`, which re-reads the `-f` files from
 * disk. `POST /process` and `POST /project` change process-compose's memory
 * only and are lost when it restarts, so they are never called.
 */
import { request } from 'node:http';
import { readFileSync } from 'node:fs';

/** Where process-compose listens, and the file holding its token. */
export interface PcSocket {
  readonly socket: string;
  readonly tokenFile?: string;
  /** Milliseconds before a request is abandoned; default 5000. */
  readonly timeoutMs?: number;
}

/** One answer: the status and the parsed JSON body (or the raw text when it is not JSON). */
export interface PcAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** Send one request and read the whole answer. Throws, naming the route, on a transport failure. */
export function pcRequest(pc: PcSocket, method: string, path: string): Promise<PcAnswer> {
  let token: string | undefined;
  if (pc.tokenFile !== undefined) {
    try {
      token = readFileSync(pc.tokenFile, 'utf8').trim();
    }
    catch (error) {
      return Promise.reject(new Error(`cannot read process-compose's token file ${pc.tokenFile}: ${(error as Error).message}`));
    }
  }
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath: pc.socket,
      method,
      path,
      headers: { accept: 'application/json', ...(token === undefined ? {} : { 'X-PC-Token-Key': token }) },
      timeout: pc.timeoutMs ?? 5000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', (error) => reject(new Error(`${method} ${path} on ${pc.socket}: ${error.message}`)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: unknown = text;
        try {
          body = text === '' ? undefined : JSON.parse(text);
        }
        catch {
          // Not JSON: the raw text is what the refusal quotes.
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`no answer within ${pc.timeoutMs ?? 5000} ms`)));
    req.on('error', (error) => reject(new Error(`${method} ${path} on ${pc.socket}: ${error.message}`)));
    req.end();
  });
}

/** The route for each verb the driver sends. */
export const ROUTES = {
  reload: (): [string, string] => ['POST', '/project/configuration'],
  start: (name: string): [string, string] => ['POST', `/process/start/${encodeURIComponent(name)}`],
  stop: (name: string): [string, string] => ['PATCH', `/process/stop/${encodeURIComponent(name)}`],
  restart: (name: string): [string, string] => ['POST', `/process/restart/${encodeURIComponent(name)}`],
  logs: (name: string, endOffset: number, limit: number): [string, string] =>
    ['GET', `/process/logs/${encodeURIComponent(name)}/${endOffset}/${limit}`],
  processes: (): [string, string] => ['GET', '/processes'],
};

/** What an unsuccessful answer said, for a refusal: process-compose answers `{error}` on failure. */
export function pcFailure(answer: PcAnswer): string {
  const body = answer.body;
  const said = typeof body === 'object' && body !== null && 'error' in body ? String((body as { error: unknown }).error) : JSON.stringify(body);
  return `process-compose answered ${answer.status}: ${said}`;
}
