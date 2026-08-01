# Searching

## A single search

```ts
import { Netgrep } from '@netgrep/netgrep';

// Create a Netgrep instance, here it's
// possible to pass an initial configuration.
const NG = new Netgrep();

// Execute a Netgrep search on the url using
// the given pattern.
NG.search("url", "pattern")
  .then((output) => {
    console.log('The pattern has matched', output.result)
  });

// It's possible to pass custom metadata during
// the search. These will be returned back in the result
// for convenience.
NG.search("url", "pattern", { title: 'A blog post' })
  .then((output) => {
    console.log('The pattern has matched', output.result)
    console.log('Metadata', output.metadata)
  });
```

## What you get back

A single search resolves to a result carrying the answer and whatever metadata you passed in:

```ts
{
  url: string;
  pattern: string;
  result: boolean;      // the whole answer: did the pattern occur?
  metadata?: T;         // returned untouched, for correlating results back to your own objects
}
```

## Batches

```ts
// There is a convenient method to do batched searches
// to multiple urls. Using `searchBatch` the resulting `Promise`
// will resolve only after the completion of all the searches.
NG.searchBatch([
  { url: 'url1' },
  { url: 'url2' },
  { url: 'url3' }
], "pattern")
  .then((outputs) => {
    outputs.forEach((output) => {
      console.log(`The pattern has matched for ${output.url}`, output.result)
    });
  });

// If you want to avoid waiting for the completion of
// all the searches, the method `searchBatchWithCallback` will
// execute a callback every time a search completes.
NG.searchBatchWithCallback([
  { url: 'url1' },
  { url: 'url2' },
  { url: 'url3' }
], "pattern", (output) => {
  console.log(`The pattern has matched for ${output.url}`, output.result)
});
```

## Batch results never reject

The batch methods add an `error` field, and this is the part worth reading twice:

```ts
{ /* …as above… */ error: string | null }
```

> [!WARNING]
> **`searchBatch` and `searchBatchWithCallback` never reject.** A failed request — network error, 404, CORS —
> is captured as `{ result: false, error: "…" }`, which is indistinguishable from a genuine "no match" unless
> you check `error`. Single `search` calls behave the opposite way: they *reject*, and have no `error` field.

```ts
const outputs = await NG.searchBatch(inputs, pattern);

const matched = outputs.filter((o) => o.error === null && o.result);
const failed = outputs.filter((o) => o.error !== null);
```
