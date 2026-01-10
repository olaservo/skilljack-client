/**
 * Sampling Capability - Handle server-initiated LLM requests with tool support
 *
 * This module is standalone and UI-agnostic. Copy this file to add sampling support
 * to any MCP client (CLI, web, desktop, etc.).
 *
 * Usage:
 *   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *   import { setupSampling } from './capabilities/sampling.js';
 *
 *   const client = new Client(
 *     { name: 'my-client', version: '1.0.0' },
 *     { capabilities: { sampling: { tools: {} } } }
 *   );
 *
 *   setupSampling(client, {
 *     // Required: provide your UI callbacks
 *     onApprovalRequest: async (request) => {
 *       // Display request to user, return true to approve
 *       return confirm('Approve this LLM request?');
 *     },
 *     onResponse: (response) => {
 *       // Display LLM response to user
 *       console.log('Response:', response);
 *     },
 *     onLog: (message) => {
 *       // Handle status messages
 *       console.log(message);
 *     },
 *   });
 *
 *   await client.connect(transport);
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam, ToolUseBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CreateMessageRequestSchema,
  type CreateMessageRequest,
  type CreateMessageResult,
  type CreateMessageResultWithTools,
  type CreateTaskResult,
  type SamplingMessage,
  type Tool,
  type ToolChoice,
  type ToolUseContent,
  type ToolResultContent,
  type TextContent,
  type ImageContent,
} from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

// Union type for sampling responses - supports both text-only and tool-use cases
type SamplingResponse = CreateMessageResult | CreateMessageResultWithTools;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Structured sampling request data for UI display.
 */
export interface SamplingRequest {
  messages: SamplingMessage[];
  systemPrompt?: string;
  tools?: Tool[];
  maxTokens?: number;
  temperature?: number;
  toolChoice?: ToolChoice;
}

/**
 * UI callbacks for sampling operations.
 */
export interface SamplingCallbacks {
  /**
   * Called when a sampling request needs user approval.
   * Display the request and return true to approve, false to reject.
   * Only called when approvalMode is 'ask'.
   */
  onApprovalRequest: (request: SamplingRequest) => Promise<boolean>;

  /**
   * Called when an LLM response is received.
   * Use this to display the response to the user.
   */
  onResponse: (response: SamplingResponse) => void;

  /**
   * Called for status/log messages.
   * Use this to show progress indicators or log output.
   */
  onLog: (message: string) => void;
}

/**
 * Approval mode for sampling requests.
 * - 'ask': User must approve each request (default, per MCP spec)
 * - 'auto': Automatically approve all requests (use only with trusted servers)
 */
export type ApprovalMode = 'ask' | 'auto';

export interface SamplingConfig extends Partial<SamplingCallbacks> {
  /** Anthropic API key (required for real LLM calls, otherwise uses mock handler) */
  apiKey?: string;
  /** Model to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Max tokens if not specified in request (default: 1024) */
  defaultMaxTokens?: number;
  /**
   * How to handle sampling requests (default: 'ask').
   * Per MCP spec, human-in-the-loop is recommended since servers control the prompt.
   */
  approvalMode?: ApprovalMode;
  /**
   * Server instructions to prepend to every system prompt.
   */
  serverInstructions?: string;
}

// Content block types from MCP
type SamplingContentBlock = TextContent | ImageContent | ToolUseContent | ToolResultContent;

// ============================================================================
// EXPORTS FOR UI HELPERS
// ============================================================================

/**
 * Format message content as a string for display.
 * Useful for UIs that want to show message content.
 */
export function formatContentForDisplay(content: SamplingMessage['content']): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content.map(block => {
      if (block.type === 'text') return (block as TextContent).text;
      if (block.type === 'tool_use') {
        const tu = block as ToolUseContent;
        return `[tool_use: ${tu.name}(${JSON.stringify(tu.input)})]`;
      }
      if (block.type === 'tool_result') {
        const tr = block as ToolResultContent;
        const resultText = tr.content?.map(c =>
          c.type === 'text' ? (c as TextContent).text : `[${c.type}]`
        ).join('') || '';
        return `[tool_result: ${tr.toolUseId} => ${resultText}${tr.isError ? ' (error)' : ''}]`;
      }
      return `[${block.type}]`;
    }).join(' ');
  }

  if (typeof content === 'object' && content !== null) {
    if ('type' in content && content.type === 'text' && 'text' in content) {
      return (content as TextContent).text;
    }
  }

  return JSON.stringify(content);
}

