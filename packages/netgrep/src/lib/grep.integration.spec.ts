import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrepOptions } from './data/GrepOptions.js';
import type { NetgrepHit } from './data/NetgrepHit.js';
import { grep } from './grep.js';

/**
 * Integration tests: the REAL WASM engine driven through the REAL streaming
 * loop behind `grep`.
 *
 * The counterpart to `grep.spec.ts`, which mocks `@netgrep/search` and so
 * executes no Rust at all — it can prove the generator's bookkeeping but not
 * that a line number, a UTF-16 range or a truncated line is right. Only
 * `fetch` is faked here, and only to remove the network: the bytes still
 * travel through a real `ReadableStream`, are still chunked, and are still
 * matched by the compiled `search_block`.
 *
 * It runs in a real headless Chromium, so `pkg/` is instantiated by its own
 * fetch-based `init()` — the same module, binary and loader a consumer gets.
 *
 * These assertions describe what `grep` ACTUALLY DOES TODAY, which is not
 * always what it should do. The `documented defects` block at the bottom pins
 * known-wrong behaviour on purpose; read the comment there before "fixing" it.
 *
 * Build the engine with: pnpm build:wasm
 */
vi.mock('@netgrep/search', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@netgrep/search')>();

  // Instantiate through the REAL, fetch-based `init()` — the point of running
  // in a browser. It happens at mock-factory time, which is before this file's
  // body replaces `globalThis.fetch` with a spy; any later and the engine's own
  // `.wasm` request would go into the spy.
  await mod.default();

  // Already instantiated, so the library's own `init()` must be a no-op rather
  // than a second instantiation.
  return { ...mod, default: () => Promise.resolve() };
});

const encoder = new TextEncoder();

/**
 * Wrap a stream in a response body that counts the consumer's reads and
 * cancels.
 *
 * Counted here rather than on the stream's own `cancel` callback: once a
 * stream is closed the Streams spec makes `cancel()` a no-op that never
 * reaches the source, so a source-side counter cannot distinguish a call that
 * happened from one that did not.
 */
function countingBody(
  stream: ReadableStream<Uint8Array>,
  state: { reads: number; cancelCalls: number },
) {
  return {
    getReader() {
      const reader = stream.getReader();

      return {
        read() {
          state.reads += 1;
          return reader.read();
        },
        cancel() {
          state.cancelCalls += 1;
          return reader.cancel();
        },
      };
    },
  };
}

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

/** Split a string into fixed-size byte chunks — deterministically. */
function chunked(str: string, size: number): Array<Uint8Array> {
  const bytes = encoder.encode(str);
  const out: Array<Uint8Array> = [];

  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.slice(i, i + size));
  }

  return out;
}

/**
 * The underlying source, so a cancel that actually reaches it is observable
 * separately from one the consumer merely called.
 */
function streamSource(
  chunks: Array<Uint8Array>,
  state: { sourceCancels: number },
) {
  let index = 0;

  return {
    pull(controller: ReadableStreamDefaultController<Uint8Array>) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }

      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel() {
      state.sourceCancels += 1;
    },
  };
}

function serve(chunks: Array<Uint8Array>) {
  const state = { reads: 0, cancelCalls: 0, sourceCancels: 0 };

  // A fresh stream per call — a `ReadableStream` can only be consumed once,
  // and reusing one throws "ReadableStream is locked". The counters are shared.
  mockFetch.mockImplementation(() =>
    Promise.resolve({
      body: countingBody(
        new ReadableStream(streamSource(chunks, state)),
        state,
      ),
    }),
  );

  return state;
}

async function collect(url: string, pattern: string, options?: GrepOptions) {
  const out: Array<NetgrepHit> = [];

  for await (const hit of grep(url, pattern, options)) {
    out.push(hit);
  }

  return out;
}

const POEM =
  'One Wiseman came to Jhaampe-town.\n' +
  'He set aside both Queen and Crown\n' +
  'Did his task and fell asleep\n' +
  'Gave his bones to the stones to keep.\n';

