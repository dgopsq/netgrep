import { Netgrep } from './Netgrep';
import { ReadableStream } from 'node:stream/web';
import { BatchNetgrepResult } from './data/BatchNetgrepResult';

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

const mockSearch = jest.fn();
const mockFetch = jest.fn();

// Moking `search` function.
jest.mock('@netgrep/search', () => {
  return { search_bytes: () => mockSearch() };
});

// Mocking `fetch` function.
global.fetch = mockFetch;

describe('Netgrep', () => {
  describe('Netgrep::search', () => {
    const NG = new Netgrep({ enableMemoryCache: false });
    const NGWithCache = new Netgrep({ enableMemoryCache: true });

    const url = 'url';
    const pattern = 'pattern';

    const okResult = { count: 1, lines: ['this is a pattern test'] };
    const failResult = { count: 0, lines: [] };

    beforeEach(() => {
      mockFetch.mockClear();

      mockFetch.mockImplementation(() =>
        Promise.resolve({ body: genReadableStreamFromString('test') })
      );
    });

    it('should work for a positive search result', async () => {
      mockSearch.mockReturnValue(okResult);

      const result = await NG.search(url, pattern);

      expect(result).toMatchObject({
        url,
        result: okResult,
      });
    });

    it('should work for a negative search result', async () => {
      mockSearch.mockReturnValue(failResult);

      const result = await NG.search(url, pattern);

      expect(result).toMatchObject({ url, result: failResult });
    });

    it('should work with the in-memory cache active', async () => {
      mockSearch.mockReturnValue(okResult);

      const result = await NGWithCache.search(url, pattern);

      expect(mockFetch).toBeCalledTimes(1);
      expect(result).toMatchObject({ url, result: okResult });

      const result2 = await NGWithCache.search(url, pattern);

      expect(mockFetch).toBeCalledTimes(1);
      expect(result2).toMatchObject({ url, result: okResult });
    });
  });

  describe('Netgrep::searchBatch', () => {
    const NG = new Netgrep({ enableMemoryCache: false });
    const NGWithCache = new Netgrep({ enableMemoryCache: true });

    const urls = ['url1', 'url2', 'url3'];
    const pattern = 'pattern';

    const okResult = { count: 1, lines: ['this is a pattern test'] };
    const failResult = { count: 0, lines: [] };

    beforeEach(() => {
      mockFetch.mockClear();

      mockFetch.mockImplementation(() =>
        Promise.resolve({ body: genReadableStreamFromString('test') })
      );
    });

    it('should work for a positive search result', async () => {
      mockSearch.mockReturnValue(okResult);

      const results = await NG.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map((url) => ({
        url,
        result: okResult,
        error: null,
      }));

      expect(results).toMatchObject(expectedResults);
    });

    it('should work for a negative search result', async () => {
      mockSearch.mockReturnValue(failResult);

      const results = await NG.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map((url) => ({
        url,
        result: failResult,
        error: null,
      }));

      expect(results).toMatchObject(expectedResults);
    });

    it('should handle errors in the fetch requests', async () => {
      const errorMessage = 'message';

      mockFetch.mockImplementation(() =>
        Promise.reject(new Error(errorMessage))
      );

      mockSearch.mockReturnValue(failResult);

      const results = await NG.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map((url) => ({
        url,
        result: failResult,
        error: errorMessage,
      }));

      expect(results).toMatchObject(expectedResults);
    });

    it('should work with the in-memory cache active', async () => {
      mockSearch.mockReturnValue(okResult);

      const results = await NGWithCache.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map((url) => ({
        url,
        result: okResult,
        error: null,
      }));

      expect(mockFetch).toBeCalledTimes(urls.length);
      expect(results).toMatchObject(expectedResults);

      const results2 = await NGWithCache.searchBatch(urls, pattern);

      expect(mockFetch).toBeCalledTimes(urls.length);
      expect(results2).toMatchObject(expectedResults);
    });
  });
});
