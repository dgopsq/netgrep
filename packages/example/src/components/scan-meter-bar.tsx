import { formatBytes, formatShare } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * How much of the file has reached the search.
 *
 * THIS PAGE REFUSED A PROGRESS BAR FOR TWO REASONS, AND BOTH ARE GONE. It had
 * no progress to report — the library exposed none — and no honest total to
 * divide by, since `Content-Length` on a gzipped response is the compressed
 * size and would drive a bar finishing at a few per cent. `GrepOptions
 * .onProgress` supplies the numerator and the generator's `manifest.json` the
 * denominator, both measured. What was refused was an animation impersonating a
 * measurement; this is not one, and the distinction is the whole reason the
 * refusal was worth writing down.
 *
 * ⚠️ DECOMPRESSED FILE CONTENT, NOT BYTES ON THE WIRE. The logs are served
 * gzipped at roughly 16×, so the transfer behind a full bar was a fraction of
 * the figure beside it. `run-stats.tsx` carries the sentence that says so and
 * it may not be shortened past the point where it distinguishes the two.
 */
export function ScanMeterBar({
  bytesRead,
  totalBytes,
  running,
}: {
  bytesRead: number;
  totalBytes: number;
  running: boolean;
}) {
  const share = totalBytes > 0 ? Math.min(bytesRead / totalBytes, 1) : 0;

  return (
    <div className="mt-4">
      <div className="text-muted-foreground/60 mb-1.5 flex items-baseline justify-between text-[10px] tracking-wider uppercase">
        <span>Read</span>
        <span className="font-mono tabular-nums normal-case">
          {formatBytes(bytesRead)} of {formatBytes(totalBytes)} ·{' '}
          {formatShare(bytesRead, totalBytes)}
        </span>
      </div>

      <div
        className="bg-border/50 h-1 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-label="File content read"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        {/*
          Width is driven by a measured ratio and transitions only to smooth the
          step between chunks — it is never animated toward a value that has not
          been read. `duration-150` is under one chunk's arrival interval, so the
          bar never runs ahead of the number beside it.
        */}
        <div
          className={cn(
            'bg-primary h-full rounded-full transition-[width] duration-150 ease-linear',
            running && 'animate-pulse',
          )}
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  );
}
