import { useRef, useState, useCallback, useMemo } from 'react';
import { Netgrep } from 'netgrep';

const NG = new Netgrep({});

export function App() {
  const [searchId, setSearchId] = useState(0);
  const resultsRef = useRef({});

  const handleChange = useCallback(
    (e) => {
      const pattern = e.target.value || '';

      const nextSearchId = searchId + 1;
      resultsRef.current[nextSearchId] = [];
      setSearchId(nextSearchId);

      NG.searchBatch(
        [
          'https://www.dgopsq.space/_next/data/ccLss2WP7L9CS5HZBe8uh/blog/inflist-an-experiment-using-purescript-and-react.json?slug=inflist-an-experiment-using-purescript-and-react',
          'https://www.dgopsq.space/_next/data/ccLss2WP7L9CS5HZBe8uh/blog/reading-from-stdin-using-purescript.json?slug=reading-from-stdin-using-purescript',
          'https://www.dgopsq.space/_next/data/ccLss2WP7L9CS5HZBe8uh/blog/reading-from-stdin-using-purescript.json?slug=reading-from-stdin-using-purescript',
          'https://www.dgopsq.space/_next/data/ccLss2WP7L9CS5HZBe8uh/blog/auth0-expo-integration.json?slug=auth0-expo-integration',
          'https://www.dgopsq.space/_next/data/ccLss2WP7L9CS5HZBe8uh/blog/handling-migrations-rn-sqlite-fp-ts.json?slug=handling-migrations-rn-sqlite-fp-ts',
        ],
        pattern,
        (result) => {
          resultsRef.current[nextSearchId].push(result);
        }
      );
    },
    [searchId, setSearchId, resultsRef]
  );

  const results = useMemo(
    () => resultsRef.current[searchId] || [],
    [resultsRef, searchId]
  );

  return (
    <div>
      <input type='text' onChange={handleChange} />

      <ul>
        {results.map((result) => (
          <li key={result.url}>{result.url}</li>
        ))}
      </ul>
    </div>
  );
}
