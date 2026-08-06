import {
  search_bytes,
  search_bytes_line,
  search_bytes_line_ranges,
} from '@netgrep/search';
import { concatBytes } from './concatBytes.js';
import type { BatchNetgrepResult } from './data/BatchNetgrepResult.js';
import type { NetgrepCapture } from './data/NetgrepCapture.js';
import type { NetgrepInput } from './data/NetgrepInput.js';
import type { NetgrepMatchRange } from './data/NetgrepMatchRange.js';
import type { NetgrepResult } from './data/NetgrepResult.js';
import type { NetgrepSearchConfig } from './data/NetgrepSearchConfig.js';
import { resolveMaxLineBytes } from './resolveMaxLineBytes.js';
import { MAX_TAIL_BYTES, splitAtLastLine } from './splitAtLastLine.js';
import { wasmReady } from './wasmReady.js';

/**
 * What one call into the engine produced.
 *
 * `line` and `ranges` are `null` whenever they were not captured — because
 * there was no match, or because the caller never asked. The two are told
 * apart by `result`, never by inspecting either field.
 */
type EngineHit = {
  result: boolean;
  line: string | null;
  ranges: Array<NetgrepMatchRange> | null;
};

/** No match, and nothing to show for it. */
const NO_HIT: EngineHit = { result: false, line: null, ranges: null };

/**
 * Run one block of bytes through the engine — BACKLOG 19.
 *
 * Three entry points rather than one taking a flag, so the `capture:
 * undefined` path is the call it has always been: nothing allocated, decoded
 * or copied out of WebAssembly for a caller who only wants membership.
 */
function runEngine(
  block: Uint8Array,
  pattern: string,
  capture: NetgrepCapture,
  maxLineBytes: number,
): EngineHit {
  if (capture === undefined) {
    return { result: search_bytes(block, pattern), line: null, ranges: null };
  }

  if (capture === 'line') {
    const line = search_bytes_line(block, pattern, maxLineBytes);

    // ⚠️ `undefined` is the ONLY no-match signal. A pattern matching an empty
    // line returns an EMPTY STRING, which is falsy — testing `if (line)` here
    // would report a match as a miss. Pinned by
    // `test_a_match_on_an_empty_line_is_an_empty_string` in
    // `packages/search/tests/search.rs`.
    return line === undefined ? NO_HIT : { result: true, line, ranges: null };
  }

  const hit = search_bytes_line_ranges(block, pattern, maxLineBytes);

  if (hit === undefined) return NO_HIT;

  // Read out, then free: the carrier is a wasm-bindgen object owning WASM
  // memory, and waiting for GC would leak it for the page's lifetime under
  // engines without weak-ref finalization.
  const line = hit.line;
  const flat = hit.ranges;
  hit.free();

  const ranges: Array<NetgrepMatchRange> = [];

  for (let i = 0; i + 1 < flat.length; i += 2) {
    ranges.push({ start: flat[i], end: flat[i + 1] });
  }

  return { result: true, line, ranges };
}

/**
 * Assemble a resolved result.
 *
 * The `line` and `ranges` keys are OMITTED, not set to `null`, when nothing
 * was captured — `NetgrepResult<T, undefined>` says the keys do not exist,
 * and a result carrying them anyway would make that a lie to anything reading
 * the object rather than its type.
 *
 * The cast is unavoidable, and confined here and to `withError` below: the
 * result type is a conditional on `C`, and TypeScript cannot evaluate a
 * conditional whose parameter is still generic, so no literal built here is
 * assignable to it — not even through a single assertion, since the three
 * branches do not structurally overlap enough for TypeScript to trust one
 * without routing through `unknown` first. The invariant it asserts — `line`
 * (and `ranges`) exist exactly when `result` is `true` and were asked for —
 * is upheld by `runEngine` above and pinned by the type tests in
 * `Netgrep.spec.ts`.
 */
function toResult<T extends object, C extends NetgrepCapture>(
  url: string,
  pattern: string,
  metadata: T | undefined,
  hit: EngineHit,
  capture: NetgrepCapture,
): NetgrepResult<T, C> {
  const base = { url, pattern, result: hit.result, metadata };

  if (capture === undefined) {
    return base as unknown as NetgrepResult<T, C>;
  }

  if (capture === 'line') {
    return { ...base, line: hit.line } as unknown as NetgrepResult<T, C>;
  }

  return {
    ...base,
    line: hit.line,
    ranges: hit.ranges,
  } as unknown as NetgrepResult<T, C>;
}

/**
 * Attach a batch's per-url error slot to a result.
 *
 * Cast for the same reason as `toResult`: spreading a value whose type is a
 * conditional on `C` produces something TypeScript cannot check against the
 * same conditional.
 */
function withError<T extends object, C extends NetgrepCapture>(
  result: NetgrepResult<T, C>,
  error: string | null,
): BatchNetgrepResult<T, C> {
  return { ...result, error } as BatchNetgrepResult<T, C>;
}

/**
 * The `netgrep` library allows to search remote files
 * for a specific pattern using the `ripgrep` library
 * over HTTP.
 */
