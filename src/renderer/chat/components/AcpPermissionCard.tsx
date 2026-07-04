/**
 * ACP Permission Card
 *
 * Blocking inline card shown when the agent requests permission for a
 * tool call. One button per option, styled by kind. Input stays
 * disabled until the user answers (or the turn is cancelled).
 */

import { useChat } from '../context/ChatContext';
import type { AcpPermissionOptionKind } from '../../../shared/acp-types';
import { AcpDiffBlock } from './AcpDiffBlock';

const KIND_CLASS: Record<AcpPermissionOptionKind, string> = {
  allow_once: 'permission-allow',
  allow_always: 'permission-allow-always',
  reject_once: 'permission-reject',
  reject_always: 'permission-reject-always',
};

export function AcpPermissionCard() {
  const { state, respondAcpPermission } = useChat();
  const permission = state.acpSession?.activePermission;
  if (!permission) return null;

  const { toolCall } = permission;
  const diff = toolCall.contentBlocks?.find((block) => block.type === 'diff');

  return (
    <div className="acp-permission-card" role="alertdialog" aria-label="Permission request">
      <div className="acp-permission-title">
        <span className="acp-permission-icon">🔐</span>
        <span>
          {state.backend.kind === 'acp' ? state.backend.agentName : 'Agent'} wants to run:{' '}
          <strong>{toolCall.title || toolCall.kind || 'a tool'}</strong>
        </span>
      </div>

      {diff && diff.type === 'diff' && (
        <div className="acp-permission-preview">
          <AcpDiffBlock path={diff.path} oldText={diff.oldText ?? null} newText={diff.newText} />
        </div>
      )}

      {toolCall.rawInput != null && !diff && (
        <pre className="acp-permission-input">{JSON.stringify(toolCall.rawInput, null, 2)}</pre>
      )}

      <div className="acp-permission-options">
        {permission.options.map((option) => (
          <button
            key={option.optionId}
            className={`acp-permission-button ${KIND_CLASS[option.kind] ?? ''}`}
            onClick={() =>
              respondAcpPermission(permission.requestId, {
                outcome: 'selected',
                optionId: option.optionId,
              })
            }
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}
