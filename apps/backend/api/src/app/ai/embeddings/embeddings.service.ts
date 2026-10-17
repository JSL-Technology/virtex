import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AiRequest } from '../entities/ai-request.entity';

const VOYAGE_URL = 'https://api.voyageai.com/v1/multimodalembeddings';
const DIMENSIONS = 1024;

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
    @InjectRepository(AiRequest) private readonly requests: Repository<AiRequest>,
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

  isAvailable(): boolean {
    return this.tableExists && Boolean(this.config.get<string>('VOYAGE_API_KEY'));
  }

  /**
   * Embed one stored image and remember the vector against it. Returns the vector, or null when
   * embeddings are unavailable or the provider failed — a failure here must never block a form.
   */
  async embedImage(
    organizationId: string,
    userId: string | null,
    imageId: string,
    jpeg: Buffer,
  ): Promise<number[] | null> {
    if (!this.isAvailable()) return null;
    const model = this.config.get<string>('VOYAGE_MULTIMODAL_MODEL') ?? 'voyage-multimodal-3';
    const started = Date.now();
    let vector: number[] | null = null;
    let status: 'SUCCEEDED' | 'FAILED' = 'FAILED';
    let errorCode: string | null = null;
    let tokens = 0;
    try {
      const response = await fetch(VOYAGE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.get<string>('VOYAGE_API_KEY')}`,
        },
        body: JSON.stringify({
          model,
          input_type: 'document',
          inputs: [
            { content: [{ type: 'image_base64', image_base64: `data:image/jpeg;base64,${jpeg.toString('base64')}` }] },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        errorCode = `http_${response.status}`;
      } else {
        const body = (await response.json()) as {
          data?: Array<{ embedding: number[] }>;
          usage?: { total_tokens?: number };
        };
        const embedding = body.data?.[0]?.embedding;
        if (Array.isArray(embedding) && embedding.length === DIMENSIONS) {
          vector = embedding;
          status = 'SUCCEEDED';
          tokens = body.usage?.total_tokens ?? 0;
        } else {
          errorCode = 'unexpected_dimensions';
        }
      }
    } catch (error) {
      errorCode = (error as Error)?.name === 'TimeoutError' ? 'timeout' : 'network';
    }

    await this.requests
      .save(
        this.requests.create({
          organizationId,
          userId,
          feature: 'product_image_embedding',
          provider: 'voyage',
          model,
          status,
          errorCode,
          inputTokens: tokens,
          credits: 0,
          latencyMs: Date.now() - started,
        }),
      )
      .catch((error) => this.logger.warn(`Could not record embedding request: ${(error as Error).message}`));

    if (!vector) {
      this.logger.warn(`Image embedding failed (${errorCode}); duplicates fall back to barcode and name.`);
      return null;
    }

    await this.dataSource.query(
      `INSERT INTO "product_embeddings" ("organization_id", "image_id", "source", "model", "embedding")
       VALUES ($1, $2, 'image', $3, $4::vector)`,
      [organizationId, imageId, model, toVectorLiteral(vector)],
    );
    return vector;
  }

  /** Catalogue products whose photos look like this one, closest first. */
  async nearestProducts(organizationId: string, vector: number[], limit = 3): Promise<ImageNeighbour[]> {
    if (!this.tableExists) return [];
    const rows: Array<{ product_id: string; similarity: string }> = await this.dataSource.query(
      `SELECT pi."product_id", 1 - (e."embedding" <=> $2::vector) AS "similarity"
         FROM "product_embeddings" e
         JOIN "product_images" pi ON pi."id" = e."image_id"
        WHERE e."organization_id" = $1 AND pi."product_id" IS NOT NULL
        ORDER BY e."embedding" <=> $2::vector
        LIMIT $3`,
      [organizationId, toVectorLiteral(vector), limit],
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
