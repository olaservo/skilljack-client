# Fixing the Electron ESM/CJS Build Issue

## The Problem

The Electron app crashed immediately on startup with:

```
ReferenceError: require is not defined in ES module scope
```

**Why this happened:**

1. `package.json` has `"type": "module"` which makes all `.js` files ESM
2. Vite was outputting ESM format (ES modules)
3. Bundled dependencies like `electron-log` and `electron-store` contain CommonJS `require()` calls
4. ESM cannot execute `require()` - it's a CommonJS-only function

## The Solution

Switch the main process and preload builds to **CommonJS format** with `.cjs` extension.

### Changes Made

#### 1. `vite.main.config.ts`

**Before:**
```typescript
build: {
  lib: {
    entry: 'src/electron/main/index.ts',
    formats: ['es'],  // ESM format
  },
  rollupOptions: {
    external: (id) => { /* complex logic to externalize everything */ },
    output: { format: 'es' },
  },
}
```

**After:**
```typescript
build: {
  lib: {
    entry: 'src/electron/main/index.ts',
    fileName: () => 'main.cjs',  // .cjs extension
    formats: ['cjs'],             // CommonJS format
  },
  rollupOptions: {
    external: ['electron'],       // Only externalize electron
    output: {
      inlineDynamicImports: true, // Single file output
    },
  },
}
```

#### 2. `vite.preload.config.ts`

**Before:**
```typescript
build: {
  lib: {
    entry: 'src/electron/preload/host.ts',
    formats: ['es'],
  },
  // ... complex external function
}
```

**After:**
```typescript
build: {
  lib: {
    entry: 'src/electron/preload/host.ts',
    fileName: () => 'preload.cjs',
    formats: ['cjs'],
  },
  rollupOptions: {
    external: ['electron'],
    output: { inlineDynamicImports: true },
  },
}
```

#### 3. `package.json`

```diff
- "main": ".vite/build/main.js",
+ "main": ".vite/build/main.cjs",
```

## Why This Works

| Aspect | ESM Approach (broken) | CJS Approach (working) |
|--------|----------------------|------------------------|
| File extension | `.js` (treated as ESM) | `.cjs` (always CommonJS) |
| Module syntax | `import`/`export` only | `require()`/`module.exports` |
| Bundled deps | `require()` calls fail | `require()` calls work |
| Electron compatibility | Partial | Full |

**Key insight:** Even though `package.json` has `"type": "module"`, Node.js always treats `.cjs` files as CommonJS regardless of the package type.

## Build Output

```
.vite/build/
├── main.cjs      # Main process (~2 MB, bundled)
├── main.cjs.map  # Source map
├── host.js       # Preload script (~7 KB)
└── host.js.map   # Source map
```

## Reference

This approach was adopted from the [MCPJam Inspector](https://github.com/anthropics/inspector) Electron implementation, which uses the same pattern for handling ESM packages with CommonJS dependencies.
