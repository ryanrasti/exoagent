# Coding Principles

## General Principles

- **No try/except on imports** - Just let imports fail. If a dependency is optional, it should be a required dependency or handled at a higher level.

- **No small 1-time use functions** - Inline small functions that are only used once. Prefer inlining over creating helper functions for single-use cases.


