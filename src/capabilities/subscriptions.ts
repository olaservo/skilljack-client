/**
 * Resource Subscriptions - Subscribe to real-time resource updates
 *
 * This module is standalone. Copy this file to add subscription support to any MCP client.
 *
 * Usage:
 *   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *   import { setupSubscriptions } from './capabilities/subscriptions.js';
 *
 *   const client = new Client({ name: 'my-client', version: '1.0.0' }, { capabilities: {} });
 *
 *   setupSubscriptions(client, (uri) => {
 *     console.log('Resource updated:', uri);
 *   });
 *
 *   await client.connect(transport);
 *
 *   // Subscribe to a resource (if server supports it)
 *   await client.subscribeResource({ uri: 'file:///data.json' });
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * Set up notification handler for resource updates.
 *
 * The callback receives the URI of the updated resource.
 * Use client.readResource({ uri }) to fetch the new content.
 */
export function setupSubscriptions(
  client: Client,
  onResourceUpdated: (uri: string) => void
): void {
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (notification) => {
    onResourceUpdated(notification.params.uri);
  });
}

/**
 * Check if server supports resource subscriptions.
 */
export function serverSupportsSubscriptions(client: Client): boolean {
  const caps = client.getServerCapabilities();
  return caps?.resources?.subscribe === true;
}
