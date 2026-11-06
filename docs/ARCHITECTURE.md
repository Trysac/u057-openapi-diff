# Architecture

## Overview

`@trysac/openapi-diff` is a TypeScript package published to npm as ES modules with type declarations. It loads OpenAPI 3.0 and 3.1 documents, compares two of them, and classifies each change as breaking, warning or info using ten rules. It is available as a library and as a command line tool.

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public API: `loadSpec`, `diffSpecs`, `formatReport`, `OpenApiDiffError`, and the exported types and constants. Parses YAML with the `yaml` package. |
| `src/cli.ts` | `run(argv, io)`: argument parsing, reading the two files with `node:fs/promises`, calling the library and mapping results to exit codes 0, 1 and 2. |
| `src/bin.ts` | Process entry point. Connects `run` to `process.stdout`, `process.stderr` and `process.exitCode`. |

## Boundaries

- Only `src/cli.ts` and `src/bin.ts` perform I/O. `src/index.ts` does not read files or use the network.
- Only `src/cli.ts` imports Node built-in modules (`node:`).
- The single runtime dependency is `yaml`, imported by `src/index.ts`.
- Library failures are thrown as `OpenApiDiffError` with a stable `code`. Invalid `maxComparisons` values throw a `TypeError`, and an invalid `format` throws a `TypeError`.

## Diff pipeline

1. `loadSpec` checks the byte size, parses JSON when the first non-space character is `{` and YAML otherwise, checks the `openapi` version, and rejects non-local references and excessive nesting.
2. `diffSpecs` collects operations from both documents, keyed by method and normalised path template, then reports removed and added operations.
3. For operations present in both, parameters, request body and responses are compared. Schemas are compared lazily with `$ref` resolution, memoised on direction and pointers, with an in-progress set so cycles terminate.
4. Changes are de-duplicated and sorted by path, method and pointer, and counted per severity.

## Build and distribution

TypeScript sources in `src/` compile to `dist/`. The CLI is run as `node dist/bin.js` after building.
