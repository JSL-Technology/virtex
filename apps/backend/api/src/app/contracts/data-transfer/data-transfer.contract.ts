/**
 * How a domain offers its records for export and import (QA A-10).
 *
 * The «Importar / Exportar» screens were a mock: a hard-coded history from July 2025 with made-up
 * users, and two buttons that waited 2.5 s on a timer and did nothing. Real export and import need
 * a domain's own knowledge — which columns, which permission, which rules a new customer or
 * product must pass — and the module that moves files must not depend on every domain to get it.
 *
 * So the dependency is inverted, as for closing blockers: each domain registers a
 * {@link DataTransferDataset} with the platform's registry, and `data-transfer` reads the
 * registry. Importing goes through the domain's own DTO and its own service, so a row is held to
 * exactly the rules the form holds a person to — tax-id validation, plan limits, uniqueness.
 */

/** One column of the file. */
export interface DataTransferColumn {
  /**
   * The header in the file. A PUBLIC CONTRACT: templates are saved against it, so it is a stable
   * snake_case key, never a translated label.
   */
  readonly key: string;
  /** The DTO / record property it carries. */
  readonly property: string;
  /** Whether an imported row must fill it. Shown in the template; enforced by the DTO. */
  readonly required?: boolean;
  /** A sample value for the template's example row. */
  readonly example?: string;
}

export interface DataTransferContext {
  readonly organizationId: string;
  readonly userId: string | null;
}

/** How a domain accepts rows, if it accepts them at all. */
export interface DataTransferImport<TDto extends object = object> {
  /** The permission that creating one of these by hand requires. Importing requires the same. */
  readonly createPermission: string;
  /** The DTO the domain's own create endpoint validates. */
  readonly dto: new () => TDto;
  /** A column whose value must be unique within the file and among the tenant's records. */
  readonly uniqueBy?: string;
  /** Whether the tenant already has a record with this value of {@link uniqueBy}. */
  exists?(value: string, context: DataTransferContext): Promise<boolean>;
  /**
   * The domain's rules beyond the DTO, checked WITHOUT writing (tax-id format, a referenced code
   * that must exist…). Throws a localized error to refuse the row.
   */
  check?(dto: TDto, context: DataTransferContext): Promise<void>;
  /** Creates the record through the domain's own service. */
  create(dto: TDto, context: DataTransferContext): Promise<void>;
}

export interface DataTransferDataset<TDto extends object = object> {
  /** Stable id, used in URLs and in the run history: `customers`, `products`… */
  readonly id: string;
  /** Catalogue key of its name. */
  readonly labelKey: string;
  /** Reading these records by hand requires it; exporting them requires the same. */
  readonly viewPermission: string;
  readonly columns: readonly DataTransferColumn[];
  /**
   * One page of the tenant's records, as plain objects keyed by {@link DataTransferColumn.property}.
   */
  exportPage(
    organizationId: string,
    take: number,
    skip: number,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; total: number }>;
  /** Absent: the dataset is export-only (an invoice is issued, never imported). */
  readonly import?: DataTransferImport<TDto>;
}
