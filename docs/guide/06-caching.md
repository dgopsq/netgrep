# Caching

netgrep keeps downloaded bytes in memory, keyed by URL, so repeat searches over the same corpus need no
network. The cache is on by default. There is no eviction, size cap or TTL: bytes are retained for the
lifetime of the `Netgrep` instance.

```ts
const NG = new Netgrep({ enableMemoryCache: false });
```

Disable it if you are searching a large or unbounded set of URLs, or bound the growth by discarding the
instance.

Concurrent searches of one URL interact with this; see
[the limitation on concurrent searches](07-limitations.md#concurrent-dedup).
