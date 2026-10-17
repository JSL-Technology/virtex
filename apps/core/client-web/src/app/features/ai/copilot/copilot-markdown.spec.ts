import { renderCopilotMarkdown } from './copilot-markdown';

describe('renderCopilotMarkdown', () => {
  it('never lets the answer carry markup, even when it quotes a name verbatim', () => {
    const html = renderCopilotMarkdown('Cliente: <img src=x onerror=alert(1)> **Acme & Co**');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('<strong>Acme &amp; Co</strong>');
  });

  it('draws lists and paragraphs', () => {
    expect(renderCopilotMarkdown('Top:\n- Uno\n- Dos\n\n1. A\n2. B')).toBe(
      '<p>Top:</p><ul><li>Uno</li><li>Dos</li></ul><ol><li>A</li><li>B</li></ol>',
    );
  });

  it('draws a pipe table', () => {
    const html = renderCopilotMarkdown('| Cliente | Saldo |\n|---|---:|\n| Acme | 1,500.00 |');
    expect(html).toContain('<th>Cliente</th>');
    expect(html).toContain('<td>1,500.00</td>');
  });

  it('makes no links: a URL stays text', () => {
    expect(renderCopilotMarkdown('[aquí](javascript:alert(1))')).not.toContain('<a');
  });
});
