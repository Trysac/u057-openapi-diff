# openapi-diff

[![npm version](https://img.shields.io/npm/v/@trysac/openapi-diff.svg)](https://www.npmjs.com/package/@trysac/openapi-diff)
[![license: MIT](https://img.shields.io/npm/l/@trysac/openapi-diff.svg)](LICENSE)
[![CI](https://github.com/Trysac/u057-openapi-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u057-openapi-diff/actions/workflows/ci.yml)

Diff two OpenAPI 3.0 or 3.1 documents and classify each change as breaking, warning or info with ten rules, available as a library and as a CI command line tool.

## Problem

API teams merge contract changes that silently break clients: a removed operation, a new required parameter, a narrowed enum. Raw YAML diffs do not show the semantic impact. This package resolves local references, normalises the differences between OpenAPI 3.0 and 3.1, and labels each change, so CI can block breaking changes before release.

## Install

```sh
npm install @trysac/openapi-diff
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations and has one runtime dependency, `yaml` (^2.8.0).

## Usage

```ts
import { diffSpecs, formatReport, loadSpec } from "@trysac/openapi-diff";

const api = "openapi: 3.1.0\ninfo: {title: A, version: '1'}\n";
const op = "paths:\n  /users:\n    get:\n      responses:\n        '200': {description: ok}\n";
const base = loadSpec(api + op);
const head = loadSpec(`${api}paths: {}\n`);
console.log(formatReport(diffSpecs(base, head), "text"));
```

## API

| Export | Signature | Description |
|---|---|---|
| `loadSpec` | `(text: string) => OpenApiDocument` | Parses YAML or JSON text. Requires openapi 3.0.x or 3.1.x and at most 10,485,760 UTF-8 bytes. Only local `$ref` values (starting with `#`) are accepted. |
| `diffSpecs` | `(base, head, options?: { maxComparisons?: number }) => DiffReport` | Returns `{ changes, summary: { breaking, warning, info } }`, with changes sorted by path, method and pointer. `maxComparisons` defaults to 100,000. |
| `formatReport` | `(report, format: "text" or "json") => string` | Returns one line per change followed by a summary line for `text`, or `JSON.stringify(report, null, 2)` for `json`. No trailing newline. |
| `OpenApiDiffError` | class with `readonly code` | Thrown by every failure of the library. Codes: `parse_error`, `too_large`, `unsupported_version`, `unresolved_ref`, `too_deep`. Messages are truncated to 200 characters. |

Each change has `rule`, `severity` (`breaking`, `warning` or `info`), `pointer` (an RFC 6901 pointer into the head document, or the base document for removals), and optional `method` and `path`. An invalid `maxComparisons` value throws a `TypeError`.

## CLI

```sh
openapi-diff <base> <head> [--format text|json] [--fail-on breaking|warning|none]
```

The command is implemented in `src/bin.ts`. `--fail-on` defaults to `breaking`. Exit codes: `0` when no change reaches `--fail-on`, `1` when one does, `2` for usage errors and for unreadable, unparsable or oversized input.

## Rules

| Rule | Severity |
|---|---|
| `operation-removed` | breaking |
| `operation-added` | info |
| `param-added` | breaking if required, otherwise info |
| `param-removed` | warning |
| `param-became-required` | breaking |
| `request-property-became-required` | breaking, also for a request body that becomes required |
| `request-enum-value-removed` | breaking |
| `response-property-removed` | breaking |
| `response-enum-value-added` | warning |
| `type-changed` | breaking, or warning for a difference inside allOf, oneOf, anyOf or not |

## Limits

- Accepted versions are 3.0.x and 3.1.x. Swagger 2.0 is rejected.
- Only local references are supported. External and malformed references raise `unresolved_ref`.
- Input is limited to 10,485,760 UTF-8 bytes, 100 YAML alias expansions and 256 levels of document nesting. Schema nesting is limited to 64 levels and reference chains to 64 hops.
- A diff performs at most `maxComparisons` schema-pair comparisons (default 100,000).
- Only JSON media types (`application/json` and `+json`) are compared.
- Request schemas ignore readOnly properties and response schemas ignore writeOnly properties.
- Enum values compare as JSON values, so `1` and `1.0` are equal and `"1"` differs from `1`.
- Response status codes, security definitions and examples are not compared.
- Composition keywords (allOf, oneOf, anyOf, not) are compared only as a whole; differences produce one warning and are not analysed further.

## Why not oasdiff

oasdiff is a Go binary, which is awkward to embed in a Node toolchain. This package is a TypeScript library with a small CLI and a single runtime dependency.

## Security

The threat model, including what the package does not defend against, is described in [docs/SECURITY.md](docs/SECURITY.md).

## Development

```sh
npm install
npm test            # Vitest suites with coverage
```

## License

[MIT](LICENSE) © 2026 Miguel Gomez
