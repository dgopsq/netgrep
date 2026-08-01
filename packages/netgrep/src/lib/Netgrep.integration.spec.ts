import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Netgrep } from './Netgrep.js';

/**
 * Integration tests: the REAL WASM engine driven through the REAL streaming
 * loop in `Netgrep.search`.
 *
 * This is the counterpart to `Netgrep.spec.ts`, which mocks `@netgrep/search`
 * and therefore never executes a single line of Rust. Only `fetch` is faked
 * here, and only to remove the network — the bytes still travel through a real
 * `ReadableStream`, are still chunked, and are still matched by the compiled
 * `search_bytes`.
 *
 * WHY THIS EXISTS
 * ---------------
 * It was written as the behavioural baseline for the 2026 modernization, ahead
 * of the PRs that replaced the entire JS toolchain and then jumped
 * `wasm-bindgen` 44 minor versions while removing the ripgrep fork. The claim
 * those PRs had to support was "behaviour is identical", and nothing in this
 * repository could previously substantiate it. It keeps that job for every
 * future dependency change.
 *
 * So: these assertions describe what netgrep ACTUALLY DOES TODAY, which is not
 * always what it should do. The `documented defects` block at the bottom pins
 * known-wrong behaviour on purpose. See the comment there before "fixing" it.
 *
 * IT RUNS THE ARTEFACT THAT SHIPS, THE WAY IT SHIPS
 * -------------------------------------------------
 * This suite runs in a real headless Chromium (see `vitest.config.ts`), so
 * there is no longer any accommodation at all: `pkg/` is exactly what gets
 * published — wasm-pack's `web` target — and it is instantiated by its own
 * real `init()`, which fetches `index_bg.wasm` over HTTP relative to
 * `import.meta.url`. Same module, same binary, same marshalling glue, same
 * loader a consumer gets.
 *
 * Under Node this was impossible: `import.meta.url` has no HTTP meaning there,
 * so the bytes had to be read off disk and handed to `initSync`, leaving the
 * loader — the part that has actually broken before, see decision 0005 — the
 * one thing nothing exercised.
 *
 * Build it with: pnpm build:wasm
 */
vi.mock('@netgrep/search', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@netgrep/search')>();

  // Instantiate through the REAL, fetch-based `init()` — the point of running
  // in a browser. It happens here, at mock-factory time, because the factory
  // runs while `Netgrep.ts` is being imported, which is before this file's
  // body replaces `globalThis.fetch` with a spy. Doing it any later would send
  // the engine's own `.wasm` request into the spy.
  await mod.default();

  // Already instantiated, so `Netgrep.ts`'s module-level `init()` must be a
  // no-op rather than a second instantiation.
  return { ...mod, default: () => Promise.resolve() };
});

const encoder = new TextEncoder();

/** Build a `ReadableStream` that emits the given chunks one at a time. */
function streamOfChunks(chunks: Array<Uint8Array>) {
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
 * Wrap a stream in a minimal response body that counts `reader.read()` calls.
 *
 * The counter is what makes early resolution observable: `Netgrep.search`
 * stops calling `read()` the moment a chunk matches.
 *
 * Note it counts READS, not stream pulls. A `ReadableStream` with the default
 * queuing strategy pulls one chunk ahead of the consumer, so counting inside
 * `pull` overstates consumption by one and would make this assertion a lie.
 */
function countingBody(stream: ReadableStream, state: { reads: number }) {
  const body = {
    getReader() {
      const reader = stream.getReader();

      return {
        read() {
          state.reads += 1;
          return reader.read();
        },
      };
    },
  };

  return body;
}

/**
 * Split a string into fixed-size chunks of bytes, the way a real HTTP response
 * arrives — except deterministically, which is the whole point.
 */
function chunked(str: string, size: number): Array<Uint8Array> {
  const bytes = encoder.encode(str);
  const out: Array<Uint8Array> = [];

  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.slice(i, i + size));
  }

  return out;
}

/** Concatenate strings and raw byte values into a single chunk. */
function bytes(...parts: Array<string | number>): Uint8Array {
  return new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? Array.from(encoder.encode(part)) : [part],
    ),
  );
}

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

/**
 * Serve the given chunks for any URL, and expose the read counter.
 *
 * A fresh stream is built per `fetch` call — a `ReadableStream` can only be
 * consumed once, so reusing one across calls throws "ReadableStream is
 * locked". The read counter is shared across all of them.
 */
function serve(chunks: Array<Uint8Array>) {
  const state = { reads: 0 };

  mockFetch.mockImplementation(() =>
    Promise.resolve({ body: countingBody(streamOfChunks(chunks), state) }),
  );

  return state;
}

/**
 * Serve the given chunks, unless the caller's signal has been aborted — in
 * which case reject the way a real `fetch` does.
 *
 * Returns the controller, so the test decides when to abort. `Netgrep` never
 * inspects the signal itself; it hands it to `fetch`, so honouring it here is
 * the only way to exercise the path a consumer actually gets.
 */
