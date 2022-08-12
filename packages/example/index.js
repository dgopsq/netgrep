import { netgrep } from 'netgrep';

netgrep(
  'https://www.dgopsq.space/blog/inflist-an-experiment-using-purescript-and-react',
  'with'
).then(console.log);
