import { useEffect, useState } from 'react';

/**
 * Return `value` once it has stopped changing for `delay` milliseconds.
 *
 * Replaces the `lodash/debounce` the original example pulled in for this one
 * call. Every keystroke starts four downloads totalling hundreds of megabytes,
 * so the delay is not a nicety.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
