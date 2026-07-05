/**
 * ACP Client Interface Implementation
 *
 * The methods the agent calls back into: session updates, permission
 * requests, filesystem access, and terminals. Delegates to the owning
 * AcpAgentConnection for session state and to the shared managers.
 */

import {
  RequestError,
  type Client,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type KillTerminalRequest,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type ReleaseTerminalRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type WriteTextFileRequest,
} from '@agentclientprotocol/sdk';
import log from 'electron-log';
import { readTextFile, writeTextFile } from './fs-handlers.js';
import type { TerminalManager } from './terminal-manager.js';

export interface AcpClientDelegate {
  handleSessionUpdate(notification: SessionNotification): void;
  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
  /** Absolute session cwd; undefined for unknown sessions */
  getSessionCwd(sessionId: string): string | undefined;
  terminals: TerminalManager;
}

export class SkilljackAcpClient implements Client {
  constructor(private delegate: AcpClientDelegate) {}

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.delegate.handleSessionUpdate(params);
  }

  async requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    return this.delegate.requestPermission(params);
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const cwd = this.requireCwd(params.sessionId);
    log.info(`[ACP] fs/read_text_file: ${params.path}`);
    const content = await readTextFile(cwd, params.path, params.line, params.limit);
    return { content };
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<Record<string, never>> {
    const cwd = this.requireCwd(params.sessionId);
    log.info(`[ACP] fs/write_text_file: ${params.path}`);
    await writeTextFile(cwd, params.path, params.content);
    return {};
  }

  async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const cwd = this.requireCwd(params.sessionId);
    return this.delegate.terminals.createTerminal({
      command: params.command,
      args: params.args ?? undefined,
      env: params.env ?? undefined,
      cwd: params.cwd || cwd,
      outputByteLimit: params.outputByteLimit,
    });
  }

  async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const result = this.delegate.terminals.getOutput(params.terminalId);
    return {
      output: result.output,
      truncated: result.truncated,
      exitStatus: result.exitStatus ?? undefined,
    };
  }

  async waitForTerminalExit(
    params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    return this.delegate.terminals.waitForExit(params.terminalId);
  }

  async killTerminal(params: KillTerminalRequest): Promise<Record<string, never>> {
    await this.delegate.terminals.kill(params.terminalId);
    return {};
  }

  async releaseTerminal(params: ReleaseTerminalRequest): Promise<Record<string, never>> {
    await this.delegate.terminals.release(params.terminalId);
    return {};
  }

  async extMethod(method: string): Promise<Record<string, unknown>> {
    throw RequestError.methodNotFound(method);
  }

  async extNotification(method: string): Promise<void> {
    log.debug(`[ACP] Ignoring extension notification: ${method}`);
  }

  private requireCwd(sessionId: string): string {
    const cwd = this.delegate.getSessionCwd(sessionId);
    if (!cwd) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return cwd;
  }
}
