// Regenerates `src/data/stories.ts` from the files in `public/stories/`.
//
// The manifest is COMMITTED, not built on the fly: the demo needs the title and
// byte count of every story before it has fetched anything, and reading 56 files
// at page load to discover them would defeat the point of the page.
//
// Run it after adding or removing a story:
//
//     node scripts/build-manifest.mjs
//
// The corpus came from sherlock-holm.es with four-letter names (`3gab.txt`,
// `bruc.txt`) that tell a reader nothing, which is why the demo used to list
// results as `/3gab.txt`. Each file carries its real title in a header block, so
// that is where the titles come from rather than a hand-written lookup table.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const storiesDir = join(here, '..', 'public', 'stories');
const outFile = join(here, '..', 'src', 'data', 'stories.ts');

/** Every file's header block ends at the byline. */
const AUTHOR = 'Arthur Conan Doyle';

/**
 * Words left lowercase by title case unless they open or close the title.
 */
const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'nor',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/**
 * Pull the title out of a story file.
 *
 * The header is a run of centred lines before the byline. It is usually one
 * line, but not always: `bruc.txt` wraps as "THE ADVENTURE OF THE" /
 * "BRUCE-PARTINGTON PLANS", separated by a line that is whitespace rather than
 * empty. So the run cannot be terminated on a blank line — it is terminated on
 * the byline, which every file has.
 *
 * A header line may also be a SUBTITLE rather than a continuation: `last.txt`
 * reads "HIS LAST BOW" / "An Epilogue of Sherlock Holmes", and joining those
 * gives the ungrammatical "His Last Bow an Epilogue of Sherlock Holmes". The
 * two cases are told apart by case — the sources shout titles and sentence-case
 * subtitles — so the run also stops at the first line containing a lowercase
 * letter.
 */
function extractTitle(text) {
  const parts = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line === AUTHOR) break;
    if (/[a-z]/.test(line)) break;
    parts.push(line);
  }

  return parts.join(' ');
}

/**
 * "THE ADVENTURE OF THE DEVIL'S FOOT" -> "The Adventure of the Devil's Foot".
 *
 * The sources are shouted in full caps, which is loud in a dense grid of 56
 * cards. Splitting on spaces alone would leave "Bruce-partington", so hyphenated
 * segments are cased individually; apostrophes are not split on, so "DEVIL'S"
 * does not become "Devil'S".
 *
 * Each segment is capitalised at its first LETTER rather than its first
 * character, because `glor.txt` is titled `THE "GLORIA SCOTT"` — capitalising
 * position 0 there uppercases the quotation mark and leaves the G alone.
 */
function toTitleCase(title) {
  const words = title.toLowerCase().split(' ');

  return words
    .map((word, i) => {
      const isEdge = i === 0 || i === words.length - 1;
      const bare = word.replace(/[^a-z]/g, '');
      if (!isEdge && SMALL_WORDS.has(bare)) return word;

      return word
        .split('-')
        .map((seg) => seg.replace(/[a-z]/, (c) => c.toUpperCase()))
        .join('-');
    })
    .join(' ');
}

const stories = readdirSync(storiesDir)
  .filter((file) => file.endsWith('.txt'))
  .map((file) => {
    const path = join(storiesDir, file);
    const title = extractTitle(readFileSync(path, 'utf8'));

    if (!title) throw new Error(`No title found in ${file}`);

    return {
      id: file.replace(/\.txt$/, ''),
      file,
      title: toTitleCase(title),
      bytes: statSync(path).size,
    };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

const totalBytes = stories.reduce((sum, story) => sum + story.bytes, 0);

const contents = `// GENERATED FILE — do not edit by hand.
// Run \`node scripts/build-manifest.mjs\` to regenerate it from public/stories/.

/**
 * One searchable file in the demo corpus.
 */
export type Story = {
  /** The file's basename, used as a stable React key. */
  id: string;
  /** The file's name within \`public/stories/\`. */
  file: string;
  /** The story's real title, read out of the file's own header. */
  title: string;
  /** The file's size on disk, so the page can state what a search costs. */
  bytes: number;
};

/**
 * The demo corpus: ${stories.length} individual Sherlock Holmes stories,
 * ${totalBytes.toLocaleString('en-US')} bytes in total.
 *
 * The omnibus volumes that shipped with the original example (the two
 * complete-canon dumps, the five collections and the four novels) are gone.
 * They were supersets of these files, so nearly every query matched all of
 * them and the result list said nothing — and they were 84% of the bytes.
 */
export const stories: Story[] = ${JSON.stringify(stories, null, 2)};

/**
 * Total size of the corpus. Shown in the UI, because a search that matches
 * nothing has to read all of it.
 */
export const totalBytes = ${totalBytes};
`;

writeFileSync(outFile, contents);

// The output is not excluded from Biome, so `pnpm lint` checks it like any
// other source file — which means the generator has to emit it already
// formatted. `JSON.stringify` produces double-quoted strings and Biome wants
// single, so rather than reimplementing its formatter, run it.
execFileSync('pnpm', ['exec', 'biome', 'format', '--write', outFile], {
  cwd: join(here, '..', '..', '..'),
  stdio: 'inherit',
});

console.log(
  `Wrote ${stories.length} stories (${totalBytes} bytes) to ${outFile}`,
);
