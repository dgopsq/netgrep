# Caching

netgrep keeps nothing. Every search streams the file from the network, holding one chunk and the
incomplete line at its end — so searching a 500 MB file costs the same memory as searching a 5 KB
one, and searching the same URL twice costs two requests.

What a repeat actually costs is the browser's decision, not netgrep's. The request goes through the
HTTP cache like any other `fetch`, so it is your response headers that decide whether the second
search re-downloads the file, revalidates it for a `304`, or is answered from disk without touching
the network at all:

```
cache-control: public, max-age=600
etag: "..."
```

A warm HTTP hit is still delivered as a stream, so a search answered from the browser's cache still
resolves on the first matching line rather than waiting for the whole file.

There is no configuration for any of this. The library used to keep downloaded bytes in memory, on by
default, behind an `enableMemoryCache` flag; that was removed because the platform does the same job
better — it has eviction, it persists across page loads, and it is shared with everything else the
page fetches.

Two searches of one URL that overlap will each download it; see
[the limitation on concurrent searches](07-limitations.md#concurrent-dedup).
