# Searching

There are two functions, and which one you want is decided by what you do with the answer.

## Does this file contain it?

`matches` answers with a boolean and reads no more of the file than it must.

```ts
import { matches } from '@netgrep/netgrep';

const found = await matches('/logs/app.log', 'ECONNREFUSED');
```

The first hit ends the transfer, so a match near the head of a 240 MB file costs a few chunks rather than
the file. A file with no match is read to the end, because proving an absence is what that takes. Nothing
crosses out of WebAssembly but the boolean — no line is copied and no terminator is counted, which is why
this is cheaper than `grep` rather than merely narrower.

## Which lines contain it?

`grep` yields every matching line, in file order, as it is found.

```ts
import { grep } from '@netgrep/netgrep';

for await (const hit of grep('/logs/app.log', 'ECONNREFUSED')) {
  console.log(hit.lineNumber, hit.line);
}
```

Hits arrive while the file is still downloading. Memory stays flat however large it is: one network chunk
and the incomplete line at its end are all that is ever held, and each hit is built at the moment it is
yielded. [The matching line](03-the-matching-line.md) covers what a hit contains.

## Iteration drives everything

Nothing is fetched until the first `next()` — which the `for await` above issues — so a pattern that will
not compile throws from the loop rather than from the `grep` call.

Leaving the loop terminates the transfer. `break`, `return` and a `throw` all do it, so taking the first
hit and stopping is how you get the cheapest possible answer that also tells you *what* matched:

```ts
for await (const hit of grep(url, pattern)) {
  console.log(hit.line);
  break; // the rest of the file is never downloaded
}
```

## An error can follow hits you already have

A connection that drops at 180 MB gives you every hit up to that point and *then* throws. Those hits are
correct and complete for the bytes that were read — they are not provisional, and there is nothing to roll
back. What you do not know is what the rest of the file contained.

```ts
const hits = [];

try {
  for await (const hit of grep(url, pattern)) hits.push(hit);
} catch (cause) {
  // `hits` is what the file said before it stopped arriving.
}
```

`matches` has no such halfway state: it rejects, and there is no partial boolean.

## Request options

Both functions take a `fetch` object handed to the request unchanged — an `Authorization` header, an API
key, `credentials: 'include'`, and the `AbortSignal` that [Cancelling](05-cancelling.md) is about.

```ts
await matches(url, pattern, {
  fetch: { headers: { Authorization: `Bearer ${token}` } },
});
```

netgrep owns the request because it needs the response body to stream, so this is the only way in. It is
passed through whole, so `method` and `body` come with it and are neither honoured specially nor rejected:
netgrep searches whatever body comes back.

## `onProgress`

Both functions also take `onProgress`, called after each network chunk with the cumulative bytes read:

```ts
await matches(url, pattern, {
  onProgress: (bytesRead) => setRead(bytesRead),
});
```

It fires whether or not anything has matched, which makes it the only sign of life during a long hitless
stretch — and the place to call `controller.abort()` from when you decide the search has run long enough
(see [Cancelling](05-cancelling.md)).

**These are decompressed bytes delivered to the page, not bytes on the wire**: a gzipped response moves far
fewer. No total comes with them, deliberately — `Content-Length` on a compressed response is the compressed
size, so comparing the two would drive a progress bar that finishes at a few per cent. Show the number
climbing, not a fraction of a file.
