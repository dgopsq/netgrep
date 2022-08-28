import { Netgrep } from '@netgrep/netgrep';
import debounce from 'lodash/debounce';
import { urls } from './inputs';

const NG = new Netgrep();
const searchInput = document.querySelector('#search-input');
const searchResultList = document.querySelector('#search-result');

/**
 * Execute a search manipulating the DOM in order
 * to show a list of urls where there is a match with
 * the given pattern.
 */
function execSearch(pattern) {
  // If the given pattern is falsy we are
  // going to reset the results' list.
  if (!pattern) {
    searchResultList.replaceChildren();
    return;
  }

  NG.searchBatch(urls, pattern)
    .then((outputs) => {
      // Clear the results list before adding
      // the new items.
      searchResultList.replaceChildren();

      const frag = document.createDocumentFragment();

      // Iterate over all the results showing only
      // the ones with a positive `output.result`.
      outputs.forEach((output) => {
        if (!output.result) return;

        const resultEl = document.createElement('li');
        resultEl.textContent = `✅ ${output.url}`;

        frag.appendChild(resultEl);
      });

      searchResultList.appendChild(frag);
    })
    .catch(console.error);
}

// Bind the `execSearch` function to the search field's
// `input` event using the lodash `debounce` utility.
searchInput.addEventListener(
  'input',
  debounce((e) => execSearch(e.target.value), 250)
);
