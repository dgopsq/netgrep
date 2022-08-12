import { netgrep } from './netgrep';

describe('netgrep', () => {
  it('should work', () => {
    expect(netgrep()).toEqual('netgrep');
  });
});
