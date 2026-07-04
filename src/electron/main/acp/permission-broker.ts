/**
 * ACP Permission Broker
 *
 * Bridges agent-initiated session/request_permission requests to the
 * renderer. Requests are pushed as ACP_PERMISSION_REQUEST events with a
 * correlation id; the renderer answers via the ACP_RESPOND_PERMISSION
 * invoke channel. Pending requests are resolved as "cancelled" when the
 * session is cancelled, the agent dies, or the window goes away.
 */

import log from 'electron-log';
import type {
  AcpPermissionOutcome,
  AcpPermissionRequestPayload,
} from '../../../shared/acp-types.js';

interface PendingRequest {
  sessionId: string;
  resolve: (outcome: AcpPermissionOutcome) => void;
}

export class PermissionBroker {
  private pending = new Map<string, PendingRequest>();
  private counter = 0;

  constructor(
    private sendToRenderer: (payload: AcpPermissionRequestPayload) => void,
    private onResolved: (sessionId: string, requestId: string) => void
  ) {}

  /**
   * Push a permission request to the renderer and wait for the answer.
   * No timeout by design: an agent turn legitimately blocks on the user.
   */
  request(
    payload: Omit<AcpPermissionRequestPayload, 'requestId'>
  ): Promise<AcpPermissionOutcome> {
    const requestId = `perm-${++this.counter}-${Date.now()}`;
    return new Promise<AcpPermissionOutcome>((resolve) => {
      this.pending.set(requestId, {
        sessionId: payload.sessionId,
        resolve: (outcome) => {
          this.pending.delete(requestId);
          this.onResolved(payload.sessionId, requestId);
          resolve(outcome);
        },
      });
      this.sendToRenderer({ ...payload, requestId });
    });
  }

  /** Called from the ACP_RESPOND_PERMISSION IPC handler. */
  respond(requestId: string, outcome: AcpPermissionOutcome): void {
    const entry = this.pending.get(requestId);
    if (!entry) {
      log.warn(`[ACP] Permission response for unknown request: ${requestId}`);
      return;
    }
    entry.resolve(outcome);
  }

  /** Resolve all pending requests for a session as cancelled (spec requirement on session/cancel). */
  cancelSession(sessionId: string): void {
    for (const [requestId, entry] of [...this.pending]) {
      if (entry.sessionId === sessionId) {
        log.info(`[ACP] Cancelling pending permission request ${requestId}`);
        entry.resolve({ outcome: 'cancelled' });
      }
    }
  }

  /** Resolve everything as cancelled (agent exit, window destroyed, app quit). */
  cancelAll(): void {
    for (const entry of [...this.pending.values()]) {
      entry.resolve({ outcome: 'cancelled' });
    }
  }
}
