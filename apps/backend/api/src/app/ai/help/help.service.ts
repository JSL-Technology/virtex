import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AiKnowledgeChunk } from '../entities/ai-knowledge-chunk.entity';

/** A section longer than this is split, so a search returns a passage rather than a whole article. */
const MAX_CHUNK_CHARS = 1800;

/** The languages the help is written in, each with its PostgreSQL text-search dictionary. */
export const HELP_LANGUAGES: Readonly<Record<string, string>> = { es: 'spanish', en: 'english', pt: 'portuguese' };
const DEFAULT_HELP_LANGUAGE = 'es';

export interface HelpChunk {
  source: string;
  ordinal: number;
  title: string;
  heading: string;
  route: string | null;
  content: string;
  contentHash: string;
  language: string;
  countries: string[];
}

export interface HelpHit {
  title: string;
  heading: string;
  route: string | null;
  source: string;
  excerpt: string;
  /** The language the passage is written in — not the reader's when no translation exists. */
  language: string;
}

/** Who is reading: their language, and their company's market. */
export interface HelpReader {
  language: string | null | undefined;
  country: string | null | undefined;
}

/**
 * The in-app help: product articles, indexed for the assistant's `search_help` tool.
 *
 * Articles are written per language (`slug.md` is Spanish, `slug.en.md` English, `slug.pt.md`
 * Portuguese) and may name the markets they apply to (`countries: DO` in the front matter) — the
 * Dominican NCF rules are not help for a company in Mexico. A search reads the reader's language
 * and market only; where an article has no translation, the Spanish one answers and says so.
 *
 * The articles ship with the API (`ai/help/articles`, copied to `help/` in the bundle) and are
 * synced into `ai_knowledge_chunks` when the API starts — only what changed is rewritten, and an
 * advisory lock keeps several replicas starting together from doing it twice. There is no
 * separate deployment step to forget: the help a release answers from is the help it shipped with.
 */
@Injectable()
export class HelpService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HelpService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AiKnowledgeChunk) private readonly chunks: Repository<AiKnowledgeChunk>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const directory = await findArticlesDirectory();
      if (!directory) {
        this.logger.warn('No help articles found; the assistant will answer without in-app help.');
        return;
      }
      const result = await this.sync(await readArticles(directory));
      if (result.written || result.removed) {
        this.logger.log(`Help index updated: ${result.written} section(s) written, ${result.removed} removed.`);
      }
    } catch (error) {
      // The help is a convenience: a failure to index it must never stop the API from starting.
      this.logger.warn(`Help index not updated: ${(error as Error).message}`);
    }
  }

  /** Make the table hold exactly `chunks`, touching only what differs. */
  async sync(chunks: HelpChunk[]): Promise<{ written: number; removed: number }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('ai-help-index'))`);
      const existing = await manager.find(AiKnowledgeChunk, { select: ['id', 'source', 'ordinal', 'contentHash'] });
      const byKey = new Map(existing.map((row) => [`${row.source}#${row.ordinal}`, row]));
      const wanted = new Set<string>();
      let written = 0;
      for (const chunk of chunks) {
        const key = `${chunk.source}#${chunk.ordinal}`;
        wanted.add(key);
        const current = byKey.get(key);
        if (current?.contentHash === chunk.contentHash) continue;
        await manager.save(AiKnowledgeChunk, { ...(current ? { id: current.id } : {}), ...chunk });
        written++;
      }
      const stale = existing.filter((row) => !wanted.has(`${row.source}#${row.ordinal}`));
      if (stale.length) await manager.delete(AiKnowledgeChunk, stale.map((row) => row.id));
      return { written, removed: stale.length };
    });
  }

  /**
   * The sections that best answer `query` for this reader, ranked by Postgres full-text search in
   * the reader's language and restricted to their market. With nothing in that language, the
   * default language answers (each hit says which language it is in).
   */
  async search(query: string, reader: HelpReader, limit = 4): Promise<HelpHit[]> {
    const text = (query ?? '').trim().slice(0, 300);
    if (!text) return [];
    const country = (reader.country ?? '').trim().toUpperCase();
    const wanted = helpLanguageOf(reader.language);
    const languages = wanted === DEFAULT_HELP_LANGUAGE ? [wanted] : [wanted, DEFAULT_HELP_LANGUAGE];
    for (const language of languages) {
      let rows = await this.ranked(text, language, country, limit);
      // Every word must match at first; when that finds nothing, any word may — a long question in
      // the person's own words rarely shares all its words with one section.
      const words = text.split(/\s+/).filter((word) => word.length > 2);
      if (!rows.length && words.length > 1) rows = await this.ranked(words.join(' OR '), language, country, limit);
      if (rows.length) {
        return rows.map((row) => ({ title: row.title, heading: row.heading, route: row.route, source: row.source, excerpt: row.content, language }));
      }
    }
    return [];
  }

  private ranked(
    text: string,
    language: string,
    country: string,
    limit: number,
  ): Promise<Array<{ title: string; heading: string; route: string | null; source: string; content: string }>> {
    // The dictionary comes from a fixed map, never from input: it is SQL text, not a parameter.
    const dictionary = HELP_LANGUAGES[language] ?? HELP_LANGUAGES[DEFAULT_HELP_LANGUAGE];
    return this.chunks.query(
      `WITH q AS (SELECT websearch_to_tsquery('${dictionary}', $1) AS query)
       SELECT c."title", c."heading", c."route", c."source", c."content"
         FROM "ai_knowledge_chunks" c, q
        WHERE c."language" = $3
          AND (c."countries" = '[]'::jsonb OR c."countries" ? $4)
          AND to_tsvector('${dictionary}', c."title" || ' ' || c."heading" || ' ' || c."content") @@ q.query
        ORDER BY ts_rank(to_tsvector('${dictionary}', c."title" || ' ' || c."heading" || ' ' || c."content"), q.query) DESC
        LIMIT $2`,
      [text, Math.min(Math.max(limit, 1), 8), language, country],
    );
  }
}

