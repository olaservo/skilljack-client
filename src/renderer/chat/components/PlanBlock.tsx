/**
 * Plan Block
 *
 * Renders the agent's current execution plan as a checklist.
 * Each ACP plan update is a full snapshot; we just render the latest.
 */

import type { AcpPlanEntryView } from '../../../shared/acp-types';

const STATUS_ICON: Record<AcpPlanEntryView['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
};

export function PlanBlock({ entries }: { entries: AcpPlanEntryView[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="acp-plan" aria-label="Agent plan">
      <div className="acp-plan-title">Plan</div>
      <ul className="acp-plan-list">
        {entries.map((entry, index) => (
          <li key={index} className="acp-plan-entry" data-status={entry.status}>
            <span className="acp-plan-icon">{STATUS_ICON[entry.status]}</span>
            <span className="acp-plan-content">{entry.content}</span>
            {entry.priority === 'high' && <span className="acp-plan-priority">high</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