describe('grep integration (real WASM)', () => {
  // A block body, not a concise one: `mockReset` returns the mock, which is a
  // function, and a hook that returns a function has returned a teardown —
  // Vitest would call `mockFetch()` after every test.
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('chunk-size invariance', () => {
    // The property that makes the design defensible: netgrep's answer is a
    // function of the file, not of where the network happened to split it.
    // One test covers the tail split, the running line base and the encoding
    // walk at once, because every bug this design can introduce is a bug that
    // makes output depend on chunking.
    const sizes = [1, 7, 64, 1024, 65536];

    it('yields identical hits at every chunk size', async () => {
      const runs = [];

      for (const size of sizes) {
        serve(chunked(POEM, size));
        runs.push(await collect('/f', 'his'));
      }

      for (const run of runs) {
        expect(run).toEqual(runs[0]);
      }

      // A guard against the whole suite passing on an empty result.
      expect(runs[0].length).toBeGreaterThan(0);
    });

    it('is invariant for a pattern matching every line, too', async () => {
      const runs = [];

      for (const size of sizes) {
        serve(chunked(POEM, size));
        runs.push(await collect('/f', 'e'));
      }

      for (const run of runs) {
        expect(run).toEqual(runs[0]);
      }

      expect(runs[0]).toHaveLength(4);
    });

    it('is invariant for a file that does not end in a newline', async () => {
      const unterminated = 'alpha\nbeta\ngamma';
      const runs = [];

      for (const size of sizes) {
        serve(chunked(unterminated, size));
        runs.push(await collect('/f', 'a'));
      }

      for (const run of runs) {
        expect(run).toEqual(runs[0]);
      }

      expect(runs[0].map((hit) => hit.lineNumber)).toEqual([1, 2, 3]);
    });
  });

  describe('line numbers', () => {
    it('numbers lines from 1, against the file', async () => {
      serve(chunked(POEM, 4096));

      const hits = await collect('/f', 'his');

      expect(hits.map((hit) => hit.lineNumber)).toEqual([3, 4]);
    });

    it('keeps numbering across a chunk boundary', async () => {
      serve(chunked(POEM, 20));

      const hits = await collect('/f', 'his');

      expect(hits.map((hit) => hit.lineNumber)).toEqual([3, 4]);
    });

    it('numbers a final line that nothing terminates', async () => {
      serve([encoder.encode('one\ntwo\nthree')]);

      const hits = await collect('/f', 'three');

      expect(hits.map((hit) => hit.lineNumber)).toEqual([3]);
    });

    it('counts non-matching lines too', async () => {
      serve([encoder.encode('a\nb\nc\nd\nTARGET\n')]);

      const hits = await collect('/f', 'TARGET');

      expect(hits[0].lineNumber).toBe(5);
    });
  });

  describe('lines and ranges', () => {
    it('yields the whole line, not the matched fragment', async () => {
      serve(chunked(POEM, 4096));

      const hits = await collect('/f', 'Wiseman');

      expect(hits[0].line).toBe('One Wiseman came to Jhaampe-town.');
    });

    it('yields ranges that slice the line back to the match', async () => {
      serve(chunked(POEM, 4096));

      const hits = await collect('/f', 'Wiseman');
      const { line, ranges } = hits[0];

      expect(ranges).toHaveLength(1);
      expect(line.slice(ranges[0].start, ranges[0].end)).toBe('Wiseman');
    });

    it('yields every match within one line', async () => {
      serve([encoder.encode('to the to the to\n')]);

      const hits = await collect('/f', 'to');

      expect(hits).toHaveLength(1);
      expect(hits[0].ranges).toHaveLength(3);
      expect(
        hits[0].ranges.map((range) =>
          hits[0].line.slice(range.start, range.end),
        ),
      ).toEqual(['to', 'to', 'to']);
    });

    it('treats an EMPTY matching line as a hit, not as a miss', async () => {
      // A pattern matching an empty line yields an empty string, which is
      // falsy — the trap the old boolean-plus-line API documented at length.
      serve([encoder.encode('a\n\nb\n')]);

      const hits = await collect('/f', '^$');

      expect(hits).toHaveLength(1);
      expect(hits[0].line).toBe('');
      expect(hits[0].lineNumber).toBe(2);
    });

    it('carries a multi-byte character across a chunk boundary intact', async () => {
      serve(chunked('før\nnaïve café\n', 3));

      const hits = await collect('/f', 'café');

      expect(hits[0].line).toBe('naïve café');
    });

    it('gives UTF-16 offsets, not byte offsets', async () => {
      serve([encoder.encode('naïve café\n')]);

      const hits = await collect('/f', 'café');
      const { line, ranges } = hits[0];

      expect(line.slice(ranges[0].start, ranges[0].end)).toBe('café');
    });

    it('applies smart case: a lowercase pattern is case-insensitive', async () => {
      serve([encoder.encode('Wiseman\nwiseman\n')]);

      expect(await collect('/f', 'wiseman')).toHaveLength(2);
    });

    it('applies smart case: an uppercased pattern is case-sensitive', async () => {
      serve([encoder.encode('Wiseman\nwiseman\n')]);

      const hits = await collect('/f', 'Wiseman');

      expect(hits).toHaveLength(1);
      expect(hits[0].lineNumber).toBe(1);
    });

    it('supports regex syntax, not just literals', async () => {
      serve(chunked(POEM, 4096));

      const hits = await collect('/f', '^Did.*asleep$');

      expect(hits.map((hit) => hit.lineNumber)).toEqual([3]);
    });
  });

  describe('the cap', () => {
    it('truncates the line on a character boundary', async () => {
      serve([encoder.encode('ααααααααα match\n')]);

      const hits = await collect('/f', 'match', { maxLineBytes: 7 });

      // Three two-byte characters fit in seven bytes; the fourth does not.
      expect(hits[0].line).toBe('ααα');
    });

    it('keeps the hit when the match itself is past the cut', async () => {
      serve([encoder.encode('abcdefghij match\n')]);

      const hits = await collect('/f', 'match', { maxLineBytes: 4 });

      expect(hits).toHaveLength(1);
      expect(hits[0].line).toBe('abcd');
    });
  });

  describe('errors and stream shapes', () => {
    it('throws on an invalid pattern before any request is made', async () => {
      await expect(collect('/f', '[')).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when the response carries no body', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({ body: null }));

      await expect(collect('/f', 'a')).rejects.toThrow(
        "doesn't contain a body",
      );
    });

    it('rejects from the iteration when the fetch itself fails', async () => {
      mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));

      await expect(collect('/f', 'a')).rejects.toThrow('offline');
    });

    it('yields nothing for a body that closes without emitting', async () => {
      serve([]);

      expect(await collect('/f', 'a')).toEqual([]);
    });

    it('keeps reading past a zero-length chunk', async () => {
      serve([new Uint8Array(0), encoder.encode('found\n')]);

      expect(await collect('/f', 'found')).toHaveLength(1);
    });

    it('does not let a chunk boundary fake a line boundary for ^', async () => {
      // `^` must not match at the start of a chunk that begins mid-line.
      serve(chunked('xxxTARGET\n', 3));

      expect(await collect('/f', '^TARGET')).toEqual([]);
    });

    it('finds a match straddling a chunk boundary', async () => {
      serve(chunked('xxTARGETxx\n', 4));

      const hits = await collect('/f', 'TARGET');

      expect(hits).toHaveLength(1);
      expect(hits[0].line).toBe('xxTARGETxx');
    });
  });

  describe('progress', () => {
    it('reports cumulative decompressed bytes after each chunk', async () => {
      serve([encoder.encode('abc\n'), encoder.encode('de\n')]);

      const seen: Array<number> = [];

      await collect('/f', 'zzz', { onProgress: (bytes) => seen.push(bytes) });

      expect(seen).toEqual([4, 7]);
    });
  });

  describe('cancellation', () => {
    it('cancels the transfer when the consumer breaks out early', async () => {
      const state = serve(chunked('hit\nhit\nhit\nhit\nhit\n', 4));

      for await (const _hit of grep('/f', 'hit')) {
        break;
      }

      expect(state.cancelCalls).toBe(1);
      expect(state.sourceCancels).toBe(1);
    });

    it('cancels the transfer when the consumer throws', async () => {
      const state = serve(chunked('hit\nhit\nhit\n', 4));

      await expect(
        (async () => {
          for await (const _hit of grep('/f', 'hit')) {
            throw new Error('boom');
          }
        })(),
      ).rejects.toThrow('boom');

      expect(state.sourceCancels).toBe(1);
    });

    it('stops reading the file once the consumer stops', async () => {
      const state = serve(chunked('hit\n'.repeat(20), 4));

      for await (const _hit of grep('/f', 'hit')) {
        break;
      }

      expect(state.reads).toBe(1);
    });

    it('cancelling a stream that already ended reaches no source', async () => {
      // The generator's `finally` runs on a natural end too, and this is why
      // that is safe: the Streams spec makes `cancel()` on a closed stream a
      // no-op that never touches the underlying source.
      const state = serve([encoder.encode('nothing here\n')]);

      await collect('/f', 'zzz');

      expect(state.cancelCalls).toBe(1);
      expect(state.sourceCancels).toBe(0);
    });
  });

  describe('documented defects (asserting current, incorrect behaviour)', () => {
    // BACKLOG 3g: past the 64 KB retained-tail ceiling the tail becomes a byte
    // window that is searched with its own block AND again as the head of the
    // next one. Two wrong answers follow, and both are pinned here rather than
    // fixed: suppressing them would lose a hit outright when the stream ends
    // inside such a line, and losing a hit is the worse failure for a grep.

    it('BACKLOG 3g: a hit inside an over-long line is yielded three times', async () => {
      // The match sits far enough in that three consecutive windows still
      // contain it, and each one searches it again. One line of one file, and
      // the line number climbs with every repeat.
      const overLong = `${'x'.repeat(100 * 1024)}TARGET${'y'.repeat(100 * 1024)}\n`;
      serve(chunked(overLong, 32 * 1024));

      const hits = await collect('/f', 'TARGET');

      expect(hits.map((hit) => hit.lineNumber)).toEqual([2, 3, 4]);
    });

    it('BACKLOG 3g: the line number drifts after an over-long line', async () => {
      // 100 KB in 32 KB chunks is the smallest fixture that actually windows:
      // the split only falls back to a byte window once a read leaves MORE
      // than 64 KB with no terminator in it, which takes a fourth chunk.
      const overLong = `${'x'.repeat(100 * 1024)}\nTARGET\n`;
      serve(chunked(overLong, 32 * 1024));

      const hits = await collect('/f', '^TARGET$');

      // The true answer is 2. The windowed block counts its incomplete final
      // line, and the next block counts the same line again — one window
      // slide, one line of drift.
      expect(hits).toHaveLength(1);
      expect(hits[0].lineNumber).toBe(3);
    });
  });
});
