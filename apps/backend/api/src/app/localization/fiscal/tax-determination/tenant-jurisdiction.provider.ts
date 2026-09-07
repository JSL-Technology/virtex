import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import {
  JurisdictionLevel,
  SourcingRule,
  TaxJurisdiction,
} from '../entities/tax-jurisdiction.entity';
import {
  TaxDetermination,
  TaxDeterminationAddress,
  TaxDeterminationProvider,
  TaxDeterminationRequest,
  TaxRateComponent,
} from './tax-determination.types';

/**
 * Determination from the jurisdictions the tenant has registered in.
 *
 * Correct and sufficient for a business with nexus in a handful of states — which is most of the
 * businesses this product serves — and it works from the first day with nobody else involved. A
 * tenant whose footprint outgrows a table they maintain by hand connects a provider instead; this
 * one then answers only where that provider does not.
 *
 * ## The rules it implements
 *
 * **Sourcing.** Most states are destination-sourced: the rate is the buyer's. A minority source
 * intrastate sales to the seller's address. Which one applies is a property of the state, recorded
 * on its own row, because getting it wrong produces a return that is wrong by the difference
 * between two towns every month rather than an error anybody notices.
 *
 * **Nexus.** A rate the tenant is not registered to collect is not collected. Post-*Wayfair*
 * economic nexus depends on the tenant's sales volume into the state, which is their determination
 * to make and not this product's to guess, so registration is recorded rather than inferred. A
 * destination with no registered state row is sold untaxed and the document records that this —
 * not an exemption, not a zero rate — is why.
 *
 * **Specificity.** A row naming a postal code beats one naming a city, which beats one naming a
 * county, at the same level. A ZIP is not a jurisdiction (one can straddle two cities), so it
 * narrows a row rather than defining one.
 */
@Injectable()
export class TenantJurisdictionProvider implements TaxDeterminationProvider {
  readonly source = 'tenant-jurisdictions';

  constructor(private readonly dataSource: DataSource) {}

  /** Every country: a tenant may register jurisdictions anywhere it has an obligation. */
  supports(): boolean {
    return true;
  }

  async determine(request: TaxDeterminationRequest): Promise<TaxDetermination> {
    const country = request.destination.countryCode?.toUpperCase();
    if (!country) {
      return this.undeterminable('LOCALIZATION.DETERMINACION_SIN_PAIS_DESTINO');
    }

    const rows = await this.dataSource.getRepository(TaxJurisdiction).find({
      where: [
        { organizationId: request.organizationId, countryCode: country, effectiveTo: IsNull() },
        { organizationId: request.organizationId, countryCode: country },
      ],
    });
    const inForce = rows.filter(
      (row) =>
        row.effectiveFrom <= request.asOf &&
        (row.effectiveTo === null || row.effectiveTo >= request.asOf),
    );
    if (inForce.length === 0) {
      // Nothing registered anywhere in the country. Not an error: a seller with no obligation
      // collects nothing, and saying so is more useful than a zero with no explanation.
      return {
        rate: 0,
        components: [],
        outcome: 'NO_NEXUS',
        reasonKey: 'LOCALIZATION.SIN_JURISDICCIONES_REGISTRADAS_PAIS',
        reasonParams: { countryCode: country },
        source: this.source,
      };
    }

    const destination = request.destination;
    if (!destination.stateCode) {
      // The state is the minimum: no rate in these markets is nationwide, so an address without
      // one cannot be priced. Guessing is what this replaces.
      return this.undeterminable('LOCALIZATION.DETERMINACION_REQUIERE_DIVISION', {
        countryCode: country,
      });
    }

    const stateRows = inForce.filter(
      (row) => row.stateCode.toUpperCase() === destination.stateCode?.toUpperCase(),
    );
    const stateRow = stateRows.find((row) => row.level === JurisdictionLevel.STATE);

    if (!stateRow || !stateRow.isRegistered) {
      return {
        rate: 0,
        components: [],
        outcome: 'NO_NEXUS',
        reasonKey: 'LOCALIZATION.SIN_REGISTRO_EN_JURISDICCION',
        reasonParams: { stateCode: destination.stateCode, countryCode: country },
        source: this.source,
      };
    }

    // Origin sourcing applies to a sale that stays inside the state; a sale crossing a state line
    // is destination-sourced everywhere.
    const origin = request.origin;
    const intrastate =
      origin?.stateCode?.toUpperCase() === destination.stateCode.toUpperCase();
    const applicable =
      stateRow.sourcing === SourcingRule.ORIGIN && intrastate && origin ? origin : destination;

    const components: TaxRateComponent[] = [
      { level: JurisdictionLevel.STATE, name: stateRow.name, rate: Number(stateRow.rate) },
    ];

    for (const level of [
      JurisdictionLevel.COUNTY,
      JurisdictionLevel.CITY,
      JurisdictionLevel.SPECIAL,
    ]) {
      const best = this.mostSpecific(stateRows, level, applicable);
      if (best && best.isRegistered) {
        components.push({ level, name: best.name, rate: Number(best.rate) });
      }
    }

    // Summed in millionths: these are fractions with six decimals, and adding four of them as
    // floats produces a rate that is not any of the rates the tenant registered.
    const millionths = components.reduce(
      (total, component) => total + Math.round(component.rate * 1_000_000),
      0,
    );

    return {
      rate: millionths / 1_000_000,
      components,
      outcome: 'DETERMINED',
      source: this.source,
    };
  }

  /**
   * The row that most specifically matches the address at one level.
   *
   * A postal code narrows; it does not define. So a row carrying one wins only when it matches,
   * and a row carrying none is the fallback for the same city or county.
   */
  private mostSpecific(
    rows: TaxJurisdiction[],
    level: JurisdictionLevel,
    address: TaxDeterminationAddress,
  ): TaxJurisdiction | undefined {
    const same = (a: string | null | undefined, b: string | null | undefined) =>
      (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

    const candidates = rows.filter((row) => {
      if (row.level !== level) return false;
      if (level === JurisdictionLevel.COUNTY && !same(row.county, address.county)) return false;
      if (level === JurisdictionLevel.CITY && !same(row.city, address.city)) return false;
      if (level === JurisdictionLevel.SPECIAL) {
        // A special district is named by whichever of county or city the row states; a row that
        // states neither covers the whole state.
        if (row.county && !same(row.county, address.county)) return false;
        if (row.city && !same(row.city, address.city)) return false;
      }
      if (row.postalCode && !same(row.postalCode, address.postalCode)) return false;
      return true;
    });

    return candidates.sort(
      (a, b) => Number(Boolean(b.postalCode)) - Number(Boolean(a.postalCode)),
    )[0];
  }

  private undeterminable(reasonKey: string, reasonParams?: Record<string, unknown>): TaxDetermination {
    return { rate: 0, components: [], outcome: 'NOT_DETERMINABLE', reasonKey, reasonParams, source: this.source };
  }
}
