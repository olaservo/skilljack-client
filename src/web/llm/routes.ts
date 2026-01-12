/**
 * LLM API Routes
 *
 * Handles the /api/chat endpoint with SSE streaming.
 * Uses Vercel AI SDK for provider-agnostic streaming.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ModelMessage } from 'ai';
import { streamChat, mergeSettings } from './provider.js';
import { buildSystemPrompt } from './system-prompt.js';
import type { ChatRequest, StreamEvent } from './types.js';
import { callTool as mcpCallTool } from '../../multi-server.js';

/**
 * Create the chat route handler
 */
export function createChatHandler(clients: Map<string, Client>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    // Parse request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let request: ChatRequest;
    try {
      request = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    // Validate request
    if (!request.messages || !Array.isArray(request.messages)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'messages array is required' }));
      return;
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Helper to send SSE event
    const sendEvent = (event: StreamEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      // Merge settings with defaults
      const settings = mergeSettings(request.settings);

      // Build system prompt with MCP context
      const systemPrompt = buildSystemPrompt(
        request.mcpContext,
        settings.systemPrompt
      );

      // Convert messages to AI SDK format (v6 uses ModelMessage)
      const messages: ModelMessage[] = request.messages
        .filter((m) => m.content.trim() !== '')
        .map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }));

      // Stream response using the provider
      const chatStream = streamChat({
        messages,
        mcpContext: request.mcpContext,
        settings,
        systemPrompt,
      });

      for await (const event of chatStream) {
        sendEvent(event);
      }

      // Ensure done is sent
      sendEvent({ type: 'done' });
    } catch (error) {
      console.error('[LLM] Stream error:', error);
      sendEvent({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      sendEvent({ type: 'done' });
    } finally {
      res.end();
    }
  };
}

/**
 * Create the tool execution handler
 *
 * POST /api/chat/tool
 * Executes a single tool call and returns the result
 */
export function createToolExecuteHandler(clients: Map<string, Client>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let request: { qualifiedName: string; arguments: Record<string, unknown> };
    try {
      request = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    if (!request.qualifiedName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'qualifiedName is required' }));
      return;
    }

    try {
      const result = await mcpCallTool(clients, request.qualifiedName, request.arguments || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Tool execution failed',
        })
      );
    }
  };
}
