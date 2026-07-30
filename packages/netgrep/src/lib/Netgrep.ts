import init, { search_bytes } from '@netgrep/search';
import type { BatchNetgrepResult } from './data/BatchNetgrepResult.js';
import type { NetgrepConfig } from './data/NetgrepConfig.js';
import type { NetgrepInput } from './data/NetgrepInput.js';
import type { NetgrepResult } from './data/NetgrepResult.js';
import type { NetgrepSearchConfig } from './data/NetgrepSearchConfig.js';
import { splitAtLastLine } from './splitAtLastLine.js';

/**
 * The default configuration used by `netgrep`.
 */
const defaultConfig: NetgrepConfig = {
  enableMemoryCache: true,
};

/**
 * Ceiling on the bytes retained between two `fetch` chunks.
 *
 * Only terminator-free input reaches it — the tail is normally the incomplete
 * trailing line, 76 bytes at worst in the demo's corpus. Past it the guarantee
 * weakens to "a boundary never hides a match shorter than 64 KB".
 *
 * A safety valve for input netgrep is not aimed at, so not configurable.
 */
const MAX_TAIL_BYTES = 64 * 1024;

/**
 * Join a list of byte chunks into one buffer.
 */
function concatBytes(chunks: Array<Uint8Array>): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);

  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }

  return joined;
}

/**
 * The WASM module has to be instantiated before `search_bytes` can be called.
 *
 * Started once at module load and shared by every `Netgrep` instance: the
 * download begins as soon as the library is imported rather than on the first
 * search, and awaiting an already-settled promise costs nothing.
 *
 * Kept module-private on purpose — callers should not have to know the engine
 * needs booting.
 */
const wasmReady = init();

/**
 * The `netgrep` library allows to search remote files
 * for a specific pattern using the `ripgrep` library
 * over HTTP.
 */
export class Netgrep {
  private readonly config: NetgrepConfig;
  private readonly memoryCache: Record<string, Uint8Array> = {};

  /**
   * Downloads currently in flight, keyed by url — BACKLOG 18.
   *
   * Populated only when the memory cache is on, because the cache entry is what
   * a second caller is handed. With the cache off there is nothing to hand over
   * and waiting would save no request.
   */
  private readonly inFlight: Record<string, Promise<unknown>> = {};

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
  public async search<T extends object>(
    url: string,
    pattern: string,
    metadata?: T,
    config?: NetgrepSearchConfig,
  ): Promise<NetgrepResult<T>> {
    // Nothing below can run before the engine exists.
    await wasmReady;

    if (this.config.enableMemoryCache) {
      // Waited on ONCE, not until the url is quiet. Looping until no download
      // is in flight would serialise callers that used to fetch in parallel,
      // and buy no fewer requests. The rejection is swallowed because the
      // recourse to a failed download is the recourse to a miss: fetch below,
      // with this caller's own signal.
      const ahead = this.inFlight[url];

      if (ahead) await ahead.catch(() => undefined);

      // Search the content in the memory cache if it's enabled. No tail buffer
      // needed: entries are only written from a drained stream, so an entry is
      // the whole file in one buffer with no boundaries to lose a match across.
      const cached = this.memoryCache[url];

      if (cached) {
        return {
          url,
          pattern,
          result: search_bytes(cached, pattern),
          metadata,
        };
      }
    }

    const running = this.executeSearch<T>(url, pattern, metadata, config);

    if (this.config.enableMemoryCache) {
      this.inFlight[url] = running;

      // Two waiters can wake together and both register, so the identity check
      // matters: an overwritten search must not delete its successor's entry.
      // Both handlers, so this never becomes a rejection of its own — the
      // caller holds `running` and answers for that one.
      const settle = () => {
        if (this.inFlight[url] === running) delete this.inFlight[url];
      };

      running.then(settle, settle);
    }

    return running;
  }

