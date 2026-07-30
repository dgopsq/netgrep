import { ReadableStream } from 'node:stream/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchNetgrepResult } from './data/BatchNetgrepResult.js';
import { Netgrep } from './Netgrep.js';

/**
 * Unit tests: `fetch` and the engine are BOTH mocked, so not a line of Rust
 * runs here and no DOM is needed. What is left is exactly the wiring —
 * streaming, batching, caching, error handling, config merging — which is what
 * this suite is for.
 *
 * The counterpart is `Netgrep.integration.spec.ts`, which drives the real
 * compiled engine in a real browser. Behaviour that depends on what the engine
 * decides belongs there, or in `packages/search/tests/search.rs`; behaviour
 * that depends on what this class does with the answer belongs here.
 */

const encoder = new TextEncoder();

/**
 * Helper function to generate a `ReadableStream`
 * from an input string.
 */
export function genReadableStreamFromString(str: string): ReadableStream {
  return genReadableStreamFromChunks([encoder.encode(str)]);
}

/**
 * Build a `ReadableStream` that emits the given chunks one at a time, the way
 * a real response body arrives.
 *
 * The chunks are `Uint8Array`s rather than strings because `Netgrep.search`
 * wraps whatever it reads in `new Uint8Array(value)` before caching it, and
 * `new Uint8Array('some string')` is a zero-length array — so a string-valued
 * chunk would make every cache assertion below vacuously true.
 */
function genReadableStreamFromChunks(
  chunks: Array<Uint8Array>,
): ReadableStream {
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }

      controller.enqueue(chunks[index]);
      index += 1;
    },
  });
}

/**
 * Collect the results of a `searchBatchWithCallback` call.
 *
 * That method returns `void` and fires its callback per input, so a test has
 * nothing to await. `settled` resolves once the callback has been called the
 * expected number of times.
 */
function collectCallbacks<T extends object>(expected: number) {
  const results: Array<BatchNetgrepResult<T>> = [];
  let finish: () => void;

  const settled = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const callback = (result: BatchNetgrepResult<T>) => {
    results.push(result);
    if (results.length >= expected) finish();
  };

  return { results, settled, callback };
}

/** Let every already-scheduled promise callback run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Serve every url but one, which rejects.
 *
 * The partial-failure shape is what a real corpus search produces — most files
 * answer, one is a 404 or a dropped connection — and three tests below need it
 * with a different url each time.
 */
function serveExcept(failing: string, message = 'nope') {
  mockFetch.mockImplementation((url: string) =>
    url === failing
      ? Promise.reject(new Error(message))
      : Promise.resolve({ body: genReadableStreamFromString('test') }),
  );
}

// `vi.hoisted` is required, not stylistic: `vi.mock` is lifted above the module
// body, and its factory runs while `./Netgrep.js` is being imported — before a
// plain `const` here would have been initialised.
const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

const mockFetch = vi.fn();

// Mocking the `search_bytes` function. `default` stands in for the WASM
// module's `init()`, which Netgrep awaits before every search.
//
// The arguments are forwarded rather than dropped so that tests can assert
// WHICH bytes reached the engine — the only way to tell a cache hit from a
// re-fetch that happened to return the same thing.
vi.mock('@netgrep/search', () => {
  return {
    default: () => Promise.resolve(),
    search_bytes: (...args: Array<unknown>) => mockSearch(...args),
  };
});

// Mocking `fetch` function.
global.fetch = mockFetch;