// Re-export types for convenience
export type { SamplingResponse, SamplingMessage, Tool, ToolChoice };

// ============================================================================
// TYPE CONVERTERS - MCP <-> Anthropic
// ============================================================================

function mcpToolToAnthropic(tool: Tool): Anthropic.Messages.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Messages.Tool['input_schema'],
  };
}

function mcpToolChoiceToAnthropic(choice: ToolChoice): Anthropic.Messages.ToolChoice {
  switch (choice.mode) {
    case 'auto':
      return { type: 'auto' };
    case 'required':
      return { type: 'any' };
    case 'none':
      return { type: 'auto' };
    default:
      return { type: 'auto' };
  }
}

function anthropicToolUseToMcp(block: ToolUseBlock): ToolUseContent {
  return {
    type: 'tool_use',
    id: block.id,
    name: block.name,
    input: block.input as Record<string, unknown>,
  };
}

function mcpToolResultToAnthropic(result: ToolResultContent): ToolResultBlockParam {
  let content: ToolResultBlockParam['content'];

  if (result.content && result.content.length > 0) {
    content = result.content.map(block => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: (block as TextContent).text };
      }
      return { type: 'text' as const, text: JSON.stringify(block) };
    });
  }

  return {
    type: 'tool_result',
    tool_use_id: result.toolUseId,
    content,
    is_error: result.isError,
  };
}

function mapStopReason(anthropicReason: string | null): string | undefined {
  if (!anthropicReason) return undefined;

  const mapping: Record<string, string> = {
    'end_turn': 'endTurn',
    'max_tokens': 'maxTokens',
    'stop_sequence': 'stopSequence',
    'tool_use': 'toolUse',
  };

  return mapping[anthropicReason] ?? anthropicReason;
}

// ============================================================================
// SETUP FUNCTION
// ============================================================================

/**
 * Context passed to executeSampling for the core LLM call.
 */
interface SamplingContext {
  anthropic: Anthropic;
  model: string;
  defaultMaxTokens: number;
  serverInstructions?: string;
  log: (msg: string) => void;
  onResponse: (response: SamplingResponse) => void;
}

/**
 * Execute the core sampling logic (LLM API call).
 * Extracted to support both sync and async (task-based) execution.
 */
async function executeSampling(
  params: CreateMessageRequest['params'],
  ctx: SamplingContext
): Promise<SamplingResponse> {
  const { anthropic, model, defaultMaxTokens, serverInstructions, log, onResponse } = ctx;
  const hasTools = params.tools && params.tools.length > 0;

  // Combine server instructions with request's system prompt
  const fullSystemPrompt = [serverInstructions, params.systemPrompt]
    .filter(Boolean)
    .join('\n\n') || undefined;

  // Convert MCP messages to Anthropic format
  const messages: MessageParam[] = params.messages.map((msg: SamplingMessage) => ({
    role: msg.role as 'user' | 'assistant',
    content: formatMessageContent(msg.content),
  }));

  // Build Anthropic API request
  const apiRequest: Anthropic.MessageCreateParams = {
    model,
    max_tokens: params.maxTokens ?? defaultMaxTokens,
    messages,
    system: fullSystemPrompt
      ? [
          {
            type: 'text' as const,
            text: fullSystemPrompt,
            cache_control: { type: 'ephemeral' as const },
          },
        ]
      : undefined,
    temperature: params.temperature,
    stop_sequences: params.stopSequences,
  };

  // Add tools if provided (and toolChoice is not 'none')
  if (hasTools && params.toolChoice?.mode !== 'none') {
    apiRequest.tools = params.tools!.map(mcpToolToAnthropic);

    if (params.toolChoice) {
      apiRequest.tool_choice = mcpToolChoiceToAnthropic(params.toolChoice);
    }
  }

  // Make API call
  const response = await anthropic.messages.create(apiRequest);

  // Handle tool use response
  if (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content
      .filter((block): block is ToolUseBlock => block.type === 'tool_use')
      .map(anthropicToolUseToMcp);

    log(`[Sampling] LLM requested ${toolUseBlocks.length} tool(s): ${toolUseBlocks.map(t => t.name).join(', ')}`);

    const result: CreateMessageResultWithTools = {
      role: 'assistant',
      content: toolUseBlocks,
      model: response.model,
      stopReason: 'toolUse',
    };

    onResponse(result);
    return result;
  }

  // Handle text response
  const textBlock = response.content.find(c => c.type === 'text');
  log(`[Sampling] LLM returned text response (stopReason: ${response.stop_reason})`);

  const result: CreateMessageResult = {
    role: 'assistant',
    content: {
      type: 'text',
      text: textBlock?.type === 'text' ? textBlock.text : '',
    },
    model: response.model,
    stopReason: mapStopReason(response.stop_reason),
  };

  onResponse(result);
  return result;
}

