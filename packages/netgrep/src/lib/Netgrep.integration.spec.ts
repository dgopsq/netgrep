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

    it('stops reading as soon as a chunk matches', async () => {
      // 'One Wiseman' is inside the first 16 bytes, so exactly one read.
      const chunks = chunked(POEM, 16);
      const state = serve(chunks);

      await new Netgrep({ enableMemoryCache: false }).search('url', 'Wiseman');

      expect(state.reads).toBe(1);
      expect(chunks.length).toBeGreaterThan(1);
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
      mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
        init?.signal?.aborted
          ? Promise.reject(new DOMException('Aborted', 'AbortError'))
          : Promise.resolve({ body: streamOfChunks([encoder.encode(POEM)]) }),
      );

      const controller = new AbortController();
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
      mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
        init?.signal?.aborted
          ? Promise.reject(new DOMException('Aborted', 'AbortError'))
          : Promise.resolve({ body: streamOfChunks([encoder.encode(POEM)]) }),
      );

      const controller = new AbortController();
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
   */
  describe('documented defects (asserting current, incorrect behaviour)', () => {
    it('BACKLOG 3a: misses a pattern straddling a chunk boundary', async () => {
      const text = 'hello wonderful world';

      // Control: the same bytes in one chunk match.
      serve([encoder.encode(text)]);
      await expect(
        new Netgrep({ enableMemoryCache: false }).search('url', 'wonderful'),
      ).resolves.toMatchObject({ result: true });

      // Split mid-word, and the match vanishes. Chunks are searched in
      // isolation with no tail retained.
      serve([encoder.encode('hello won'), encoder.encode('derful world')]);
      await expect(
        new Netgrep({ enableMemoryCache: false }).search('url', 'wonderful'),
      ).resolves.toMatchObject({ result: false });
    });

    it('BACKLOG 3a: the same search answers differently once the cache is warm', async () => {
      // The cache reassembles the chunks, so the second search sees one buffer
      // where the first saw fragments — and 3a's false negative disappears.
      // The same url and the same pattern, two different answers, decided by
      // whether anyone asked before.
      //
      // This lives here rather than under `in-memory cache` because the first
      // assertion IS 3a: a fix that retains a tail buffer makes it `true` and
      // turns this red, and §2.1 says that must happen somewhere labelled.
      serve(chunked(POEM, 7));

      const NG = new Netgrep({ enableMemoryCache: true });

      await expect(NG.search('url', 'Jhaampe-town')).resolves.toMatchObject({
        result: false,
      });

      await expect(NG.search('url', 'Jhaampe-town')).resolves.toMatchObject({
        result: true,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('BACKLOG 3b: a cache poisoned by early resolution answers later searches wrongly', async () => {
      // 'needle' matches in chunk 2, so search resolves and stops reading.
      // Only 'alpha needle ' is cached — 'omega' was never downloaded.
      serve([
        encoder.encode('alpha '),
        encoder.encode('needle '),
        encoder.encode('omega'),
      ]);

      const NG = new Netgrep({ enableMemoryCache: true });

      await expect(NG.search('url', 'needle')).resolves.toMatchObject({
        result: true,
      });

      // 'omega' IS in the file. The cached prefix says otherwise, and the
      // cache is consulted before the network, so no re-fetch corrects it.
      await expect(NG.search('url', 'omega')).resolves.toMatchObject({
        result: false,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('BACKLOG 18: concurrent searches of one url double its cache entry', async () => {
      // Nothing tracks a download already in flight, so two searches started
      // before either resolves both fetch, and both append what they read to
      // the same cache entry.
      //
      // The waste is the obvious half. The sharp half is that the entry now
      // holds bytes the file never contained: the two copies are joined with
      // no separator, so the seam forms a line that exists nowhere, and a
      // later search matches it.
      //
      // One chunk, so the assertion does not depend on how the two reads
      // interleave.
      serve([encoder.encode('needle')]);

      const NG = new Netgrep({ enableMemoryCache: true });

      await Promise.all([NG.search('url', 'zzz'), NG.search('url', 'zzz')]);

      // No in-flight de-duplication.
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // The file is 'needle'. The cache says 'needleneedle'.
      await expect(NG.search('url', '^needleneedle$')).resolves.toMatchObject({
        result: true,
      });
    });

    it('BACKLOG 3c: an invalid pattern traps the WASM instance', async () => {
      serve([encoder.encode(POEM)]);

      // `.build(pattern).unwrap()` in lib.rs panics on a malformed regex,
      // which surfaces as a wasm trap rather than a catchable domain error.
      await expect(
        new Netgrep({ enableMemoryCache: false }).search('url', '('),
      ).rejects.toThrow('unreachable');
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

    it('BACKLOG 3f: one NUL byte discards the entire chunk, match included', async () => {
      // `BinaryDetection::quit(b'\x00')` abandons the chunk on the first NUL.
      // Not "stops at the NUL" — the match is dropped even when it occurs
      // BEFORE the NUL, and even on an earlier line.
      const NG = new Netgrep({ enableMemoryCache: false });

      serve([bytes('needle here')]);
      await expect(NG.search('a', 'needle')).resolves.toMatchObject({
        result: true,
      });

      serve([bytes('needle here', 0x00, 'tail')]);
      await expect(NG.search('b', 'needle')).resolves.toMatchObject({
        result: false,
      });

      serve([bytes('needle here\n', 0x00, 'tail')]);
      await expect(NG.search('c', 'needle')).resolves.toMatchObject({
        result: false,
      });
    });
  });
});
