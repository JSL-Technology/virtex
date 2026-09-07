import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantWithholdingRegime } from '../fiscal/entities/tenant-withholding-regime.entity';
import {
  CreateWithholdingRegimeDto,
  UpdateWithholdingRegimeDto,
} from '../dto/withholding-regime.dto';
import { BadRequestError, NotFoundError } from '../../i18n/localized.exception';

/**
 * The withholding regimes a tenant maintains for itself.
 *
 * Most of this product's markets are ones where the built-in catalogue deliberately holds nothing,
 * because the rate turns on a municipality, an activity code or a designation the authority
 * publishes per taxpayer. Those tenants have real obligations and no built-in regime to meet them
 * with, and until this existed their only option was stating a rate per document — which is the
 * defect the whole withholding change was about.
 */
@Injectable()
export class WithholdingRegimesService {
  constructor(
    @InjectRepository(TenantWithholdingRegime)
    private readonly regimes: Repository<TenantWithholdingRegime>,
  ) {}

  list(organizationId: string): Promise<TenantWithholdingRegime[]> {
    return this.regimes.find({
      where: { organizationId },
      order: { kind: 'ASC', code: 'ASC' },
    });
  }

  async create(
    dto: CreateWithholdingRegimeDto,
    organizationId: string,
  ): Promise<TenantWithholdingRegime> {
    this.assertPayers(dto.payers);
    return this.regimes.save(
      this.regimes.create({ ...dto, organizationId, payees: dto.payees ?? [] }),
    );
  }

  async update(
    id: string,
    dto: UpdateWithholdingRegimeDto,
    organizationId: string,
  ): Promise<TenantWithholdingRegime> {
    const row = await this.regimes.findOne({ where: { id, organizationId } });
    if (!row) throw new NotFoundError('LOCALIZATION.REGIMEN_RETENCION_NO_ENCONTRADO');
    if (dto.payers) this.assertPayers(dto.payers);
    return this.regimes.save(this.regimes.merge(row, dto));
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const row = await this.regimes.findOne({ where: { id, organizationId } });
    if (!row) throw new NotFoundError('LOCALIZATION.REGIMEN_RETENCION_NO_ENCONTRADO');
    // Deactivating keeps a regime out of new documents while leaving the ones it priced explicable.
    // Deleting is for a row created by mistake, which never applied to anything.
    await this.regimes.delete({ id, organizationId });
  }

  /** A regime with no payer applies to nobody, which is a configuration mistake, not a rule. */
  private assertPayers(payers: string[] | undefined): void {
    if (!payers || payers.length === 0) {
      throw new BadRequestError('LOCALIZATION.REGIMEN_RETENCION_SIN_PAGADOR');
    }
  }
}
