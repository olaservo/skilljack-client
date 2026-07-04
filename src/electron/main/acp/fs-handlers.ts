/**
 * ACP Filesystem Handlers
 *
 * Implements fs/read_text_file and fs/write_text_file for ACP agents.
 * All paths must be absolute and inside the session's cwd subtree —
 * this sandbox is the hard security boundary; user-facing approval
 * happens through the agent's own permission requests.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class FsSandboxError extends Error {}

/** Reject non-absolute paths and paths outside the session root. */
export function resolvePathWithinRoot(root: string, target: string): string {
  if (!path.isAbsolute(target)) {
    throw new FsSandboxError(`Path must be absolute: ${target}`);
  }
  const resolved = path.resolve(target);
  const relative = path.relative(path.resolve(root), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FsSandboxError(`Path is outside the session working directory: ${target}`);
  }
  return resolved;
}

export async function readTextFile(
  root: string,
  target: string,
  line?: number | null,
  limit?: number | null
): Promise<string> {
  const resolved = resolvePathWithinRoot(root, target);
  const content = await fs.readFile(resolved, 'utf8');

  if (line == null && limit == null) {
    return content;
  }

  const lines = content.split('\n');
  const start = Math.max(0, (line ?? 1) - 1); // line is 1-based
  const end = limit != null ? start + limit : lines.length;
  return lines.slice(start, end).join('\n');
}

export async function writeTextFile(
  root: string,
  target: string,
  content: string
): Promise<void> {
  const resolved = resolvePathWithinRoot(root, target);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, 'utf8');
}
