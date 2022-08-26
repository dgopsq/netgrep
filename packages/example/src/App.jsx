import { useState, useCallback } from 'react';
import debounce from 'lodash/debounce';
import { Netgrep } from 'netgrep';

const NG = new Netgrep({
  enableMemoryCache: true,
});

export function App() {
  const [results, setResults] = useState([]);

  const handleChange = useCallback(
    debounce((e) => {
      const pattern = e.target.value || '';

      if (pattern === '') {
        setResults([]);
        return;
      }

      NG.searchBatch(
        [
          { url: 'https://sherlock-holm.es/stories/plain-text/advs.txt' },
          { url: 'https://sherlock-holm.es/stories/plain-text/mems.txt' },
          { url: 'https://sherlock-holm.es/stories/plain-text/retn.txt' },
          { url: 'https://sherlock-holm.es/stories/plain-text/lstb.txt' },
        ],
        pattern
      ).then(setResults);
    }, 500),
    [setResults]
  );

  return (
    <div>
      <input type='text' onChange={handleChange} />

      <ul>
        {results.map(({ result, url }) =>
          result ? <li key={url}>{url}</li> : null
        )}
      </ul>
    </div>
  );
}