/**
 * Check if request has task params.
 * The SDK adds `task` to params when caller provides it in options.
 * Also check _meta.task for backwards compatibility with servers using the older pattern.
 */
function hasTaskParams(params: unknown): boolean {
  if (typeof params !== 'object' || params === null) return false;
  const p = params as Record<string, unknown>;
  // Check direct params.task (SDK pattern)
  if (p.task !== undefined) return true;
  // Check _meta.task (backwards compat)
  if (p._meta && typeof p._meta === 'object') {
    const meta = p._meta as Record<string, unknown>;
    if (meta.task !== undefined) return true;
  }
  return false;
}

/**
 * Set up sampling capability on a client.
 *
 * The client must declare `sampling: { tools: {} }` in its capabilities
 * to receive tool-enabled sampling requests from servers.
 */
export function setupSampling(client: Client, config: SamplingConfig = {}): void {
  const apiKey = config.apiKey;
  const log = config.onLog ?? (() => {});
  const onApprovalRequest = config.onApprovalRequest ?? (async () => true);
  const onResponse = config.onResponse ?? (() => {});

  if (!apiKey) {
    log('[Sampling] No API key - using mock handler');
    client.setRequestHandler(CreateMessageRequestSchema, createMockHandler(log));
    return;
  }

  const anthropic = new Anthropic({
    apiKey,
    maxRetries: 5,
  });
  const model = config.model ?? 'claude-sonnet-4-20250514';
  const defaultMaxTokens = config.defaultMaxTokens ?? 1024;
  const approvalMode = config.approvalMode ?? 'ask';
  const serverInstructions = config.serverInstructions;

  // Context for executeSampling
  const samplingCtx: SamplingContext = {
    anthropic,
    model,
    defaultMaxTokens,
    serverInstructions,
    log,
    onResponse,
  };

  // Handler receives extra from SDK which includes taskStore if client was configured with one
  client.setRequestHandler(CreateMessageRequestSchema, async (request, extra) => {
    const { params } = request;

    const hasTools = params.tools && params.tools.length > 0;
    log(`[Sampling] Server requested LLM completion${hasTools ? ` with ${params.tools!.length} tools` : ''}`);

    // Check if this is a task-based request
    // The SDK adds `task` to params when server sends task creation options
    const isTaskRequest = hasTaskParams(params) && extra.taskStore;
    if (isTaskRequest) {
      log(`[Sampling] Task-based request detected (ttl: ${extra.taskRequestedTtl ?? 'default'})`);
    }

    // Combine server instructions with request's system prompt for approval display
    const fullSystemPrompt = [serverInstructions, params.systemPrompt]
      .filter(Boolean)
      .join('\n\n') || undefined;

    // Build the request object for the UI
    const samplingRequest: SamplingRequest = {
      messages: params.messages,
      systemPrompt: fullSystemPrompt,
      tools: params.tools,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      toolChoice: params.toolChoice,
    };

    // Human-in-the-loop: get approval via callback
    if (approvalMode === 'ask') {
      const approved = await onApprovalRequest(samplingRequest);
      if (!approved) {
        log('[Sampling] Request rejected by user');
        const result: CreateMessageResult = {
          role: 'assistant',
          content: { type: 'text', text: '[Request rejected by user]' },
          model: 'rejected',
          stopReason: 'endTurn',
        };
        // For task requests, we still need to store the rejection as a task result
        if (isTaskRequest && extra.taskStore) {
          const task = await extra.taskStore.createTask({ ttl: extra.taskRequestedTtl ?? undefined });
          await extra.taskStore.storeTaskResult(task.taskId, 'completed', result);
          log(`[Sampling] Task ${task.taskId}: Request rejected by user`);
          return { task } as CreateTaskResult;
        }
        return result;
      }
      log('[Sampling] Request approved, sending to LLM...');
    }

    // Execute the LLM call
    const executeAndReturn = async (): Promise<SamplingResponse | CreateTaskResult> => {
      // If task-based request, create task and store result
      if (isTaskRequest && extra.taskStore) {
        const task = await extra.taskStore.createTask({ ttl: extra.taskRequestedTtl ?? undefined });
        log(`[Sampling] Task ${task.taskId}: Starting LLM call...`);

        // Update task status to show we're working
        await extra.taskStore.updateTaskStatus(task.taskId, 'working', 'Calling LLM API...');

        // Execute the sampling
        const result = await executeSampling(params, samplingCtx);

        // Store the result and return CreateTaskResult
        await extra.taskStore.storeTaskResult(task.taskId, 'completed', result);
        log(`[Sampling] Task ${task.taskId}: LLM call completed`);

        return { task } as CreateTaskResult;
      }

      // Synchronous execution (no task params)
      return executeSampling(params, samplingCtx);
    };

    return executeAndReturn();
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function formatMessageContent(content: SamplingMessage['content']): MessageParam['content'] {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return [formatSingleBlock(content as SamplingContentBlock)];
  }

  return content.map(block => formatSingleBlock(block as SamplingContentBlock));
}

function formatSingleBlock(block: SamplingContentBlock): ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: (block as TextContent).text };

    case 'image': {
      const imageBlock = block as ImageContent;
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageBlock.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: imageBlock.data,
        },
      };
    }

    case 'tool_use': {
      const toolUseBlock = block as ToolUseContent;
      return {
        type: 'tool_use',
        id: toolUseBlock.id,
        name: toolUseBlock.name,
        input: toolUseBlock.input,
      };
    }

    case 'tool_result':
      return mcpToolResultToAnthropic(block as ToolResultContent);

    default:
      return { type: 'text', text: JSON.stringify(block) };
  }
}

