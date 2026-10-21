import { HelpService, chunkArticle, helpLanguageOf } from './help.service';
import { AiKnowledgeChunk } from '../entities/ai-knowledge-chunk.entity';
import { describeWithDb, openTestDataSource } from '../../common/database/testing/integration-db';
import type { DataSource } from 'typeorm';
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

  it('reads the language from the file name and the markets from the front matter', () => {
    const [english] = chunkArticle('ncf.en.md', '---\ntitle: NCF\ncountries: do, xx1, MX\n---\n\nText.\n');
    expect(english).toMatchObject({ language: 'en', countries: ['DO', 'MX'] });
    const [spanish] = chunkArticle('ncf.md', article);
    expect(spanish).toMatchObject({ language: 'es', countries: [] });
    // A market change rewrites the section: the hash covers it.
    expect(chunkArticle('ncf.md', article.replace('route: /accounts-payable', 'route: /accounts-payable\ncountries: DO'))[0].contentHash)
      .not.toBe(spanish.contentHash);
  });

  it('every article has its English version, and the Dominican-only ones say so', async () => {
    const directory = path.join(__dirname, 'articles');
    const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.md'));
    const spanish = files.filter((name) => !/\.[a-z]{2}\.md$/.test(name));
    for (const file of spanish) expect(files).toContain(file.replace(/\.md$/, '.en.md'));
    const ncf = chunkArticle('ncf-recibidos.md', await fs.readFile(path.join(directory, 'ncf-recibidos.md'), 'utf8'));
    expect(ncf[0].countries).toEqual(['DO']);
  });

  it('every shipped article has a title and at least one section', async () => {
    const directory = path.join(__dirname, 'articles');
    const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const chunks = chunkArticle(file, await fs.readFile(path.join(directory, file), 'utf8'));
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].title).not.toBe(file.replace(/\.md$/, ''));
      expect(chunks[0].title).not.toBe(file.replace(/\.[a-z]{2}\.md$/, ''));
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
    const chunk = (ordinal: number, contentHash: string) => ({
      source: 'a.md',
      ordinal,
      title: 't',
      heading: '',
      route: null,
      content: 'c',
      contentHash,
      language: 'es',
      countries: [],
    });
    const result = await service.sync([chunk(0, 'same'), chunk(1, 'new'), chunk(2, 'added')]);
    expect(result).toEqual({ written: 2, removed: 1 });
    expect(manager.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'r2', contentHash: 'new' }));
    expect(manager.delete).toHaveBeenCalledWith(expect.anything(), ['r3']);
  });
});

describe('helpLanguageOf', () => {
  it('maps a reader\'s language to a help language, Spanish otherwise', () => {
    expect(helpLanguageOf('en-US')).toBe('en');
    expect(helpLanguageOf('pt-BR')).toBe('pt');
    expect(helpLanguageOf('fr')).toBe('es');
    expect(helpLanguageOf(null)).toBe('es');
  });
});

describeWithDb('HelpService.search, by language and market', () => {
  let dataSource: DataSource;
  let service: HelpService;
  const source = (name: string) => `audit-help-${name}`;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    service = new HelpService(dataSource, dataSource.getRepository(AiKnowledgeChunk));
    const repo = dataSource.getRepository(AiKnowledgeChunk);
    await repo.delete({ source: source('ncf.md') });
    await repo.delete({ source: source('ncf.en.md') });
    await repo.delete({ source: source('cfdi.md') });
    const row = (file: string, language: string, countries: string[], title: string, content: string) =>
      repo.save({ source: source(file), ordinal: 0, title, heading: '', route: null, content, contentHash: file, language, countries });
    await row('ncf.md', 'es', ['DO'], 'Comprobantes zxqwv', 'El comprobante zxqwv dominicano de las compras.');
    await row('ncf.en.md', 'en', ['DO'], 'Receipts zxqwv', 'The Dominican zxqwv receipt on purchases.');
    await row('cfdi.md', 'es', ['MX'], 'Folio zxqwv', 'El folio zxqwv del CFDI de las compras.');
  });

  afterAll(async () => {
    await dataSource.getRepository(AiKnowledgeChunk).delete({ source: source('ncf.md') });
    await dataSource.getRepository(AiKnowledgeChunk).delete({ source: source('ncf.en.md') });
    await dataSource.getRepository(AiKnowledgeChunk).delete({ source: source('cfdi.md') });
    await dataSource.destroy();
  });

  it('answers in the reader\'s language, from their market only', async () => {
    const english = await service.search('zxqwv', { language: 'en', country: 'DO' });
    expect(english.map((hit) => [hit.source, hit.language])).toEqual([[source('ncf.en.md'), 'en']]);
    const mexico = await service.search('zxqwv', { language: 'es', country: 'MX' });
    expect(mexico.map((hit) => hit.source)).toEqual([source('cfdi.md')]);
  });

  it('falls back to the default language, saying so, when there is no translation', async () => {
    const hits = await service.search('zxqwv', { language: 'en', country: 'MX' });
    expect(hits.map((hit) => [hit.source, hit.language])).toEqual([[source('cfdi.md'), 'es']]);
  });

  it('gives a market no other market\'s rules', async () => {
    expect(await service.search('zxqwv', { language: 'en', country: 'US' })).toEqual([]);
  });
});
