/**
 * ACP Agents Registry Config
 *
 * Loads/saves agents.json from the userData directory. Deliberately a
 * separate file from servers.json: entries in servers.json are spawned
 * and health-checked as MCP servers at boot, which must not happen to
 * ACP agents.
 */

import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import log from 'electron-log';
import type { AcpAgentConfig } from '../../../shared/acp-types.js';

interface AgentsFile {
  acpAgents: Record<string, AcpAgentConfig>;
}

const DEFAULT_AGENTS: Record<string, AcpAgentConfig> = {
  'claude-code': {
    displayName: 'Claude Code',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp'],
    env: {},
    defaultSessionCwd: null,
    enabled: true,
    builtIn: true,
  },
  codex: {
    displayName: 'Codex',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp'],
    env: {},
    defaultSessionCwd: null,
    enabled: true,
    builtIn: true,
  },
  gemini: {
    displayName: 'Gemini CLI',
    command: 'gemini',
    args: ['--experimental-acp'],
    env: {},
    defaultSessionCwd: null,
    enabled: true,
    builtIn: true,
  },
};

export function getAgentsConfigPath(): string {
  return path.join(app.getPath('userData'), 'agents.json');
}

export function loadAgentsConfig(): Record<string, AcpAgentConfig> {
  const configPath = getAgentsConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      saveAgentsConfig(DEFAULT_AGENTS);
      return { ...DEFAULT_AGENTS };
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as AgentsFile;
    if (!parsed.acpAgents || typeof parsed.acpAgents !== 'object') {
      throw new Error('agents.json missing "acpAgents" object');
    }
    return parsed.acpAgents;
  } catch (err) {
    log.error('[ACP] Failed to load agents.json, using defaults:', err);
    return { ...DEFAULT_AGENTS };
  }
}

export function saveAgentsConfig(agents: Record<string, AcpAgentConfig>): void {
  const configPath = getAgentsConfigPath();
  const file: AgentsFile = { acpAgents: agents };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(file, null, 2), 'utf8');
}
