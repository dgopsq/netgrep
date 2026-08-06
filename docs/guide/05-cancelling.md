# Cancelling

A search in flight can be stopped two ways, and which one you have depends on which function you called.

## Leave the loop

`grep`'s generator terminates the transfer on any exit — `break`, `return`, a `throw`. That is the
idiomatic path and it needs no extra machinery:

```ts
for await (const hit of grep(url, pattern)) {
  render(hit);
  if (enough(hit)) break; // the rest of the file is never downloaded
}
```

**But a loop that is finding nothing has no body to break from.** Across a hitless stretch of a 240 MB
file, `grep` yields nothing to react to, so there is nothing to cancel from. For that, and for `matches`,
which exposes no loop at all, you need a signal.

## Pass a signal

`AbortSignal` goes in the `fetch` options, where it is already a standard key:

```ts
const controller = new AbortController();

const pending = matches(url, pattern, { fetch: { signal: controller.signal } });

// A keystroke later:
controller.abort();

try {
  const found = await pending;
} catch (cause) {
  // The abort lands here. Nothing was answered.
}
```

An aborted request rejects — `grep` throws from the iteration, `matches` rejects its promise — and stops
the transfer rather than merely abandoning it, so a fast typist does not queue up hundreds of megabytes of
superseded reads.

There is no top-level `signal` option. It lives in `fetch` so there is never a precedence rule to
remember between two of them.
