import type { NetgrepMatchRange } from './NetgrepMatchRange.js';

/**
 * One matching line, as `grep` yields it.
 */
export type NetgrepHit = {
  /**
   * The matching line with its terminator stripped, truncated to
   * `maxLineBytes` and lossily decoded.
   */
  line: string;

  /**
   * Every match's position within `line`, in order. Always present, never
   * null — but empty when every match sits past the `maxLineBytes` cut, since
   * `line` cannot show a range it does not hold.
   */
  ranges: Array<NetgrepMatchRange>;

  /**
   * The line's 1-based position in the FILE, not in the network chunk it
   * arrived in.
   *
   * Exact until a single line outgrows the 64 KB retained-tail ceiling, past
   * which the count gains a line each time the window slides.
   */
  lineNumber: number;
};
