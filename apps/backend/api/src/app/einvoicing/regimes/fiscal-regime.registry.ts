import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { FiscalRegimeAdapter } from './fiscal-regime.types';
import { CfdiRegimeAdapter } from './mx/cfdi.adapter';
import { DianRegimeAdapter } from './co/dian.adapter';
import { SunatRegimeAdapter } from './pe/sunat.adapter';
import { SriRegimeAdapter } from './ec/sri.adapter';
import { SiiRegimeAdapter } from './cl/sii.adapter';
import { NfeRegimeAdapter } from './br/nfe.adapter';
import { AfipRegimeAdapter } from './ar/afip.adapter';

/**
 * Which electronic-invoicing regime applies to a tenant, if any.
 *
 * ## Why `null` is a first-class answer
 *
 * Twelve of the nineteen markets this product is sold in have no regime implemented, and the
 * United States has none to implement — a US sales invoice carries no fiscal stamp at all, which
 * is not a gap. Returning `null` for those says so, and the caller issues the document without
 * transmitting anything.
 *
 * The Dominican Republic is deliberately absent from this table. Its regime predates this
 * interface, runs through `EcfSubmissionService` and has been in production longest; rewriting a
 * working implementation to share a shape with six that are not yet proven would put the one
 * market that works at risk for the tidiness of the six that do not.
 */
@Injectable()
export class FiscalRegimeRegistry {
  private readonly byCountry: ReadonlyMap<string, FiscalRegimeAdapter>;

  constructor(
    cfdi: CfdiRegimeAdapter,
    dian: DianRegimeAdapter,
    sunat: SunatRegimeAdapter,
    sri: SriRegimeAdapter,
    sii: SiiRegimeAdapter,
    nfe: NfeRegimeAdapter,
    afip: AfipRegimeAdapter,
  ) {
    this.byCountry = new Map<string, FiscalRegimeAdapter>([
      ['MX', cfdi],
      ['CO', dian],
      ['PE', sunat],
      ['EC', sri],
      ['CL', sii],
      ['BR', nfe],
      ['AR', afip],
    ]);
  }

  /** The regime for a market, or null where none applies. */
  forCountry(countryCode: string | null | undefined): FiscalRegimeAdapter | null {
    return this.byCountry.get((countryCode ?? '').toUpperCase()) ?? null;
  }

  /** The regime for a tenant, resolved inside the caller's transaction when one is given. */
  async forOrganization(
    organizationId: string,
    manager: EntityManager,
  ): Promise<FiscalRegimeAdapter | null> {
    const organization = await manager.findOne(Organization, {
      where: { id: organizationId },
      select: ['id', 'country'],
    });
    return this.forCountry(organization?.country ?? null);
  }

  /** The markets whose regime is implemented, for the coverage table to stay honest against. */
  implementedCountries(): readonly string[] {
    return [...this.byCountry.keys()];
  }
}
