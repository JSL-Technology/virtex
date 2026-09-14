import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { TenantWithholdingRegime } from '../../localization/fiscal/entities/tenant-withholding-regime.entity';
import {
  CountryWithholdingScheme,
  TaxpayerType,
  WithholdingRegime,
  applicableRegimes,
  findWithholdingScheme,
} from '../../localization/fiscal/withholding-regimes';
import { BadRequestError } from '../../i18n/localized.exception';

/** What the server decided to withhold on a document, and why. */
export interface ResolvedWithholding {
  /** Fraction of the output tax withheld at source. */
  taxWithholdingRate: number;
  /** Fraction of the taxable base withheld on account of income tax. */
  incomeTaxWithholdingRate: number;
  /** The regime codes applied, recorded on the document so a filing can be traced to its rule. */
  regimeCodes: string[];
  /**
   * Set when the rates are the caller's rather than the catalogue's, with the reason given.
   *
   * An exception is legitimate — a market this product does not model, a designation that changed
   * this morning, a rate a tenant's advisor is certain of and the table is not. It is recorded
   * rather than refused, and it is never silent.
   */
  override?: { reason: string; supersededRegimeCodes: string[] };
}

/** What the caller may state, and the justification that makes it acceptable. */
export interface WithholdingRequest {
  taxWithholdingRate?: number;
  incomeTaxWithholdingRate?: number;
  /** Why the stated rates differ from the ones the regimes produce. */
  withholdingOverrideReason?: string;
}

/**
 * Resolving withholding on the server, from the parties and the sale.
 *
 * ## What this replaces
 *
 * `taxWithholdingRate` and `incomeTaxWithholdingRate` came off the create-invoice request as any
 * fraction between 0 and 1, and nothing compared them to anything. The consumption-tax rate had
 * long been derived from the tenant's catalogue and validated against the country's scheme; the
 * withholdings — which are the amounts the buyer remits to the authority on the seller's behalf,
 * and which the seller then claims as a credit — were whatever the client sent.
 *
 * That is a filing defect in both directions. Under-withhold and the seller owes the difference
 * with penalties; over-withhold and the buyer has been charged money nobody had the authority to
 * charge. It is also unreconstructable after the fact: nothing recorded which rule, if any, the
 * figure was supposed to come from.
 *
 * ## The order of authority
 *
 * 1. A regime the tenant configured for itself. Their accountant is the authority on their
 *    filings, rates move by decree, and most of this product's markets are ones where the
 *    built-in catalogue deliberately holds nothing.
 * 2. The built-in catalogue for the tenant's country, for the markets whose regimes can be stated
 *    nationally.
 * 3. A rate stated on the request — accepted only with a reason, recorded as an override.
 *
 * A request that states a rate matching what the regimes produce is not an override; it is the
 * client agreeing with the server, and needs no justification.
 */
@Injectable()
export class WithholdingResolverService {
  private readonly logger = new Logger(WithholdingResolverService.name);

  /**
   * The withholding for a sale.
   *
   * `scope` is what the document is predominantly for. A mixed document — goods and services on
   * one invoice — is resolved as services when any line is a service, because every regime that
   * distinguishes the two withholds on services and not on goods, and applying the goods treatment
   * to a document containing services under-withholds.
   */
  async resolve(
    manager: EntityManager,
    organizationId: string,
    customer: Pick<Customer, 'id' | 'taxpayerType' | 'country'>,
    scope: 'SERVICES' | 'GOODS',
    request: WithholdingRequest,
  ): Promise<ResolvedWithholding> {
    const organization = await manager.getRepository(Organization).findOne({
      where: { id: organizationId },
      select: ['id', 'country'],
    });
    const countryCode = organization?.country ?? null;

    const regimes = await this.regimesFor(manager, organizationId, countryCode, customer, scope);
    return this.reconcile(regimes, request, organizationId, `cliente ${customer.id}`);
  }

