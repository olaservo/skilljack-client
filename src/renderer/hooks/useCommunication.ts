/**
 * useCommunication Hook
 *
 * Environment-aware hook that returns the appropriate CommunicationAdapter
 * based on whether we're running in Electron or web mode.
 *
 * Usage:
 *   const adapter = useCommunication();
 *   const servers = await adapter.getServers();
 */

import { useMemo, useEffect, useRef } from 'react';
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
 * Get the appropriate communication adapter for the current environment.
 * This is a singleton that persists for the lifetime of the component tree.
 */
export function useCommunication(): CommunicationAdapter {
  const adapterRef = useRef<CommunicationAdapter | null>(null);

  // Create adapter once and memoize
  const adapter = useMemo(() => {
    if (adapterRef.current) {
      return adapterRef.current;
    }

    if (isElectron() && window.electronAPI) {
      adapterRef.current = createIPCAdapter(window.electronAPI);
    } else {
      adapterRef.current = createHTTPAdapter();
    }

    return adapterRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (adapterRef.current) {
        adapterRef.current.dispose();
        adapterRef.current = null;
      }
    };
  }, []);

  return adapter;
}

/**
 * Get a static adapter instance (for use outside React components)
 */
let staticAdapter: CommunicationAdapter | null = null;

export function getCommunicationAdapter(): CommunicationAdapter {
  if (!staticAdapter) {
    if (isElectron() && window.electronAPI) {
      staticAdapter = createIPCAdapter(window.electronAPI);
    } else {
      staticAdapter = createHTTPAdapter();
    }
  }
  return staticAdapter;
}

/**
 * Check if running in Electron environment
 */
export { isElectron };
