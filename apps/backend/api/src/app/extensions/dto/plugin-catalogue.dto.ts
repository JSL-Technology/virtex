import { Expose, Type } from 'class-transformer';

/**
 * What the catalogue is allowed to say about a version.
 *
 * Deliberately does NOT carry `code`, `uiEntry` or `signature`. `getByName` used to return the
 * entity straight from the repository with `relations: { versions: true }`, so `extensions:view` —
 * satisfied by the `'*'` every tenant administrator holds — returned the full server-side source,
 * the full client-side source and the platform's attestation for every extension in the
 * marketplace. That is every vendor's proprietary code, handed to every customer.
 *
 * It was also the reconnaissance step for the publishing hole: read exactly what other tenants are
 * running, then publish a version that looks like it.
 *
 * `code` travels to one place only — the isolate. `uiEntry` travels to one place only — the
 * sandboxed iframe of a tenant that consented to that version, through `runtime()`.
 */
export class PluginVersionSummaryDto {
  @Expose() id: string;
  @Expose() version: string;
  @Expose() channel: string;
  @Expose() createdAt: Date;

  /** What the version declares it needs. The source that would use them is not exposed. */
  @Expose() capabilities: string[] | null;

  /** Where it contributes UI. A manifest, not code. */
  @Expose() contributes: unknown;

  /** Whether it ships a client-side UI at all — without shipping the UI itself. */
  @Expose() hasUi: boolean;

  /** Whether the platform has an attestation on file — without publishing the attestation. */
  @Expose() signed: boolean;
}

/** One extension as the marketplace lists it. */
export class PluginSummaryDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() status: string;
  @Expose() description: string | null;
  @Expose() author: string | null;

  /**
   * Who published it: `platform` for a first-party extension, `organization` for one this tenant
   * published, `third_party` for anyone else's. The publisher's organization id is deliberately
   * NOT exposed — it would enumerate tenant ids across the platform.
   */
  @Expose() publisher: 'platform' | 'organization' | 'third_party';

  @Expose() versionCount: number;

  @Expose()
  @Type(() => PluginVersionSummaryDto)
  versions?: PluginVersionSummaryDto[];
}
