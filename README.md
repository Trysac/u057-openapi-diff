# openapi-diff

[![npm version](https://img.shields.io/npm/v/@trysac/openapi-diff.svg)](https://www.npmjs.com/package/@trysac/openapi-diff)
[![license: MIT](https://img.shields.io/npm/l/@trysac/openapi-diff.svg)](LICENSE)
[![CI](https://github.com/Trysac/u057-openapi-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u057-openapi-diff/actions/workflows/ci.yml)

Diff two OpenAPI 3.0 or 3.1 documents and classify each change as breaking, warning or info with ten rules, as a library and a CI CLI

## Problem

Describe in two or three sentences the concrete problem this utility solves, who hits it, and why existing
packages do not solve it well. Keep it factual; link to an issue or decision record when there is one.

## Install

```sh
npm install @trysac/openapi-diff
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations.

## Usage

```ts
import { greet } from "@trysac/openapi-diff";

// Build a greeting; surrounding whitespace is ignored.
const message = greet("  Ada ");
console.log(message); // "Hello, Ada!"

try {
  greet("   ");
} catch (error) {
  console.error((error as Error).message); // "name must not be empty"
}
```

## API

| Export | Signature | Description |
|---|---|---|
| `greet` | `(name: string) => string` | Placeholder API; replace it with the real one. |

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez
