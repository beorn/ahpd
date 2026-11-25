import type { AnnotationsState, AnnotationsSummary } from '@microsoft/agent-host-protocol';
import { annotationsChannelOf } from './channels.js';

/**
 * What a session says of its annotations without a subscribe: the channel
 * that holds them and how many there are, as VS Code's host fills
 * `SessionState.annotations` and the session's row.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.1.0/types/channels-annotations/state.ts#L25-L36
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2758-L2763
 */
export const annotationsSummaryOf = (session: string, marks: AnnotationsState): AnnotationsSummary => ({
  resource: annotationsChannelOf(session),
  annotationCount: marks.annotations.length,
  entryCount: marks.annotations.reduce((count, annotation) => count + annotation.entries.length, 0),
});
