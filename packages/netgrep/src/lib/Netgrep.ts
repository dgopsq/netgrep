import { search } from 'core';
import { BatchNetgrepResult } from './data/BatchNetgrepResult';
import { NetgrepConfig } from './data/NetgrepConfig';
import { NetgrepResult } from './data/NetgrepResult';

/**
 *
 */
export class Netgrep {
  private readonly config: NetgrepConfig;

  constructor(config: NetgrepConfig) {
    this.config = config;
  }

  /**
   *
   * @param url
   * @param pattern
   * @returns
   */
  public search(url: string, pattern: string): Promise<NetgrepResult> {
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

          if (result) {
            resolve({ url, result: true });
          } else {
            handleReader(reader);
          }
        });
      };

      fetch(url)
        .then((res) =>
          !res.body
            ? Promise.reject('No body returned from the request')
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
   * @param cb
   */
  public searchBatch(
    urls: Array<string>,
    pattern: string,
    cb: (result: BatchNetgrepResult) => void
  ): void {
    urls.forEach((url) => {
      this.search(url, pattern)
        .then((res) => cb({ ...res, error: null }))
        .catch((err) =>
          cb({ url, result: false, error: this.serializeError(err) })
        );
    });
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
}
