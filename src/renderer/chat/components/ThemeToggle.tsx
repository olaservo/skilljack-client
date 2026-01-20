/**
 * Theme Toggle Component
 *
 * Quick theme switcher button that opens a theme panel.
 */

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTheme } from '../context/ThemeContext';

const PaletteIcon = () => (
  <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="8" r="2" fill="currentColor" />
    <circle cx="8" cy="14" r="2" fill="currentColor" />
    <circle cx="16" cy="14" r="2" fill="currentColor" />
  </svg>
);

const CloseIcon = () => (
  <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export function ThemeToggle() {
  const [open, setOpen] = useState(false);
  const { currentTheme, allThemes, setTheme, previewTheme, cancelPreview } = useTheme();

  const handleThemeHover = (theme: typeof currentTheme) => {
    previewTheme(theme);
  };

  const handleThemeLeave = () => {
    cancelPreview();
  };

  const handleThemeSelect = (theme: typeof currentTheme) => {
    setTheme(theme);
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="chat-header-button"
          aria-label="Change theme"
          title="Change theme"
        >
          <PaletteIcon />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="theme-dialog-overlay" />
        <Dialog.Content className="theme-dialog-content">
          <Dialog.Title className="theme-dialog-title">
            Choose a Theme
          </Dialog.Title>
          <Dialog.Description className="theme-dialog-description">
            Select a theme to customize the appearance. Hover to preview.
          </Dialog.Description>

          <div className="theme-grid">
            {allThemes.map((theme) => (
              <button
                key={theme.id}
                className={`theme-card ${currentTheme.id === theme.id ? 'theme-card-active' : ''}`}
                onMouseEnter={() => handleThemeHover(theme)}
                onMouseLeave={handleThemeLeave}
                onClick={() => handleThemeSelect(theme)}
              >
                <div
                  className="theme-card-preview"
                  style={{
                    background: theme.variables['--bg-primary'],
                    borderColor: theme.variables['--border'],
                  }}
                >
                  <div
                    className="theme-card-accent"
                    style={{ background: theme.variables['--accent'] }}
                  />
                  <div
                    className="theme-card-text"
                    style={{ color: theme.variables['--text-primary'] }}
                  />
                </div>
                <span className="theme-card-name">{theme.name}</span>
              </button>
            ))}
          </div>

          <Dialog.Close asChild>
            <button
              className="theme-dialog-close"
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
