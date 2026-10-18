import { Injectable } from '@nestjs/common';

/**
 * The master records data-quality checks for duplicates, offered by the modules that own them.
 *
 * Customers belong to sales, suppliers to purchasing, products to inventory; the duplicate check
 * reads all three without importing any — each registers a source here, with the permissions that
 * guard reading and editing its records, exactly as datasets register for import and export.
 */
export type DuplicateEntityType = 'CUSTOMER' | 'SUPPLIER' | 'PRODUCT';

export interface DuplicateRecord {
  id: string;
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  /** A product's SKU, or any code the owner uses. */
  code?: string | null;
  barcode?: string | null;
}

export interface DuplicateSource {
  type: DuplicateEntityType;
  /** Needed to see this type's suggestions. */
  viewPermission: string;
  /** Needed to decide on them. */
  editPermission: string;
  /** Active records, a page at a time, in a stable order. */
  records(organizationId: string, offset: number, limit: number): Promise<DuplicateRecord[]>;
  /** The client route that opens one record. */
  link(id: string): string;
}

@Injectable()
export class DuplicateSourceRegistry {
  private readonly sources = new Map<DuplicateEntityType, DuplicateSource>();

  register(source: DuplicateSource): void {
    this.sources.set(source.type, source);
  }

  get(type: DuplicateEntityType): DuplicateSource | undefined {
    return this.sources.get(type);
  }

  all(): DuplicateSource[] {
    return [...this.sources.values()].sort((a, b) => a.type.localeCompare(b.type));
  }
}
