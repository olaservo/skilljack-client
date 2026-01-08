/**
 * Roots Capability - Expose filesystem directories to servers
 *
 * This module is standalone. Copy this file to add roots support to any MCP client.
 *
 * Usage:
 *   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *   import { setupRoots, pathToRoot } from './capabilities/roots.js';
 *
 *   const client = new Client(
 *     { name: 'my-client', version: '1.0.0' },
 *     { capabilities: { roots: { listChanged: true } } }
 *   );
 *
 *   setupRoots(client, ['/workspace']);
 *   await client.connect(transport);
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ListRootsRequestSchema, type Root } from '@modelcontextprotocol/sdk/types.js';

/**
 * Set up roots capability with static paths.
 */
export function setupRoots(client: Client, paths: string[]): void {
  const roots = paths.map(pathToRoot);

  client.setRequestHandler(ListRootsRequestSchema, async () => {
    return { roots };
  });
}

/**
 * Convert a filesystem path to a Root object.
 */
export function pathToRoot(path: string): Root {
  const normalized = path.replace(/\\/g, '/');
  const name = normalized.split('/').filter(Boolean).pop() || normalized;

  let uri: string;
  if (/^[a-zA-Z]:\//.test(normalized)) {
    uri = `file:///${normalized}`;
  } else if (normalized.startsWith('/')) {
    uri = `file://${normalized}`;
  } else {
    const cwd = process.cwd().replace(/\\/g, '/');
    uri = `file://${cwd}/${normalized}`;
  }

  return { uri, name };
}

/*
 * For dynamic roots, manage state yourself:
 *
 *   let roots = ['/workspace'].map(pathToRoot);
 *
 *   client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots }));
 *
 *   // Later, update and notify:
 *   roots.push(pathToRoot('/new/path'));
 *   await client.sendRootsListChanged();
 */
