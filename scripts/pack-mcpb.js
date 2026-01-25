#!/usr/bin/env node
/**
 * MCPB Packer Script
 *
 * Creates an MCPB (MCP Bundle) file from a directory.
 * The directory must contain a manifest.json at the root.
 *
 * Usage:
 *   node scripts/pack-mcpb.js <source-dir> [output-file]
 *
 * Examples:
 *   node scripts/pack-mcpb.js ./my-server
 *   node scripts/pack-mcpb.js ./my-server ./dist/my-server.mcpb
 *
 * The MCPB format is a ZIP archive containing:
 *   - manifest.json (required, at root)
 *   - Server files (as referenced by manifest)
 *
 * Supports .mcpbignore file for excluding files (same syntax as .gitignore)
 */

import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { zipSync } from 'fflate';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from 'fs';
import { join, basename, relative, resolve, sep } from 'path';

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
};

function log(msg, color = '') {
  console.log(`${color}${msg}${colors.reset}`);
}

function error(msg) {
  log(`Error: ${msg}`, colors.red);
  process.exit(1);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

// Default patterns to exclude (from mcpb-reference + additions)
const EXCLUDE_PATTERNS = [
  // OS files
  '.DS_Store',
  'Thumbs.db',

  // Git
  '.git',
  '.gitignore',
  '.gitattributes',

  // MCPB
  '.mcpbignore',
  '*.mcpb',

  // Dependencies - only exclude caches and lockfiles
  'node_modules/.cache',
  'node_modules/.bin',
  'node_modules/.package-lock.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  '.pnp.*',
  '.yarn',
  '.npm',
  '.npmrc',
  '.yarnrc',

  // Test & coverage
  '__tests__',
  'test',
  'tests',
  '*.test.js',
  '*.test.ts',
  '*.spec.js',
  '*.spec.ts',
  'coverage',
  '.nyc_output',
  '.nycrc',
  'jest.config.*',
  'vitest.config.*',

  // TypeScript source (keep only dist)
  '*.ts',
  '!*.d.ts',  // Keep declaration files
  'tsconfig.json',
  'tsconfig.*.json',
  '*.tsbuildinfo',

  // Build tools & config
  '.eslintrc*',
  '.eslintignore',
  '.prettierrc*',
  '.prettierignore',
  '.editorconfig',
  '.babelrc',
  'babel.config.*',
  'webpack.config.*',
  'rollup.config.*',
  'vite.config.*',

  // Logs & env
  '*.log',
  '.env*',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',

  // Source maps
  '*.map',

  // IDE & editor
  '.vscode',
  '.idea',
  '.claude',

  // Documentation (optional - can override in .mcpbignore)
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'AGENTS.md',

  // Docker (not needed in bundle)
  'Dockerfile',
  'docker-compose.yml',
  '.dockerignore',
];

/**
 * Read .mcpbignore file and return patterns
 */
function readMcpbIgnorePatterns(baseDir) {
  const ignorePath = join(baseDir, '.mcpbignore');
  if (!existsSync(ignorePath)) return [];

  try {
    const content = readFileSync(ignorePath, 'utf-8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Check if a path matches any exclude pattern
 */
function shouldExclude(relativePath, additionalPatterns = []) {
  const allPatterns = [...EXCLUDE_PATTERNS, ...additionalPatterns];
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const baseName = basename(normalizedPath);

  for (const pattern of allPatterns) {
    // Remove trailing slash for directory patterns
    const cleanPattern = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;

    // Exact match
    if (normalizedPath === cleanPattern) return true;

    // Basename match (e.g., ".git" matches "foo/.git")
    if (baseName === cleanPattern) return true;

    // Directory prefix match (e.g., "evals" matches "evals/logs/foo.json")
    if (normalizedPath.startsWith(cleanPattern + '/')) return true;

    // Glob patterns (simple implementation)
    if (cleanPattern.includes('*')) {
      const regex = new RegExp(
        '^' + cleanPattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
      );
      if (regex.test(normalizedPath) || regex.test(baseName)) return true;
    }
  }

  return false;
}

/**
 * Recursively collect all files in a directory with permissions
 */
function collectFiles(dir, baseDir = dir, additionalPatterns = []) {
  const files = {};
  let ignoredCount = 0;

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const relativePath = relative(baseDir, fullPath).replace(/\\/g, '/');

      if (shouldExclude(relativePath, additionalPatterns)) {
        ignoredCount++;
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const stat = statSync(fullPath);
        files[relativePath] = {
          data: readFileSync(fullPath),
          mode: stat.mode,
        };
      }
    }
  }

  walk(dir);
  return { files, ignoredCount };
}

/**
 * Validate manifest.json structure
 */
function validateManifest(manifest) {
  const errors = [];

  // Required fields
  if (!manifest.name) errors.push('Missing required field: name');
  if (!manifest.version) errors.push('Missing required field: version');
  if (!manifest.description) errors.push('Missing required field: description');
  if (!manifest.author?.name) errors.push('Missing required field: author.name');
  if (!manifest.server) errors.push('Missing required field: server');

  // Check manifest version
  const version = manifest.manifest_version || manifest.dxt_version;
  if (!version) {
    errors.push('Missing manifest_version (or dxt_version)');
  }

  if (manifest.server) {
    if (!manifest.server.type) errors.push('Missing required field: server.type');
    if (!manifest.server.entry_point) errors.push('Missing required field: server.entry_point');
    if (!manifest.server.mcp_config?.command) {
      errors.push('Missing required field: server.mcp_config.command');
    }
  }

  return errors;
}

/**
 * Main packing function
 */
function packMcpb(sourceDir, outputPath, options = {}) {
  // Resolve paths
  const resolvedSourceDir = resolve(sourceDir);
  const { install: shouldInstall } = options;

  // Check source directory exists
  if (!existsSync(resolvedSourceDir)) {
    error(`Source directory not found: ${resolvedSourceDir}`);
  }

  if (!statSync(resolvedSourceDir).isDirectory()) {
    error(`Source path is not a directory: ${resolvedSourceDir}`);
  }

  // Check manifest.json exists
  const manifestPath = join(resolvedSourceDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    error(`manifest.json not found in ${resolvedSourceDir}\n\nSee scripts/manifest-template.json for an example.`);
  }

  // Read and validate manifest
  let manifest;
  try {
    const manifestContent = readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(manifestContent);
  } catch (e) {
    error(`Failed to parse manifest.json: ${e.message}`);
  }

  const validationErrors = validateManifest(manifest);
  if (validationErrors.length > 0) {
    log('Manifest validation errors:', colors.red);
    for (const err of validationErrors) {
      log(`  - ${err}`, colors.red);
    }
    process.exit(1);
  }

  // Install production dependencies if requested
  if (shouldInstall) {
    log(`\nInstalling production dependencies...`, colors.blue);
    try {
      // Remove existing node_modules to get clean install
      const nodeModulesPath = join(resolvedSourceDir, 'node_modules');
      if (existsSync(nodeModulesPath)) {
        log(`  Removing existing node_modules...`, colors.dim);
        rmSync(nodeModulesPath, { recursive: true, force: true });
      }

      // Run npm install --production (skip scripts to avoid build steps)
      log(`  Running npm install --omit=dev --ignore-scripts...`, colors.dim);
      execSync('npm install --omit=dev --ignore-scripts', {
        cwd: resolvedSourceDir,
        stdio: 'pipe',
      });
      log(`  Dependencies installed`, colors.green);
    } catch (e) {
      error(`Failed to install dependencies: ${e.message}`);
    }
  }

  // Determine output path
  const finalOutputPath = outputPath || `${manifest.name}-${manifest.version}.mcpb`;
  const resolvedOutputPath = resolve(finalOutputPath);

  log(`\n📦  ${manifest.name}@${manifest.version}`, colors.blue);

  // Read .mcpbignore patterns
  const mcpbIgnorePatterns = readMcpbIgnorePatterns(resolvedSourceDir);
  if (mcpbIgnorePatterns.length > 0) {
    log(`  Using .mcpbignore (${mcpbIgnorePatterns.length} patterns)`, colors.dim);
  }

  // Collect all files
  const { files, ignoredCount } = collectFiles(resolvedSourceDir, resolvedSourceDir, mcpbIgnorePatterns);
  const fileEntries = Object.entries(files);

  log(`\nArchive Contents`, colors.dim);

  // Calculate sizes and display files
  let totalUnpackedSize = 0;
  const sortedEntries = fileEntries.sort(([a], [b]) => a.localeCompare(b));

  for (const [path, { data }] of sortedEntries) {
    const size = data.length;
    totalUnpackedSize += size;
    log(`${formatFileSize(size).padStart(8)}  ${path}`, colors.dim);
  }

  // Create ZIP with preserved file permissions
  const isUnix = process.platform !== 'win32';
  const zipFiles = {};

  for (const [filePath, { data, mode }] of Object.entries(files)) {
    if (isUnix) {
      // Set external file attributes to preserve Unix permissions
      // The mode needs to be shifted to the upper 16 bits for ZIP format
      zipFiles[filePath] = [data, { os: 3, attrs: (mode & 0o777) << 16 }];
    } else {
      zipFiles[filePath] = data;
    }
  }

  const zipData = zipSync(zipFiles, {
    level: 9, // Maximum compression
    mtime: new Date(),
  });

  // Write output file
  writeFileSync(resolvedOutputPath, zipData);

  // Calculate SHA1 checksum
  const shasum = createHash('sha1').update(zipData).digest('hex');

  // Print archive details
  log(`\nArchive Details`);
  log(`  name:          ${manifest.name}`);
  log(`  version:       ${manifest.version}`);
  log(`  filename:      ${basename(resolvedOutputPath)}`);
  log(`  package size:  ${formatFileSize(zipData.length)}`);
  log(`  unpacked size: ${formatFileSize(totalUnpackedSize)}`);
  log(`  shasum:        ${shasum}`);
  log(`  total files:   ${fileEntries.length}`);
  if (ignoredCount > 0) {
    log(`  ignored:       ${ignoredCount} files`);
  }

  log(`\n${colors.green}✓ Created: ${resolvedOutputPath}${colors.reset}`);
}

// CLI entry point
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
MCPB Packer - Create MCP Bundle files

Usage:
  node scripts/pack-mcpb.js [options] <source-dir> [output-file]
  npm run pack-mcpb -- [options] <source-dir> [output-file]

Arguments:
  source-dir   Directory containing manifest.json and server files
  output-file  Output .mcpb file path (default: <name>-<version>.mcpb)

Options:
  --install    Run npm install --omit=dev before packing (clean prod deps)
  --help, -h   Show this help message

Example:
  node scripts/pack-mcpb.js ./my-mcp-server
  node scripts/pack-mcpb.js --install ./my-mcp-server
  node scripts/pack-mcpb.js ./servers/weather ./dist/weather-server.mcpb

Features:
  - Validates manifest.json structure
  - Supports .mcpbignore file for excluding files
  - Preserves Unix file permissions
  - Maximum compression (level 9)
  - SHA1 checksum output
  - Optional clean npm install for production deps

The source directory must contain a valid manifest.json.
See scripts/manifest-template.json for an example.
`);
  process.exit(0);
}

// Parse arguments
const install = args.includes('--install');
const positionalArgs = args.filter(a => !a.startsWith('--'));
const sourceDir = positionalArgs[0];
const outputPath = positionalArgs[1];

if (!sourceDir) {
  error('Missing required argument: source-dir');
}

packMcpb(sourceDir, outputPath, { install });
