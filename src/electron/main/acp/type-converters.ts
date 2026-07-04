/**
 * ACP SDK → serializable view converters.
 *
 * Everything crossing the IPC boundary must survive structured clone,
 * so these strip SDK types down to the plain mirrors in shared/acp-types.
 */

import type {
  ContentBlock,
  PermissionOption,
  PlanEntry,
  SessionConfigOption,
  SessionModeState,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
  AvailableCommand,
} from '@agentclientprotocol/sdk';
import type {
  AcpCommandView,
  AcpConfigOptionView,
  AcpContentBlockView,
  AcpModeStateView,
  AcpPermissionOptionView,
  AcpPlanEntryView,
  AcpToolCallContentView,
  AcpToolCallView,
} from '../../../shared/acp-types.js';

export function toContentBlockView(block: ContentBlock): AcpContentBlockView {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'resource_link':
      return { type: 'resource_link', uri: block.uri, name: block.name };
    case 'resource': {
      const resource = block.resource as { uri?: string; text?: string };
      return { type: 'resource', uri: resource.uri, text: resource.text };
    }
    default:
      return { type: block.type };
  }
}

export function toToolCallContentView(content: ToolCallContent): AcpToolCallContentView {
  switch (content.type) {
    case 'diff':
      return {
        type: 'diff',
        path: content.path,
        oldText: content.oldText ?? null,
        newText: content.newText,
      };
    case 'terminal':
      return { type: 'terminal', terminalId: content.terminalId };
    case 'content':
    default:
      return { type: 'content', block: toContentBlockView(content.content) };
  }
}

function safeRaw(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

export function toToolCallView(toolCall: ToolCall): AcpToolCallView {
  return {
    toolCallId: toolCall.toolCallId,
    title: toolCall.title,
    kind: toolCall.kind ?? 'other',
    status: toolCall.status ?? 'pending',
    contentBlocks: (toolCall.content ?? []).map(toToolCallContentView),
    locations: (toolCall.locations ?? []).map((loc) => ({ path: loc.path, line: loc.line })),
    rawInput: safeRaw(toolCall.rawInput),
    rawOutput: safeRaw(toolCall.rawOutput),
  };
}

/**
 * Merge a tool_call_update into an existing view. Per spec, every field
 * except toolCallId is optional — only non-null fields are applied.
 */
export function mergeToolCallUpdate(
  existing: AcpToolCallView,
  update: ToolCallUpdate
): AcpToolCallView {
  return {
    ...existing,
    title: update.title ?? existing.title,
    kind: update.kind ?? existing.kind,
    status: update.status ?? existing.status,
    contentBlocks:
      update.content != null ? update.content.map(toToolCallContentView) : existing.contentBlocks,
    locations:
      update.locations != null
        ? update.locations.map((loc) => ({ path: loc.path, line: loc.line }))
        : existing.locations,
    rawInput: update.rawInput !== undefined ? safeRaw(update.rawInput) : existing.rawInput,
    rawOutput: update.rawOutput !== undefined ? safeRaw(update.rawOutput) : existing.rawOutput,
  };
}

/** A partial view for permission requests that reference an unseen tool call. */
export function toPartialToolCallView(update: ToolCallUpdate): AcpToolCallView {
  return mergeToolCallUpdate(
    {
      toolCallId: update.toolCallId,
      title: '',
      kind: 'other',
      status: 'pending',
      contentBlocks: [],
      locations: [],
    },
    update
  );
}

export function toPlanEntryViews(entries: PlanEntry[]): AcpPlanEntryView[] {
  return entries.map((entry) => ({
    content: entry.content,
    priority: entry.priority,
    status: entry.status,
  }));
}

export function toCommandViews(commands: AvailableCommand[]): AcpCommandView[] {
  return commands.map((command) => ({
    name: command.name,
    description: command.description,
    inputHint: (command.input as { hint?: string } | null | undefined)?.hint,
  }));
}

export function toModeStateView(modes: SessionModeState | null | undefined): AcpModeStateView | null {
  if (!modes) return null;
  return {
    currentModeId: modes.currentModeId,
    availableModes: modes.availableModes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      description: mode.description ?? undefined,
    })),
  };
}

export function toConfigOptionViews(
  options: SessionConfigOption[] | null | undefined
): AcpConfigOptionView[] {
  if (!options) return [];
  return options.map((option) => {
    if (option.type === 'boolean') {
      const boolOption = option as unknown as { currentValue?: boolean | null };
      return {
        id: option.id,
        name: option.name,
        description: option.description ?? undefined,
        category: option.category ?? undefined,
        type: 'boolean' as const,
        currentValue: boolOption.currentValue ?? null,
        options: [],
      };
    }
    const selectOption = option as unknown as {
      currentValue?: string | null;
      options?: Array<{ value: string; name: string; description?: string | null } | { name: string; options: unknown[] }>;
    };
    // Flatten grouped select options; groups have an inner options array
    const flat: Array<{ value: string; name: string; description?: string | null }> = [];
    for (const entry of selectOption.options ?? []) {
      if ('value' in entry) {
        flat.push(entry);
      } else if ('options' in entry && Array.isArray(entry.options)) {
        for (const inner of entry.options as Array<{ value: string; name: string; description?: string | null }>) {
          if (inner && typeof inner === 'object' && 'value' in inner) flat.push(inner);
        }
      }
    }
    return {
      id: option.id,
      name: option.name,
      description: option.description ?? undefined,
      category: option.category ?? undefined,
      type: 'select' as const,
      currentValue: selectOption.currentValue ?? null,
      options: flat.map((value) => ({
        value: value.value,
        name: value.name,
        description: value.description ?? undefined,
      })),
    };
  });
}

export function toPermissionOptionViews(options: PermissionOption[]): AcpPermissionOptionView[] {
  return options.map((option) => ({
    optionId: option.optionId,
    name: option.name,
    kind: (option.kind ?? inferOptionKind(option.name)) as AcpPermissionOptionView['kind'],
  }));
}

/** Some agents omit option kind; infer allow/reject from the label. */
function inferOptionKind(name: string): AcpPermissionOptionView['kind'] {
  const lower = name.toLowerCase();
  if (/(reject|deny|no|cancel)/.test(lower)) {
    return lower.includes('always') ? 'reject_always' : 'reject_once';
  }
  return lower.includes('always') ? 'allow_always' : 'allow_once';
}
