import { search_bytes } from '@netgrep/search';
import { BatchNetgrepResult } from './data/BatchNetgrepResult.js';
import { NetgrepConfig } from './data/NetgrepConfig.js';
import { NetgrepInput } from './data/NetgrepInput.js';
import { NetgrepResult } from './data/NetgrepResult.js';
import { NetgrepSearchConfig } from './data/NetgrepSearchConfig.js';

/**
 * The default configuration used by `netgrep`.
 */
const defaultConfig: NetgrepConfig = {
  enableMemoryCache: true,
};

/**
 * The `netgrep` library allows to search remote files
 * for a specific pattern using the `ripgrep` library
 * over HTTP.
 */
export class Netgrep {
  private readonly config: NetgrepConfig;
  private readonly memoryCache: Record<string, Uint8Array> = {};

  constructor(config?: Partial<NetgrepConfig>) {
    this.config = {
      ...defaultConfig,
      ...config,
    };
  }

  /**
   * Search a remote file for a specific pattern.
   * This method uses `ripgrep` under the hood in order to
   * start searching while downloading the file instead of
   * waiting for the whole file to be available offline.
   *
   * @param url
   * The url to the remote file.
   * @param pattern
   * The pattern to search for. This can be anything `ripgrep` can understand.
   * @param metadata
   * An optional object that will be returned back as soon as a match
   * as been found in the file.
   * @param config
   * An optional configuration respecting the `NetgrepSearchConfig` type.
   * @returns
   * A promise resolving to a `NetgrepResult<T>` as soon as a match will
   * be found in the remote file.
   */
  public search<T extends object>(
    url: string,
    pattern: string,
    metadata?: T,
    config?: NetgrepSearchConfig
  ): Promise<NetgrepResult<T>> {
    return new Promise((resolve, reject) => {
      const handleReader = (
        reader: ReadableStreamDefaultReader<Uint8Array>
      ) => {
        return reader.read().then(({ value, done }) => {
          // If the reader is actually done
          // let's quit this job returning `false`.
          if (done) {
            resolve({ url, result: false, metadata });
            return;
          }

          // Execute the search in the current chunk of bytes
          // using the underneath WASM core module.
          const u8Array = new Uint8Array(value);
          const result = search_bytes(u8Array, pattern);

          // Store the `Uint8Array` in the memory cache
          // if it's enabled.
          if (this.config.enableMemoryCache) {
            this.upsertMemoryCache(url, u8Array);
          }

          if (result) {
            resolve({ url, result: true, metadata });
          } else {
            handleReader(reader);
          }
        });
      };

      // Search the content in the memory cache
      // if it's enabled.
      if (this.config.enableMemoryCache && this.memoryCache[url]) {
        const result = search_bytes(this.memoryCache[url], pattern);
        resolve({ url, result, metadata });
        return;
      }

      fetch(url, { signal: config?.signal })
        .then((res) =>
          !res.body
            ? Promise.reject(new Error("The response doesn't contain a body"))
            : Promise.resolve(res.body.getReader())
        )
        .then(handleReader)
        .catch(reject);
    });
  }

  /**
   * Execute the `search` method in batch for multiple
   * files. This method returns a promise waiting for all
   * the executed searches to complete.
   *
   * @param urls
   * An array of `NetgrepInput<T>` containing the urls to the
   * files. `T` is the generic type for the optional metadata to
   * pass for each url.
   * @param pattern
   * The pattern to search for. This can be anything `ripgrep` can understand.
   * @param config
   * An optional configuration respecting the `NetgrepSearchConfig` type.
   * @returns
   * A promise waiting for all the executed searches to complete.
   */
  public searchBatch<T extends object>(
    inputs: Array<NetgrepInput<T>>,
    pattern: string,
    config?: NetgrepSearchConfig
  ): Promise<Array<BatchNetgrepResult<T>>> {
    return Promise.all(
      inputs.map((input) => {
        const { url } = input;

        return this.search(url, pattern, input.metadata, config)
          .then((res) => ({ ...res, error: null }))
          .catch((err) => ({
            url,
            result: false,
            metadata: input.metadata,
            error: this.serializeError(err),
          }));
      })
    );
  }

  /**
   * Execute the `search` method in batch for multiple
   * files. This method takes a callback as an input and
   * executes it everytime a match happens.
   *
   * @param urls
   * An array of `NetgrepInput<T>` containing the urls to the
   * files. `T` is the generic type for the optional metadata to
   * pass for each url.
   * @param pattern
   * The pattern to search for. This can be anything `ripgrep` can understand.
   * @param cb
   * The callback that will be triggered at every match. It takes
   * a `BatchNetgrepResult<T>` as a parameter.
   * @param config
   * An optional configuration respecting the `NetgrepSearchConfig` type.
   */
  public searchBatchWithCallback<T extends object>(
    inputs: Array<NetgrepInput<T>>,
    pattern: string,
    cb: (result: BatchNetgrepResult<T>) => void,
    config?: NetgrepSearchConfig
  ): void {
    inputs.forEach((input) => {
      const { url } = input;
      this.search(url, pattern, input.metadata, config)
        .then((res) => cb({ ...res, error: null }))
        .catch((err) =>
          cb({
            url,
            result: false,
            metadata: input.metadata,
            error: this.serializeError(err),
          })
        );
    });
  }

  /**
   * Transform an `unknown` type returned from a catch
   * into a `string`.
   */
  private serializeError(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    } else {
      return JSON.stringify(err);
    }
  }

  /**
   * Upsert a slice of bytes into the in-memory cache.
   */
  private upsertMemoryCache(url: string, bytes: Uint8Array) {
    const currentBlockLength = this.memoryCache[url]?.length || 0;
    const joinedArray = new Uint8Array(currentBlockLength + bytes.length);

    if (this.memoryCache[url]) joinedArray.set(this.memoryCache[url]);

    joinedArray.set(bytes, currentBlockLength);
    this.memoryCache[url] = joinedArray;
  }
}