  /**
   * The withholding on a PURCHASE, where the two roles are the other way round.
   *
   * On a sale the tenant is the payee and the customer is the payer — the customer is the one who
   * withholds. On a purchase the tenant pays, so the tenant is the payer and the supplier is the
   * payee. The regime table does not care which document it is looking at; it asks who pays and
   * who is paid, and this is the same lookup with the two arguments swapped.
   *
   * Until the supplier record carried a fiscal classification there was nothing to swap in: the
   * withholding on a vendor bill arrived as a free amount on the request, and nothing on the
   * server could compare it to anything. That is the same filing defect the sales side had, and it
   * fails in both directions — under-withhold and the tenant owes the difference with penalties;
   * over-withhold and money was taken from a supplier with no authority to take it.
   */
  async resolveForPurchase(
    manager: EntityManager,
    organizationId: string,
    supplier: { id: string; taxpayerType?: TaxpayerType | null; country?: string | null },
    scope: 'SERVICES' | 'GOODS',
    request: WithholdingRequest,
  ): Promise<ResolvedWithholding> {
    const organization = await manager.getRepository(Organization).findOne({
      where: { id: organizationId },
      select: ['id', 'country'],
    });
    const countryCode = organization?.country ?? null;

    const regimes = await this.purchaseRegimesFor(
      manager,
      organizationId,
      countryCode,
      supplier,
      scope,
    );
    return this.reconcile(regimes, request, organizationId, `proveedor ${supplier.id}`);
  }

  /**
   * Which regimes apply when the tenant is the one paying.
   *
   * The payer is the tenant's own classification, taken from its settings and defaulting to a
   * company — the ordinary case, and the one that withholds. The payee is the supplier's, and a
   * supplier the tenant has not classified withholds nothing automatically, exactly as an
   * unclassified customer does on the sales side.
   *
   * A supplier abroad is outside the domestic regime: a payment abroad is withheld under the rules
   * for payments abroad (the DGII's 609), which are not these and which this product does not
   * apply on its own initiative.
   */
  private async purchaseRegimesFor(
    manager: EntityManager,
    organizationId: string,
    countryCode: string | null,
    supplier: { taxpayerType?: TaxpayerType | null; country?: string | null },
    scope: 'SERVICES' | 'GOODS',
  ): Promise<WithholdingRegime[]> {
    const payee = supplier.taxpayerType ?? null;
    if (!payee || payee === TaxpayerType.FOREIGN) return [];
    if (supplier.country && countryCode && supplier.country !== countryCode) return [];

    const settings = await manager.getRepository(OrganizationSettings).findOne({
      where: { organizationId },
      select: ['organizationId', 'taxpayerType'],
    });
    const payer = settings?.taxpayerType ?? TaxpayerType.COMPANY;

    const configured = await manager.getRepository(TenantWithholdingRegime).find({
      where: { organizationId, isActive: true },
    });

    const scheme: CountryWithholdingScheme | undefined = configured.length
      ? {
          configurationRequired: false,
          regimes: this.mergeWithCatalogue(configured, countryCode),
        }
      : findWithholdingScheme(countryCode);

    return applicableRegimes(scheme, { payer, payee, scope });
  }

  /**
   * Compare what the regimes produce with what the caller stated, and decide which stands.
   *
   * Extracted from `resolve` so the purchase side cannot drift from the sales side: the rule —
   * agreement is not an override, disagreement needs a reason, and an override is recorded rather
   * than refused — is the same rule, and two copies of it would eventually be two rules.
   */
  private reconcile(
    regimes: WithholdingRegime[],
    request: WithholdingRequest,
    organizationId: string,
    party: string,
  ): ResolvedWithholding {
    const fromRegimes = this.ratesOf(regimes);

    const stated = {
      taxWithholdingRate: request.taxWithholdingRate,
      incomeTaxWithholdingRate: request.incomeTaxWithholdingRate,
    };
    const statesSomething =
      stated.taxWithholdingRate !== undefined || stated.incomeTaxWithholdingRate !== undefined;
    if (!statesSomething) return fromRegimes;

    const effective = {
      taxWithholdingRate: stated.taxWithholdingRate ?? fromRegimes.taxWithholdingRate,
      incomeTaxWithholdingRate:
        stated.incomeTaxWithholdingRate ?? fromRegimes.incomeTaxWithholdingRate,
    };

    // Six decimals, because that is the precision the column and the DTO carry. Comparing the
    // floats directly would call 0.30000000000000004 a disagreement.
    const agrees =
      this.sameRate(effective.taxWithholdingRate, fromRegimes.taxWithholdingRate) &&
      this.sameRate(effective.incomeTaxWithholdingRate, fromRegimes.incomeTaxWithholdingRate);
    if (agrees) return fromRegimes;

    if (!request.withholdingOverrideReason?.trim()) {
      throw new BadRequestError('invoices.withholding_stated_stated_not_what_applicable', {
        stated: `${effective.taxWithholdingRate} / ${effective.incomeTaxWithholdingRate}`,
        resolved: `${fromRegimes.taxWithholdingRate} / ${fromRegimes.incomeTaxWithholdingRate}`,
        regimes: fromRegimes.regimeCodes.join(', ') || '—',
      });
    }

    this.logger.warn(
      `Retención fuera de régimen en organización ${organizationId}, ${party}: ` +
        `${effective.taxWithholdingRate}/${effective.incomeTaxWithholdingRate} en lugar de ` +
        `${fromRegimes.taxWithholdingRate}/${fromRegimes.incomeTaxWithholdingRate}. ` +
        `Razón: ${request.withholdingOverrideReason.trim()}`,
    );

    return {
      ...effective,
      regimeCodes: [],
      override: {
        reason: request.withholdingOverrideReason.trim(),
        supersededRegimeCodes: fromRegimes.regimeCodes,
      },
    };
  }

