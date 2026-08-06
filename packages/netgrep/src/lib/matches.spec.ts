import { ReadableStream } from 'node:stream/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { matches } from './matches.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// `vi.hoisted` is required, not stylistic: `vi.mock` is lifted above the module
// body, and its factory runs while `./matches.js` is being imported.
const { mockSearchBytes } = vi.hoisted(() => ({ mockSearchBytes: vi.fn() }));

vi.mock('@netgrep/search', () => ({
  default: () => Promise.resolve(),
  search_bytes: (...args: Array<unknown>) => mockSearchBytes(...args),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Serve the given chunks, counting reads and the consumer's `cancel()` calls.
 *
 * Counted at the consumer boundary rather than on the stream's own `cancel`
 * callback: a stream that has already closed swallows `cancel()` without
 * telling its source, so a source-side assertion cannot see a call that should
 * not have happened.
 */
function serve(chunks: Array<string>) {
  const state = { reads: 0, cancelCalls: 0 };

  mockFetch.mockImplementation(() => {
    let index = 0;

    const stream = new ReadableStream({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
      },
    });

    return Promise.resolve({
      body: {
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
      },
    });
  });

  return state;
}

/**
 * A stand-in engine that matches literal substrings.
 *
 * Chosen over `mockReturnValueOnce` chains so no test has to count the
 * pre-flight compile against an empty slice — it contains nothing, so it
 * answers false on its own.
 */
function literalEngine() {
  mockSearchBytes.mockImplementation((chunk: Uint8Array, pattern: string) =>
    decoder.decode(chunk).includes(pattern),
  );
}

describe('matches', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockSearchBytes.mockReset();
  });

  it('answers true at the first matching block, without reading the rest', async () => {
    const state = serve(['no\n', 'yes\n', 'no\n']);
    literalEngine();

    expect(await matches('/f', 'yes')).toBe(true);
    expect(state.reads).toBe(2);
  });

  it('answers false having read the whole file', async () => {
    const state = serve(['a\n', 'b\n', 'c\n']);
    literalEngine();

    expect(await matches('/f', 'zzz')).toBe(false);

    // Three chunks plus the read that reports `done`. Proving an absence costs
    // the whole file; there is no shortcut for it.
    expect(state.reads).toBe(4);
  });

  it('cancels the transfer on the first hit', async () => {
    const state = serve(['yes\n', 'more\n', 'more\n']);
    literalEngine();

    await matches('/f', 'yes');

    expect(state.cancelCalls).toBe(1);
  });

  it('compiles the pattern BEFORE opening the connection', async () => {
    mockSearchBytes.mockImplementation(() => {
      throw new Error('regex parse error');
    });

    await expect(matches('/f', '[')).rejects.toThrow('regex parse error');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never hands the engine an incomplete line', async () => {
    serve(['al', 'pha\n']);
    literalEngine();

    await matches('/f', 'zzz');

    const seen = mockSearchBytes.mock.calls.map(([chunk]) =>
      decoder.decode(chunk as Uint8Array),
    );

    // The empty pre-flight slice, then the joined line — never the fragment
    // that arrived on its own.
    expect(seen).toEqual(['', 'alpha\n']);
  });

  it('rejects when the response carries no body', async () => {
    literalEngine();
    mockFetch.mockImplementation(() => Promise.resolve({ body: null }));

    await expect(matches('/f', 'a')).rejects.toThrow("doesn't contain a body");
  });

  it('rejects when the fetch itself fails', async () => {
    literalEngine();
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));

    await expect(matches('/f', 'a')).rejects.toThrow('offline');
  });

  it('answers false for a body that closes without emitting', async () => {
    serve([]);
    literalEngine();

    expect(await matches('/f', 'a')).toBe(false);
  });

  it('hands the caller request options to fetch, unchanged', async () => {
    serve(['a\n']);
    literalEngine();

    const init: RequestInit = { headers: { Authorization: 'Bearer t' } };

    await matches('/f', 'zzz', { fetch: init });

    expect(mockFetch).toHaveBeenCalledWith('/f', init);
  });

  it('reports cumulative bytes read after each chunk', async () => {
    serve(['abc\n', 'de\n']);
    literalEngine();

    const seen: Array<number> = [];

    await matches('/f', 'zzz', { onProgress: (bytes) => seen.push(bytes) });

    expect(seen).toEqual([4, 7]);
  });
});
