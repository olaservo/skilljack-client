/**
 * MCP Apps Capability Module
 *
 * Provides helpers for detecting and working with MCP App UIs.
 * MCP Apps (SEP-1865) allow servers to deliver interactive HTML UIs
 * that render tool results in sandboxed iframes.
 *
 * Usage:
 *   import { toolHasUI, getToolUiResourceUri, fetchUIResource } from './capabilities/apps.js';
 *
 *   const tools = await client.listTools();
 *   for (const tool of tools.tools) {
 *     if (toolHasUI(tool)) {
 *       const uri = getToolUiResourceUri(tool);
 *       const resource = await fetchUIResource(client, uri!);
 *       // resource.html contains the app HTML
 *     }
 *   }
 */

import {
  getToolUiResourceUri,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Re-export key constants and helpers
export { getToolUiResourceUri, RESOURCE_MIME_TYPE };

/**
 * Check if a tool has an associated UI resource.
 */
export function toolHasUI(tool: Tool): boolean {
  return !!getToolUiResourceUri(tool);
}

/**
 * UI resource content with optional CSP metadata.
 */
export interface UIResource {
  html: string;
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
  };
}

/**
 * Fetch the UI resource HTML for a given uri:// URI.
 * Returns null if the resource is not a valid MCP App resource.
 */
export async function fetchUIResource(
  client: Client,
  uri: string
): Promise<UIResource | null> {
  const resource = await client.readResource({ uri });

  if (!resource || resource.contents.length !== 1) {
    return null;
  }

  const content = resource.contents[0];

  // Verify it's an MCP App resource
  if (content.mimeType !== RESOURCE_MIME_TYPE) {
    return null;
  }

  // Extract HTML (text or base64 blob)
  const html = 'blob' in content ? atob(content.blob as string) : (content.text as string);

  // Extract CSP metadata if present
  const csp = (content as { _meta?: { ui?: { csp?: UIResource['csp'] } } })._meta?.ui?.csp;

  return { html, csp };
}

/**
 * Get tool info with UI detection for display purposes.
 */
export interface ToolWithUIInfo {
  name: string;
  description?: string;
  hasUI: boolean;
  uiResourceUri?: string;
}

/**
 * Get tool list with UI information.
 */
export async function getToolsWithUIInfo(client: Client): Promise<ToolWithUIInfo[]> {
  const { tools } = await client.listTools();

  return tools.map((tool) => {
    const uiResourceUri = getToolUiResourceUri(tool);
    return {
      name: tool.name,
      description: tool.description,
      hasUI: !!uiResourceUri,
      uiResourceUri,
    };
  });
}

/**
 * Tool visibility targets (v0.4.1)
 * - 'model': visible to LLM for AI-initiated tool calls
 * - 'app': visible to apps for app-initiated tool calls via tools/call
 */
export type ToolVisibility = 'model' | 'app';

/**
 * Get the visibility settings for a tool.
 * Tools can specify visibility in _meta.ui.visibility array.
 * Default: visible to both model and app.
 */
export function getToolVisibility(tool: Tool): ToolVisibility[] {
  const meta = tool._meta as { ui?: { visibility?: string[] } } | undefined;
  const visibility = meta?.ui?.visibility;
  if (Array.isArray(visibility) && visibility.length > 0) {
    return visibility.filter((v): v is ToolVisibility => v === 'model' || v === 'app');
  }
  return ['model', 'app']; // default: visible to both
}

/**
 * Check if a tool should be visible to the LLM/model.
 * Tools with visibility: ["app"] are hidden from the model.
 */
export function isToolVisibleToModel(tool: Tool): boolean {
  return getToolVisibility(tool).includes('model');
}
