import init, { search_bytes, search_bytes_line } from '@netgrep/search';
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
 * Ceiling on the returned line when `captureLine` is on and the caller names no
 * other. Far past any line of prose, and small enough that a minified bundle
 * costs a snippet rather than a copy of itself.
 */
const DEFAULT_MAX_LINE_BYTES = 4096;

/**
 * What one call into the engine produced.
 *
 * `line` is `null` whenever no line was captured — because there was no match,
 * or because the caller never asked for one. The two are told apart by
 * `result`, never by inspecting `line`.
 */
type EngineHit = {
  result: boolean;
  line: string | null;
};

/** No match, and nothing to show for it. */
const NO_HIT: EngineHit = { result: false, line: null };

/**
 * Run one block of bytes through the engine.
 *
 * Two entry points rather than one with a flag, so the `captureLine: false`
 * path is the same call it has always been — nothing is allocated, decoded or
 * copied out of WebAssembly for a caller who only wants membership. See
 * [decision 0020](../../../../docs/decisions/0020-the-matching-line.md).
 */
function runEngine(
  block: Uint8Array,
  pattern: string,
  captureLine: boolean,
  maxLineBytes: number,
): EngineHit {
  if (!captureLine) {
    return { result: search_bytes(block, pattern), line: null };
  }

  const line = search_bytes_line(block, pattern, maxLineBytes);

  // ⚠️ `undefined` is the ONLY no-match signal. A pattern matching an empty
  // line returns an EMPTY STRING, which is falsy — testing `if (line)` here
  // would report a match as a miss. Pinned by
  // `test_a_match_on_an_empty_line_is_an_empty_string` in
  // `packages/search/tests/search.rs`.
  return line === undefined ? NO_HIT : { result: true, line };
}

/**
 * Clamp a caller-supplied `maxLineBytes` into something a Rust `usize` can hold.
 *
 * Clamped rather than validated: wasm-bindgen does not check the number, so a
 * negative or fractional value would be reinterpreted rather than rejected, and
 * throwing on it would be a new failure mode for a cosmetic setting.
 */
function resolveMaxLineBytes(requested: number | undefined): number {
  return requested === undefined
    ? DEFAULT_MAX_LINE_BYTES
    : Math.max(1, Math.floor(requested));
}

/**
 * Assemble a resolved result.
 *
 * The `line` key is OMITTED, not set to `null`, when nothing was captured —
 * `NetgrepResult<T, false>` says the key does not exist, and a result carrying
 * it anyway would make that a lie to anything reading the object rather than
 * its type.
 *
 * The cast is unavoidable, and confined here and to `withError` below: the
 * result type is a conditional on `L`, and TypeScript cannot evaluate a
 * conditional whose parameter is still generic, so no literal built here is
 * assignable to it. The invariant it asserts — `line` is a `string` exactly
 * when `result` is `true` — is upheld by `runEngine` above and pinned by the
 * type tests in `Netgrep.spec.ts`.
 */
function toResult<T extends object, L extends boolean>(
  url: string,
  pattern: string,
  metadata: T | undefined,
  hit: EngineHit,
  captureLine: boolean,
): NetgrepResult<T, L> {
  const base = { url, pattern, result: hit.result, metadata };

  return (captureLine ? { ...base, line: hit.line } : base) as NetgrepResult<
    T,
    L
  >;
}

/**
 * Attach a batch's per-url error slot to a result.
 *
 * Cast for the same reason as `toResult`: spreading a value whose type is a
 * conditional on `L` produces something TypeScript cannot check against the
 * same conditional.
 */
