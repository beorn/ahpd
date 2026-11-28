/**
 * process-compose's API, reached over its Unix socket (#38277).
 *
 * Never TCP: the socket is a file only this machine's user can open, and the
 * token in `X-PC-Token-Key` is a second lock on it. REST reads and the state
 * stream handshake are bounded because the AHP round trip has ten seconds.
 *
 * Reload is `POST /project/configuration`, which re-reads the `-f` files from
 * disk. `POST /process` and `POST /project` change process-compose's memory
 * only and are lost when it restarts, so they are never called.
 */
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import WebSocket from 'ws';

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

const pcHeaders = (pc: PcSocket): Record<string, string> => {
  if (pc.tokenFile === undefined) return {};
  try {
    return { 'X-PC-Token-Key': readFileSync(pc.tokenFile, 'utf8').trim() };
  }
  catch (error) {
    throw new Error(`cannot read process-compose's token file ${pc.tokenFile}: ${(error as Error).message}`);
  }
};

/** Send one request and read the whole answer. Throws, naming the route, on a transport failure. */
export async function pcRequest(pc: PcSocket, method: string, path: string): Promise<PcAnswer> {
  const headers = pcHeaders(pc);
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath: pc.socket,
      method,
      path,
      headers: { accept: 'application/json', ...headers },
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

/** The supervisor's state stream, with the same Unix socket and token as its REST reads. */
export function pcStateStream(pc: PcSocket): WebSocket {
  return new WebSocket('ws://localhost/process/states/ws', {
    createConnection: () => createConnection(pc.socket),
    headers: pcHeaders(pc),
    handshakeTimeout: pc.timeoutMs ?? 5000,
    // Each frame describes one process. Bound what an unexpected sender can buffer.
    maxPayload: 1024 * 1024,
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
