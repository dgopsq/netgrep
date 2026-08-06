import { ReadableStream } from 'node:stream/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamBlocks } from './streamBlocks.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const mockFetch = vi.fn();
global.fetch = mockFetch;

/** Split a string into fixed-size byte chunks, the way a response arrives. */
function chunked(str: string, size: number): Array<Uint8Array> {
  const bytes = encoder.encode(str);
  const out: Array<Uint8Array> = [];

  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.slice(i, i + size));
  }

  return out;
}

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
 * Serve the given chunks, counting reads and the consumer's `cancel()` calls.
 *
 * Counted at the consumer boundary rather than on the stream's own `cancel`
 * callback: a stream that has already closed swallows `cancel()` without
 * telling its source, so a source-side assertion cannot see a call that should
 * not have happened.
 */
function serve(chunks: Array<Uint8Array>) {
  const state = { reads: 0, cancelCalls: 0 };

  mockFetch.mockImplementation(() => {
    const stream = streamOfChunks(chunks);

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

/** Collect every block a stream yields, as text. */
async function collect(url: string): Promise<Array<string>> {
  const out: Array<string> = [];

  for await (const block of streamBlocks(url)) {
    out.push(decoder.decode(block));
  }

  return out;
}

describe('streamBlocks', () => {
  // A block body, not a concise one: `mockReset` returns the mock, which is a
  // function, and a hook that returns a function has returned a teardown —
  // Vitest would call `mockFetch()` after every test.
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('yields whole lines and holds the incomplete one back', async () => {
    serve(chunked('alpha\nbeta\ngam', 32));

    expect(await collect('/f')).toEqual(['alpha\nbeta\n', 'gam']);
  });

  it('joins a line split across two chunks before yielding it', async () => {
    serve([encoder.encode('al'), encoder.encode('pha\n')]);

    expect(await collect('/f')).toEqual(['alpha\n']);
  });

  it('yields the final line even when nothing terminates it', async () => {
    serve([encoder.encode('one\ntwo')]);

    expect(await collect('/f')).toEqual(['one\n', 'two']);
  });

  it('yields nothing at all for an empty body', async () => {
    serve([]);

    expect(await collect('/f')).toEqual([]);
  });

  it('yields no empty block for a chunk that completes no line', async () => {
    serve([encoder.encode('abc'), encoder.encode('def\n')]);

    expect(await collect('/f')).toEqual(['abcdef\n']);
  });

  it('keeps reading past a zero-length chunk', async () => {
    serve([encoder.encode(''), encoder.encode('found\n')]);

    expect(await collect('/f')).toEqual(['found\n']);
  });

  it('throws when the response carries no body', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({ body: null }));

    await expect(collect('/f')).rejects.toThrow("doesn't contain a body");
  });

  it('reports cumulative bytes read after each chunk', async () => {
    serve([encoder.encode('abc\n'), encoder.encode('de\n')]);

    const seen: Array<number> = [];

    for await (const _block of streamBlocks('/f', {
      onProgress: (bytes) => seen.push(bytes),
    })) {
      // Draining is the point; the blocks themselves are asserted elsewhere.
    }

    expect(seen).toEqual([4, 7]);
  });

  it('cancels the reader when the consumer breaks out early', async () => {
    const state = serve(chunked('a\nb\nc\nd\ne\n', 2));

    for await (const _block of streamBlocks('/f')) {
      break;
    }

    expect(state.cancelCalls).toBe(1);
    expect(state.reads).toBe(1);
  });

  it('cancels the reader when the consumer throws', async () => {
    const state = serve(chunked('a\nb\nc\n', 2));

    await expect(
      (async () => {
        for await (const _block of streamBlocks('/f')) {
          throw new Error('boom');
        }
      })(),
    ).rejects.toThrow('boom');

    expect(state.cancelCalls).toBe(1);
  });

  it('stops reading the moment the consumer stops asking', async () => {
    // The generator suspends at `yield` and does not resume until the consumer
    // asks again, which is what pushes backpressure onto the socket. A
    // read-ahead would break it silently, and this is the assertion that
    // notices.
    const state = serve(chunked('a\nb\nc\nd\ne\nf\n', 2));

    const blocks = streamBlocks('/f');

    await blocks.next();
    const readsAfterFirst = state.reads;
    await blocks.next();

    expect(readsAfterFirst).toBe(1);
    expect(state.reads).toBe(2);

    await blocks.return(undefined);
  });
});
