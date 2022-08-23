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
          'https://www.dgopsq.space/_next/data/ccLss2WP7L9CS5HZBe8uh/blog/inflist-an-experiment-using-purescript-and-react.json?slug=inflist-an-experiment-using-purescript-and-react',
          'https://www.dgopsq.space/_next/data/ccLss2WP7L9CS5HZBe8uh/blog/reading-from-stdin-using-purescript.json?slug=reading-from-stdin-using-purescript',
          'https://www.dgopsq.space/_next/data/ccLss2WP7L9CS5HZBe8uh/blog/auth0-expo-integration.json?slug=auth0-expo-integration',
          'https://www.dgopsq.space/_next/data/ccLss2WP7L9CS5HZBe8uh/blog/handling-migrations-rn-sqlite-fp-ts.json?slug=handling-migrations-rn-sqlite-fp-ts',
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
