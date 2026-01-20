/**
 * Settings Dialog Component
 *
 * Configure Doer and Dreamer model settings.
 */

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useSettings } from './SettingsContext.js';
import { getModelsForProvider, type Provider, type ModelConfig, type ModelOption } from './types.js';

const GearIcon = () => (
  <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

const CloseIcon = () => (
  <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

interface ModelSectionProps {
  title: string;
  description: string;
  config: ModelConfig;
  onChange: (config: ModelConfig) => void;
}

function ModelSection({ title, description, config, onChange }: ModelSectionProps) {
  const models = getModelsForProvider(config.provider);

  const handleProviderChange = (provider: Provider) => {
    const newModels = getModelsForProvider(provider);
    onChange({
      ...config,
      provider,
      modelId: newModels[0]?.id || config.modelId,
    });
  };

  const handleModelChange = (modelId: string) => {
    onChange({ ...config, modelId });
  };

  const handleTemperatureChange = (temperature: number) => {
    onChange({ ...config, temperature });
  };

  const handleMaxTurnsChange = (maxTurns: number) => {
    onChange({ ...config, maxTurns });
  };

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3 className="settings-section-title">{title}</h3>
        <p className="settings-section-description">{description}</p>
      </div>

      <div className="settings-field">
        <label className="settings-label">Provider</label>
        <select
          className="settings-select"
          value={config.provider}
          onChange={(e) => handleProviderChange(e.target.value as Provider)}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>

      <div className="settings-field">
        <label className="settings-label">Model</label>
        <select
          className="settings-select"
          value={config.modelId}
          onChange={(e) => handleModelChange(e.target.value)}
        >
          {models.map((model: ModelOption) => (
            <option key={model.id} value={model.id}>
              {model.name} {model.description ? `(${model.description})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-field">
        <label className="settings-label">
          Temperature: {config.temperature.toFixed(1)}
        </label>
        <input
          type="range"
          className="settings-slider"
          min="0"
          max="1"
          step="0.1"
          value={config.temperature}
          onChange={(e) => handleTemperatureChange(parseFloat(e.target.value))}
        />
        <div className="settings-slider-labels">
          <span>Precise</span>
          <span>Creative</span>
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-label">
          Max Turns: {config.maxTurns}
        </label>
        <input
          type="range"
          className="settings-slider"
          min="1"
          max="15"
          step="1"
          value={config.maxTurns}
          onChange={(e) => handleMaxTurnsChange(parseInt(e.target.value, 10))}
        />
        <div className="settings-slider-labels">
          <span>Single step</span>
          <span>Deep reasoning</span>
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const { doer, dreamer, setDoer, setDreamer, resetDefaults } = useSettings();

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="chat-header-button"
          aria-label="Settings"
          title="Model settings"
        >
          <GearIcon />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="settings-dialog-overlay" />
        <Dialog.Content className="settings-dialog-content">
          <Dialog.Title className="settings-dialog-title">
            Model Settings
          </Dialog.Title>
          <Dialog.Description className="settings-dialog-description">
            Configure the Doer and Dreamer models. Use <code>/dream</code> to switch to Dreamer.
          </Dialog.Description>

          <div className="settings-sections">
            <ModelSection
              title="Doer"
              description="Fast, action-oriented model for getting things done"
              config={doer}
              onChange={setDoer}
            />

            <ModelSection
              title="Dreamer"
              description="Thoughtful model for complex reasoning"
              config={dreamer}
              onChange={setDreamer}
            />
          </div>

          <div className="settings-footer">
            <button
              className="settings-reset-button"
              onClick={resetDefaults}
            >
              Reset to Defaults
            </button>
          </div>

          <Dialog.Close asChild>
            <button
              className="settings-dialog-close"
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
