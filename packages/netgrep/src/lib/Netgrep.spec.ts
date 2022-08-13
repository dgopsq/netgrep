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
jest.mock('core', () => {
  return { search: () => mockSearch() };
});

// Mocking `fetch` function.
global.fetch = mockFetch;

describe('Netgrep', () => {
  describe('Netgrep::search', () => {
    const NG = new Netgrep({});

    const url = 'url';
    const pattern = 'pattern';

    beforeAll(() => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({ body: genReadableStreamFromString('test') })
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
  });

  describe('Netgrep::searchBatch', () => {
    const NG = new Netgrep({});

    const urls = ['url1', 'url2', 'url3'];
    const pattern = 'pattern';

    beforeEach(() => {
      mockFetch.mockClear();

      mockFetch.mockImplementation(() =>
        Promise.resolve({ body: genReadableStreamFromString('test') })
      );
    });

    it('should work for a positive search result', async () => {
      mockSearch.mockReturnValue(true);

      const results = await NG.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map((url) => ({
        url,
        result: true,
        error: null,
      }));

      expect(results).toMatchObject(expectedResults);
    });

    it('should work for a negative search result', async () => {
      mockSearch.mockReturnValue(false);

      const results = await NG.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map((url) => ({
        url,
        result: false,
        error: null,
      }));

      expect(results).toMatchObject(expectedResults);
    });

    it('should handle errors in the fetch requests', async () => {
      const errorMessage = 'message';

      mockFetch.mockImplementation(() =>
        Promise.reject(new Error(errorMessage))
      );

      mockSearch.mockReturnValue(false);

      const results = await NG.searchBatch(urls, pattern);

      const expectedResults: Array<BatchNetgrepResult> = urls.map((url) => ({
        url,
        result: false,
        error: errorMessage,
      }));

      expect(results).toMatchObject(expectedResults);
    });
  });
});
