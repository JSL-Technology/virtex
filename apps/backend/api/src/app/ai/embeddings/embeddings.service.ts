import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AiGatewayService } from '../gateway/ai-gateway.service';
import { withTenant } from '../../shared/tenancy/tenant-job';

/** How close two images must be (cosine similarity) to ask "is this the same product?". */
const SAME_PRODUCT_SIMILARITY = 0.9;

export interface ImageNeighbour {
  productId: string;
  similarity: number;
}

/**
 * Image embeddings, for recognising a product that is already in the catalogue.
 *
 * Optional twice over: it needs `VOYAGE_API_KEY`, and it needs the `vector` extension, which the
 * migration installs only where the database offers it. When either is missing every method is a
 * no-op and duplicates are found by barcode and name alone — the feature degrades, nothing fails.
 *
 * The vectors live in Postgres (`product_embeddings`), under the same row-level policy as every
 * other tenant table. A separate vector database would be a second place where one tenant's data
 * could be returned to another; here a similarity search is an ordinary query, isolated like one.
 */
@Injectable()
export class EmbeddingsService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingsService.name);
  private tableExists = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly gateway: AiGatewayService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const rows: Array<{ exists: boolean }> = await this.dataSource.query(
        `SELECT to_regclass('public.product_embeddings') IS NOT NULL AS "exists"`,
      );
      this.tableExists = Boolean(rows[0]?.exists);
    } catch {
      this.tableExists = false;
    }
    if (!this.tableExists) {
      this.logger.log('pgvector is not installed: image duplicate detection is off.');
    }
  }

  /** Whether the deployment can embed at all: the table exists and a key is configured. Each company still opts in. */
  isAvailable(): boolean {
    return this.tableExists && Boolean(this.config.get<string>('VOYAGE_API_KEY'));
  }

  /**
   * Embed one stored image and remember the vector against it. Returns the vector and the model
   * that produced it, or null when embeddings are unavailable, the company has not opted in, or the
   * provider failed — a failure here must never block a form. The call itself goes through the
   * gateway (consent, circuit breaker, receipt).
   */
  async embedImage(
    organizationId: string,
    userId: string | null,
    imageId: string,
    jpeg: Buffer,
  ): Promise<{ vector: number[]; model: string } | null> {
    if (!this.tableExists) return null;
    const embedded = await this.gateway.embedImage(organizationId, userId, jpeg);
    if (!embedded) return null;
    await withTenant(this.dataSource, organizationId, () =>
      this.dataSource.query(
        `INSERT INTO "product_embeddings" ("organization_id", "image_id", "source", "model", "embedding")
         VALUES ($1, $2, 'image', $3, $4::vector)`,
        [organizationId, imageId, embedded.model, toVectorLiteral(embedded.vector)],
      ),
    );
    return embedded;
  }

  /** Catalogue products whose photos look like this one, closest first. */
  async nearestProducts(organizationId: string, embedded: { vector: number[]; model: string }, limit = 3): Promise<ImageNeighbour[]> {
    if (!this.tableExists) return [];
    const vector = embedded.vector;
    const rows: Array<{ product_id: string; similarity: string }> = await this.dataSource.query(
      `SELECT pi."product_id", 1 - (e."embedding" <=> $2::vector) AS "similarity"
         FROM "product_embeddings" e
         JOIN "product_images" pi ON pi."id" = e."image_id"
        WHERE e."organization_id" = $1 AND pi."product_id" IS NOT NULL
          -- Vectors of different models live in different spaces: only like is compared with like.
          AND e."model" = $4
        ORDER BY e."embedding" <=> $2::vector
        LIMIT $3`,
      [organizationId, toVectorLiteral(vector), limit, embedded.model],
    );
    return rows
      .map((row) => ({ productId: row.product_id, similarity: Number(row.similarity) }))
      .filter((row) => row.similarity >= SAME_PRODUCT_SIMILARITY);
  }
}

/** pgvector's text input format. Numbers only — the vector came from the provider, not the user. */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}