export class Netgrep {
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
   * `{ capture: 'line' }` to get the first matching line back alongside the
   * boolean, or `{ capture: 'line-ranges' }` to also get each match's position
   * within it; the result type changes to match, so `line` (and `ranges`) are
   * present wherever `result` has been narrowed to `true`.
   * @returns
   * A promise resolving to a `NetgrepResult<T, C>` as soon as a match will
   * be found in the remote file.
   */
  public async search<T extends object, C extends NetgrepCapture = undefined>(
    url: string,
    pattern: string,
    metadata?: T,
    config?: NetgrepSearchConfig<C>,
  ): Promise<NetgrepResult<T, C>> {
    // Nothing below can run before the engine exists.
    await wasmReady;

    // One cast, here, rather than at every read: `maxLineBytes` is typed
    // `C extends 'line' | 'line-ranges' ? number : never`, which is not a
    // `number` while `C` is still generic. Its runtime value is whatever the
    // caller passed, and `resolveMaxLineBytes` treats that as untrusted
    // anyway.
    const capture = config?.capture;
    const maxLineBytes = resolveMaxLineBytes(
      config?.maxLineBytes as number | undefined,
    );

    return this.executeSearch<T, C>(
      url,
      pattern,
      metadata,
      config,
      capture,
      maxLineBytes,
    );
  }

  /**
   * One fetch-and-stream pass over a url, searching each chunk as it arrives.
   *
   * Separate from `search` so the public method stays what it reads as — the
   * engine gate and the argument resolution — with the loop below it. The
   * split arrived with the cache and outlived it.
   */
  private executeSearch<T extends object, C extends NetgrepCapture>(
    url: string,
    pattern: string,
    metadata: T | undefined,
    config: NetgrepSearchConfig<C> | undefined,
    capture: NetgrepCapture,
    maxLineBytes: number,
  ): Promise<NetgrepResult<T, C>> {
    return new Promise((resolve, reject) => {
      // The incomplete final line seen so far, held back until the rest of it
      // arrives — BACKLOG 3a. Annotated because `subarray` yields an
      // `ArrayBufferLike` view, which the inferred type would reject.
      let tail: Uint8Array = new Uint8Array(0);

      // Whether `tail` still needs searching when the stream ends. False in the
      // windowed case, where it was already searched as part of the whole buffer.
      let tailPending = false;

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
                ? runEngine(tail, pattern, capture, maxLineBytes)
                : NO_HIT;

            resolve(toResult<T, C>(url, pattern, metadata, hit, capture));
            return;
          }

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
              ? runEngine(searchable, pattern, capture, maxLineBytes)
              : NO_HIT;

          if (hit.result) {
            // Terminate the transfer rather than just stop reading it. An
            // abandoned reader leaves the request open, so the rest of the
            // file keeps arriving and is paid for. Rejections are ignored:
            // the answer is already decided, and a stream that has errored
            // rejects here.
            reader.cancel().catch(() => {});

            resolve(toResult<T, C>(url, pattern, metadata, hit, capture));
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
   * `capture` applies to every url in the batch, and shapes every result.
   * @returns
   * A promise waiting for all the executed searches to complete.
   */
  public searchBatch<T extends object, C extends NetgrepCapture = undefined>(
    inputs: Array<NetgrepInput<T>>,
    pattern: string,
    config?: NetgrepSearchConfig<C>,
  ): Promise<Array<BatchNetgrepResult<T, C>>> {
    return Promise.all(
      inputs.map((input) => {
        const { url } = input;

        return this.search<T, C>(url, pattern, input.metadata, config)
          .then((res) => withError<T, C>(res, null))
          .catch((err) => this.toFailure<T, C>(input, pattern, err, config));
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
   * a `BatchNetgrepResult<T, C>` as a parameter.
   * @param config
   * An optional configuration respecting the `NetgrepSearchConfig` type.
   * `capture` applies to every url in the batch, and shapes every result.
   */
  public searchBatchWithCallback<
    T extends object,
    C extends NetgrepCapture = undefined,
  >(
    inputs: Array<NetgrepInput<T>>,
    pattern: string,
    cb: (result: BatchNetgrepResult<T, C>) => void,
    config?: NetgrepSearchConfig<C>,
  ): void {
    inputs.forEach((input) => {
      this.search<T, C>(input.url, pattern, input.metadata, config)
        .then((res) => cb(withError<T, C>(res, null)))
        .catch((err) => cb(this.toFailure<T, C>(input, pattern, err, config)));
    });
  }

  /**
   * The result for a url that never answered.
   *
   * `result: false` — and therefore `line: null` (and `ranges: null`), when
   * capture was asked for. An error is not a match, and it is emphatically
   * not a match with nothing to show: a caller narrowing on `result` must not
   * be handed a `line` here.
   */
  private toFailure<T extends object, C extends NetgrepCapture>(
    input: NetgrepInput<T>,
    pattern: string,
    err: unknown,
    config: NetgrepSearchConfig<C> | undefined,
  ): BatchNetgrepResult<T, C> {
    const capture = config?.capture;

    return withError<T, C>(
      toResult<T, C>(input.url, pattern, input.metadata, NO_HIT, capture),
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
}