  /**
   * One fetch-and-stream pass over a url, searching each chunk as it arrives.
   *
   * Knows nothing about the cache read or the in-flight registry: `search`
   * decides whether this needs to run at all.
   */
  private executeSearch<T extends object>(
    url: string,
    pattern: string,
    metadata?: T,
    config?: NetgrepSearchConfig,
  ): Promise<NetgrepResult<T>> {
    return new Promise((resolve, reject) => {
      // The incomplete final line seen so far, held back until the rest of it
      // arrives — BACKLOG 3a. Annotated because `subarray` yields an
      // `ArrayBufferLike` view, which the inferred type would reject.
      let tail: Uint8Array = new Uint8Array(0);

      // Whether `tail` still needs searching when the stream ends. False in the
      // windowed case, where it was already searched as part of the whole buffer.
      let tailPending = false;

      const caching = this.config.enableMemoryCache;

      // Joined ONCE at the end rather than reallocated per chunk, which used to
      // make this O(n²) — BACKLOG 11. Left empty when the cache is off: the
      // search never needs more than the tail, so collecting anyway would retain
      // all 500 MB of a 500 MB file for nothing.
      const chunks: Array<Uint8Array> = [];

      const handleReader = (
        reader: ReadableStreamDefaultReader<Uint8Array>,
      ) => {
        return reader.read().then(({ value, done }) => {
          // If the reader is actually done
          // let's quit this job returning `false`.
          if (done) {
            // The stream ended, so the held-back tail is a genuine final line
            // rather than a fragment, and skipping it would lose the last line of
            // every file not ending in a newline.
            //
            // Only when it has not already been searched. A windowed tail was
            // covered by the whole-buffer search that produced it, and searching
            // it alone would treat its first byte as a line start — letting `^`
            // match a line that begins earlier.
            const result =
              tailPending && tail.length > 0 && search_bytes(tail, pattern);

            this.commitMemoryCache(url, chunks, caching);

            resolve({ url, pattern, result, metadata });
            return;
          }

          if (caching) chunks.push(value);

          // Prepend the held-back tail, then hand the engine only whole lines.
          const {
            searchable,
            tail: nextTail,
            tailSearched,
          } = splitAtLastLine(
            tail.length > 0 ? concatBytes([tail, value]) : value,
            MAX_TAIL_BYTES,
          );

          tail = nextTail;
          tailPending = !tailSearched;

          // A chunk with no terminator in it searches nothing and grows the tail.
          const result =
            searchable.length > 0 && search_bytes(searchable, pattern);

          if (result) {
            resolve({ url, pattern, result: true, metadata });
          } else {
            // `.catch` because this promise is not chained to the executor's:
            // without it, a rejection from any chunk after the first (dropped
            // connection, abort, invalid pattern first reaching the engine late)
            // goes unhandled and the search never settles.
            handleReader(reader).catch(reject);
          }
        });
      };

      fetch(url, { signal: config?.signal })
        .then((res) =>
          !res.body
            ? Promise.reject(new Error("The response doesn't contain a body"))
            : Promise.resolve(res.body.getReader()),
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
    config?: NetgrepSearchConfig,
  ): Promise<Array<BatchNetgrepResult<T>>> {
    return Promise.all(
      inputs.map((input) => {
        const { url } = input;

        return this.search(url, pattern, input.metadata, config)
          .then((res) => ({ ...res, error: null }))
          .catch((err) => ({
            url,
            result: false,
            pattern,
            metadata: input.metadata,
            error: this.serializeError(err),
          }));
      }),
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
    config?: NetgrepSearchConfig,
  ): void {
    inputs.forEach((input) => {
      const { url } = input;
      this.search(url, pattern, input.metadata, config)
        .then((res) => cb({ ...res, error: null }))
        .catch((err) =>
          cb({
            url,
            result: false,
            pattern,
            metadata: input.metadata,
            error: this.serializeError(err),
          }),
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
   * Store a fully downloaded file in the in-memory cache.
   *
   * ONLY EVER CALLED ON A DRAINED STREAM — BACKLOG 3b. Writing per chunk left a
   * prefix behind with nothing marking it incomplete, so a later search for a
   * term further down answered `false` about text never downloaded.
   *
   * Assigns rather than appends. Two concurrent searches of one url no longer
   * reach here together — the second waits on the first — but an assignment is
   * what makes that safe to rely on rather than something to reason about.
   */
  private commitMemoryCache(
    url: string,
    chunks: Array<Uint8Array>,
    caching: boolean,
  ) {
    if (!caching) return;

    this.memoryCache[url] = concatBytes(chunks);
  }
}
