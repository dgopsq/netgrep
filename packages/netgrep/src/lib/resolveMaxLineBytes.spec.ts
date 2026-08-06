import { describe, expect, it } from 'vitest';
import { resolveMaxLineBytes } from './resolveMaxLineBytes.js';

// The clamp on its own, as a table in Node.
//
// Reaching these branches through `grep` means asserting the third argument of
// a mocked `search_block`, which pins the wiring rather than the arithmetic —
// and the wiring is already pinned in `grep.spec.ts`. What matters here is the
// UPPER bound, which no test that goes through the engine can show: the number
// crosses into WASM through ToUint32, which wraps rather than saturates, so
// `Infinity`, `NaN` and 2³² all arrive as 0. A cap of 0 yields an empty string
// for every match, and an empty string is exactly how a match on an empty line
// is reported — so the obvious way to ask for "no cap" produced the one answer
// this API cannot afford to be ambiguous about.

const DEFAULT = 4096;
const CEILING = 0xffffffff;

describe('resolveMaxLineBytes', () => {
  it('defaults when the caller asks for nothing', () => {
    expect(resolveMaxLineBytes(undefined)).toBe(DEFAULT);
  });

  it('passes a usable value through', () => {
    expect(resolveMaxLineBytes(120)).toBe(120);
  });

  it('clamps values a Rust `usize` could not hold', () => {
    // Not rejected, because wasm-bindgen validates nothing: a negative would be
    // reinterpreted as an enormous positive, and a fraction would be truncated
    // somewhere less visible than here.
    expect([0, -1, -4096, 0.5].map(resolveMaxLineBytes)).toEqual([1, 1, 1, 1]);
  });

  it('clamps DOWN too, because the conversion wraps rather than saturates', () => {
    // The sharp bound. Without this, every one of these reaches the engine as
    // 0 and every match comes back as an empty line.
    expect([2 ** 32, 2 ** 40, CEILING].map(resolveMaxLineBytes)).toEqual([
      CEILING,
      CEILING,
      CEILING,
    ]);
  });

  it('reads `Infinity` as "no cap", and `NaN` as no request at all', () => {
    // `Infinity` is the obvious way to spell "give me the whole line", so it
    // becomes the largest cap the engine can hold rather than silently
    // reverting to the default and ignoring the caller.
    expect(resolveMaxLineBytes(Number.POSITIVE_INFINITY)).toBe(CEILING);

    // `NaN` is not a request for anything, so the default stands.
    expect(resolveMaxLineBytes(Number.NaN)).toBe(DEFAULT);
  });

  it('floors a fractional value rather than passing it on', () => {
    expect(resolveMaxLineBytes(12.7)).toBe(12);
  });
});
