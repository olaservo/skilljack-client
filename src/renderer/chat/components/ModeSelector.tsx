/**
 * Mode Selector Component
 *
 * Shows the ACP session's config options (preferred) or legacy session
 * modes as compact selectors in the drawer header. Per spec, when an
 * agent advertises both, config options win.
 */

import { useChat } from '../context/ChatContext';

export function ModeSelector() {
  const { state, setAcpMode, setAcpConfigOption } = useChat();
  const session = state.acpSession;
  if (!session || state.backend.kind !== 'acp') return null;

  if (session.configOptions.length > 0) {
    return (
      <div className="mode-selector">
        {session.configOptions.map((option) =>
          option.type === 'select' ? (
            <select
              key={option.id}
              className="mode-selector-select"
              value={String(option.currentValue ?? '')}
              onChange={(e) => setAcpConfigOption(option.id, e.target.value)}
              title={option.description || option.name}
              aria-label={option.name}
            >
              {option.options.map((value) => (
                <option key={value.value} value={value.value} title={value.description}>
                  {value.name}
                </option>
              ))}
            </select>
          ) : (
            <label key={option.id} className="mode-selector-toggle" title={option.description || option.name}>
              <input
                type="checkbox"
                checked={option.currentValue === true}
                onChange={(e) => setAcpConfigOption(option.id, e.target.checked)}
              />
              {option.name}
            </label>
          )
        )}
      </div>
    );
  }

  if (session.modes && session.modes.availableModes.length > 0) {
    return (
      <div className="mode-selector">
        <select
          className="mode-selector-select"
          value={session.modes.currentModeId}
          onChange={(e) => setAcpMode(e.target.value)}
          aria-label="Agent mode"
          title="Agent mode"
        >
          {session.modes.availableModes.map((mode) => (
            <option key={mode.id} value={mode.id} title={mode.description}>
              {mode.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return null;
}
