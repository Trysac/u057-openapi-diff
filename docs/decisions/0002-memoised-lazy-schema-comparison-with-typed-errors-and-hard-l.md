# Memoised lazy schema comparison with typed errors and hard limits

Status: accepted (generated, pending human review)

## Context

API teams need CI to block breaking OpenAPI changes, but raw YAML diffs hide semantic impact. Specifications can contain reference cycles, shared components, YAML alias bombs and very large inputs. The classifier must terminate on all of them, run without network or filesystem access in the library, and report each finding in a stable, sorted order.

## Decision

Parse YAML 1.2 core with the yaml library (alias limit 100, unique keys) and JSON natively, after a UTF-8 byte-size check. Resolve only local $ref values lazily and compare schema pairs with a memo keyed on direction, base pointer and head pointer, plus an in-progress set so cycles end and shared references compare once. Depth over 64 raises too_deep and more than maxComparisons pair comparisons raise too_large; the memo is bounded by that comparison budget. Findings are attributed to the operation that reaches them, de-duplicated per operation and sorted by path, method and pointer. All failures use one OpenApiDiffError class with five stable codes. Only src/cli.ts imports node: modules.

## Consequences

The library is deterministic, works in any JavaScript runtime and cannot be driven into unbounded work by a hostile document. Shared schemas report one finding per operation that uses them, which tells reviewers which endpoints break. Findings reached only through a cycle are attributed to the comparison that first enters it. Oneof, anyOf, allOf and not are only flagged as changed, never analysed, and schemas without a type are treated as accepting every type, which can produce a breaking type-changed when a type is added to a request schema.
