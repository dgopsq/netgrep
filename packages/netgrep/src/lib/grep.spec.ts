import { ReadableStream } from 'node:stream/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrepOptions } from './data/GrepOptions.js';
import type { NetgrepHit } from './data/NetgrepHit.js';
import { grep } from './grep.js';

const encoder = new TextEncoder();

// `vi.hoisted` is required, not stylistic: `vi.mock` is lifted above the module
// body, and its factory runs while `./grep.js` is being imported.
const { mockSearchBlock, mockSearchBytes } = vi.hoisted(() => ({
  mockSearchBlock: vi.fn(),
  mockSearchBytes: vi.fn(),
}));

vi.mock('@netgrep/search', () => ({
  default: () => Promise.resolve(),
  search_block: (...args: Array<unknown>) => mockSearchBlock(...args),
  search_bytes: (...args: Array<unknown>) => mockSearchBytes(...args),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

/** What the real `search_block` hands back: a carrier owning WASM memory. */
function blockHits(text: string, table: Array<number>) {
  return { text, table: new Uint32Array(table), free: vi.fn() };
}

function serve(chunks: Array<string>) {
  let index = 0;

  mockFetch.mockImplementation(() =>
    Promise.resolve({
      body: new ReadableStream({
        pull(controller) {
          if (index >= chunks.length) {
            controller.close();
            return;
          }

          controller.enqueue(encoder.encode(chunks[index]));
          index += 1;
        },
      }),
    }),
  );
}

async function collect(url: string, pattern: string, options?: GrepOptions) {
  const out: Array<NetgrepHit> = [];

  for await (const hit of grep(url, pattern, options)) {
    out.push(hit);
  }

  return out;
}

describe('grep', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockSearchBlock.mockReset();
    mockSearchBytes.mockReset();
  });

  it('yields the hits of a single block', async () => {
    serve(['a\nb\n']);
    mockSearchBlock.mockReturnValue(blockHits('a', [1, 2, 1, 1, 0, 1]));

    expect(await collect('/f', 'a')).toEqual([
      { line: 'a', ranges: [{ start: 0, end: 1 }], lineNumber: 1 },
    ]);
  });

  it('makes line numbers file-absolute by carrying a base across blocks', async () => {
    serve(['one\ntwo\n', 'three\nfour\n']);
    mockSearchBlock
      .mockReturnValueOnce(blockHits('two', [1, 2, 2, 1, 0, 3]))
      .mockReturnValueOnce(blockHits('four', [1, 2, 2, 1, 0, 4]));

    const hits = await collect('/f', 'o');

    expect(hits.map((hit) => hit.lineNumber)).toEqual([2, 4]);
  });

  it('advances the base by the lines a block held, not by its hits', async () => {
    // A block of a thousand lines with one hit still moves the base by a
    // thousand. Counting hits instead is the bug this pins.
    serve(['x\n', 'y\n']);
    mockSearchBlock
      .mockReturnValueOnce(blockHits('', [0, 1000]))
      .mockReturnValueOnce(blockHits('y', [1, 1, 1, 1, 0, 1]));

    const hits = await collect('/f', 'y');

    expect(hits.map((hit) => hit.lineNumber)).toEqual([1001]);
  });

  it('frees the carrier for every block, hit or no hit', async () => {
    serve(['a\n', 'b\n']);
    const first = blockHits('', [0, 1]);
    const second = blockHits('b', [1, 1, 1, 1, 0, 1]);
    mockSearchBlock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    await collect('/f', 'b');

    expect(first.free).toHaveBeenCalledTimes(1);
    expect(second.free).toHaveBeenCalledTimes(1);
  });

  it('compiles the pattern BEFORE opening the connection', async () => {
    mockSearchBytes.mockImplementation(() => {
      throw new Error('regex parse error');
    });

    await expect(collect('/f', '[')).rejects.toThrow('regex parse error');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not run at all until the first next()', async () => {
    // An async generator's body is deferred, so a bad pattern surfaces from
    // the iteration rather than from the call.
    mockSearchBytes.mockImplementation(() => {
      throw new Error('regex parse error');
    });

    const hits = grep('/f', '[');

    expect(mockSearchBytes).not.toHaveBeenCalled();
    await expect(hits.next()).rejects.toThrow('regex parse error');
  });

  it('caps lines at 4096 bytes by default', async () => {
    serve(['a\n']);
    mockSearchBlock.mockReturnValue(blockHits('', [0, 1]));

    await collect('/f', 'a');

    expect(mockSearchBlock).toHaveBeenCalledWith(expect.anything(), 'a', 4096);
  });

  it('passes a caller-supplied cap to the engine', async () => {
    serve(['a\n']);
    mockSearchBlock.mockReturnValue(blockHits('', [0, 1]));

    await collect('/f', 'a', { maxLineBytes: 12 });

    expect(mockSearchBlock).toHaveBeenCalledWith(expect.anything(), 'a', 12);
  });

  it('yields nothing for a file with no match, having read all of it', async () => {
    serve(['a\n', 'b\n']);
    mockSearchBlock.mockReturnValue(blockHits('', [0, 1]));

    expect(await collect('/f', 'zzz')).toEqual([]);
    expect(mockSearchBlock).toHaveBeenCalledTimes(2);
  });

  it('stops searching when the consumer breaks out', async () => {
    serve(['a\n', 'a\n', 'a\n']);
    mockSearchBlock.mockReturnValue(blockHits('a', [1, 1, 1, 1, 0, 1]));

    for await (const _hit of grep('/f', 'a')) {
      break;
    }

    expect(mockSearchBlock).toHaveBeenCalledTimes(1);
  });
});
