/**
 * The small part of Markdown the copilot writes — paragraphs, bullet and numbered lists, bold,
 * italics, inline code and pipe tables — as HTML.
 *
 * Everything is escaped FIRST and only then are the few constructs turned into tags, so nothing in
 * the answer (which can quote a customer's name or a product description verbatim) is ever
 * markup. No links and no images: a number in an answer comes from a tool, and a link in one
 * would be the model's invention.
 */
export function renderCopilotMarkdown(source: string): string {
  const lines = escapeHtml(source.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableRule(lines[i + 1].trim())) {
      flushParagraph();
      flushList();
      const header = cells(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i].trim())) rows.push(cells(lines[i++].trim()));
      i--;
      out.push(
        '<div class="cp-table"><table><thead><tr>' +
          header.map((cell) => `<th>${inline(cell)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table></div>',
      );
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      out.push(`<p><strong>${inline(heading[1])}</strong></p>`);
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    const item = bullet ?? /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (item) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list?.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(item[1]);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return out.join('');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

function isTableRow(line: string): boolean {
  return line.startsWith('|') && line.endsWith('|') && line.length > 1;
}

function isTableRule(line: string): boolean {
  return /^\|(\s*:?-{2,}:?\s*\|)+$/.test(line);
}

function cells(line: string): string[] {
  return line.slice(1, -1).split('|').map((cell) => cell.trim());
}