describe('Netgrep', () => {
  describe('Netgrep::search', () => {
    const NG = new Netgrep({ enableMemoryCache: false });
    const NGWithCache = new Netgrep({ enableMemoryCache: true });

    const url = 'url';
    const pattern = 'pattern';

    beforeEach(() => {
      mockFetch.mockClear();
      mockSearch.mockClear();

      mockFetch.mockImplementation(() =>
        Promise.resolve({ body: genReadableStreamFromString('test') }),
      );
    });

    it('should work for a positive search result', async () => {
      mockSearch.mockReturnValue(true);

      const result = await NG.search(url, pattern);

      expect(result).toMatchObject({ url, result: true });
    });

    it('should work for a negative search result', async () => {
      mockSearch.mockReturnValue(false);

      const result = await NG.search(url, pattern);

      expect(result).toMatchObject({ url, result: false });
    });

    it('should work with the in-memory cache active', async () => {
      mockSearch.mockReturnValue(true);

      const result = await NGWithCache.search(url, pattern);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ url, result: true });

      const result2 = await NGWithCache.search(url, pattern);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result2).toMatchObject({ url, result: true });
    });

    it('echoes the url, the pattern and the metadata back', async () => {
      mockSearch.mockReturnValue(true);

      // The result is the entire public output of the library, so every field
      // of it is worth an assertion.
      await expect(NG.search(url, pattern, { id: 7 })).resolves.toEqual({
        url,
        pattern,
        result: true,
        metadata: { id: 7 },
      });
    });

    it('resolves false when the body is empty, without consulting the engine', async () => {
      mockSearch.mockReturnValue(true);
      mockFetch.mockImplementation(() =>
        Promise.resolve({ body: genReadableStreamFromChunks([]) }),
      );

      await expect(NG.search(url, pattern)).resolves.toMatchObject({
        result: false,
      });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('rejects when the response carries no body', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({ body: null }));

      await expect(NG.search(url, pattern)).rejects.toThrow(
        "The response doesn't contain a body",
      );
    });

    it('rejects when the fetch itself fails', async () => {
      mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));

      await expect(NG.search(url, pattern)).rejects.toThrow('offline');
    });

    it('forwards the abort signal to fetch', async () => {
      mockSearch.mockReturnValue(true);

      const controller = new AbortController();
      await NG.search(url, pattern, undefined, { signal: controller.signal });

      // `search` does not act on the signal itself — it hands it to `fetch`
      // and lets the resulting rejection travel back out.
      expect(mockFetch).toHaveBeenCalledWith(url, {
        signal: controller.signal,
      });
    });

    it('leaves the signal undefined when no search config is given', async () => {
      mockSearch.mockReturnValue(true);

      await NG.search(url, pattern);

      expect(mockFetch).toHaveBeenCalledWith(url, { signal: undefined });
    });

    it('enables the in-memory cache by default', async () => {
      mockSearch.mockReturnValue(true);

      // The default matters: it is what every consumer who passes no config
      // gets, and it is the setting that makes BACKLOG 3b reachable.
      const defaulted = new Netgrep();

      await defaulted.search('defaulted', pattern);
      await defaulted.search('defaulted', pattern);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('re-fetches every time when the cache is disabled', async () => {
      mockSearch.mockReturnValue(true);

      await NG.search('uncached', pattern);
      await NG.search('uncached', pattern);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('accumulates consecutive chunks into one cached buffer', async () => {
      // A miss drains the stream, so all three chunks land in the cache and
      // the next search is answered from the joined buffer.
      mockSearch.mockReturnValue(false);
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          body: genReadableStreamFromChunks([
            encoder.encode('alpha '),
            encoder.encode('beta '),
            encoder.encode('gamma'),
          ]),
        }),
      );

      const instance = new Netgrep({ enableMemoryCache: true });
      await instance.search('joined', pattern);

      mockSearch.mockClear();
      await instance.search('joined', pattern);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockSearch).toHaveBeenCalledTimes(1);
      expect(mockSearch).toHaveBeenCalledWith(
        encoder.encode('alpha beta gamma'),
        pattern,
      );
    });

    it('caches nothing when the search resolved before the stream ended', async () => {
      // BACKLOG 3b. Writing per chunk left an entry holding only the chunks read
      // before the match, unmarked as a prefix, so a later search for anything
      // further down answered `false` from text never downloaded. The entry is
      // now written on `done` only: an early resolution leaves none and the next
      // search re-fetches, which is the right trade against a wrong answer.
      mockSearch.mockReturnValue(true);
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          body: genReadableStreamFromChunks([
            encoder.encode('needle\n'),
            encoder.encode('omega\n'),
          ]),
        }),
      );

      const instance = new Netgrep({ enableMemoryCache: true });

      await instance.search('partial', pattern);
      await instance.search('partial', pattern);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not share its cache with another instance', async () => {
      mockSearch.mockReturnValue(true);

      await new Netgrep({ enableMemoryCache: true }).search('shared', pattern);
      await new Netgrep({ enableMemoryCache: true }).search('shared', pattern);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('keys the cache by url', async () => {
      mockSearch.mockReturnValue(true);

      const instance = new Netgrep({ enableMemoryCache: true });

      await instance.search('first', pattern);
      await instance.search('second', pattern);
      await instance.search('first', pattern);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('frees a waiting search when the download it waited on fails', async () => {
      // A waiter parked on an in-flight download must not inherit its failure —
      // it never asked for that request, and its own signal may be perfectly
      // live. It also must not park forever. So: fetch for itself, and let the
      // failure belong to the caller that owns it.
      mockSearch.mockReturnValue(true);
      mockFetch
        .mockImplementationOnce(() => Promise.reject(new Error('offline')))
        .mockImplementation(() =>
          Promise.resolve({ body: genReadableStreamFromString('test') }),
        );

      const instance = new Netgrep({ enableMemoryCache: true });

      const settled = await Promise.allSettled([
        instance.search('doomed', pattern),
        instance.search('doomed', pattern),
      ]);

      expect(settled[0]).toMatchObject({ status: 'rejected' });
      expect(settled[1]).toMatchObject({
        status: 'fulfilled',
        value: { url: 'doomed', result: true },
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not serialise waiters that all have to fetch anyway', async () => {
      // A caller waits ONCE. Waiting until no download is in flight instead
      // would make each waiter queue behind the last, so callers that used to
      // fetch in parallel would fetch one after another — for the same number
      // of requests, since an early match caches nothing for anyone to share.
      //
      // Overlap rather than elapsed time, so this pins the shape and not the
      // machine it runs on.
      let open = 0;
      let peak = 0;

      mockSearch.mockReturnValue(true);
      mockFetch.mockImplementation(() => {
        open += 1;
        peak = Math.max(peak, open);

        return Promise.resolve({
          body: new ReadableStream({
            pull(controller) {
              controller.enqueue(encoder.encode('needle\n'));
              controller.close();
              open -= 1;
            },
          }),
        });
      });

      const instance = new Netgrep({ enableMemoryCache: true });

      await Promise.all([
        instance.search('herd', pattern),
        instance.search('herd', pattern),
        instance.search('herd', pattern),
      ]);

      // The first goes alone; the two that wake behind it go together.
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(peak).toBeGreaterThan(1);
    });

    it('stops reading as soon as a chunk matches', async () => {
      // The terminators matter: a chunk is searched only up to its last `\n`, so
      // a newline-free fixture would search nothing until the stream ended and
      // this would test the opposite of what it says. See `splitAtLastLine`.
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          body: genReadableStreamFromChunks([
            encoder.encode('one\n'),
            encoder.encode('two\n'),
            encoder.encode('three\n'),
          ]),
        }),
      );

      // Matches on the second chunk, so the third is never searched. Early
      // resolution is the entire point of the library (decision 0002), and it
      // is observable here as a call count.
      mockSearch.mockReturnValueOnce(false).mockReturnValueOnce(true);

      await expect(NG.search(url, pattern)).resolves.toMatchObject({
        result: true,
      });
      expect(mockSearch).toHaveBeenCalledTimes(2);
    });

    it('holds a chunk back until its line is complete, then searches it whole', async () => {
      // The cost of fixing BACKLOG 3a: early resolution is line-granular now.
      // A split word reaches the engine ONCE, joined, rather than twice in
      // halves that match nothing — but the answer arrives one chunk later.
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          body: genReadableStreamFromChunks([
            encoder.encode('hello won'),
            encoder.encode('derful world\n'),
          ]),
        }),
      );

      mockSearch.mockReturnValue(true);

      await expect(NG.search(url, pattern)).resolves.toMatchObject({
        result: true,
      });

      // Not once per chunk: the first had no complete line in it.
      expect(mockSearch).toHaveBeenCalledTimes(1);
      expect(mockSearch).toHaveBeenCalledWith(
        encoder.encode('hello wonderful world\n'),
        pattern,
      );
    });

    it('searches the final line even when nothing terminates it', async () => {
      // A file not ending in a newline leaves a tail no chunk will complete, so
      // it is searched on `done`. Forgetting that loses every such last line.
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          body: genReadableStreamFromChunks([
            encoder.encode('first\n'),
            encoder.encode('unterminated'),
          ]),
        }),
      );

      mockSearch.mockReturnValueOnce(false).mockReturnValueOnce(true);

      await expect(NG.search(url, pattern)).resolves.toMatchObject({
        result: true,
      });
      expect(mockSearch).toHaveBeenLastCalledWith(
        encoder.encode('unterminated'),
        pattern,
      );
    });

    it('does not retain the file when the cache is off', async () => {
      // Chunks are collected for the cache only. Holding them with the cache off
      // would keep all 500 MB of a 500 MB file — worse than the O(n²) append it
      // replaced. Observable as the engine never seeing a joined buffer.
      mockSearch.mockReturnValue(false);
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          body: genReadableStreamFromChunks([
            encoder.encode('alpha\n'),
            encoder.encode('beta\n'),
          ]),
        }),
      );

      await NG.search('uncached-retain', pattern);

      // One call per line, never a joined buffer, and no cache entry after.
      expect(mockSearch).toHaveBeenCalledTimes(2);
      await NG.search('uncached-retain', pattern);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Netgrep::searchBatch', () => {
    const NG = new Netgrep({ enableMemoryCache: false });
    const NGWithCache = new Netgrep({ enableMemoryCache: true });

    const urls = [{ url: 'url1' }, { url: 'url2' }, { url: 'url3' }];

    const pattern = 'pattern';

    beforeEach(() => {
      mockFetch.mockClear();
      mockSearch.mockClear();

      mockFetch.mockImplementation(() =>
        Promise.resolve({ body: genReadableStreamFromString('test') }),
      );
    });

    it('should work for a positive search result', async () => {
      mockSearch.mockReturnValue(true);

      const results = await NG.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map(
        ({ url }) => ({
          url,
          pattern,
          result: true,
          error: null,
        }),
      );

      expect(results).toMatchObject(expectedResults);
    });

    it('should work for a negative search result', async () => {
      mockSearch.mockReturnValue(false);

      const results = await NG.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map(
        ({ url }) => ({
          url,
          pattern,
          result: false,
          error: null,
        }),
      );

      expect(results).toMatchObject(expectedResults);
    });

    it('should handle errors in the fetch requests', async () => {
      const errorMessage = 'message';

      mockFetch.mockImplementation(() =>
        Promise.reject(new Error(errorMessage)),
      );

      mockSearch.mockReturnValue(false);

      const results = await NG.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map(
        ({ url }) => ({
          url,
          pattern,
          result: false,
          error: errorMessage,
        }),
      );

      expect(results).toMatchObject(expectedResults);
    });

    it('should work with the in-memory cache active', async () => {
      mockSearch.mockReturnValue(true);

      const results = await NGWithCache.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map(
        ({ url }) => ({
          url,
          pattern,
          result: true,
          error: null,
        }),
      );

      expect(mockFetch).toHaveBeenCalledTimes(urls.length);
      expect(results).toMatchObject(expectedResults);

      const results2 = await NGWithCache.searchBatch(urls, pattern);

      expect(mockFetch).toHaveBeenCalledTimes(urls.length);
      expect(results2).toMatchObject(expectedResults);
    });

    it('resolves to an empty array for no inputs', async () => {
      await expect(NG.searchBatch([], pattern)).resolves.toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('keeps the metadata of each input, including on the error path', async () => {
      mockSearch.mockReturnValue(true);

      serveExcept('bad');

      const results = await NG.searchBatch(
        [
          { url: 'good', metadata: { id: 1 } },
          { url: 'bad', metadata: { id: 2 } },
        ],
        pattern,
      );

      expect(results).toMatchObject([
        { url: 'good', result: true, error: null, metadata: { id: 1 } },
        { url: 'bad', result: false, error: 'nope', metadata: { id: 2 } },
      ]);
    });

    it('does not let one failing url fail the others', async () => {
      mockSearch.mockReturnValue(true);

      serveExcept('url2');

      const results = await NG.searchBatch(urls, pattern);

      expect(results.map((r) => r.error)).toEqual([null, 'nope', null]);
      expect(results.map((r) => r.result)).toEqual([true, false, true]);
    });

    it('serialises a rejection that is not an Error', async () => {
      // `serializeError` falls back to `JSON.stringify`, which is what a
      // consumer reading `.error` will see. Nothing else covers that branch.
      mockFetch.mockImplementation(() => Promise.reject({ code: 418 }));

      const results = await NG.searchBatch([{ url: 'teapot' }], pattern);

      expect(results[0].error).toBe('{"code":418}');
    });

    it('forwards the abort signal to every request', async () => {
      mockSearch.mockReturnValue(true);

      const controller = new AbortController();
      await NG.searchBatch(urls, pattern, { signal: controller.signal });

      for (const { url } of urls) {
        expect(mockFetch).toHaveBeenCalledWith(url, {
          signal: controller.signal,
        });
      }
    });
  });

  describe('Netgrep::searchBatchWithCallback', () => {
    const NG = new Netgrep({ enableMemoryCache: false });

    const urls = [{ url: 'url1' }, { url: 'url2' }, { url: 'url3' }];

    const pattern = 'pattern';

    beforeEach(() => {
      mockFetch.mockClear();
      mockSearch.mockClear();

      mockFetch.mockImplementation(() =>
        Promise.resolve({ body: genReadableStreamFromString('test') }),
      );
    });

    it('invokes the callback once per input', async () => {
      mockSearch.mockReturnValue(true);

      const { results, settled, callback } = collectCallbacks(urls.length);

      NG.searchBatchWithCallback(urls, pattern, callback);
      await settled;

      // Order is not guaranteed — each search resolves on its own — so the
      // assertion is on the set.
      expect(results).toHaveLength(urls.length);
      expect(results.map((r) => r.url).sort()).toEqual([
        'url1',
        'url2',
        'url3',
      ]);
      expect(results.every((r) => r.result && r.error === null)).toBe(true);
    });

    it('reports a negative result through the callback too', async () => {
      mockSearch.mockReturnValue(false);

      const { results, settled, callback } = collectCallbacks(1);

      NG.searchBatchWithCallback([{ url: 'only' }], pattern, callback);
      await settled;

      expect(results[0]).toMatchObject({
        url: 'only',
        pattern,
        result: false,
        error: null,
      });
    });

    it('reports errors through the callback rather than throwing', async () => {
      mockFetch.mockImplementation(() => Promise.reject(new Error('nope')));

      const { results, settled, callback } = collectCallbacks(urls.length);

      // The method returns void, so an unhandled rejection here would surface
      // as a process-level warning rather than a test failure. This pins that
      // every failure is routed into the callback instead.
      NG.searchBatchWithCallback(urls, pattern, callback);
      await settled;

      expect(results.map((r) => r.error)).toEqual(['nope', 'nope', 'nope']);
      expect(results.every((r) => r.result === false)).toBe(true);
    });

    it('passes the metadata through both paths', async () => {
      mockSearch.mockReturnValue(true);

      serveExcept('bad');

      const { results, settled, callback } = collectCallbacks<{ id: number }>(
        2,
      );

      NG.searchBatchWithCallback(
        [
          { url: 'good', metadata: { id: 1 } },
          { url: 'bad', metadata: { id: 2 } },
        ],
        pattern,
        callback,
      );
      await settled;

      // Looked up rather than indexed by position: the two searches resolve
      // independently, so the callback order is not defined.
      const byUrl = (url: string) => results.find((r) => r.url === url);

      expect(byUrl('good')).toMatchObject({ metadata: { id: 1 }, error: null });
      expect(byUrl('bad')).toMatchObject({
        metadata: { id: 2 },
        error: 'nope',
      });
    });

    it('never calls the callback for an empty input list', async () => {
      const callback = vi.fn();

      NG.searchBatchWithCallback([], pattern, callback);
      await flush();

      expect(callback).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('forwards the abort signal to every request', async () => {
      mockSearch.mockReturnValue(true);

      const controller = new AbortController();
      const { settled, callback } = collectCallbacks(urls.length);

      NG.searchBatchWithCallback(urls, pattern, callback, {
        signal: controller.signal,
      });
      await settled;

      for (const { url } of urls) {
        expect(mockFetch).toHaveBeenCalledWith(url, {
          signal: controller.signal,
        });
      }
    });
  });
});
