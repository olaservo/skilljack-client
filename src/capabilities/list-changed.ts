/**
 * List Changed Capability - React to dynamic tool/prompt/resource changes
 *
 * This module is standalone. Copy this file to add dynamic discovery to any MCP client.
 *
 * Usage:
 *   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *   import { setupListChanged } from './capabilities/list-changed.js';
 *
 *   const client = new Client({ name: 'my-client', version: '1.0.0' }, { capabilities: {} });
 *
 *   setupListChanged(client, {
 *     onToolsChanged: (tools) => console.log('Tools:', tools.map(t => t.name)),
 *   });
 *
 *   await client.connect(transport);
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  type Tool,
  type Prompt,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js';

export interface ListChangedCallbacks {
  onToolsChanged?: (tools: Tool[]) => void;
  onPromptsChanged?: (prompts: Prompt[]) => void;
  onResourcesChanged?: (resources: Resource[]) => void;
}

/**
 * Set up notification handlers for list changes.
 *
 * Note: For auto-refresh, use the SDK's built-in listChanged option instead:
 *
 *   new Client(info, {
 *     capabilities: {},
 *     listChanged: {
 *       tools: { autoRefresh: true, onChanged: (err, tools) => {...} }
 *     }
 *   });
 */
export function setupListChanged(client: Client, callbacks: ListChangedCallbacks): void {
  if (callbacks.onToolsChanged) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      const result = await client.listTools();
      callbacks.onToolsChanged!(result.tools);
    });
  }

  if (callbacks.onPromptsChanged) {
    client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
      const result = await client.listPrompts();
      callbacks.onPromptsChanged!(result.prompts);
    });
  }

  if (callbacks.onResourcesChanged) {
    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      const result = await client.listResources();
      callbacks.onResourcesChanged!(result.resources);
    });
  }
}
