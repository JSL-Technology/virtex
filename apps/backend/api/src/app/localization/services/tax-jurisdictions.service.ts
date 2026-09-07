import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaxJurisdiction } from '../fiscal/entities/tax-jurisdiction.entity';
import {
  CreateTaxJurisdictionDto,
  UpdateTaxJurisdictionDto,
} from '../dto/tax-jurisdiction.dto';
import { BadRequestError, NotFoundError } from '../../i18n/localized.exception';

/**
 * The jurisdictions a tenant is registered to collect tax in.
 *
 * Small on purpose: the value is in the determination that reads these rows, not in the CRUD that
 * maintains them. A business with nexus in three states keeps three to nine rows here and gets
 * correct pricing; the alternative was a rate the client put on the request with nothing checking
 * it.
 */
@Injectable()
export class TaxJurisdictionsService {
  constructor(
    @InjectRepository(TaxJurisdiction)
    private readonly jurisdictions: Repository<TaxJurisdiction>,
  ) {}

  list(organizationId: string): Promise<TaxJurisdiction[]> {
    return this.jurisdictions.find({
      where: { organizationId },
      order: { countryCode: 'ASC', stateCode: 'ASC', level: 'ASC', effectiveFrom: 'DESC' },
    });
  }

  async create(dto: CreateTaxJurisdictionDto, organizationId: string): Promise<TaxJurisdiction> {
    this.assertWindow(dto.effectiveFrom, dto.effectiveTo);
    return this.jurisdictions.save(
      this.jurisdictions.create({
        ...dto,
        organizationId,
        countryCode: dto.countryCode.toUpperCase(),
        stateCode: dto.stateCode.toUpperCase(),
      }),
    );
  }

  async update(
    id: string,
    dto: UpdateTaxJurisdictionDto,
    organizationId: string,
  ): Promise<TaxJurisdiction> {
    const row = await this.jurisdictions.findOne({ where: { id, organizationId } });
    if (!row) throw new NotFoundError('LOCALIZATION.JURISDICCION_NO_ENCONTRADA');

    this.assertWindow(dto.effectiveFrom ?? row.effectiveFrom, dto.effectiveTo ?? row.effectiveTo);
    return this.jurisdictions.save(this.jurisdictions.merge(row, dto));
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const row = await this.jurisdictions.findOne({ where: { id, organizationId } });
    if (!row) throw new NotFoundError('LOCALIZATION.JURISDICCION_NO_ENCONTRADA');
    // Deleted rather than closed: a row created by mistake was never in force. A rate that changed
    // is superseded by giving the old row an `effectiveTo`, which keeps old documents priceable.
    await this.jurisdictions.delete({ id, organizationId });
  }

  private assertWindow(from: string, to: string | null | undefined): void {
    if (to && to < from) {
      throw new BadRequestError('LOCALIZATION.VIGENCIA_FIN_ANTERIOR_INICIO', { from, to });
    }
  }
}
