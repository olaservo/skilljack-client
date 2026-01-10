/**
 * CLI Argument Parsing
 *
 * This module is standalone. Copy this file to add CLI argument parsing to any MCP client.
 *
 * Usage:
 *   import { parseArgs, printHelp, type ParsedArgs } from './cli/args.js';
 *
 *   const args = parseArgs(process.argv.slice(2));
 *   if (args.help) {
 *     printHelp();
 *     process.exit(0);
 *   }
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createStdioTransport } from '../transports/stdio.js';
import { createHttpTransport } from '../transports/http.js';
import { isValidLoggingLevel, LOGGING_LEVELS, type LoggingLevel } from '../capabilities/logging.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ParsedArgs {
  /** Transport to use for connection */
  transport?: Transport;
  /** Filesystem roots to expose */
  roots: string[];
  /** Whether sampling is enabled */
  enableSampling: boolean;
  /** Sampling approval mode */
  approvalMode: 'ask' | 'auto';
  /** Logging level */
  logLevel: LoggingLevel;
  /** CLI-provided instructions */
  cliInstructions?: string;
  /** Whether to disable server instructions */
  noServerInstructions: boolean;
  /** Custom config file path */
  configPath?: string;
  /** Whether help was requested */
  help: boolean;
  /** Conformance mode info */
  conformance?: {
    scenario: string;
    serverUrl: string;
  };
}

export interface ParseError {
  message: string;
  exitCode: number;
}

export type ParseResult =
  | { success: true; args: ParsedArgs }
  | { success: false; error: ParseError };

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse command line arguments.
 *
 * @param argv - Arguments (typically process.argv.slice(2))
 * @returns Parse result with either args or error
 */
export function parseArgs(argv: string[]): ParseResult {
  const args: ParsedArgs = {
    roots: [],
    enableSampling: false,
    approvalMode: 'ask',
    logLevel: 'info',
    noServerInstructions: false,
    help: false,
  };

  // Check for conformance mode first
  const conformanceIndex = argv.indexOf('--conformance');
  if (conformanceIndex !== -1) {
    const remainingArgs = argv.slice(conformanceIndex + 1);
    const serverUrl = remainingArgs[remainingArgs.length - 1];

    let scenario = 'initialize';
    if (remainingArgs.length >= 2 && !remainingArgs[0].startsWith('http')) {
      scenario = remainingArgs[0];
    }

    if (!serverUrl || !serverUrl.startsWith('http')) {
      return {
        success: false,
        error: {
          message: 'Usage: --conformance [scenario] <server-url>\nScenarios: initialize, tools-call, elicitation-defaults',
          exitCode: 1,
        },
      };
    }

    args.conformance = { scenario, serverUrl };
    return { success: true, args };
  }

  // Parse regular arguments
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--stdio' && argv[i + 1]) {
      const parts = argv[i + 1].split(' ');
      args.transport = createStdioTransport(parts[0], parts.slice(1));
      i++;
    } else if (argv[i] === '--url' && argv[i + 1]) {
      args.transport = createHttpTransport(argv[i + 1]);
      i++;
    } else if (argv[i] === '--roots' && argv[i + 1]) {
      args.roots.push(...argv[i + 1].split(','));
      i++;
    } else if (argv[i] === '--log-level' && argv[i + 1]) {
      const level = argv[i + 1];
      if (isValidLoggingLevel(level)) {
        args.logLevel = level;
      } else {
        return {
          success: false,
          error: {
            message: `Invalid log level: ${level}\nValid levels: ${LOGGING_LEVELS.join(', ')}`,
            exitCode: 1,
          },
        };
      }
      i++;
    } else if (argv[i] === '--sampling') {
      args.enableSampling = true;
    } else if (argv[i] === '--instructions' && argv[i + 1]) {
      args.cliInstructions = argv[i + 1];
      i++;
    } else if (argv[i] === '--no-server-instructions') {
      args.noServerInstructions = true;
    } else if (argv[i] === '--config' && argv[i + 1]) {
      args.configPath = argv[i + 1];
      i++;
    } else if (argv[i] === '--approval-mode' && argv[i + 1]) {
      const mode = argv[i + 1];
      if (mode === 'ask' || mode === 'auto') {
        args.approvalMode = mode;
      } else {
        return {
          success: false,
          error: {
            message: `Invalid approval mode: ${mode}\nValid modes: ask, auto`,
            exitCode: 1,
          },
        };
      }
      i++;
    } else if (argv[i] === '--help') {
      args.help = true;
    }
  }

  return { success: true, args };
}

// ============================================================================
// HELP TEXT
// ============================================================================

/**
 * Get the help text for the CLI.
 */
export function getHelpText(): string {
  return `
Usage: mcp-skilljack-client [options]

Connection:
  --stdio "command args"   Connect via stdio
  --url <url>              Connect via HTTP

Capabilities:
  --sampling               Enable sampling (requires ANTHROPIC_API_KEY)
  --approval-mode <mode>   Sampling approval mode (default: ask)
                           ask  = user approves each request (per MCP spec)
                           auto = auto-approve (trusted servers only)
  --roots <paths>          Comma-separated roots to expose
  --log-level <level>      Set logging level (default: info)
                           Levels: ${LOGGING_LEVELS.join(', ')}

Server Instructions:
  --instructions "text"    Add custom instructions for this session
  --no-server-instructions Disable MCP server instructions (selective control)
  --config <path>          Custom config file path (default: ./mcp-client.json)

  Instructions are prepended to the system prompt in sampling requests.
  Sources (in order): MCP server -> config file -> CLI flag

  Config file format (mcp-client.json):
    { "servers": { "server-name": { "instructions": "..." } } }

  SECURITY NOTE: Instructions are probabilistic guidance - do not rely on
  them for security-critical operations. Use deterministic checks instead.

Conformance testing:
  --conformance <scenario> <url>   Run conformance test scenario
                                   Scenarios: initialize, tools-call, elicitation-defaults
`;
}
