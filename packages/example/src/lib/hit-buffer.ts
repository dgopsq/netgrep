import type { NetgrepHit } from '@netgrep/netgrep';

/**
 * How many matching lines the PAGE keeps — its own budget, not the library's
 * bound. netgrep holds one chunk whatever the file's size; a virtualized list
 * still needs its items in memory.
 *
 * 100,000 lines is ~45 MB. Unbounded, a loose pattern over the 240 MB source's
 * ~2.4M lines passes half a gigabyte and ends the tab. Redo that arithmetic
 * before raising this.
 */
export const MAX_RETAINED_HITS = 100_000;

/**
 * The hits of one run: every one counted, the first `MAX_RETAINED_HITS` kept.
 *
 * `hits` keeps a stable identity for the buffer's life — the hook hands it to
 * the virtualizer once and re-renders on `retained`. A new run gets a new
 * buffer rather than a reset, so a stale render cannot read a half-cleared
 * array.
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
