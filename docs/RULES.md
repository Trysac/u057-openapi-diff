# Classification rules

`diffSpecs` compares two OpenAPI 3.0.x or 3.1.x documents and labels every change with one of ten rules.

| Rule | Severity | Meaning |
|---|---|---|
| `operation-removed` | breaking | An operation present in the base is missing in the head. |
| `operation-added` | info | A new operation appears in the head. |
| `param-added` | breaking if required, otherwise info | A parameter appears. |
| `param-removed` | warning | A parameter disappears. |
| `param-became-required` | breaking | A parameter changes from optional to required. |
| `request-property-became-required` | breaking | A request property is newly required, or `requestBody.required` goes from false to true. |
| `request-enum-value-removed` | breaking | A request enum loses a value. |
| `response-property-removed` | breaking | A response schema loses a property. |
| `response-enum-value-added` | warning | A response enum gains a value. |
| `type-changed` | breaking or warning | A request type set loses a member or a response type set gains one; a change inside `allOf`, `oneOf`, `anyOf` or `not` is one warning, "composition changed, not analysed". |

## Matching

- Paths match after replacing every `{name}` with `{}`; otherwise they must be equal, so a trailing slash makes a different path.
- Parameters merge path-level and operation-level entries (the operation wins) and are identified by name and location. Header names are case-insensitive. Path parameters are matched by their position in the path template.
- Only local references (`#/...`) are supported; they are resolved lazily and cycles terminate.
- Only JSON media types (`application/json` and `+json`) are compared, and only for response statuses present on both sides.
- Types are compared as sets: OpenAPI 3.0 `nullable: true` adds `null`, 3.1 type arrays are sets and `integer` is a subset of `number`. A schema without `type` accepts every type.
- Request schemas ignore `readOnly` properties and response schemas ignore `writeOnly` properties.
- Enum values compare as JSON values: `1` equals `1.0`, `"1"` differs from `1`.

## Limits

- Specification text: 10 485 760 UTF-8 bytes (`too_large`).
- Schema nesting: 64 levels (`too_deep`).
- Schema-pair comparisons: 100 000 by default, configurable with `maxComparisons` (`too_large`).
- Out of scope: Swagger 2.0, external references, response status and security changes, examples and deep `oneOf` or `anyOf` semantics.

## Command line

```
openapi-diff <base> <head> [--format text|json] [--fail-on breaking|warning|none]
```

Exit code 0 means no change at or above `--fail-on` (default `breaking`), 1 means at least one, 2 means a usage or input error.
