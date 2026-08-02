import { useEffect, useState } from 'react';
import { manifestUrl, sources } from '@/data/logs';

export type LogSizes = {
  /** Bytes per source id. */
  bytes: Record<string, number>;
  /** Their sum — what a query matching nothing has to download. */
  totalBytes: number;
};

function withTotal(bytes: Record<string, number>): LogSizes {
  return {
    bytes,
    totalBytes: Object.values(bytes).reduce((sum, size) => sum + size, 0),
  };
}

/**
 * What the page shows before the manifest arrives: the configured targets.
 *
 * Every one of them is slightly low, because a target is a floor the generator
 * overshoots by up to one seed. That is the right direction to be wrong in for
 * the fraction of a second this is on screen — the page under-promises what a
 * search costs rather than over-promising it — but it is still wrong, which is
 * why the manifest exists.
 */
const TARGETS = withTotal(
  Object.fromEntries(sources.map((source) => [source.id, source.targetBytes])),
);

/**
 * The real size of each generated log file.
 *
 * Fetched once at startup from the manifest `build-logs.mjs` writes beside the
 * logs, because only the generator knows what the tiling actually produced:
 * `apache.txt` is built up to a floor of 8 MB and lands at 8.3 MB, and a page
 * that prints the floor beside the file name is stating four sizes that are all
 * incorrect.
 *
 * A missing or unreadable manifest is NOT an error here. It is what a
 * `pnpm dev` without a prior generator run looks like, and the page degrades to
 * the configured targets rather than to a dash or a crash — the sizes are
 * context for the timings, not the measurement itself.
 */
export function useLogSizes(): LogSizes {
  const [sizes, setSizes] = useState<LogSizes>(TARGETS);

  useEffect(() => {
    const controller = new AbortController();

    fetch(manifestUrl(), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest: unknown) => {
        if (typeof manifest !== 'object' || manifest === null) return;

        const sizeOf = manifest as Record<string, unknown>;

        setSizes(
          withTotal(
            Object.fromEntries(
              sources.map((source) => {
                const size = sizeOf[source.id];
                return [
                  source.id,
                  typeof size === 'number' ? size : source.targetBytes,
                ];
              }),
            ),
          ),
        );
      })
      // No manifest, no network, or an aborted fetch on unmount: the targets
      // stand. Nothing is logged, because none of it is the visitor's problem.
      .catch(() => {});

    return () => controller.abort();
  }, []);

  return sizes;
}
