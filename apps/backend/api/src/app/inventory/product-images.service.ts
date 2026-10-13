import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { ProductImage } from './entities/product-image.entity';
import { Product } from './entities/product.entity';
import { ProductCategory } from './entities/product-category.entity';
import { StorageService } from '../storage/storage.service';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { standardSalesTaxRate } from './contracts/sellable-product.contract';
import {
  CatalogContext,
  PricingHint,
  ProductCatalogPort,
  ProductImageUpload,
  ProductMatch,
  StoredProductImage,
} from './contracts/product-catalog.contract';

/** The longest side an image is kept at. It is also the size vision models read at without downscaling. */
const MAX_EDGE_PX = 1568;

/** Decoded size refused beyond this: a 10 MB file can decompress to gigabytes ("decompression bomb"). */
const MAX_INPUT_PIXELS = 50_000_000;

/** Formats accepted, by what the bytes ARE — the declared MIME type is the client's opinion. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff']);

/**
 * Product photos, and the catalogue questions a photo-assisted form needs answered.
 *
 * Every image is re-encoded before it is stored. That is not a cosmetic step:
 *
 *  - **Privacy.** A phone photo carries EXIF, often with the GPS position of the shop or the
 *    employee's home. Re-encoding drops all of it; nothing of the original file survives.
 *  - **Safety.** The bytes are decoded by an image library before anything else trusts them, so a
 *    file that merely claims to be a JPEG is refused, and the pixel limit stops decompression bombs.
 *  - **Orientation.** The EXIF rotation is applied to the pixels first, so a portrait photo is not
 *    stored — and read by a model — on its side.
 *  - **Cost.** A 12-megapixel photo is resized to the size vision models read at anyway.
 */
@Injectable()
export class ProductImagesService implements ProductCatalogPort {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    @InjectRepository(ProductImage) private readonly images: Repository<ProductImage>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(ProductCategory) private readonly categories: Repository<ProductCategory>,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  async storeImage(
    organizationId: string,
    userId: string | null,
    upload: ProductImageUpload,
  ): Promise<StoredProductImage> {
    let normalised: { data: Buffer; info: { width: number; height: number } };
    try {
      const probe = sharp(upload.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
      const metadata = await probe.metadata();
      if (!metadata.format || !ACCEPTED_FORMATS.has(metadata.format)) {
        throw new Error(`unsupported format ${metadata.format}`);
      }
      normalised = await sharp(upload.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false })
        .rotate()
        .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } catch (error) {
      this.logger.warn(`Rejected product image upload: ${(error as Error).message}`);
      throw new BadRequestError('inventory.product_image.not_an_image');
    }

    const sha256 = createHash('sha256').update(normalised.data).digest('hex');

    // The same picture uploaded again — a retry, a double click — is the same stored object.
    const existing = await this.images.findOne({ where: { organizationId, sha256, productId: IsNull() } });
    if (existing) {
      return {
        id: existing.id,
        sha256,
        mimeType: 'image/jpeg',
        width: normalised.info.width,
        height: normalised.info.height,
        data: normalised.data,
      };
    }

    const stored = await this.storage.upload(
      { fileName: `${sha256}.jpg`, mimeType: 'image/jpeg', buffer: normalised.data },
      `product-images/${organizationId}`,
    );
    const image = await this.images.save(
      this.images.create({
        organizationId,
        productId: null,
        storageKey: stored.storageKey,
        mimeType: 'image/jpeg',
        fileSize: normalised.data.length,
        width: normalised.info.width,
        height: normalised.info.height,
        sha256,
        isPrimary: false,
        uploadedByUserId: userId,
      }),
    );

    return {
      id: image.id,
      sha256,
      mimeType: 'image/jpeg',
      width: normalised.info.width,
      height: normalised.info.height,
      data: normalised.data,
    };
  }

