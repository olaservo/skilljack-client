/**
 * ACP Diff Block
 *
 * Renders a {type: 'diff'} tool-call content item as a simple line diff.
 * Uses common prefix/suffix trimming — no heavy diff dependency.
 */

interface AcpDiffBlockProps {
  path: string;
  oldText: string | null;
  newText: string;
}

interface DiffLine {
  kind: 'context' | 'removed' | 'added';
  text: string;
}

const MAX_CONTEXT_LINES = 3;

function computeDiff(oldText: string | null, newText: string): DiffLine[] {
  if (oldText == null) {
    // New file — everything is an addition
    return newText.split('\n').map((text) => ({ kind: 'added' as const, text }));
  }

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const lines: DiffLine[] = [];
  const prefixContext = oldLines.slice(Math.max(0, prefix - MAX_CONTEXT_LINES), prefix);
  if (prefix > MAX_CONTEXT_LINES) {
    lines.push({ kind: 'context', text: '…' });
  }
  for (const text of prefixContext) {
    lines.push({ kind: 'context', text });
  }
  for (const text of oldLines.slice(prefix, oldLines.length - suffix)) {
    lines.push({ kind: 'removed', text });
  }
  for (const text of newLines.slice(prefix, newLines.length - suffix)) {
    lines.push({ kind: 'added', text });
  }
  const suffixContext = oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + MAX_CONTEXT_LINES);
  for (const text of suffixContext) {
    lines.push({ kind: 'context', text });
  }
  if (suffix > MAX_CONTEXT_LINES) {
    lines.push({ kind: 'context', text: '…' });
  }
  return lines;
}

const PREFIX: Record<DiffLine['kind'], string> = {
  context: '  ',
  removed: '- ',
  added: '+ ',
};

export function AcpDiffBlock({ path, oldText, newText }: AcpDiffBlockProps) {
  const lines = computeDiff(oldText, newText);

  return (
    <div className="acp-diff">
      <div className="acp-diff-path">{path}</div>
      <pre className="acp-diff-body">
        {lines.map((line, index) => (
          <div key={index} className={`acp-diff-line acp-diff-${line.kind}`}>
            {PREFIX[line.kind]}
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
