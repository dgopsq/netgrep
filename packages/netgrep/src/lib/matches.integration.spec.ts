import { beforeEach, describe, expect, it, vi } from 'vitest';
import { matches } from './matches.js';

/**
 * Integration tests: the REAL WASM engine driven through the REAL streaming
 * loop behind `matches`.
 *
 * The counterpart to `matches.spec.ts`, which mocks `@netgrep/search` and so
 * executes no Rust at all — it can prove the loop's bookkeeping but not that
 * smart case, an anchor or a multi-byte character across a seam is right. Only
 * `fetch` is faked here, and only to remove the network: the bytes still
 * travel through a real `ReadableStream`, are still chunked, and are still
 * matched by the compiled `search_bytes`.
 *
 * It runs in a real headless Chromium, so `pkg/` is instantiated by its own
 * fetch-based `init()` — the same module, binary and loader a consumer gets.
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

const POEM =
  'One Wiseman came to Jhaampe-town.\n' +
  'He set aside both Queen and Crown\n' +
  'Did his task and fell asleep\n' +
  'Gave his bones to the stones to keep.\n';

describe('matches integration (real WASM)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('chunk-size invariance', () => {
    // netgrep's answer is a function of the file, not of where the network
    // happened to split it. For a boolean that is the whole contract.
    const sizes = [1, 7, 64, 1024, 65536];

    it('answers true at every chunk size', async () => {
      for (const size of sizes) {
        serve(chunked(POEM, size));

        expect(await matches('/f', 'his')).toBe(true);
      }
    });

    it('answers false at every chunk size', async () => {
      for (const size of sizes) {
        serve(chunked(POEM, size));

        expect(await matches('/f', 'zzz')).toBe(false);
      }
    });
  });

  describe('matching', () => {
    it('finds a match straddling a chunk boundary', async () => {
      serve(chunked('xxTARGETxx\n', 4));

      expect(await matches('/f', 'TARGET')).toBe(true);
    });

    it('does not let a chunk boundary fake a line boundary for ^', async () => {
      serve(chunked('xxxTARGET\n', 3));

      expect(await matches('/f', '^TARGET')).toBe(false);
    });

    it('finds a match on a final line that nothing terminates', async () => {
      serve([encoder.encode('one\ntwo\nthree')]);

      expect(await matches('/f', 'three')).toBe(true);
    });

    it('treats an EMPTY matching line as a match', async () => {
      serve([encoder.encode('a\n\nb\n')]);

      expect(await matches('/f', '^$')).toBe(true);
    });

    it('carries a multi-byte character across a chunk boundary intact', async () => {
      serve(chunked('før\nnaïve café\n', 3));

      expect(await matches('/f', 'café')).toBe(true);
    });

    it('applies smart case: a lowercase pattern is case-insensitive', async () => {
      serve([encoder.encode('Wiseman\n')]);

      expect(await matches('/f', 'wiseman')).toBe(true);
    });

    it('applies smart case: an uppercased pattern is case-sensitive', async () => {
      serve([encoder.encode('wiseman\n')]);

      expect(await matches('/f', 'Wiseman')).toBe(false);
    });

    it('supports regex syntax, not just literals', async () => {
      serve(chunked(POEM, 4096));

      expect(await matches('/f', '^Did.*asleep$')).toBe(true);
    });
  });

  describe('errors and stream shapes', () => {
    it('rejects on an invalid pattern before any request is made', async () => {
      await expect(matches('/f', '[')).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects when the response carries no body', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({ body: null }));

      await expect(matches('/f', 'a')).rejects.toThrow(
        "doesn't contain a body",
      );
    });

    it('rejects when the fetch itself fails', async () => {
      mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));

      await expect(matches('/f', 'a')).rejects.toThrow('offline');
    });

    it('answers false for a body that closes without emitting', async () => {
      serve([]);

      expect(await matches('/f', 'a')).toBe(false);
    });

    it('keeps reading past a zero-length chunk', async () => {
      serve([new Uint8Array(0), encoder.encode('found\n')]);

      expect(await matches('/f', 'found')).toBe(true);
    });
  });

  describe('early exit', () => {
    it('stops the transfer at the first hit', async () => {
      const state = serve(chunked('miss\nmiss\nTARGET\nmiss\nmiss\n', 5));

      expect(await matches('/f', 'TARGET')).toBe(true);

      // Six chunks exist; the fourth is the one that completes `TARGET\n`, and
      // nothing after it is asked for.
      expect(state.reads).toBe(4);
      expect(state.cancelCalls).toBe(1);
      expect(state.sourceCancels).toBe(1);
    });

    it('reads the whole file to prove a match is absent', async () => {
      const state = serve(chunked('miss\n'.repeat(5), 5));

      expect(await matches('/f', 'TARGET')).toBe(false);

      // Five chunks plus the read that reports `done`.
      expect(state.reads).toBe(6);
    });

    it('cancelling a stream that already ended reaches no source', async () => {
      // The generator's `finally` runs on a natural end too, and this is why
      // that is safe: the Streams spec makes `cancel()` on a closed stream a
      // no-op that never touches the underlying source.
      const state = serve([encoder.encode('nothing here\n')]);

      await matches('/f', 'zzz');

      expect(state.cancelCalls).toBe(1);
      expect(state.sourceCancels).toBe(0);
    });
  });

  describe('retaining nothing', () => {
    it('fetches once per concurrent search of one url, by design', async () => {
      // The cost of retaining nothing, and the reason this is called by design
      // rather than a defect. This used to be BACKLOG 18: a per-url registry
      // made a second caller wait for the first and answer from the entry it
      // wrote. That entry WAS the handover, and it is gone — so sharing would
      // now mean either keeping every chunk of a file nobody asked to keep, or
      // teeing the response stream and with it the first caller's abort
      // signal. Both callers fetch instead. The answers are correct; the
      // second request is wasted.
      //
      // One chunk, so this does not depend on how the two reads interleave.
      serve([encoder.encode(POEM)]);

      const answers = await Promise.all([
        matches('/f', 'dragon'),
        matches('/f', 'Wiseman'),
      ]);

      expect(answers).toEqual([false, true]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('request options', () => {
    it('hands the caller request options to fetch, unchanged', async () => {
      serve([encoder.encode('a\n')]);

      const init: RequestInit = { credentials: 'include' };

      await matches('/f', 'zzz', { fetch: init });

      expect(mockFetch).toHaveBeenCalledWith('/f', init);
    });
  });

  describe('documented defects (asserting current, incorrect behaviour)', () => {
    // BACKLOG 3g: a line with no terminator in it would buffer an entire
    // response, so past a 64 KB ceiling the bytes carried between chunks stop
    // being the incomplete trailing line and become a plain window on the last
    // 64 KB. That window drops everything before it and starts mid-line, so the
    // boolean can be wrong in BOTH directions. Pinned here rather than fixed:
    // the ceiling is what keeps memory independent of the response size, and
    // both answers below are the same window seen from two sides.

    it('BACKLOG 3g: a match longer than 64 KB across a chunk boundary answers false', async () => {
      const filler = 'x'.repeat(70_000);

      // Control: the same bytes arriving in ONE chunk answer true, because the
      // whole buffer is searched before the window is taken.
      serve([encoder.encode(`nee${filler}dle`)]);
      expect(await matches('/f', 'nee.*dle')).toBe(true);

      // Split, and `nee` left the window before `dle` arrived — so no buffer
      // handed to the engine ever holds both halves.
      serve([
        encoder.encode(`nee${filler}`),
        encoder.encode('dle and then some'),
      ]);
      expect(await matches('/f', 'nee.*dle')).toBe(false);

      // Control: the same boundary with the line under the ceiling, where the
      // carry-over is still the exact trailing line. Pins the bound rather than
      // merely the failure.
      serve([
        encoder.encode(`nee${'x'.repeat(1_000)}`),
        encoder.encode('dle and then some'),
      ]);
      expect(await matches('/f', 'nee.*dle')).toBe(true);
    });

    it('BACKLOG 3g: ^ answers true when no line in the file begins that way', async () => {
      // The false POSITIVE, and the worse of the two: the answer claims a match
      // that is not in the file. The window starts mid-line on an `a`, the
      // engine cannot be told that, so `^` anchors to the window's first byte.

      // Control: the same shape under the ceiling, where the buffer still
      // begins where the line begins. One line, beginning with `b`.
      serve([encoder.encode(`b${'a'.repeat(1_000)}`), encoder.encode('end\n')]);
      expect(await matches('/f', '^a')).toBe(false);

      // Over the ceiling. Still one line beginning with `b`, and still nothing
      // that `^a` should match.
      serve([
        encoder.encode(`b${'a'.repeat(70_000)}`),
        encoder.encode('end\n'),
      ]);
      expect(await matches('/f', '^a')).toBe(true);
    });
  });
});
