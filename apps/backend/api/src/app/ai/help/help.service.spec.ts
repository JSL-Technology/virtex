import { HelpService, chunkArticle } from './help.service';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

describe('chunkArticle', () => {
  const article = `---\ntitle: NCF y e-CF\nroute: /accounts-payable\n---\n\nIntro sin encabezado.\n\n## Formato\n\nUn NCF tiene 11 caracteres.\n\n## Repetidos\n\nUn NCF es único.\n`;

  it('splits by section and carries the title, heading and route of each', () => {
    const chunks = chunkArticle('ncf.md', article);
    expect(chunks.map((chunk) => [chunk.ordinal, chunk.heading, chunk.content])).toEqual([
      [0, '', 'Intro sin encabezado.'],
      [1, 'Formato', 'Un NCF tiene 11 caracteres.'],
      [2, 'Repetidos', 'Un NCF es único.'],
    ]);
    expect(chunks.every((chunk) => chunk.title === 'NCF y e-CF' && chunk.route === '/accounts-payable')).toBe(true);
  });

  it('gives an unchanged section the same hash, so a restart rewrites nothing', () => {
    const edited = article.replace('Un NCF es único.', 'Un NCF es único para su emisor.');
    const [before, after] = [chunkArticle('ncf.md', article), chunkArticle('ncf.md', edited)];
    expect(after[1].contentHash).toBe(before[1].contentHash);
    expect(after[2].contentHash).not.toBe(before[2].contentHash);
  });

  it('every shipped article has a title and at least one section', async () => {
    const directory = path.join(__dirname, 'articles');
    const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const chunks = chunkArticle(file, await fs.readFile(path.join(directory, file), 'utf8'));
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].title).not.toBe(file.replace(/\.md$/, ''));
    }
  });
});

describe('HelpService.sync', () => {
  it('writes only what changed and removes what is gone', async () => {
    const rows = [
      { id: 'r1', source: 'a.md', ordinal: 0, contentHash: 'same' },
      { id: 'r2', source: 'a.md', ordinal: 1, contentHash: 'old' },
      { id: 'r3', source: 'gone.md', ordinal: 0, contentHash: 'x' },
    ];
    const manager = { query: jest.fn(), find: jest.fn(async () => rows), save: jest.fn(), delete: jest.fn() };
    const dataSource = { transaction: (fn: (m: typeof manager) => unknown) => fn(manager) };
    const service = new HelpService(dataSource as never, {} as never);
    const chunk = (ordinal: number, contentHash: string) => ({ source: 'a.md', ordinal, title: 't', heading: '', route: null, content: 'c', contentHash });
    const result = await service.sync([chunk(0, 'same'), chunk(1, 'new'), chunk(2, 'added')]);
    expect(result).toEqual({ written: 2, removed: 1 });
    expect(manager.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'r2', contentHash: 'new' }));
    expect(manager.delete).toHaveBeenCalledWith(expect.anything(), ['r3']);
  });
});
