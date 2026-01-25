/**
 * MCPB (MCP Bundle) Types
 *
 * TypeScript interfaces for MCPB manifest schema v0.3 and related types.
 */

/**
 * User configuration option definition in manifest
 */
export interface McpbUserConfigOption {
  type: 'string' | 'number' | 'boolean' | 'directory' | 'file';
  title: string;
  description: string;
  required?: boolean;
  default?: string | number | boolean | string[];
  multiple?: boolean;
  sensitive?: boolean;
  min?: number;
  max?: number;
}

/**
 * Tool declaration in manifest
 */
export interface McpbTool {
  name: string;
  description?: string;
}

/**
 * Platform-specific configuration override
 */
export interface McpbPlatformOverride {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * MCP server configuration within manifest
 */
export interface McpbMcpConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  platform_overrides?: Record<string, McpbPlatformOverride>;
}

/**
 * Server definition in manifest
 * Note: 'uv' type added in manifest v0.4 for Python UV runtime
 */
export interface McpbServer {
  type: 'node' | 'python' | 'binary' | 'uv';
  entry_point: string;
  mcp_config: McpbMcpConfig;
}

/**
 * Author information in manifest
 */
export interface McpbAuthor {
  name: string;
  email?: string;
  url?: string;
}

/**
 * Compatibility constraints in manifest
 */
export interface McpbCompatibility {
  claude_desktop?: string;
  platforms?: Array<'darwin' | 'win32' | 'linux'>;
  runtimes?: {
    python?: string;
    node?: string;
  };
}

/**
 * MCPB Manifest schema v0.3
 */
export interface McpbManifest {
  manifest_version?: string;
  dxt_version?: string; // Deprecated, alias for manifest_version
  name: string;
  display_name?: string;
  version: string;
  description: string;
  long_description?: string;
  author: McpbAuthor;
  repository?: {
    type: string;
    url: string;
  };
  homepage?: string;
  documentation?: string;
  support?: string;
  icon?: string;
  icons?: Array<{
    src: string;
    size: string;
    theme?: string;
  }>;
  screenshots?: string[];
  server: McpbServer;
  tools?: McpbTool[];
  tools_generated?: boolean;
  prompts?: Array<{
    name: string;
    description?: string;
    arguments?: string[];
    text: string;
  }>;
  prompts_generated?: boolean;
  keywords?: string[];
  license?: string;
  privacy_policies?: string[];
  compatibility?: McpbCompatibility;
  user_config?: Record<string, McpbUserConfigOption>;
  _meta?: Record<string, Record<string, unknown>>;
}

/**
 * Signature verification status
 */
export type SignatureStatus = 'signed' | 'self-signed' | 'unsigned';

/**
 * Signature verification result
 */
export interface McpbSignatureInfo {
  status: SignatureStatus;
  publisher?: string;
  issuer?: string;
  valid_from?: string;
  valid_to?: string;
  fingerprint?: string;
}

/**
 * Result of previewing an MCPB file (before installation)
 */
export interface McpbPreviewResult {
  mcpbPath: string;
  manifest: McpbManifest;
  signature: McpbSignatureInfo;
  platformCompatible: boolean;
  missingRequiredConfig: string[];
}

/**
 * Options for installing an MCPB
 */
export interface McpbInstallOptions {
  mcpbPath: string;
  userConfig?: Record<string, unknown>;
  serverName?: string;
}

/**
 * Resolved server configuration ready for registration
 */
export interface ResolvedServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Result of installing an MCPB
 */
export interface McpbInstallResult {
  success: boolean;
  serverName: string;
  message: string;
  installPath?: string;
  config?: ResolvedServerConfig;
}
