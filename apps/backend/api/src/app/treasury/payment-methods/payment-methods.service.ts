import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentMethod } from '../entities/payment-method.entity';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from '../dto/payment-method.dto';
import { ConflictError, ForbiddenError, NotFoundError } from '../../i18n/localized.exception';
import { TenantCountryResolver } from '../../shared/tenancy/tenant-country.resolver';
import { countryPackFor } from '../../contracts/country-pack/country-pack';

/**
 * The company's payment methods.
 *
 * Who may shape the list is the market's answer, not this service's: the country pack says whether
 * the catalogue is the authority's (`AUTHORITY_FIXED` — the DGII's 606 codes) or the company's
 * (`EDITABLE`). In a fixed market nothing is added, renamed or retired, because the authority's
 * report accepts those codes and no others; everywhere else the company adds ACH or Zelle, renames
 * «Card» to what its terminal prints, and retires what it stopped accepting.
 *
 * Methods are retired, never deleted: an invoice or a bill that recorded `ZELLE` must still be able
 * to say what it was paid with.
 */
@Injectable()
export class PaymentMethodsService {
  constructor(
    @InjectRepository(PaymentMethod) private readonly methods: Repository<PaymentMethod>,
    private readonly tenantCountry: TenantCountryResolver,
  ) {}

  async findAll(organizationId: string, includeInactive = true): Promise<PaymentMethod[]> {
    return this.methods.find({
      where: includeInactive ? { organizationId } : { organizationId, isActive: true },
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
  }

  async create(dto: CreatePaymentMethodDto, organizationId: string): Promise<PaymentMethod> {
    await this.assertEditable(organizationId);
    const code = normalizeCode(dto.code);
    const taken = await this.methods.exists({ where: { organizationId, code } });
    if (taken) throw new ConflictError('treasury.payment_method_code_taken', { code });

    return this.methods.save(
      this.methods.create({
        organizationId,
        code,
        name: dto.name.trim(),
        kind: dto.kind,
        fiscalCode: dto.fiscalCode?.trim() || null,
        isSystem: false,
        isActive: true,
        sortOrder: dto.sortOrder ?? (await this.nextSortOrder(organizationId)),
      }),
    );
  }

  async update(id: string, dto: UpdatePaymentMethodDto, organizationId: string): Promise<PaymentMethod> {
    const method = await this.methods.findOne({ where: { id, organizationId } });
    if (!method) throw new NotFoundError('treasury.payment_method_not_found');
    await this.assertEditable(organizationId);
    // A row an authority catalogue seeded is that authority's, in any market.
    if (method.isSystem) throw new ForbiddenError('treasury.payment_method_fixed_by_authority');
    // The code is what past documents recorded; changing it would orphan them.
    if (dto.code !== undefined && normalizeCode(dto.code) !== method.code) {
      throw new ConflictError('treasury.payment_method_code_immutable', { code: method.code });
    }

    if (dto.name !== undefined) method.name = dto.name.trim();
    if (dto.kind !== undefined) method.kind = dto.kind;
    if (dto.fiscalCode !== undefined) method.fiscalCode = dto.fiscalCode?.trim() || null;
    if (dto.sortOrder !== undefined) method.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) method.isActive = dto.isActive;
    return this.methods.save(method);
  }

  /**
   * Refuses a change in a market whose authority fixes the catalogue.
   *
   * Said with the authority's name, because «you cannot edit this» explains nothing and «the DGII
   * fixes these codes for the 606» explains everything.
   */
  private async assertEditable(organizationId: string): Promise<void> {
    const pack = countryPackFor(await this.tenantCountry.resolveOrNull(organizationId));
    if (pack.paymentMethods.catalogue === 'AUTHORITY_FIXED') {
      throw new ForbiddenError('treasury.payment_methods_fixed_in_market', {
        authority: pack.paymentMethods.authority ?? '',
      });
    }
  }

  private async nextSortOrder(organizationId: string): Promise<number> {
    const [row] = await this.methods.query(
      `SELECT COALESCE(MAX("sort_order"), 0) + 10 AS next FROM "payment_methods" WHERE "organization_id" = $1`,
      [organizationId],
    );
    return Number(row?.next ?? 10);
  }
}

/** `ach` and ` Ach ` are the same code. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
