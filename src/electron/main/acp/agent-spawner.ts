/**
 * ACP Agent Process Spawner
 *
 * Spawns agent CLIs (claude-agent-acp, codex-acp, gemini, ...) as stdio
 * subprocesses. Windows needs care:
 * - npm-installed CLIs are .cmd shims, which require shell: true to spawn
 * - GUI-launched Electron apps can inherit a reduced PATH, so we fall back
 *   to reading the machine/user PATH from the registry
 *
 * Command resolution ported from .inbox/acpx/src/spawn-command-options.ts;
 * registry PATH augmentation ported from obsidian-agent-client.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import log from 'electron-log';
import type { AcpAgentConfig } from '../../../shared/acp-types.js';

// ============================================
// Windows command resolution
// ============================================

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  return (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function commandCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
  if (path.extname(command).length > 0) {
    return [command];
  }
  return windowsExecutableExtensions(env).map((ext) => `${command}${ext}`);
}

function commandHasPath(command: string): boolean {
  return command.includes('/') || command.includes('\\') || path.isAbsolute(command);
}

function findInPath(candidates: string[], pathValue: string): string | undefined {
  for (const directory of pathValue.split(';')) {
    const dir = directory.trim();
    if (!dir) continue;
    for (const candidate of candidates) {
      const resolved = path.join(dir, candidate);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
  }
  return undefined;
}

let registryPathCache: string | null | undefined;

/**
 * Read machine + user PATH from the Windows registry. Electron apps
 * launched from the GUI may not inherit the full shell PATH.
 */
function getRegistryPath(): string | null {
  if (registryPathCache !== undefined) {
    return registryPathCache;
  }
  registryPathCache = null;
  try {
    const queries: Array<[string, string]> = [
      ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'Path'],
      ['HKCU\\Environment', 'Path'],
    ];
    const parts: string[] = [];
    for (const [key, value] of queries) {
      const result = spawnSync('reg', ['query', key, '/v', value], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      });
      const match = result.stdout?.match(/Path\s+REG(?:_EXPAND)?_SZ\s+(.+)/i);
      if (match?.[1]) {
        parts.push(match[1].trim());
      }
    }
    if (parts.length > 0) {
      // Expand %VAR% references (common in registry PATH values)
      registryPathCache = parts
        .join(';')
        .replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? `%${name}%`);
    }
  } catch (err) {
    log.warn('[ACP] Failed to read PATH from registry:', err);
  }
  return registryPathCache;
}

/** Resolve a command name to an existing file path on Windows. */
export function resolveWindowsCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const candidates = commandCandidates(command, env);

  if (commandHasPath(command)) {
    return candidates.find((candidate) => fs.existsSync(candidate));
  }

  const fromPath = env.PATH ? findInPath(candidates, env.PATH) : undefined;
  if (fromPath) {
    return fromPath;
  }

  // Fall back to the registry PATH (Electron GUI launches can have a reduced PATH)
  const registryPath = getRegistryPath();
  return registryPath ? findInPath(candidates, registryPath) : undefined;
}

function isBatchScript(resolvedCommand: string): boolean {
  const ext = path.extname(resolvedCommand).toLowerCase();
  return ext === '.cmd' || ext === '.bat';
}

/**
 * Escape an argument for cmd.exe when spawning with shell: true.
 * Doubles % and ", quotes when the value contains cmd metacharacters.
 */
function escapeCmdArg(arg: string): string {
  const escaped = arg.replace(/%/g, '%%').replace(/"/g, '""');
  return /[\s&()<>|^,;=]/.test(escaped) || escaped.length === 0 ? `"${escaped}"` : escaped;
}

// ============================================
// Spawning
// ============================================

export interface SpawnedAgent {
  child: ChildProcess;
  /** Resolved command actually spawned (for diagnostics) */
  resolvedCommand: string;
}

export class AgentSpawnError extends Error {}

/**
 * Provider API keys are NOT inherited by agent processes: the app's own
 * .env (loaded for the Doer/Dreamer models) would otherwise leak into
 * agents like Claude Code, which then bill the API key instead of the
 * user's subscription login. To use key-based auth for an agent, set the
 * key explicitly in that agent's env config — explicit entries always win.
 */
const STRIPPED_PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
];

function buildAgentEnv(configEnv: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const stripped: string[] = [];
  for (const key of Object.keys(env)) {
    if (STRIPPED_PROVIDER_KEYS.some((name) => name.toLowerCase() === key.toLowerCase())) {
      delete env[key];
      stripped.push(key);
    }
  }
  if (stripped.length > 0) {
    log.info(`[ACP] Not inheriting provider keys into agent env: ${stripped.join(', ')}`);
  }
  return { ...env, ...(configEnv ?? {}) };
}

export function spawnAgentProcess(config: AcpAgentConfig): SpawnedAgent {
  const env = buildAgentEnv(config.env);
  const args = config.args ?? [];
  const cwd = config.cwd || undefined;

  let command = config.command;
  let spawnArgs = args;
  let useShell = false;

  if (process.platform === 'win32') {
    const resolved = resolveWindowsCommand(config.command, env);
    if (resolved) {
      command = resolved;
      if (isBatchScript(resolved)) {
        // .cmd/.bat shims can only run through cmd.exe; escape accordingly
        useShell = true;
        command = escapeCmdArg(resolved);
        spawnArgs = args.map(escapeCmdArg);
      }
    } else if (!commandHasPath(config.command)) {
      throw new AgentSpawnError(
        `Command not found: "${config.command}". Make sure it is installed and on your PATH, ` +
          `or set an absolute path in the agent's configuration.`
      );
    }
  }

  log.info(`[ACP] Spawning agent: ${command} ${spawnArgs.join(' ')}${useShell ? ' (shell)' : ''}`);

  const child = spawn(command, spawnArgs, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: useShell,
    windowsHide: true,
  });

  return { child, resolvedCommand: command };
}

/**
 * Kill an agent process and its entire tree.
 * Windows: taskkill /t kills descendants (npx shims spawn the real agent as a child).
 * POSIX: SIGTERM, then SIGKILL after a grace period.
 */
export function killProcessTree(child: ChildProcess, graceMs = 3000): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    } catch (err) {
      log.warn(`[ACP] taskkill failed for pid ${pid}:`, err);
      child.kill();
    }
    return;
  }

  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, graceMs);
  timer.unref();
  child.once('exit', () => clearTimeout(timer));
}