/** The help language for a reader's language (`es-DO` → `es`), or the default one. */
export function helpLanguageOf(language: string | null | undefined): string {
  const base = (language ?? '').trim().toLowerCase().slice(0, 2);
  return base in HELP_LANGUAGES ? base : DEFAULT_HELP_LANGUAGE;
}

/** Where the articles are: next to the bundle in a build, in the source tree in development. */
async function findArticlesDirectory(): Promise<string | null> {
  const candidates = [
    path.join(__dirname, 'help'),
    path.join(__dirname, '..', 'help'),
    path.join(__dirname, 'articles'),
    path.join(process.cwd(), 'apps', 'backend', 'api', 'src', 'app', 'ai', 'help', 'articles'),
  ];
  for (const candidate of candidates) {
    const entries = await fs.readdir(candidate).catch(() => null);
    if (entries?.some((name) => name.endsWith('.md'))) return candidate;
  }
  return null;
}

async function readArticles(directory: string): Promise<HelpChunk[]> {
  const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.md')).sort();
  const chunks: HelpChunk[] = [];
  for (const file of files) {
    chunks.push(...chunkArticle(file, await fs.readFile(path.join(directory, file), 'utf8')));
  }
  return chunks;
}

/**
 * An article split into its `##` sections, each prefixed by nothing but its own text: the title and
 * heading travel as columns, so a hit can say where it came from.
 */
export function chunkArticle(source: string, markdown: string): HelpChunk[] {
  const { meta, body } = frontMatter(markdown);
  const title = (meta['title'] ?? source.replace(/\.md$/, '')).slice(0, 300);
  const route = meta['route']?.slice(0, 300) ?? null;
  // `slug.en.md` is English, `slug.md` the default language; the front matter may say it too.
  const suffix = /\.([a-z]{2})\.md$/.exec(source)?.[1];
  const language = helpLanguageOf(meta['language'] ?? suffix ?? DEFAULT_HELP_LANGUAGE);
  const countries = (meta['countries'] ?? '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code))
    .sort();
  const sections: Array<{ heading: string; text: string }> = [];
  let current = { heading: '', lines: [] as string[] };
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      if (current.lines.join('').trim()) sections.push({ heading: current.heading, text: current.lines.join('\n').trim() });
      current = { heading: heading[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim()) sections.push({ heading: current.heading, text: current.lines.join('\n').trim() });

  const chunks: HelpChunk[] = [];
  for (const section of sections) {
    for (const piece of split(section.text)) {
      const ordinal = chunks.length;
      chunks.push({
        source,
        ordinal,
        title,
        heading: section.heading.slice(0, 300),
        route,
        content: piece,
        language,
        countries,
        contentHash: createHash('sha256')
          .update(`${title}\n${section.heading}\n${route ?? ''}\n${language}\n${countries.join(',')}\n${piece}`)
          .digest('hex'),
      });
    }
  }
  return chunks;
}

function frontMatter(markdown: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { meta: {}, body: markdown };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^(\w+):\s*(.*)$/.exec(line);
    if (pair) meta[pair[1]] = pair[2].trim();
  }
  return { meta, body: markdown.slice(match[0].length) };
}

/** Paragraph-aligned pieces of at most MAX_CHUNK_CHARS. */
function split(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const pieces: string[] = [];
  let piece = '';
  for (const paragraph of text.split(/\n{2,}/)) {
    if (piece && piece.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
      pieces.push(piece);
      piece = '';
    }
    piece = piece ? `${piece}\n\n${paragraph}` : paragraph;
  }
  if (piece) pieces.push(piece);
  return pieces;
}
