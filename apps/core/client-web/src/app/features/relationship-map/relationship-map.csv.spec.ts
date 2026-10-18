import { toCsv } from './relationship-map.csv';

describe('toCsv', () => {
  it('quotes separators, quotes and line breaks', () => {
    expect(toCsv([['a,b', 'say "hi"', 'x\ny']])).toBe('"a,b","say ""hi""","x\ny"');
  });

  it('neutralises formula injection in text cells', () => {
    expect(toCsv([['=HYPERLINK("http://evil")', '+1', '-2', '@SUM(A1)']])).toBe(
      `"'=HYPERLINK(""http://evil"")",'+1,'-2,'@SUM(A1)`,
    );
  });

  it('keeps numbers numeric, including negatives, and blanks empties', () => {
    expect(toCsv([[-150.5, 0, null, undefined, '']])).toBe('-150.5,0,,,');
  });

  it('joins rows with CRLF', () => {
    expect(toCsv([['a'], ['b']])).toBe('a\r\nb');
  });
});
