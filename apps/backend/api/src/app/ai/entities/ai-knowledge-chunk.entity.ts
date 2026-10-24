import { Column, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * A section of an in-app help article. Global product documentation — the same for every tenant,
 * written from the articles the API ships with (`ai/help/articles`).
 */
@Entity({ name: 'ai_knowledge_chunks' })
@Unique('UQ_ai_knowledge_chunks_source_ordinal', ['source', 'ordinal'])
export class AiKnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The article's file name, e.g. `ncf-recibidos.md`. */
  @Column({ type: 'varchar', length: 200 })
  source: string;

  @Column({ type: 'integer' })
  ordinal: number;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'varchar', length: 300, default: '' })
  heading: string;

  /** The screen the article is about, when it is one. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  route: string | null;

  @Column({ type: 'text' })
  content: string;

  /** The article's language (`es`, `en`, `pt`); each is searched with its own dictionary. */
  @Column({ type: 'varchar', length: 8, default: 'es' })
  language: string;

  /** Markets the article applies to (ISO 3166-1 alpha-2); empty means every market. */
  @Column({ type: 'jsonb', default: [] })
  countries: string[];

  @Column({ name: 'content_hash', type: 'char', length: 64 })
  contentHash: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
