# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suites in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`).

## Commands

```sh
npm test            # vitest run --coverage
npx vitest          # watch mode while developing
```

## Test files

- `test/index.test.ts` tests the public API through `src/index.ts`. It covers `loadSpec` (YAML and JSON parsing, version checks, local and external references, the 10,485,760-byte limit counted in UTF-8, parse errors including duplicate keys and alias bombs, nesting depth), `OpenApiDiffError` (code and message length), and `diffSpecs` (operations, parameters, schemas, enums, nullable handling, read-only and write-only properties, recursive schemas, comparison limits, ordering and summaries). Documents are written inline as YAML strings.
- `test/cli.test.ts` tests `run` from `src/cli.ts` with fixture files. It covers exit codes 0, 1 and 2, `--fail-on` values, `--format` (including `--format=json`), help output, unreadable, missing, directory and oversized inputs, and usage errors.

## Fixtures

Fixtures live in `test/fixtures/`:

- `base.yaml`: the base document used by the CLI tests.
- `head-breaking.yaml`: removes `GET /users/{id}` and changes the `/status` enum shape.
- `head-warning.yaml`: adds an enum value, producing a warning.
- `head-info.yaml`: adds `GET /health`, producing an info change.
- `bad.yaml`: contains a duplicate `openapi` key and is unparsable.
- `swagger2.yaml`: a Swagger 2.0 document, rejected with `unsupported_version`.

## Rules

- Test through the public entry points and assert observable behavior: return values, thrown errors and their codes, and exit codes.
- Tests are deterministic. Temporary files go to the OS temp directory and are removed by the test.

## Reports

Coverage reports are written to `coverage/`.
