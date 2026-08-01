# Cancelling a search

Every search method takes an optional config with an `AbortSignal`, which is threaded into the underlying
`fetch`. For a search-as-you-type box:

```ts
let controller: AbortController | undefined;

function onInput(pattern: string) {
  controller?.abort();           // cancel the previous keystroke's searches
  controller = new AbortController();

  NG.searchBatch(inputs, pattern, { signal: controller.signal })
    .then(render);
}
```

Aborted searches surface as an `error` on batch results, so filter them out as shown in
[Batch results never reject](02-searching.md#batch-results-never-reject).