function formatContentAsString(content: unknown): string {
  if (typeof content === 'string') return content;

  if (typeof content === 'object' && content !== null) {
    if ('type' in content && content.type === 'text' && 'text' in content) {
      return content.text as string;
    }
    if (Array.isArray(content)) {
      return content
        .filter(c => c.type === 'text' && 'text' in c)
        .map(c => c.text)
        .join('\n');
    }
  }

  return String(content);
}

function createMockHandler(log: (msg: string) => void) {
  return async (request: { params: { messages: Array<{ content: unknown }>; tools?: Tool[] } }): Promise<SamplingResponse> => {
    log('[Sampling] Mock response (no API key)');

    if (request.params.tools && request.params.tools.length > 0) {
      const tool = request.params.tools[0];
      log(`[Sampling] Mock: Would use tool "${tool.name}"`);
      const response: CreateMessageResultWithTools = {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: `mock_${Date.now()}`,
          name: tool.name,
          input: {},
        }],
        model: 'mock-model',
        stopReason: 'toolUse',
      };
      return response;
    }

    const prompt = request.params.messages[0]
      ? formatContentAsString(request.params.messages[0].content)
      : 'unknown';

    return {
      role: 'assistant',
      content: { type: 'text', text: `[Mock] Received: "${prompt.substring(0, 50)}..."` },
      model: 'mock-model',
      stopReason: 'endTurn',
    };
  };
}
