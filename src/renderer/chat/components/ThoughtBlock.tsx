/**
 * Thought Block
 *
 * Collapsible "Thinking…" section for ACP agent_thought_chunk content,
 * rendered above the message body.
 */

import { useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';

export function ThoughtBlock({ content, streaming }: { content: string; streaming: boolean }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible.Root className="acp-thought" open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Trigger asChild>
        <button className="acp-thought-toggle">
          {isOpen ? '▾' : '▸'} {streaming ? 'Thinking…' : 'Thought process'}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <pre className="acp-thought-content">{content}</pre>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
