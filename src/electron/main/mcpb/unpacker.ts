/**
 * MCPB Unpacker
 *
 * Extracts MCPB (ZIP) archives with security protections.
 * Adapted from mcpb-reference implementation.
 */

import { unzipSync } from 'fflate';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join, resolve, sep } from 'path';
import { extractSignatureBlock } from './signature.js';

export interface UnpackResult {
  success: boolean;
  outputDir: string;
  error?: string;
}

/**
 * Unpack an MCPB file to a directory
 *
 * Security features:
 * - Zip-slip attack prevention via path validation
 * - Signature block stripping before extraction
 * - Unix permission preservation
 *
 * @param mcpbPath Path to the .mcpb file
 * @param outputDir Directory to extract to
 * @returns UnpackResult with success status and output directory
 */
export function unpackMcpb(mcpbPath: string, outputDir: string): UnpackResult {
  const resolvedMcpbPath = resolve(mcpbPath);
  const finalOutputDir = resolve(outputDir);

  if (!existsSync(resolvedMcpbPath)) {
    return {
      success: false,
      outputDir: finalOutputDir,
      error: `MCPB file not found: ${mcpbPath}`,
    };
  }

  // Create output directory if it doesn't exist
  if (!existsSync(finalOutputDir)) {
    mkdirSync(finalOutputDir, { recursive: true });
  }

  try {
    const fileContent = readFileSync(resolvedMcpbPath);
    const { originalContent } = extractSignatureBlock(fileContent);

    // Parse file attributes from ZIP central directory for Unix permissions
    const fileAttributes = new Map<string, number>();
    const isUnix = process.platform !== 'win32';

    if (isUnix) {
      // Parse ZIP central directory to extract file attributes
      const zipBuffer = originalContent;

      // Find end of central directory record (EOCD signature: 0x06054b50)
      let eocdOffset = -1;
      for (let i = zipBuffer.length - 22; i >= 0; i--) {
        if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
          eocdOffset = i;
          break;
        }
      }

      if (eocdOffset !== -1) {
        const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
        const centralDirEntries = zipBuffer.readUInt16LE(eocdOffset + 8);

        let offset = centralDirOffset;

        for (let i = 0; i < centralDirEntries; i++) {
          // Central directory file header signature: 0x02014b50
          if (zipBuffer.readUInt32LE(offset) === 0x02014b50) {
            const externalAttrs = zipBuffer.readUInt32LE(offset + 38);
            const filenameLength = zipBuffer.readUInt16LE(offset + 28);
            const filename = zipBuffer.toString(
              'utf8',
              offset + 46,
              offset + 46 + filenameLength
            );

            // Extract Unix permissions from external attributes (upper 16 bits)
            const mode = (externalAttrs >> 16) & 0o777;
            if (mode > 0) {
              fileAttributes.set(filename, mode);
            }

            const extraFieldLength = zipBuffer.readUInt16LE(offset + 30);
            const commentLength = zipBuffer.readUInt16LE(offset + 32);
            offset += 46 + filenameLength + extraFieldLength + commentLength;
          } else {
            break;
          }
        }
      }
    }

    // Decompress ZIP content
    const decompressed = unzipSync(originalContent);

    for (const relativePath in decompressed) {
      if (Object.prototype.hasOwnProperty.call(decompressed, relativePath)) {
        const data = decompressed[relativePath];
        const fullPath = join(finalOutputDir, relativePath);

        // SECURITY: Prevent zip slip attacks by validating the resolved path
        const normalizedPath = resolve(fullPath);
        const normalizedOutputDir = resolve(finalOutputDir);
        if (
          !normalizedPath.startsWith(normalizedOutputDir + sep) &&
          normalizedPath !== normalizedOutputDir
        ) {
          return {
            success: false,
            outputDir: finalOutputDir,
            error: `Path traversal attempt detected: ${relativePath}`,
          };
        }

        // Create parent directory
        const dir = join(fullPath, '..');
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // Write file
        writeFileSync(fullPath, data);

        // Restore Unix file permissions if available
        if (isUnix && fileAttributes.has(relativePath)) {
          try {
            const mode = fileAttributes.get(relativePath);
            if (mode !== undefined) {
              chmodSync(fullPath, mode);
            }
          } catch {
            // Silently ignore permission errors
          }
        }
      }
    }

    return {
      success: true,
      outputDir: finalOutputDir,
    };
  } catch (error) {
    return {
      success: false,
      outputDir: finalOutputDir,
      error: error instanceof Error ? error.message : 'Unknown error during unpacking',
    };
  }
}

/**
 * Read manifest.json from MCPB without extracting
 *
 * @param mcpbPath Path to the .mcpb file
 * @returns Manifest JSON string or null if not found
 */
export function readManifestFromMcpb(mcpbPath: string): string | null {
  try {
    const fileContent = readFileSync(mcpbPath);
    const { originalContent } = extractSignatureBlock(fileContent);
    const decompressed = unzipSync(originalContent);

    // Look for manifest.json at root
    if (decompressed['manifest.json']) {
      return Buffer.from(decompressed['manifest.json']).toString('utf-8');
    }

    return null;
  } catch {
    return null;
  }
}