  /**
   * Give a new product the photos it was created from.
   *
   * Only images of this tenant that no product has claimed yet: an image id from another tenant is
   * invisible here, and one already on a product cannot be stolen by naming it. The first becomes
   * the primary image and the product's display URL.
   */
  async claimImages(
    manager: EntityManager,
    organizationId: string,
    productId: string,
    imageIds: string[],
  ): Promise<string | null> {
    if (!imageIds.length) return null;
    const unique = [...new Set(imageIds)];
    const images = await manager.find(ProductImage, {
      where: { organizationId, id: In(unique), productId: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (images.length !== unique.length) {
      throw new NotFoundError('inventory.product_image.not_found');
    }
    const ordered = unique.map((id) => images.find((image) => image.id === id)!);
    for (const [index, image] of ordered.entries()) {
      image.productId = productId;
      image.isPrimary = index === 0;
    }
    await manager.save(ordered);
    return this.storage.getUrl(ordered[0].storageKey);
  }

  async listForProduct(
    organizationId: string,
    productId: string,
  ): Promise<Array<{ id: string; url: string; isPrimary: boolean; width: number | null; height: number | null }>> {
    const images = await this.images.find({
      where: { organizationId, productId },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
    return Promise.all(
      images.map(async (image) => ({
        id: image.id,
        url: await this.storage.getUrl(image.storageKey),
        isPrimary: image.isPrimary,
        width: image.width,
        height: image.height,
      })),
    );
  }

  async catalogContext(organizationId: string): Promise<CatalogContext> {
    const categories = await this.categories.find({
      where: { organizationId, isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const byId = new Map(categories.map((category) => [category.id, category]));
    const pathOf = (category: ProductCategory): string => {
      const names: string[] = [];
      let cursor: ProductCategory | undefined = category;
      // Bounded: the tree is at most five deep (ProductCategoriesService), and a cycle cannot loop.
      for (let depth = 0; cursor && depth < 8; depth++) {
        names.unshift(cursor.name);
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
      return names.join(' › ');
    };

    const units: Array<{ symbol: string; category: string }> = await this.dataSource.query(
      `SELECT "symbol", "category" FROM "unit_of_measure" ORDER BY "category", "symbol"`,
    );
    const brands: Array<{ brand: string }> = await this.dataSource.query(
      `SELECT "brand" FROM "products"
        WHERE "organization_id" = $1 AND "brand" IS NOT NULL
        GROUP BY "brand" ORDER BY COUNT(*) DESC, "brand" LIMIT 200`,
      [organizationId],
    );

    return {
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        path: pathOf(category),
      })),
      units,
      brands: brands.map((row) => row.brand),
      standardTaxRate: await standardSalesTaxRate(this.dataSource.manager, organizationId),
    };
  }

  async findLikelyDuplicates(
    organizationId: string,
    probe: { barcode?: string | null; name?: string | null; brand?: string | null },
  ): Promise<ProductMatch[]> {
    const matches = new Map<string, ProductMatch>();
    const toMatch = (product: Product, reason: ProductMatch['reason'], similarity: number): ProductMatch => ({
      id: product.id,
      name: product.name,
      sku: product.sku ?? null,
      barcode: product.barcode ?? null,
      brand: product.brand ?? null,
      imageUrl: product.imageUrl ?? null,
      reason,
      similarity,
    });

    const barcode = probe.barcode?.trim();
    if (barcode) {
      const product = await this.products.findOne({ where: { organizationId, barcode } });
      if (product) matches.set(product.id, toMatch(product, 'barcode', 1));
    }

    const name = probe.name?.trim();
    if (name) {
      // Word overlap, in the database: the significant words of the proposed name, each required.
      // Coarse on purpose — this asks a person "is it one of these?", it does not decide.
      const words = name
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 3)
        .slice(0, 4);
      if (words.length) {
        const conditions = words.map((_, index) => `lower("name") LIKE $${index + 2}`).join(' AND ');
        const rows: Product[] = await this.products.query(
          `SELECT "id", "name", "sku", "barcode", "brand", "image_url" AS "imageUrl"
             FROM "products" WHERE "organization_id" = $1 AND ${conditions} LIMIT 5`,
          [organizationId, ...words.map((word) => `%${word.replace(/[%_\\]/g, '\\$&')}%`)],
        );
        for (const row of rows) {
          if (!matches.has(row.id)) matches.set(row.id, toMatch(row, 'name', 0.6));
        }
      }
    }

    return [...matches.values()].sort((a, b) => b.similarity - a.similarity);
  }

  async describeProducts(organizationId: string, ids: string[]): Promise<ProductMatch[]> {
    if (!ids.length) return [];
    const products = await this.products.find({ where: { organizationId, id: In(ids) } });
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku ?? null,
      barcode: product.barcode ?? null,
      brand: product.brand ?? null,
      imageUrl: product.imageUrl ?? null,
      reason: 'name',
      similarity: 0,
    }));
  }

  async pricingHint(organizationId: string, categoryId: string | null): Promise<PricingHint> {
    const rows: Array<{ markup: string | null; n: string }> = await this.dataSource.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "price" / "cost") AS "markup", COUNT(*) AS "n"
         FROM "products"
        WHERE "organization_id" = $1 AND "cost" > 0 AND "price" > 0
          AND ($2::uuid IS NULL OR "category_id" = $2::uuid)`,
      [organizationId, categoryId],
    );
    const sampleSize = Number(rows[0]?.n ?? 0);
    const markup = rows[0]?.markup === null || rows[0]?.markup === undefined ? null : Number(rows[0].markup);
    // Fewer than three products is an anecdote, not a typical markup.
    return { typicalMarkup: sampleSize >= 3 ? markup : null, sampleSize };
  }
}