function serveUnlessAborted(chunks: Array<Uint8Array>) {
  const controller = new AbortController();

  mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
    init?.signal?.aborted
      ? Promise.reject(new DOMException('Aborted', 'AbortError'))
      : Promise.resolve({ body: streamOfChunks(chunks) }),
  );

  return controller;
}

const POEM =
  'One Wiseman came to Jhaampe-town.\n' +
  'He set aside both Queen and Crown\n' +
  'Did his task and fell asleep\n' +
  'Gave his bones to the stones to keep.\n';

describe('Netgrep integration (real WASM)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('matching', () => {
    it('finds a pattern contained in a single chunk', async () => {
      serve([encoder.encode(POEM)]);

      const result = await new Netgrep({ enableMemoryCache: false }).search(
        'url',
        'set aside',
      );

      expect(result).toMatchObject({ result: true, pattern: 'set aside' });
    });

    it('reports false for an absent pattern, having drained the stream', async () => {
      const chunks = chunked(POEM, 16);
      const state = serve(chunks);

      const result = await new Netgrep({ enableMemoryCache: false }).search(
        'url',
        'dragon',
      );

      expect(result).toMatchObject({ result: false });
      // Every chunk, plus the final read that reports `done`.
      expect(state.reads).toBe(chunks.length + 1);
    });

    it('finds a pattern that only appears in a later chunk', async () => {
      serve(chunked(POEM, 16));

      const result = await new Netgrep({ enableMemoryCache: false }).search(
        'url',
        'stones',
      );

      expect(result).toMatchObject({ result: true });
    });

    it('stops reading as soon as a line matches', async () => {
      // 'One Wiseman' is in the first 16 bytes, but a chunk is searched only up
      // to its last `\n`, so the answering read is the one that COMPLETES the
      // line. POEM's first line is 34 bytes, so that is the third 16-byte chunk.
      // The price of fixing BACKLOG 3a: invisible against real 16-64 KB chunks,
      // exactly two extra reads against these deliberately tiny ones.
      const chunks = chunked(POEM, 16);
      const state = serve(chunks);

      await new Netgrep({ enableMemoryCache: false }).search('url', 'Wiseman');

      expect(state.reads).toBe(3);

      // Still resolving early, which is the property that matters: the poem is
      // eight chunks long and five of them were never asked for.
      expect(chunks.length).toBeGreaterThan(state.reads);
    });

    it('finds a pattern straddling a chunk boundary', async () => {
      // BACKLOG 3a, fixed: the retained tail hides the seam from the engine. The
      // `documented defects` block has what this used to assert, and the
      // residual case that survives.
      serve([encoder.encode('hello won'), encoder.encode('derful world')]);

      await expect(
        new Netgrep({ enableMemoryCache: false }).search('url', 'wonderful'),
      ).resolves.toMatchObject({ result: true });
    });

    it('does not let a chunk boundary fake a line boundary', async () => {
      // The mirror image of 3a, never separately tracked: a chunk searched as
      // though it were a whole document made the seam look like a line start to
      // `^` and a line end to `$`, so both invented matches wherever the network
      // happened to split. Whole lines fix both directions at once.
      const NG = new Netgrep({ enableMemoryCache: false });

      serve([encoder.encode('hello won'), encoder.encode('derful world\n')]);
      await expect(NG.search('a', 'won$')).resolves.toMatchObject({
        result: false,
      });

      serve([encoder.encode('hello won'), encoder.encode('derful world\n')]);
      await expect(NG.search('b', '^derful')).resolves.toMatchObject({
        result: false,
      });

      // The genuine anchors on the same bytes still match.
      serve([encoder.encode('hello won'), encoder.encode('derful world\n')]);
      await expect(NG.search('c', '^hello')).resolves.toMatchObject({
        result: true,
      });

      serve([encoder.encode('hello won'), encoder.encode('derful world\n')]);
      await expect(NG.search('d', 'world$')).resolves.toMatchObject({
        result: true,
      });
    });

    it('matches a pattern spanning multiple lines of one chunk', async () => {
      serve([encoder.encode(POEM)]);

      const NG = new Netgrep({ enableMemoryCache: false });

      // Every line is reachable; only the `^` anchor misbehaves (see
      // `documented defects` below).
      await expect(NG.search('a', 'Gave his bones')).resolves.toMatchObject({
        result: true,
      });
      await expect(NG.search('b', 'asleep$')).resolves.toMatchObject({
        result: true,
      });
    });

    it('supports regex syntax, not just literals', async () => {
      serve([encoder.encode(POEM)]);

      const NG = new Netgrep({ enableMemoryCache: false });

      await expect(
        NG.search('url', 'Queen (and|or) Crown'),
      ).resolves.toMatchObject({
        result: true,
      });
    });

    it('applies smart case: a lowercase pattern is case-insensitive', async () => {
      serve([encoder.encode(POEM)]);

      const result = await new Netgrep({ enableMemoryCache: false }).search(
        'url',
        'both queen and crown',
      );

      expect(result).toMatchObject({ result: true });
    });

    it('applies smart case: an uppercased pattern is case-sensitive', async () => {
      serve([encoder.encode('one wiseman came to jhaampe-town.')]);

      const result = await new Netgrep({ enableMemoryCache: false }).search(
        'url',
        'Wiseman',
      );

      expect(result).toMatchObject({ result: false });
    });

    it('returns the metadata it was given', async () => {
      serve([encoder.encode(POEM)]);

      const result = await new Netgrep({ enableMemoryCache: false }).search(
        'url',
        'Wiseman',
        { id: 42 },
      );

      expect(result).toMatchObject({ result: true, metadata: { id: 42 } });
    });

    it('rejects when the response carries no body', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({ body: null }));

      const NG = new Netgrep({ enableMemoryCache: false });

      await expect(NG.search('url', 'Wiseman')).rejects.toThrow(
        "The response doesn't contain a body",
      );
    });
  });

  describe('stream shapes', () => {
    it('reports false for a body that closes without emitting anything', async () => {
      const state = serve([]);

      const result = await new Netgrep({ enableMemoryCache: false }).search(
        'url',
        'Wiseman',
      );

      expect(result).toMatchObject({ result: false });
      // The single read that reports `done`.
      expect(state.reads).toBe(1);
    });

    it('keeps reading past a zero-length chunk', async () => {
      // A zero-length chunk is not `done`, and the engine answers `false` for
      // it. Treating either as end-of-stream would silently truncate the
      // search, and real bodies do emit empty chunks.
      serve([
        encoder.encode('nothing here'),
        new Uint8Array(0),
        encoder.encode('Wiseman arrives'),
      ]);

      await expect(
        new Netgrep({ enableMemoryCache: false }).search('url', 'Wiseman'),
      ).resolves.toMatchObject({ result: true });
    });

    it('matches in a final chunk that has no trailing newline', async () => {
      // Chunk boundaries almost never land on a line terminator, so the last
      // line the engine sees is usually unterminated.
      serve([encoder.encode('first line\n'), encoder.encode('Wiseman')]);

      await expect(
        new Netgrep({ enableMemoryCache: false }).search('url', 'Wiseman$'),
      ).resolves.toMatchObject({ result: true });
    });

    it('matches non-ASCII text across the WASM boundary', async () => {
      // The bytes cross into WASM as a `Uint8Array` and the pattern as a
      // string, so a multi-byte character exercises the marshalling on both
      // sides at once.
      serve(chunked('il a bu un café noir\n', 8));

      await expect(
        new Netgrep({ enableMemoryCache: false }).search('url', 'café'),
      ).resolves.toMatchObject({ result: true });
    });
  });

  describe('searchBatch', () => {
    it('resolves a result per input against the real engine', async () => {
      serve([encoder.encode(POEM)]);

      const results = await new Netgrep({
        enableMemoryCache: false,
      }).searchBatch([{ url: 'a' }, { url: 'b' }, { url: 'c' }], 'fell asleep');

      expect(results).toMatchObject([
        { url: 'a', result: true, error: null },
        { url: 'b', result: true, error: null },
        { url: 'c', result: true, error: null },
      ]);
    });

    it('reports hits, misses and failures side by side', async () => {
      // The shape a real corpus search produces: most files answer, one is a
      // 404 or a dropped connection, and none of it stops the rest.
      mockFetch.mockImplementation((url: string) => {
        if (url === 'broken') return Promise.reject(new Error('offline'));

        const text = url === 'hit' ? POEM : 'nothing of interest\n';
        return Promise.resolve({
          body: streamOfChunks([encoder.encode(text)]),
        });
      });

      const results = await new Netgrep({
        enableMemoryCache: false,
      }).searchBatch(
        [{ url: 'hit' }, { url: 'miss' }, { url: 'broken' }],
        'Wiseman',
      );

      expect(results).toMatchObject([
        { url: 'hit', result: true, error: null },
        { url: 'miss', result: false, error: null },
        { url: 'broken', result: false, error: 'offline' },
      ]);
    });
  });

  describe('searchBatchWithCallback', () => {
    it('calls back once per input, against the real engine', async () => {
      serve([encoder.encode(POEM)]);

      const results: Array<{ url: string; result: boolean }> = [];

      await new Promise<void>((resolve) => {
        new Netgrep({ enableMemoryCache: false }).searchBatchWithCallback(
          [{ url: 'a' }, { url: 'b' }],
          'Jhaampe',
          (result) => {
            results.push({ url: result.url, result: result.result });
            if (results.length === 2) resolve();
          },
        );
      });

      // Each search resolves independently, so only the set is defined.
      expect(results.map((r) => r.url).sort()).toEqual(['a', 'b']);
      expect(results.every((r) => r.result)).toBe(true);
    });
  });

  describe('abort', () => {
    it('rejects the search when the signal aborts the fetch', async () => {
      // `Netgrep` does not watch the signal itself — it hands it to `fetch`
      // and lets the rejection travel back out — so this pins that the
      // rejection is not swallowed somewhere in the streaming loop.
      const controller = serveUnlessAborted([encoder.encode(POEM)]);
      controller.abort();

      await expect(
        new Netgrep({ enableMemoryCache: false }).search(
          'url',
          'Wiseman',
          undefined,
          {
            signal: controller.signal,
          },
        ),
      ).rejects.toThrow('Aborted');
    });

    it('turns an abort into a per-url error in a batch', async () => {
      const controller = serveUnlessAborted([encoder.encode(POEM)]);
      controller.abort();

      const results = await new Netgrep({
        enableMemoryCache: false,
      }).searchBatch([{ url: 'a' }, { url: 'b' }], 'Wiseman', {
        signal: controller.signal,
      });

      expect(results).toMatchObject([
        { url: 'a', result: false, error: 'Aborted' },
        { url: 'b', result: false, error: 'Aborted' },
      ]);
    });
  });

  describe('in-memory cache', () => {
    it('answers a repeated search from cache without re-fetching', async () => {
      serve([encoder.encode(POEM)]);

      const NG = new Netgrep({ enableMemoryCache: true });

      await expect(NG.search('url', 'dragon')).resolves.toMatchObject({
        result: false,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Whole file cached (the miss drained the stream), so a different
      // pattern is answered from memory.
      await expect(NG.search('url', 'Wiseman')).resolves.toMatchObject({
        result: true,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('re-fetches every time when the cache is disabled', async () => {
      serve([encoder.encode(POEM)]);

      const NG = new Netgrep({ enableMemoryCache: false });

      await NG.search('url', 'dragon');
      await NG.search('url', 'dragon');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('answers a concurrent search of the same url from the one download', async () => {
      serve([encoder.encode(POEM)]);

      const NG = new Netgrep({ enableMemoryCache: true });

      // Order matters: the miss goes first, so the caller that fetches is the
      // one that drains the stream and writes the entry. The second waits on it
      // and is answered from that entry — a different pattern, same bytes.
      const results = await Promise.all([
        NG.search('url', 'dragon'),
        NG.search('url', 'Wiseman'),
      ]);

      expect(results.map((r) => r.result)).toEqual([false, true]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('lets a waiter fetch for itself when the download ahead cached nothing', async () => {
      // The honest residual of sharing one download: completeness is not known
      // until `done`, so a caller that matches early resolves without writing
      // an entry. The waiter wakes to a cold cache and has to fetch after all —
      // one request saved is not a guarantee, only the common case.
      serve([encoder.encode('needle\n'), encoder.encode('omega\n')]);

      const NG = new Netgrep({ enableMemoryCache: true });

      const results = await Promise.all([
        NG.search('url', 'needle'),
        NG.search('url', 'omega'),
      ]);

      expect(results.map((r) => r.result)).toEqual([true, true]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('still fetches twice for concurrent searches when the cache is disabled', async () => {
      // Deliberate, and the boundary of the in-flight registry. With no cache
      // there is no entry to hand a waiter, so waiting would buy it nothing but
      // the first download's latency. Both go to the network instead.
      serve([encoder.encode(POEM)]);

      const NG = new Netgrep({ enableMemoryCache: false });

      await Promise.all([
        NG.search('url', 'dragon'),
        NG.search('url', 'dragon'),
      ]);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * `captureLine` through the real engine — BACKLOG 19.
   *
   * What a line CONTAINS given a block of bytes is pinned natively in
   * `packages/search/tests/search.rs`, and the wiring is pinned with the engine
   * mocked in `Netgrep.spec.ts`. What only this suite can establish is the
   * property the feature actually rests on: that the line survives the trip
   * through `fetch`, the tail buffer, the cache and the WASM boundary — and
   * that it is the FILE's first matching line rather than the first one in
   * whichever chunk happened to match.
   *
   * That property is owed entirely to the tail buffer — BACKLOG 3a. Before it,
   * each chunk was searched in isolation, so a first occurrence straddling a seam
   * was missed
   * and the line returned was the file's *second* match — differing run to run
   * with the network's chunking. `splitAtLastLine` means the engine now sees
   * whole lines in file order, so the answer is the same however the response
   * is split. The first test below is that claim, and it is the reason this
   * feature could be built at all.
   */
  describe('captureLine', () => {
    const CAPTURE = { capture: 'line' } as const;

    it('returns the whole line, not the matched fragment', async () => {
      serve([encoder.encode(POEM)]);

      await expect(
        new Netgrep({ enableMemoryCache: false }).search(
          'url',
          'aside',
          undefined,
          CAPTURE,
        ),
      ).resolves.toMatchObject({
        result: true,
        line: 'He set aside both Queen and Crown',
      });
    });

    it("returns the FILE's first match however the response is chunked", async () => {
      // The assertion decision 0018 bought. `Wiseman` is on line 1 and again on
      // the last line, and every chunk size below splits the first occurrence
      // somewhere different — including straight through the middle of the word.
      const text =
        'One Wiseman came to Jhaampe-town.\n' +
        'He set aside both Queen and Crown\n' +
        'A second Wiseman followed after.\n';

      const NG = new Netgrep({ enableMemoryCache: false });
      const lines: Array<string | null> = [];

      for (const size of [1, 3, 7, 16, 40, 1024]) {
        serve(chunked(text, size));

        const result = await NG.search(
          `url-${size}`,
          'Wiseman',
          undefined,
          CAPTURE,
        );

        lines.push(result.result ? result.line : null);
      }

      // One answer, six chunkings — and it is the first line, not the third.
      expect(lines).toEqual(Array(6).fill('One Wiseman came to Jhaampe-town.'));
    });

    it('returns a line that arrived across two chunks, whole', async () => {
      // The tail buffer holds the incomplete final line back and prepends it to
      // the next chunk, so the engine is handed the line entire — which means
      // the line handed BACK is entire too, seam and all.
      serve([
        encoder.encode('first line\nHe set aside bo'),
        encoder.encode('th Queen and Crown\nlast line\n'),
      ]);

      await expect(
        new Netgrep({ enableMemoryCache: false }).search(
          'url',
          'aside',
          undefined,
          CAPTURE,
        ),
      ).resolves.toMatchObject({
        line: 'He set aside both Queen and Crown',
      });
    });

    it('gives the same line from the cache as from the network', async () => {
      // The cache path searches one whole buffer while the streaming path
      // searches a sequence of line-aligned blocks. Different code, and the
      // answer has to agree — otherwise a warm page would show a different
      // snippet than a cold one, which reads as a bug rather than as a cache.
      serve(chunked(POEM, 7));

      const NG = new Netgrep({ enableMemoryCache: true });

      // A miss first, so the stream drains and the entry is written.
      await NG.search('url', 'dragon');

      const cold = await new Netgrep({ enableMemoryCache: false }).search(
        'url',
        'bones',
        undefined,
        CAPTURE,
      );
      const warm = await NG.search('url', 'bones', undefined, CAPTURE);

      expect(warm.result && warm.line).toBe(
        'Gave his bones to the stones to keep.',
      );
      expect(cold.result && cold.line).toBe(warm.result && warm.line);
    });

    it('returns the final line of a file that does not end in a newline', async () => {
      // Resolved from the held-back tail at `done`, which is a different call
      // site from the per-chunk one and so worth its own assertion.
      serve([
        encoder.encode('first line\n'),
        encoder.encode('Wiseman at the end'),
      ]);

      await expect(
        new Netgrep({ enableMemoryCache: false }).search(
          'url',
          'Wiseman',
          undefined,
          CAPTURE,
        ),
      ).resolves.toMatchObject({ line: 'Wiseman at the end' });
    });

    it('carries a multi-byte character across the boundary intact', async () => {
      // The bytes go in as a `Uint8Array` and the line comes back as a JS
      // string, so this exercises the marshalling in the direction the boolean
      // API never used.
      serve(chunked('nothing\nil a bu un café noir\n', 8));

      await expect(
        new Netgrep({ enableMemoryCache: false }).search(
          'url',
          'café',
          undefined,
          CAPTURE,
        ),
      ).resolves.toMatchObject({ line: 'il a bu un café noir' });
    });

    it('reports a miss as `line: null`, and omits the key entirely when not asked', async () => {
      serve([encoder.encode(POEM)]);
      const NG = new Netgrep({ enableMemoryCache: false });

      await expect(
        NG.search('a', 'dragon', undefined, CAPTURE),
      ).resolves.toMatchObject({ result: false, line: null });

      serve([encoder.encode(POEM)]);

      // Not `line: null` — no key at all, so the object agrees with the type.
      expect(await NG.search('b', 'Wiseman')).not.toHaveProperty('line');
    });

    it('truncates at maxLineBytes, on a character boundary', async () => {
      serve([encoder.encode(`needle ${'é'.repeat(50)}\n`)]);

      const result = await new Netgrep({ enableMemoryCache: false }).search(
        'url',
        'needle',
        undefined,
        { capture: 'line', maxLineBytes: 12 },
      );

      // 'needle ' is 7 bytes, leaving 5 for two-byte characters — so two of
      // them, not two and a half. A split would have shown as U+FFFD.
      expect(result.result && result.line).toBe('needle éé');
      expect(result.result && result.line).not.toContain('�');
    });

    it('carries the line through a batch, and never onto a failed url', async () => {
      mockFetch.mockImplementation((url: string) =>
        url === 'broken'
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({
              body: streamOfChunks([encoder.encode(POEM)]),
            }),
      );

      const results = await new Netgrep({
        enableMemoryCache: false,
      }).searchBatch([{ url: 'hit' }, { url: 'broken' }], 'asleep', CAPTURE);

      expect(results).toMatchObject([
        {
          url: 'hit',
          result: true,
          line: 'Did his task and fell asleep',
          error: null,
        },
        { url: 'broken', result: false, line: null, error: 'offline' },
      ]);
    });

    it('rejects an invalid pattern the same way the boolean path does', async () => {
      serve([encoder.encode(POEM)]);

      await expect(
        new Netgrep({ enableMemoryCache: false }).search(
          'url',
          '(',
          undefined,
          CAPTURE,
        ),
      ).rejects.toThrow('unclosed group');
    });
  });

  /**
   * ---------------------------------------------------------------------
   * DOCUMENTED DEFECTS — these assertions pin behaviour that is WRONG.
   * ---------------------------------------------------------------------
   *
   * Read this before changing anything below.
   *
   * The modernization was explicitly toolchain-only, so these bugs were
   * carried across unchanged and on purpose. Their job here is to detect
   * *unintended* change during a large dependency jump — a test asserting the
   * correct-but-not-yet-implemented behaviour would fail today and tell us
   * nothing. See docs/decisions/0011-tests-that-assert-known-bugs.md.
   *
   * When one of these is genuinely fixed, the corresponding assertion must be
   * inverted IN THE SAME PR. That is the point: the fix cannot land quietly.
   *
   * Tracked in `docs/BACKLOG.md`.
   *
   * AND the published demo tells its visitors about these defects, so the fix
   * is not finished until it stops. Remove the caveat from the `CAVEATS` array
   * in `packages/example/src/components/limitations.tsx` in the same PR.
   * Nothing tests that — inverting the assertion below turns this suite green
   * and the site keeps warning about a bug you just fixed. See AGENTS.md §2.3.
   */
  describe('documented defects (asserting current, incorrect behaviour)', () => {
    it('BACKLOG 3a (FIXED): a match straddling a chunk boundary is found', async () => {
      // This assertion used to sit here inverted, pinning a real bug: chunks were
      // searched in isolation with no tail retained, so a pattern split across
      // the seam matched nothing — silently, and depending on how the network
      // divided the response.
      //
      // `Netgrep.search` now prepends each chunk's incomplete trailing line to
      // the next. Exact rather than a guess, because a match can never span a
      // `\n` — see `test_a_match_cannot_span_a_line_terminator` in
      // packages/search/tests/search.rs. Per the block comment above, inverted in
      // the same PR that changed it. The residual is pinned separately below.
      const text = 'hello wonderful world';

      // Control: the same bytes in one chunk match.
      serve([encoder.encode(text)]);
      await expect(
        new Netgrep({ enableMemoryCache: false }).search('url', 'wonderful'),
      ).resolves.toMatchObject({ result: true });

      // Previously false. This is the case that was broken.
      serve([encoder.encode('hello won'), encoder.encode('derful world')]);
      await expect(
        new Netgrep({ enableMemoryCache: false }).search('url', 'wonderful'),
      ).resolves.toMatchObject({ result: true });
    });

    it('BACKLOG 3a (FIXED): the answer no longer depends on whether the cache is warm', async () => {
      // The sharpest way to see 3a: the cache reassembled the chunks, so the
      // second search saw one buffer where the first saw fragments — same url,
      // same pattern, two answers, decided by whether anyone had asked before.
      //
      // Both are `true` now, for two different reasons: the tail buffer finds it
      // first time, and an early resolution no longer leaves an entry to
      // disagree (BACKLOG 3b, below) — hence two fetches.
      serve(chunked(POEM, 7));

      const NG = new Netgrep({ enableMemoryCache: true });

      await expect(NG.search('url', 'Jhaampe-town')).resolves.toMatchObject({
        result: true,
      });

      await expect(NG.search('url', 'Jhaampe-town')).resolves.toMatchObject({
        result: true,
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('BACKLOG 3b (FIXED): an early resolution leaves no cache entry to poison', async () => {
      // This assertion used to sit here inverted, pinning a real bug: the cache
      // was written per chunk, so resolving on the first match left an entry
      // holding only the PREFIX read so far, unmarked as incomplete — and a later
      // search for a term further down answered `false` about text never
      // downloaded.
      //
      // The entry is now written only on `done`, so a partial one is never
      // created. Per the block comment above, inverted in the same PR.
      //
      // The newlines matter: without them the match would only be found by the
      // end-of-stream flush, which is a drained stream, exercising nothing.
      serve([
        encoder.encode('alpha\n'),
        encoder.encode('needle\n'),
        encoder.encode('omega\n'),
      ]);

      const NG = new Netgrep({ enableMemoryCache: true });

      await expect(NG.search('url', 'needle')).resolves.toMatchObject({
        result: true,
      });

      // 'omega' IS in the file, and the answer now says so. It costs a second
      // fetch, which is the correct trade against a confident wrong answer.
      await expect(NG.search('url', 'omega')).resolves.toMatchObject({
        result: true,
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Finding 'omega' in the LAST chunk still caches nothing: completeness is
      // not known until `done`, one read later. Only a search reaching `done`
      // caches — a miss, or a match found in the flush.
      await expect(NG.search('url', 'dragon')).resolves.toMatchObject({
        result: false,
      });
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // That miss drained the stream, so this is answered from memory. The cache
      // still works; it just no longer lies.
      await expect(NG.search('url', 'omega')).resolves.toMatchObject({
        result: true,
      });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('BACKLOG 18 (FIXED): concurrent searches of one url share a single fetch', async () => {
      // This assertion used to sit here inverted, pinning a real bug: nothing
      // tracked a download already in flight, so two searches of one url
      // started before either resolved both fetched it. A per-url registry now
      // makes the second wait for the first and answer from the entry it
      // writes. Per the block comment above, inverted in the same PR.
      //
      // It works only with the cache ON, because the entry IS the handover.
      // With it off both still fetch, deliberately — pinned in the cache suite
      // above rather than here, since that is a design boundary and not a bug.
      //
      // One chunk, so this does not depend on how the two reads interleave.
      serve([encoder.encode('needle')]);

      const NG = new Netgrep({ enableMemoryCache: true });

      const results = await Promise.all([
        NG.search('url', 'zzz'),
        NG.search('url', 'zzz'),
      ]);

      expect(results.map((r) => r.result)).toEqual([false, false]);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // The other half of this entry, fixed earlier and still true: the shared
      // record holds the file once. It used to be APPENDED to per chunk,
      // joining the file to itself with no separator and forming a line that
      // existed in no file.
      await expect(NG.search('url', '^needleneedle$')).resolves.toMatchObject({
        result: false,
      });

      // The file is 'needle', and that is what the cache holds.
      await expect(NG.search('url', '^needle$')).resolves.toMatchObject({
        result: true,
      });

      // All four searches, one request.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('BACKLOG 3g: a match longer than the 64 KB tail ceiling is still missed', async () => {
      // What the tail buffer does NOT fix. A terminator-free line would buffer an
      // entire response, so past a 64 KB ceiling the tail becomes a window on the
      // last 64 KB — and a match starting before that window and ending after the
      // buffer is lost. Needs a line over 64 KB AND a match spanning most of it,
      // so it is unreachable in prose: this corpus's longest line is 76 bytes.
      const NG = new Netgrep({ enableMemoryCache: false });
      const filler = 'x'.repeat(70_000);

      // Control: found in ONE chunk, because the whole buffer is searched before
      // the window is taken. Easy to get wrong, and wrong here is a regression
      // rather than a residual — the naive cut searches only up to
      // `length - 64 KB` and drops the middle unscanned.
      serve([encoder.encode(`nee${filler}dle`)]);
      await expect(NG.search('a', 'nee.*dle')).resolves.toMatchObject({
        result: true,
      });

      // Split, and 'nee' left the window before 'dle' arrived. The gap that
      // remains.
      serve([
        encoder.encode(`nee${filler}`),
        encoder.encode('dle and then some'),
      ]);
      await expect(NG.search('b', 'nee.*dle')).resolves.toMatchObject({
        result: false,
      });

      // A match inside the ceiling survives the same boundary, pinning the bound
      // rather than merely the failure.
      serve([
        encoder.encode(`${filler}nee`),
        encoder.encode('dle and then some'),
      ]);
      await expect(NG.search('c', 'nee.*dle')).resolves.toMatchObject({
        result: true,
      });
    });

    it('BACKLOG 3g: `^` can match at a window boundary inside an over-long line', async () => {
      // The other half of 3g, and a false POSITIVE rather than a false negative.
      //
      // Once a line outgrows the ceiling the retained bytes are a window, so the
      // buffer handed to the engine no longer begins where a line begins — and
      // the engine has no way to be told that. `^` therefore anchors to the
      // window's first byte. Same precondition as the misses above: a line longer
      // than 64 KB, so unreachable in prose.
      const NG = new Netgrep({ enableMemoryCache: false });

      // Control: one line beginning with 'b', so nothing should match `^a`.
      serve([encoder.encode(`b${'a'.repeat(70_000)}`)]);
      await expect(NG.search('a', '^a')).resolves.toMatchObject({
        result: false,
      });

      // The residual: the window is discarded once a terminator arrives, but the
      // buffer that carried it still started mid-line.
      serve([
        encoder.encode(`b${'a'.repeat(70_000)}`),
        encoder.encode('end\n'),
      ]);
      await expect(NG.search('b', '^a')).resolves.toMatchObject({
        result: true,
      });
    });

    it('BACKLOG 3g: a captured line is a mid-line FRAGMENT inside an over-long line', async () => {
      // The third consequence of 3g, and the one `captureLine` added.
      //
      // Once a line outgrows the 64 KB ceiling the buffer handed to the engine
      // starts mid-line, so what comes back is not a line: it begins at an
      // arbitrary byte decided by where the window fell. `result` is still
      // correct — something did match — but `line` is a fragment, and the type
      // calls it a line.
      //
      // Same precondition as the two 3g tests above, so equally unreachable in
      // prose: this corpus's longest line is 76 bytes. Not fixable without
      // either buffering without bound or teaching the engine that a block
      // starts mid-line, which is offset bookkeeping and out of scope.
      const NG = new Netgrep({ enableMemoryCache: false });
      const filler = 'x'.repeat(70_000);

      // Control: one chunk, so the whole line is present and the line comes
      // back whole — capped, but starting where the line starts.
      serve([encoder.encode(`START${filler}needle\n`)]);

      const whole = await NG.search('a', 'needle', undefined, {
        capture: 'line',
        maxLineBytes: 16,
      });

      expect(whole.result && whole.line).toBe('STARTxxxxxxxxxxx');

      // Split, and the window has long since dropped 'START'. The line now
      // "begins" 70 KB into itself.
      serve([
        encoder.encode(`START${filler}`),
        encoder.encode('needle and then some\n'),
      ]);

      const fragment = await NG.search('b', 'needle', undefined, {
        capture: 'line',
        maxLineBytes: 16,
      });

      expect(fragment.result).toBe(true);
      expect(fragment.result && fragment.line).toBe('xxxxxxxxxxxxxxxx');
      expect(fragment.result && fragment.line).not.toContain('START');
    });

    it('BACKLOG 3c (FIXED): an invalid pattern rejects, and the engine survives it', async () => {
      // This assertion used to sit here inverted, pinning a real bug:
      // `.build(pattern).unwrap()` in lib.rs panicked on a malformed regex,
      // which surfaced as `RuntimeError: unreachable` — a wasm trap rather
      // than a catchable domain error.
      //
      // `search_bytes` now returns a `Result<bool, JsError>`, so the rejection
      // carries the regex crate's own diagnostic. Per the block comment above,
      // the assertion is inverted in the same PR that changed it.
      serve([encoder.encode(POEM)]);

      const NG = new Netgrep({ enableMemoryCache: false });

      await expect(NG.search('url', '(')).rejects.toThrow('unclosed group');

      // The point of the whole change: a trap would have poisoned the module
      // for every later call, so this could only be asserted in a browser.
      // The same instance still answers correctly afterwards.
      serve([encoder.encode(POEM)]);

      await expect(NG.search('url', 'set aside')).resolves.toMatchObject({
        result: true,
      });
    });

    it('BACKLOG 3c (FIXED): a bad pattern is a per-url error in a batch, not a crash', async () => {
      // `searchBatch` already documents that a failed url comes back as
      // `{ result: false, error }`. Before the fix an invalid pattern took a
      // different path out — a trap — so this is the assertion that the
      // README's deleted CAUTION block was standing in for.
      serve([encoder.encode(POEM)]);

      const results = await new Netgrep({
        enableMemoryCache: false,
      }).searchBatch([{ url: 'a' }, { url: 'b' }], '(');

      expect(results).toHaveLength(2);

      for (const result of results) {
        expect(result.result).toBe(false);
        expect(result.error).toContain('unclosed group');
      }
    });

    it('BACKLOG 3e (FIXED upstream): `^` anchors to the line, on any line', async () => {
      // This assertion used to sit here inverted, pinning a real bug: `^`
      // anchored to the start of the CHUNK rather than the line whenever
      // `case_smart` left a pattern case-sensitive, so `^Needle` matched only
      // on line 1 while `^needle` worked everywhere.
      //
      // Dropping the ripgrep fork for grep-regex 0.1.14 / grep-searcher 0.1.17
      // fixed it upstream — no change to lib.rs was needed. The baseline
      // caught the behaviour change, and per the block comment above the
      // assertion is inverted in the same PR that changed it.
      const NG = new Netgrep({ enableMemoryCache: false });

      serve([encoder.encode('Needle x\nother\n')]);
      await expect(NG.search('a', '^Needle')).resolves.toMatchObject({
        result: true,
      });

      // Previously false. This is the case that was broken.
      serve([encoder.encode('other\nNeedle x\n')]);
      await expect(NG.search('b', '^Needle')).resolves.toMatchObject({
        result: true,
      });

      serve([encoder.encode('a\nb\nNeedle x\n')]);
      await expect(NG.search('c', '^Needle')).resolves.toMatchObject({
        result: true,
      });

      // The case-insensitive path was always correct; still is.
      serve([encoder.encode('other\nneedle x\n')]);
      await expect(NG.search('d', '^needle')).resolves.toMatchObject({
        result: true,
      });

      serve([encoder.encode('other\nxx Needle\n')]);
      await expect(NG.search('e', 'Needle$')).resolves.toMatchObject({
        result: true,
      });
    });

    it('BACKLOG 3f: one NUL byte discards the whole searched block, match included', async () => {
      // `BinaryDetection::quit(b'\x00')` abandons what it was given on the first
      // NUL, so the match is dropped even when it precedes the NUL.
      //
      // STILL OPEN, but the blast radius changed shape: the engine now gets a
      // chunk's block of COMPLETE LINES, so a NUL's reach depends on where the
      // last `\n` falls. Case (c) needed a terminator added, or the NUL lands in
      // the held-back partial line and never shares a block with the match.
      const NG = new Netgrep({ enableMemoryCache: false });

      serve([bytes('needle here')]);
      await expect(NG.search('a', 'needle')).resolves.toMatchObject({
        result: true,
      });

      serve([bytes('needle here', 0x00, 'tail')]);
      await expect(NG.search('b', 'needle')).resolves.toMatchObject({
        result: false,
      });

      serve([bytes('needle here\n', 0x00, 'tail\n')]);
      await expect(NG.search('c', 'needle')).resolves.toMatchObject({
        result: false,
      });

      // The incidental narrowing, pinned so it is not mistaken for the fix: case
      // (c) minus the final terminator, so the NUL sits in the trailing partial
      // line and gets its own block. The match survives — because of where the
      // newline is, which nobody should rely on. 3f is fixed in `lib.rs` or not
      // at all.
      serve([bytes('needle here\n', 0x00, 'tail')]);
      await expect(NG.search('d', 'needle')).resolves.toMatchObject({
        result: true,
      });
    });
  });
});
