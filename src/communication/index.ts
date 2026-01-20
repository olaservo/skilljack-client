/**
 * Communication Module Exports
 *
 * Provides unified communication adapters for web and Electron modes.
 */

export * from './types.js';
export { createHTTPAdapter } from './http-adapter.js';
export { createIPCAdapter } from './ipc-adapter.js';
