# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are derived from Conventional Commits.

## [Unreleased]

### Added

- Add `loadSpec`, `diffSpecs` and `formatReport` to classify OpenAPI 3.0 and 3.1 changes as breaking, warning or info with ten rules, plus the `OpenApiDiffError` class and an `openapi-diff` CLI with `--format` and `--fail-on`.
- Initial project structure from the factory utility template.
