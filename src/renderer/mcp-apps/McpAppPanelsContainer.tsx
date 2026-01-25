/**
 * MCP App Panels Container
 *
 * Renders all open MCP App panels with layout controls.
 * Supports grid, tabs, and stack layouts.
 */

import React from 'react';
import { useMcpApps } from './McpAppContext';
import { McpAppPanel } from './McpAppPanel';

export function McpAppPanelsContainer() {
  const {
    panels,
    layoutMode,
    activeTabKey,
    closePanel,
    setLayoutMode,
    setActiveTab,
  } = useMcpApps();

  // Don't render if no panels
  if (panels.length === 0) {
    return null;
  }

  return (
    <div
      className={`mcp-app-container has-app`}
      data-layout={layoutMode}
    >
      {/* Layout Controls */}
      <div className="mcp-layout-controls">
        <button
          className={`mcp-layout-btn ${layoutMode === 'grid' ? 'active' : ''}`}
          onClick={() => setLayoutMode('grid')}
          title="Grid layout"
          aria-label="Grid layout"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
        </button>
        <button
          className={`mcp-layout-btn ${layoutMode === 'tabs' ? 'active' : ''}`}
          onClick={() => setLayoutMode('tabs')}
          title="Tabs layout"
          aria-label="Tabs layout"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <rect x="1" y="4" width="14" height="11" rx="1" />
            <rect x="1" y="1" width="5" height="3" rx="1" />
            <rect x="7" y="1" width="5" height="3" rx="0.5" opacity="0.5" />
          </svg>
        </button>
        <button
          className={`mcp-layout-btn ${layoutMode === 'stack' ? 'active' : ''}`}
          onClick={() => setLayoutMode('stack')}
          title="Stack layout"
          aria-label="Stack layout"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <rect x="1" y="1" width="14" height="4" rx="1" />
            <rect x="1" y="6" width="14" height="4" rx="1" />
            <rect x="1" y="11" width="14" height="4" rx="1" />
          </svg>
        </button>
      </div>

      {/* Tab Bar (only shown in tabs mode) */}
      {layoutMode === 'tabs' && (
        <div className="mcp-app-tabs" role="tablist">
          {panels.map((panel) => {
            const toolName =
              panel.uiResourceUri.split('/').pop() || panel.uiResourceUri;
            return (
              <div
                key={panel.key}
                className={`mcp-app-tab ${activeTabKey === panel.key ? 'active' : ''}`}
                onClick={() => setActiveTab(panel.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab(panel.key);
                  }
                }}
                role="tab"
                tabIndex={0}
                aria-selected={activeTabKey === panel.key}
              >
                <span className="mcp-tab-label">
                  {toolName} ({panel.serverName})
                </span>
                <button
                  className="mcp-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closePanel(panel.key);
                  }}
                  aria-label="Close tab"
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Panels */}
      <div className="mcp-app-panels">
        {panels.map((panel) => (
          <McpAppPanel
            key={panel.key}
            panel={panel}
            onClose={() => closePanel(panel.key)}
            isActive={layoutMode !== 'tabs' || activeTabKey === panel.key}
          />
        ))}
      </div>
    </div>
  );
}
