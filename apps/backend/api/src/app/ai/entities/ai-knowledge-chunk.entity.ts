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

  @Column({ name: 'content_hash', type: 'char', length: 64 })
  contentHash: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
