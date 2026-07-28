# CLAUDE.md

See **[AGENTS.md](AGENTS.md)** — it is the canonical guide for agents working in this repository and covers
project scope and status, the toolchain and its pins, verified commands, the repository map, hard rules, and
known correctness caveats.

Read it before making any change. In particular read **§2 "Read this before you edit anything"**: some tests
assert behaviour that is deliberately *wrong*, and almost nothing builds until you have run `pnpm build:wasm`.
Those two facts account for most of the confusion this repository can cause.
