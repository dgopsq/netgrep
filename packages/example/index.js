import { Netgrep } from 'netgrep';

const NG = new Netgrep();

NG.search(
  'https://www.dgopsq.space/blog/inflist-an-experiment-using-purescript-and-react',
  'with'
).then(console.log);
