import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The shape of a Vite plugin this file needs, described rather than imported.
 *
 * `vite` is a dependency of the example package, not of the library — and the
 * integration test imports the marker lines below, which would drag whatever
 * this file imports into `packages/netgrep`'s typecheck. Structural types cost
 * nine lines and keep the library's program to `node` types alone.
 */
type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void;

type TestServerPlugin = {
  name: string;
  configureServer: (server: {
    middlewares: { use: (middleware: Middleware) => void };
  }) => void;
};

/**
 * A response that has sent its first bytes and is waiting to be told to send
 * the rest.
 */
type Held = {
  response: ServerResponse;
  tail: string;
};

/** Held responses, keyed by the id the test generated. */
const held = new Map<string, Held>();

/**
 * Bytes written before the response is held open.
 *
 * Sized so the head cannot sit in a socket buffer waiting for company: a few
 * hundred bytes might legitimately not surface until more arrives, and a test
 * that failed for that reason would look like a streaming failure. 64 KB is
 * past any such threshold.
 *
 * Padded with short lines, never one long one — a line over the 64 KB tail
 * ceiling would put the reader on the windowed path and change what it yields.
 */
const PAD_LINE = `${'x'.repeat(63)}\n`;
const PAD_LINES = 1024;

/** The line the head carries, and the line the tail carries. */
export const DRIP_HEAD_LINE = 'MARKER-HEAD';
export const DRIP_TAIL_LINE = 'MARKER-TAIL';

function head(): string {
  return `${DRIP_HEAD_LINE}\n${PAD_LINE.repeat(PAD_LINES)}`;
}

function tail(): string {
  return `${DRIP_TAIL_LINE}\n`;
}

/**
 * Serve a response whose second half is sent only when a test asks for it.
 *
 * This is what makes progressive delivery provable rather than plausible. A
 * test reads until it gets the head's match, and only then releases the tail —
 * so the read can only have succeeded if bytes crossed while the response was
 * still open. Had the browser buffered the whole body, the tail would not yet
 * exist to complete it and the read would never resolve.
 *
 * Nothing here is timing-based. There is no sleep and no deadline to tune: the
 * ordering is enforced by the server refusing to finish.
 */
export function dripServer(): TestServerPlugin {
  return {
    name: 'netgrep-drip-server',

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');

        if (url.pathname !== '/__drip' && url.pathname !== '/__drip/release') {
          return next();
        }

        const id = url.searchParams.get('id');

        if (!id) {
          response.statusCode = 400;
          response.end('missing id');
          return;
        }

        if (url.pathname === '/__drip/release') {
          const waiting = held.get(id);

          if (waiting) {
            held.delete(id);
            waiting.response.end(waiting.tail);
          }

          response.statusCode = 204;
          response.end();
          return;
        }

        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');

        // No `Content-Length`, so the response is chunked and may legally end
        // whenever the server says. `no-transform` keeps any proxy from
        // buffering the body to recompress it, which would defeat the point.
        response.setHeader('Cache-Control', 'no-store, no-transform');

        response.write(head());

        held.set(id, { response, tail: tail() });

        // Nothing calls `end` here. That is the mechanism, not an oversight —
        // the release route finishes it.
        request.on('close', () => held.delete(id));
      });
    },
  };
}
