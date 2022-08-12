import { search } from 'core';

/**
 * Search 🔭
 */
export function netgrep(url: string, pattern: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const handleReader = (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      return reader.read().then(({ value, done }) => {
        // If the reader is actually done
        // let's quit this job returning `false`.
        if (done) {
          resolve(false);
          return;
        }

        // Execute the search in the current chunk of bytes
        // using the underneath WASM core module.
        const u8Array = new Uint8Array(value);
        const result = search(u8Array, pattern);

        if (result) {
          resolve(true);
        } else {
          handleReader(reader);
        }
      });
    };

    fetch(url)
      .then((res) =>
        !res.body
          ? Promise.reject('No body returned from the request')
          : Promise.resolve(res.body.getReader())
      )
      .then(handleReader)
      .catch(reject);
  });
}
