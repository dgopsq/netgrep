import { ReadableStream } from 'node:stream/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchNetgrepResult } from './data/BatchNetgrepResult.js';
import { Netgrep } from './Netgrep.js';

/**
 * Helper function to generate a `ReadableStream`
 * from an input string.
 */
export function genReadableStreamFromString(str: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(str);
      controller.close();
    },
  });
}

// `vi.hoisted` is required, not stylistic: `vi.mock` is lifted above the module
// body, and its factory runs while `./Netgrep.js` is being imported — before a
// plain `const` here would have been initialised.
const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

const mockFetch = vi.fn();

// Mocking the `search_bytes` function. `default` stands in for the WASM
// module's `init()`, which Netgrep awaits before every search.
vi.mock('@netgrep/search', () => {
  return {
    default: () => Promise.resolve(),
    search_bytes: () => mockSearch(),
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
  });

  describe('Netgrep::searchBatch', () => {
    const NG = new Netgrep({ enableMemoryCache: false });
    const NGWithCache = new Netgrep({ enableMemoryCache: true });

    const urls = [{ url: 'url1' }, { url: 'url2' }, { url: 'url3' }];

    const pattern = 'pattern';

    beforeEach(() => {
      mockFetch.mockClear();

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
  });
});
