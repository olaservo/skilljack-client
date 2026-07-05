/**
 * ACP Terminal Block
 *
 * Renders a {type: 'terminal'} tool-call content item: polls the main
 * process for output while the owning tool call is running, then shows
 * the final output and exit status.
 */

import { useEffect, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { useCommunication } from '../../hooks/useCommunication';
import type { AcpTerminalOutputResult } from '../../../shared/acp-types';

const POLL_INTERVAL_MS = 500;

interface AcpTerminalBlockProps {
  terminalId: string;
  /** Whether the owning tool call is still running (keeps polling) */
  active: boolean;
}

export function AcpTerminalBlock({ terminalId, active }: AcpTerminalBlockProps) {
  const { state } = useChat();
  const adapter = useCommunication();
  const [result, setResult] = useState<AcpTerminalOutputResult | null>(null);
  const sessionId = state.acpSession?.sessionId;
  // Once the terminal is released by the agent, polling errors; keep the last output
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!adapter.acp || !sessionId || stoppedRef.current) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const output = await adapter.acp!.getTerminalOutput(sessionId, terminalId);
        if (!cancelled) {
          setResult(output);
          if (output.exitStatus) stoppedRef.current = true;
        }
      } catch {
        // Terminal released — keep whatever we captured last
        stoppedRef.current = true;
      }
    };

    poll();
    if (!active) return;
    const timer = setInterval(() => {
      if (stoppedRef.current) {
        clearInterval(timer);
        return;
      }
      poll();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [adapter, sessionId, terminalId, active]);

  if (!result) {
    return <div className="acp-terminal acp-terminal-pending">Running…</div>;
  }

  return (
    <div className="acp-terminal">
      <pre className="acp-terminal-output">
        {result.truncated ? '… (output truncated)\n' : ''}
        {result.output || '(no output)'}
      </pre>
      {result.exitStatus && (
        <div className="acp-terminal-exit" data-ok={result.exitStatus.exitCode === 0}>
          exit {result.exitStatus.exitCode ?? `signal ${result.exitStatus.signal}`}
        </div>
      )}
    </div>
  );
}
