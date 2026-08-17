import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../../logs.config.json';
import { logUrl, manifestUrl, sources } from './logs';

const apache = sources[0];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('logUrl', () => {
  // Dev serves the files `build-logs.mjs` wrote into `.logs/`, so the URL
  // is site-relative and carries no version prefix.
  it('points at the local files in dev', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('BASE_URL', '/');

    expect(logUrl(apache)).toBe('/logs/apache.txt');
  });

  it('honours a base path in dev', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('BASE_URL', '/netgrep/');

    expect(logUrl(apache)).toBe('/netgrep/logs/apache.txt');
  });

  it('points at the versioned R2 prefix in prod', () => {
    vi.stubEnv('PROD', true);

    expect(logUrl(apache)).toBe(
      `${config.remoteBase}/v${config.corpusVersion}/apache.txt`,
    );
  });

  // The object keeps its `.txt` name on R2: the body is gzipped, and
  // `Content-Encoding` is what says so.
  it('does not suffix the key with .gz', () => {
    vi.stubEnv('PROD', true);

    expect(logUrl(apache)).not.toContain('.gz');
  });

  it('prefers VITE_LOGS_BASE over both defaults', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_LOGS_BASE', 'https://staging.example.com/v9/');

    expect(logUrl(apache)).toBe('https://staging.example.com/v9/apache.txt');
  });

  // So `VITE_LOGS_BASE=http://localhost:8787/v1` works without the visitor
  // having to remember the slash.
  it('tolerates an override missing its trailing slash', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_LOGS_BASE', 'https://staging.example.com/v9');

    expect(logUrl(apache)).toBe('https://staging.example.com/v9/apache.txt');
  });

  it('composes every source against the same base', () => {
    vi.stubEnv('PROD', true);

    for (const source of sources) {
      expect(logUrl(source)).toBe(
        `${config.remoteBase}/v${config.corpusVersion}/${source.file}`,
      );
    }
  });
});

describe('manifestUrl', () => {
  it('sits beside the logs in dev', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('BASE_URL', '/');

    expect(manifestUrl()).toBe('/logs/manifest.json');
  });

  // The manifest is uploaded under the same prefix, so a version bump replaces
  // the sizes and the files it describes together.
  it('sits beside the logs on R2', () => {
    vi.stubEnv('PROD', true);

    expect(manifestUrl()).toBe(
      `${config.remoteBase}/v${config.corpusVersion}/manifest.json`,
    );
  });
});
