# Security practices

How this package defends its users and what it leaves to the caller. The disclosure policy is in [../SECURITY.md](../SECURITY.md).

## Threat model

The main untrusted input is an OpenAPI document supplied by a caller or a pull request. The CLI also takes file paths from its arguments.

### Defended

- Oversized input: text longer than 10,485,760 UTF-8 bytes is rejected with `too_large` before parsing. The CLI also checks the file size before reading it.
- YAML alias expansion (billion laughs): parsing uses `maxAliasCount: 100`, and an alias bomb is rejected with `parse_error`.
- Duplicate YAML keys are rejected (`uniqueKeys: true`).
- Deep nesting: documents nested more than 256 levels are rejected with `too_deep`. Schema comparison stops beyond 64 levels.
- Reference loops and chains: comparison of recursive schemas terminates through memoisation and an in-progress set. Reference chains longer than 64 hops are rejected.
- Comparison budget: a diff stops with `too_large` after `maxComparisons` schema-pair comparisons (default 100,000).
- External references: any `$ref` not starting with `#` is rejected with `unresolved_ref`. The library never fetches URLs or reads other files.
- Error messages: values from the document are truncated (200 characters for error messages, 100 for quoted values), and quoted values use JSON escaping.
- No `eval`, dynamic `Function` construction or child processes in library code.

### Not defended

- Time and memory within the limits: a document close to 10 MB, or a diff that uses most of the 100,000-comparison budget, can take substantial CPU time and memory. The library has no wall-clock timeout.
- The budget counts schema-pair comparisons, not the cost of each comparison or of parsing. The default budget may be too large for constrained CI runners.
- Path keys and operation paths are printed in text reports after truncation but not stripped of terminal control characters, so a crafted path can alter terminal output.
- The CLI opens whatever paths it is given, including symbolic links, and does not restrict them to a directory.
- The library does not check that a document is semantically valid OpenAPI beyond the version field, so malformed but well-typed input produces a best-effort diff.
- Findings reached through a cycle are attributed to the first comparison that reaches them, which can change the reported pointer but not the existence of a change.

## Secrets

- No secrets, tokens or credentials in the repository, commit history, logs or prompts.
- Publishing credentials live only in the CI secret store or the maintainer's local npm configuration.

## Dependencies

- The only runtime dependency is `yaml`. Development dependencies are the toolchain listed in [STACK.md](STACK.md).
- Commit the generated `package-lock.json` so installs are reproducible.

## Publishing

- Only the build output in `dist/` is intended for the published package.