function withError<T extends object, L extends boolean>(
  result: NetgrepResult<T, L>,
  error: string | null,
): BatchNetgrepResult<T, L> {
  return { ...result, error } as BatchNetgrepResult<T, L>;
}

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
   * An optional configuration respecting the `NetgrepSearchConfig` type. Pass
   * `{ captureLine: true }` to get the first matching line back alongside the
   * boolean; the result type changes to match, so `line` is a `string` wherever
   * `result` has been narrowed to `true`.
   * @returns
   * A promise resolving to a `NetgrepResult<T>` as soon as a match will
   * be found in the remote file.
   */
  public async search<T extends object, L extends boolean = false>(
    url: string,
    pattern: string,
    metadata?: T,
    config?: NetgrepSearchConfig<L>,
  ): Promise<NetgrepResult<T, L>> {
    // Nothing below can run before the engine exists.
    await wasmReady;

    // One cast, here, rather than at every read: `maxLineBytes` is typed
    // `L extends true ? number : never`, which is not a `number` while `L` is
    // still generic. Its runtime value is whatever the caller passed, and
    // `resolveMaxLineBytes` treats that as untrusted anyway.
    const captureLine = config?.captureLine === true;
    const maxLineBytes = resolveMaxLineBytes(
      config?.maxLineBytes as number | undefined,
    );

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
        // The whole file in one buffer, so the first matching line here is the
        // file's first matching line — the same one a cold fetch reports.
        return toResult<T, L>(
          url,
          pattern,
          metadata,
          runEngine(cached, pattern, captureLine, maxLineBytes),
          captureLine,
        );
      }
    }

    const running = this.executeSearch<T, L>(
      url,
      pattern,
      metadata,
      config,
      captureLine,
      maxLineBytes,
    );

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
  private executeSearch<T extends object, L extends boolean>(
    url: string,
    pattern: string,
    metadata: T | undefined,
    config: NetgrepSearchConfig<L> | undefined,
    captureLine: boolean,
    maxLineBytes: number,
  ): Promise<NetgrepResult<T, L>> {
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
            const hit =
              tailPending && tail.length > 0
                ? runEngine(tail, pattern, captureLine, maxLineBytes)
                : NO_HIT;

            this.commitMemoryCache(url, chunks, caching);

            resolve(toResult<T, L>(url, pattern, metadata, hit, captureLine));
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
          const hit =
            searchable.length > 0
              ? runEngine(searchable, pattern, captureLine, maxLineBytes)
              : NO_HIT;

          if (hit.result) {
            resolve(toResult<T, L>(url, pattern, metadata, hit, captureLine));
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
  public searchBatch<T extends object, L extends boolean = false>(
    inputs: Array<NetgrepInput<T>>,
    pattern: string,
    config?: NetgrepSearchConfig<L>,
  ): Promise<Array<BatchNetgrepResult<T, L>>> {
    return Promise.all(
      inputs.map((input) => {
        const { url } = input;

        return this.search<T, L>(url, pattern, input.metadata, config)
          .then((res) => withError<T, L>(res, null))
          .catch((err) => this.toFailure<T, L>(input, pattern, err, config));
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
  public searchBatchWithCallback<T extends object, L extends boolean = false>(
    inputs: Array<NetgrepInput<T>>,
    pattern: string,
    cb: (result: BatchNetgrepResult<T, L>) => void,
    config?: NetgrepSearchConfig<L>,
  ): void {
    inputs.forEach((input) => {
      this.search<T, L>(input.url, pattern, input.metadata, config)
        .then((res) => cb(withError<T, L>(res, null)))
        .catch((err) => cb(this.toFailure<T, L>(input, pattern, err, config)));
    });
  }

  /**
   * The result for a url that never answered.
   *
   * `result: false` — and therefore `line: null`, when one was asked for. An
   * error is not a match, and it is emphatically not a match with nothing to
   * show: a caller narrowing on `result` must not be handed a `line` here.
   */
  private toFailure<T extends object, L extends boolean>(
    input: NetgrepInput<T>,
    pattern: string,
    err: unknown,
    config: NetgrepSearchConfig<L> | undefined,
  ): BatchNetgrepResult<T, L> {
    const captureLine = config?.captureLine === true;

    return withError<T, L>(
      toResult<T, L>(input.url, pattern, input.metadata, NO_HIT, captureLine),
      this.serializeError(err),
    );
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
