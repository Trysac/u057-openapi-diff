# Project record: openapi-diff

## Objective

Diff two OpenAPI 3.0 or 3.1 documents and classify each change as breaking, warning or info using ten rules, as a library and as a CI command line tool. The goal is to let CI block breaking contract changes before release, with semantic labels instead of raw YAML diffs. It is aimed at API teams that need this check in a Node toolchain.

## Scope

In scope:

- Loading OpenAPI 3.0.x and 3.1.x documents from YAML or JSON text, with local references resolved.
- Classifying changes to operations, parameters, request bodies, responses and JSON schemas with the ten rules in the README.
- Text and JSON report output.
- The `openapi-diff` command with `--format` and `--fail-on` options and exit codes 0, 1 and 2.

Out of scope:

- Swagger 2.0 documents.
- External references (any `$ref` that does not start with `#`).
- Response status code changes and security scheme changes.
- Changes to examples.
- Deep semantics of oneOf and anyOf: a difference inside these keywords is reported as one warning.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

Measured values only. Leave "pending measurement" until a real figure is recorded; never estimate here.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 475743 / 149160 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 1.0236 | factory ledger |

## Factory run u057 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | claude-sonnet-5-5 | yes | 2363 | 125043 | 0 | 4473 | 0.6280 |
| fix-1 | claude-sonnet-5-5 | no | 6 | 815 | 6921 | 41477 | 0.0296 |
| fix-2 | claude-sonnet-5-5 | no | 10 | 1419 | 12619 | 88934 | 0.0547 |
| fix-3 | claude-sonnet-5-5 | no | 10 | 1353 | 7950 | 72634 | 0.0407 |
| audit | claude-sonnet-5-5 | no | 12 | 6370 | 35509 | 140766 | 0.1666 |
| fix-4 | claude-sonnet-5-5 | no | 10 | 4777 | 15628 | 88276 | 0.0957 |
| docs | claude-haiku-5-5 | no | 36772 | 9383 | 0 | 0 | 0.0084 |

Total: $1.0236. Prices: Anthropic list prices.
