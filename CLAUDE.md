# CLAUDE.md

See **[AGENTS.md](AGENTS.md)** — it is the canonical guide for agents working in this repository and covers
project scope, the toolchain (note: Rust **1.81.0**, not `stable`), verified commands, the repository map,
hard rules, and known correctness caveats.

Read it before making any change. In particular, read **§2 "Read this before you edit anything"** — local
source edits do not reach the example app or the TypeScript package, and mistaking the example for a
verification tool is the most expensive trap in this repo.
