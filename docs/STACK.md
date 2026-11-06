# Stack

## Used

| Tool | Purpose | Why |
|---|---|---|
| TypeScript (strict) | Language and type checking | Typed public API and declarations for consumers. |
| Node.js 20+ | Runtime | Native ES modules; the code uses `Object.hasOwn`. |
| yaml ^2.8.0 | YAML 1.2 parsing | The only runtime dependency. Used with the core schema, `uniqueKeys: true` and `maxAliasCount: 100`. |
| Vitest + `@vitest/coverage-v8` | Tests and coverage | ESM-native and runs TypeScript without a separate build step. |

## Discarded

| Tool | Why not |
|---|---|
| oasdiff (Go binary) | Awkward to embed in a Node toolchain. |
| Bundlers (tsup, Rollup) | Unneeded for a small ESM library; `tsc` emits what is published. |

Add a row whenever a dependency or tool is added or rejected.
