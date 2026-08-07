import type { NetgrepHit } from '@netgrep/netgrep';

/**
 * How many matching lines the PAGE keeps.
 *
 * ⚠️ THIS IS THE PAGE'S BUDGET, NOT THE LIBRARY'S BOUND, and the difference is
 * the thing this demo exists to teach. netgrep holds one network chunk and the
 * incomplete line at its end however large the file is; this array holds
 * whatever it is told to, because a virtualized list still needs its items in
 * memory.
 *
 * The arithmetic behind the number: the 240 MB OpenSSH source is ~2.4 M lines,
 * and a loose pattern (`e`, `sshd`) matches most of them. At ~100 characters a
 * line that is ~2 bytes per character plus per-object overhead — comfortably
 * past half a gigabyte, which ends the tab. 100,000 lines is ~45 MB, which is
 * large but survivable, and is ~100× more than anyone scrolls.
 *
 * Raising it is buying memory with someone else's tab. Redo the arithmetic
 * first.
 */
export const MAX_RETAINED_HITS = 100_000;

/**
 * The hits of one run: every one counted, the first `MAX_RETAINED_HITS` kept.
 *
 * `hits` keeps a stable identity for the buffer's whole life — the hook hands
 * it to the virtualizer once and re-renders on `retained` instead. A buffer
 * that copied the array per push would put the cost back that the ref was for.
 * A new run gets a new buffer rather than a reset, so a stale render can never
 * read a half-cleared array.
 */
export class HitBuffer {
  readonly hits: NetgrepHit[] = [];

  private counted = 0;

  push(hit: NetgrepHit): void {
    this.counted += 1;

    if (this.hits.length < MAX_RETAINED_HITS) this.hits.push(hit);
  }

  /** Every matching line seen, including the ones not kept. */
  get total(): number {
    return this.counted;
  }

  /** How many are in `hits` — the virtualizer's item count. */
  get retained(): number {
    return this.hits.length;
  }

  /** Whether the page is showing fewer lines than it found. */
  get truncated(): boolean {
    return this.counted > this.hits.length;
  }
}
