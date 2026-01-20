/**
 * useCommunication Hook
 *
 * Environment-aware hook that returns the appropriate CommunicationAdapter
 * based on whether we're running in Electron or web mode.
 *
 * IMPORTANT: Both useCommunication() and getCommunicationAdapter() return
 * the SAME singleton instance. This is critical because the IPC adapter
 * uses module-level state for stream management that breaks if multiple
 * adapter instances are created.
 *
 * Usage:
 *   const adapter = useCommunication();
 *   const servers = await adapter.getServers();
 */

import type { CommunicationAdapter } from '../../communication/types.js';
import { createHTTPAdapter } from '../../communication/http-adapter.js';
import { createIPCAdapter } from '../../communication/ipc-adapter.js';

/**
 * Detect if we're running in Electron
 */
function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electronAPI !== undefined;
}

/**
 * Module-level singleton adapter instance.
 * Shared by both useCommunication() and getCommunicationAdapter().
 */
let singletonAdapter: CommunicationAdapter | null = null;

function getOrCreateAdapter(): CommunicationAdapter {
  if (!singletonAdapter) {
    if (isElectron() && window.electronAPI) {
      singletonAdapter = createIPCAdapter(window.electronAPI);
    } else {
      singletonAdapter = createHTTPAdapter();
    }
  }
  return singletonAdapter;
}

/**
 * React hook to get the communication adapter.
 * Returns the same singleton instance on every call.
 */
export function useCommunication(): CommunicationAdapter {
  return getOrCreateAdapter();
}

/**
 * Get the static adapter instance (for use outside React components).
 * Returns the same singleton instance as useCommunication().
 */
export function getCommunicationAdapter(): CommunicationAdapter {
  return getOrCreateAdapter();
}

/**
 * Check if running in Electron environment
 */
export { isElectron };
