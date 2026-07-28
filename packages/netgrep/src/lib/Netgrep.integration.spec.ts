import { ReadableStream } from 'node:stream/web';
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
 * It is the behavioural baseline for the modernization sequence described in
 * `docs/plans/MODERNIZATION.md`. The next two PRs replace the entire JS
 * toolchain and then jump `wasm-bindgen` 44 minor versions while removing the
 * ripgrep fork. The claim those PRs need to support is "behaviour is
 * identical", and nothing in this repository could previously substantiate it.
 *
 * So: these assertions describe what netgrep ACTUALLY DOES TODAY, which is not
 * always what it should do. The `documented defects` block at the bottom pins
 * known-wrong behaviour on purpose. See the comment there before "fixing" it.
 *
 * WHY pkg-node AND NOT pkg
 * ------------------------
 * The published `pkg/` is built with wasm-pack's *bundler* target, whose
 * `import * as wasm from './index_bg.wasm'` no bundler-less Node can resolve.
 * `pkg-node/` is the same Rust, same release profile, same `.wasm` binary,
 * compiled with `--target nodejs` so the test can load it. The generated
 * marshalling glue is identical; only the module-loading preamble differs.
 *
 * Build it with:
 *   cd packages/search && wasm-pack build --target nodejs \
 *     --out-dir pkg-node --out-name index --release
 */
vi.mock('@netgrep/search', async () => {
  const { existsSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const here = dirname(fileURLToPath(import.meta.url));
  const pkgNode = resolve(here, '../../../search/pkg-node/index.js');

  if (!existsSync(pkgNode)) {
    throw new Error(
      [
        '',
        'The Node-target WASM build is missing, so the integration tests cannot',
        'run against the real engine.',
        '',
        'Build it with:',
        '  cd packages/search && wasm-pack build --target nodejs \\',
        '    --out-dir pkg-node --out-name index --release',
        '',
        `Expected at: ${pkgNode}`,
        '',
      ].join('\n'),
    );
  }

  // The nodejs-target build is CommonJS, so it needs `require` rather than a
  // dynamic import to expose its named exports directly.
  return createRequire(import.meta.url)(pkgNode);
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
global.fetch = mockFetch;

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
  });

  /**
   * ---------------------------------------------------------------------
   * DOCUMENTED DEFECTS — these assertions pin behaviour that is WRONG.
   * ---------------------------------------------------------------------
   *
   * Read this before changing anything below.
   *
   * The modernization is explicitly toolchain-only (`MODERNIZATION.md`
   * decision 6), so these bugs are carried across unchanged and on purpose.
   * Their job here is to detect *unintended* change during a large dependency
   * jump — a test asserting the correct-but-not-yet-implemented behaviour
   * would fail today and tell us nothing.
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

    it('UNDOCUMENTED: one NUL byte discards the entire chunk, match included', async () => {
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
