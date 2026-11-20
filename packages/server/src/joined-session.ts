import { fileSessions, type FileSessionOptions } from '@ahpd/sdk';
import { sessionsDir, sessionsPath } from './config.js';

export const JOINED_SESSION_ENV = 'AHPD_JOINED_SESSION';

type JoinedSession = NonNullable<FileSessionOptions['joined']>;

export function joinedSession(value: unknown): JoinedSession {
  const scope = value as Partial<JoinedSession> | null;
  if (typeof scope?.hostId !== 'string' || scope.hostId === ''
    || typeof scope.innerId !== 'string' || scope.innerId === '') {
    throw new Error('Joined session scope needs a hub identity and an inner session id');
  }
  return { hostId: scope.hostId, innerId: scope.innerId };
}

export function joinedSessions(scope: JoinedSession, onProblem: (message: string) => void) {
  return fileSessions({ dir: sessionsDir(), joined: scope, legacyFile: sessionsPath(), onProblem });
}