  /**
   * What the tenant's country and its own configuration say applies here.
   *
   * A customer with no fiscal classification withholds nothing automatically: the classification
   * is assigned by the tax authority and recorded by the tenant, and guessing it from the tax id's
   * shape or the company name is how a product invents a filing.
   */
  private async regimesFor(
    manager: EntityManager,
    organizationId: string,
    countryCode: string | null,
    customer: Pick<Customer, 'taxpayerType' | 'country'>,
    scope: 'SERVICES' | 'GOODS',
  ): Promise<WithholdingRegime[]> {
    const payer = customer.taxpayerType ?? null;
    if (!payer) return [];

    // A buyer abroad is outside the domestic withholding regime; an export is not withheld at
    // source by the importer's authority, and this product does not model the importer's.
    if (payer === TaxpayerType.FOREIGN) return [];

    const configured = await manager.getRepository(TenantWithholdingRegime).find({
      where: { organizationId, isActive: true },
    });

    // The payee is the tenant itself, and which classification it is matters: a negocio de único
    // dueño, a persona natural con RUC or a monotributista is a natural person for withholding
    // purposes, and their corporate customers withhold from them at rates that do not apply
    // between companies. Assuming a company would under-withhold on every invoice they issue.
    const settings = await manager.getRepository(OrganizationSettings).findOne({
      where: { organizationId },
      select: ['organizationId', 'taxpayerType'],
    });
    const payee = settings?.taxpayerType ?? TaxpayerType.COMPANY;

    const scheme: CountryWithholdingScheme | undefined = configured.length
      ? {
          configurationRequired: false,
          regimes: this.mergeWithCatalogue(configured, countryCode),
        }
      : findWithholdingScheme(countryCode);

    return applicableRegimes(scheme, { payer, payee, scope });
  }

  /**
   * The tenant's own regimes, plus the built-in ones they have not replaced.
   *
   * "Replaced" means same kind, same payer set and same scope: a tenant that configures its own
   * VAT withholding for government payers has decided what that case is, and leaving the built-in
   * rule beside it would make which one applies depend on array order.
   */
  private mergeWithCatalogue(
    configured: TenantWithholdingRegime[],
    countryCode: string | null,
  ): WithholdingRegime[] {
    const own: WithholdingRegime[] = configured.map((row) => ({
      code: row.code,
      kind: row.kind,
      rate: Number(row.rate),
      payers: row.payers,
      payees: row.payees?.length ? row.payees : undefined,
      scope: row.scope,
      label: row.label,
      legalBasis: row.legalBasis,
    }));

    const builtIn = findWithholdingScheme(countryCode);
    if (!builtIn || builtIn.configurationRequired) return own;

    const replaced = new Set(own.map((regime) => this.slotOf(regime)));
    return [...own, ...builtIn.regimes.filter((regime) => !replaced.has(this.slotOf(regime)))];
  }

  private slotOf(regime: WithholdingRegime): string {
    return `${regime.kind}|${[...regime.payers].sort().join(',')}|${regime.scope}`;
  }

  private ratesOf(regimes: WithholdingRegime[]): ResolvedWithholding {
    const of = (kind: 'VAT' | 'INCOME') =>
      regimes.find((regime) => regime.kind === kind)?.rate ?? 0;

    return {
      taxWithholdingRate: of('VAT'),
      incomeTaxWithholdingRate: of('INCOME'),
      regimeCodes: regimes.map((regime) => regime.code),
    };
  }

  private sameRate(a: number, b: number): boolean {
    return Math.round(a * 1_000_000) === Math.round(b * 1_000_000);
  }
}
