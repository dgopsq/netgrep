import { search } from 'core';
import { BatchNetgrepResult } from './data/BatchNetgrepResult';
import { NetgrepConfig } from './data/NetgrepConfig';
import { NetgrepResult } from './data/NetgrepResult';
import { NetgrepSearchConfig } from './data/NetgrepSearchConfig';

/**
 *
 */
const defaultConfig: NetgrepConfig = {
  enableMemoryCache: true,
};

/**
 *
 */
export class Netgrep {
  private readonly config: NetgrepConfig;
  private readonly memoryCache: Record<string, Uint8Array> = {};

  constructor(config: Partial<NetgrepConfig>) {
    this.config = {
      ...defaultConfig,
      ...config,
    };
  }

  /**
   *
   * @param url
   * @param pattern
   * @param config
   * @returns
   */
  public search(
    url: string,
    pattern: string,
    config?: NetgrepSearchConfig
  ): Promise<NetgrepResult> {
    return new Promise((resolve, reject) => {
      const handleReader = (
        reader: ReadableStreamDefaultReader<Uint8Array>
      ) => {
        return reader.read().then(({ value, done }) => {
          // If the reader is actually done
          // let's quit this job returning `false`.
          if (done) {
            resolve({ url, result: false });
            return;
          }

          // Execute the search in the current chunk of bytes
          // using the underneath WASM core module.
          const u8Array = new Uint8Array(value);
          const result = search(u8Array, pattern);

          // Store the `Uint8Array` in the memory cache
          // if it's enabled.
          if (this.config.enableMemoryCache) {
            this.upsertMemoryCache(url, u8Array);
          }

          if (result) {
            resolve({ url, result: true });
          } else {
            handleReader(reader);
          }
        });
      };

      // Search the content in the memory cache
      // if it's enabled.
      if (this.config.enableMemoryCache && this.memoryCache[url]) {
        const result = search(this.memoryCache[url], pattern);
        resolve({ url, result });
        return;
      }

      fetch(url, { signal: config?.signal })
        .then((res) =>
          !res.body
            ? Promise.reject("The response doesn't contain a body")
            : Promise.resolve(res.body.getReader())
        )
        .then(handleReader)
        .catch(reject);
    });
  }

  /**
   *
   * @param urls
   * @param pattern
   * @param config
   */
  public searchBatch(
    urls: Array<string>,
    pattern: string,
    config?: NetgrepSearchConfig
  ): Promise<Array<BatchNetgrepResult>> {
    return Promise.all(
      urls.map((url) =>
        this.search(url, pattern, config)
          .then((res) => ({ ...res, error: null }))
          .catch((err) => ({
            url,
            result: false,
            error: this.serializeError(err),
          }))
      )
    );
  }

  /**
   *
   * @param urls
   * @param pattern
   * @param cb
   * @param config
   */
  public searchBatchWithCallback(
    urls: Array<string>,
    pattern: string,
    cb: (result: BatchNetgrepResult) => void,
    config?: NetgrepSearchConfig
  ): void {
    urls.forEach((url) =>
      this.search(url, pattern, config)
        .then((res) => cb({ ...res, error: null }))
        .catch((err) =>
          cb({
            url,
            result: false,
            error: this.serializeError(err),
          })
        )
    );
  }

  /**
   *
   * @param err
   * @returns
   */
  private serializeError(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    } else {
      return JSON.stringify(err);
    }
  }

  /**
   *
   * @param url
   * @param bytes
   */
  private upsertMemoryCache(url: string, bytes: Uint8Array) {
    const currentBlockLength = this.memoryCache[url]?.length || 0;

    const joinedArray = new Uint8Array(currentBlockLength + bytes.length);

    if (this.memoryCache[url]) joinedArray.set(this.memoryCache[url]);

    joinedArray.set(bytes, currentBlockLength);

    this.memoryCache[url] = joinedArray;
  }
}
