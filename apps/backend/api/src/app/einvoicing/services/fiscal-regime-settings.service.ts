import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { FiscalRegimeSettings } from '../entities/fiscal-regime-settings.entity';
import { FiscalDocumentRange } from '../entities/fiscal-document-range.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { FiscalRangeService } from './fiscal-range.service';
import {
  RegisterFiscalRangeDto,
  UpsertFiscalRegimeSettingsDto,
} from '../dto/fiscal-regime-settings.dto';
import { BadRequestError } from '../../i18n/localized.exception';

/** A range as it is safe to show: everything except the secret. */
export interface FiscalRangeView {
  id: string;
  documentType: string;
  series: string;
  startsAt: number;
  endsAt: number;
  currentSequence: number;
  remaining: number;
  isActive: boolean;
  validUntil: string | null;
  authorizationCode: string | null;
  /** Whether the range carries the material the authority issued with it, never the material. */
  hasSecret: boolean;
  secretKind: string | null;
}

/**
 * The tenant's own e-invoicing configuration: the regime settings, and the ranges they were
 * authorised to issue from.
 *
 * ## The country is not a parameter
 *
 * Both are keyed by the tenant's own country, read from the organization rather than taken from
 * the request. A tenant configuring a Chilean CAF against a Colombian resolution is not a scenario
 * worth supporting, and accepting a country from the caller would let one tenant's misconfiguration
 * look exactly like another tenant's legitimate setup.
 */
@Injectable()
export class FiscalRegimeSettingsService {
  constructor(
    @InjectRepository(FiscalRegimeSettings)
    private readonly settings: Repository<FiscalRegimeSettings>,
    @InjectRepository(FiscalDocumentRange)
    private readonly ranges: Repository<FiscalDocumentRange>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    private readonly rangeService: FiscalRangeService,
    private readonly dataSource: DataSource,
  ) {}

  /** The tenant's market, or a refusal: nothing here is meaningful without one. */
  private async countryOf(organizationId: string): Promise<string> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
      select: ['id', 'country'],
    });
    const country = (organization?.country ?? '').toUpperCase();
    if (!country) throw new BadRequestError('EINVOICING.ORGANIZACION_SIN_PAIS');
    return country;
  }

  async find(organizationId: string): Promise<FiscalRegimeSettings | null> {
    const countryCode = await this.countryOf(organizationId);
    return this.settings.findOne({ where: { organizationId, countryCode } });
  }

  async upsert(
    organizationId: string,
    dto: UpsertFiscalRegimeSettingsDto,
  ): Promise<FiscalRegimeSettings> {
    const countryCode = await this.countryOf(organizationId);
    const existing = await this.settings.findOne({ where: { organizationId, countryCode } });

    const row = existing ?? this.settings.create({ organizationId, countryCode });
    Object.assign(row, dto);
    return this.settings.save(row);
  }

  /**
   * Every range the tenant holds, without the secrets.
   *
   * Superseded ranges are included: they are what past documents were drawn from, and an inspector
   * asking which authorisation covered a document from March needs to see the row.
   */
  async listRanges(organizationId: string): Promise<FiscalRangeView[]> {
    const countryCode = await this.countryOf(organizationId);
    const rows = await this.ranges.find({
      where: { organizationId, countryCode },
      order: { isActive: 'DESC', documentType: 'ASC', startsAt: 'ASC' },
    });

    return rows.map((range) => ({
      id: range.id,
      documentType: range.documentType,
      series: range.series,
      startsAt: Number(range.startsAt),
      endsAt: Number(range.endsAt),
      currentSequence: Number(range.currentSequence),
      remaining: Math.max(0, Number(range.endsAt) - Number(range.currentSequence)),
      isActive: range.isActive,
      validUntil: range.validUntil ?? null,
      authorizationCode: range.authorizationCode ?? null,
      // Whether there is one, never what it is. A CAF read back out of an API is a CAF that can
      // be used to stamp documents in the taxpayer's name.
      hasSecret: Boolean(range.encryptedSecret),
      secretKind: range.secretKind ?? null,
    }));
  }

  /** Register a range the authority granted, superseding any active one for the same series. */
  async registerRange(
    organizationId: string,
    dto: RegisterFiscalRangeDto,
  ): Promise<FiscalRangeView> {
    const countryCode = await this.countryOf(organizationId);

    if (dto.secret && !dto.secretKind) {
      throw new BadRequestError('EINVOICING.RANGO_FISCAL_SECRETO_SIN_TIPO');
    }

    const range = await this.dataSource.transaction((manager) =>
      this.rangeService.register(manager, {
        organizationId,
        countryCode,
        documentType: dto.documentType,
        series: dto.series ?? '',
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        validUntil: dto.validUntil ?? null,
        authorizationCode: dto.authorizationCode ?? null,
        secret: dto.secret ?? null,
        secretKind: dto.secretKind ?? null,
      }),
    );

    return {
      id: range.id,
      documentType: range.documentType,
      series: range.series,
      startsAt: Number(range.startsAt),
      endsAt: Number(range.endsAt),
      currentSequence: Number(range.currentSequence),
      remaining: Math.max(0, Number(range.endsAt) - Number(range.currentSequence)),
      isActive: range.isActive,
      validUntil: range.validUntil ?? null,
      authorizationCode: range.authorizationCode ?? null,
      hasSecret: Boolean(range.encryptedSecret),
      secretKind: range.secretKind ?? null,
    };
  }

  /**
   * Retire a range.
   *
   * Deactivation, never deletion. The row is the authorisation a past document was issued under,
   * and deleting it destroys the only record of which permission covered which document — which is
   * precisely what an inspection asks for.
   */
  async deactivateRange(organizationId: string, rangeId: string): Promise<void> {
    const countryCode = await this.countryOf(organizationId);
    const result = await this.ranges.update(
      { id: rangeId, organizationId, countryCode },
      { isActive: false },
    );
    if (!result.affected) {
      throw new BadRequestError('EINVOICING.RANGO_FISCAL_NO_ENCONTRADO');
    }
  }
}
