import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, Repository } from 'typeorm';
import { FixedAsset, FixedAssetStatus, DepreciationMethod } from './entities/fixed-asset.entity';
import { FixedAssetDepreciation } from './entities/fixed-asset-depreciation.entity';
import { Page, resolvePaging, toPage } from '../common/pagination';
import {
  CreateFixedAssetDto,
  DisposeAssetDto,
  FixedAssetsQueryDto,
  UpdateFixedAssetDto,
} from './dto/fixed-asset.dto';
import { AssetPostingService } from './asset-posting.service';
import { DepreciationService } from './depreciation.service';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { CreateJournalEntryDto, CreateJournalEntryLineDto } from '../journal-entries/dto/create-journal-entry.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';
import { allocateDocumentNumber, DOCUMENT_SEQUENCE_SCOPE } from '../shared/numbering/document-numbers';
import { roundAmount, toCents } from '../common/money';
import { endOfMonthIso, previousDay, startOfMonthIso, yearOf, type IsoDate } from '../common/dates';
import { remainingSchedule, ScheduledCharge } from './depreciation-schedule';

/** The asset's depreciation board: what has been charged, and what remains to be. */
export interface FixedAssetSchedule {
  posted: Array<{
    periodEnd: string;
    amount: number;
    accumulatedAfter: number;
    bookValueAfter: number;
    journalEntryId: string;
  }>;
  projected: ScheduledCharge[];
}

/**
 * Fields that fix what the asset cost and how it was valued from the start. Once a month has been
 * charged here, changing them would leave the entries already posted computed on other figures —
 * a correction of cost is an improvement or an impairment, which are documents of their own.
 */
const VALUATION_FIELDS = [
  'cost',
  'acquisitionDate',
  'inServiceDate',
  'openingAccumulatedDepreciation',
  'openingDepreciatedThrough',
  'assetAccountId',
  'accumulatedDepreciationAccountId',
] as const;

/**
 * The fixed-asset register: registering, editing, retiring, and the schedule.
 *
 * The ledger side of each step is described on `FixedAsset` (registering posts nothing) and on
 * `DepreciationService` (each month's charge). A disposal is the one document here that posts.
 */
@Injectable()
export class FixedAssetsService {
  constructor(
    @InjectRepository(FixedAsset)
    private readonly fixedAssetRepository: Repository<FixedAsset>,
    private readonly dataSource: DataSource,
    private readonly assetPosting: AssetPostingService,
    private readonly journalLookup: JournalLookupService,
    private readonly depreciation: DepreciationService,
    /** Narratives in the tenant's books language; see `LedgerNarrativeService`. */
    private readonly narrative: LedgerNarrativeService = new LedgerNarrativeService(new I18nService()),
  ) {}

  async create(dto: CreateFixedAssetDto, organizationId: string, actorUserId: string | null): Promise<FixedAsset> {
    return this.dataSource.transaction(async (manager) => {
      const values = {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        branchId: dto.branchId ?? null,
        acquisitionDate: dto.acquisitionDate,
        inServiceDate: dto.inServiceDate ?? dto.acquisitionDate,
        cost: roundAmount(dto.cost),
        residualValue: roundAmount(dto.residualValue ?? 0),
        usefulLifeMonths: dto.usefulLifeMonths,
        depreciationMethod: dto.depreciationMethod ?? DepreciationMethod.STRAIGHT_LINE,
        assetAccountId: dto.assetAccountId,
        accumulatedDepreciationAccountId: dto.accumulatedDepreciationAccountId,
        depreciationExpenseAccountId: dto.depreciationExpenseAccountId ?? null,
        vendorBillId: dto.vendorBillId ?? null,
        openingAccumulatedDepreciation: roundAmount(dto.openingAccumulatedDepreciation ?? 0),
      };
      const depreciatedThrough = this.validateValuation(values, dto.openingDepreciatedThrough ?? null);
      await this.assertReferences(manager, organizationId, values);

      const number = await allocateDocumentNumber(
        manager,
        organizationId,
        DOCUMENT_SEQUENCE_SCOPE.FIXED_ASSET,
        'AF',
        yearOf(values.acquisitionDate),
      );
      const asset = manager.create(FixedAsset, {
        ...values,
        organizationId,
        number,
        accumulatedDepreciation: values.openingAccumulatedDepreciation,
        bookValue: roundAmount(values.cost - values.openingAccumulatedDepreciation),
        depreciatedThrough,
        status: FixedAssetStatus.IN_USE,
        createdByUserId: actorUserId,
      });
      return manager.save(asset);
    });
  }

  /**
   * A page of assets, newest first, narrowed by status, branch or a number/name search.
   *
   * It returned every asset the tenant owned once; a manufacturer or a hotel group carries tens of
   * thousands.
   */
  async findAll(organizationId: string, query: FixedAssetsQueryDto = {}): Promise<Page<FixedAsset>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const qb = this.fixedAssetRepository
      .createQueryBuilder('asset')
      .where('asset.organizationId = :organizationId', { organizationId });
    if (query.status) qb.andWhere('asset.status = :status', { status: query.status });
    if (query.branchId) qb.andWhere('asset.branchId = :branchId', { branchId: query.branchId });
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        new Brackets((where) =>
          where
            .where('asset.number ILIKE :term', { term: `%${escapeLike(search)}%` })
            .orWhere('asset.name ILIKE :term', { term: `%${escapeLike(search)}%` }),
        ),
      );
    }
    const [rows, total] = await qb
      .orderBy('asset.acquisitionDate', 'DESC')
      .addOrderBy('asset.number', 'DESC')
      .skip(paging.skip)
      .take(paging.take)
      .getManyAndCount();
    return toPage(rows, total, paging);
  }

  async findOne(id: string, organizationId: string): Promise<FixedAsset> {
    const asset = await this.fixedAssetRepository.findOneBy({ id, organizationId });
    if (!asset) throw new NotFoundError('fixed_assets.fixed_asset_id_not_found', { id });
    return asset;
  }

  /** The months charged here, and the projection of the ones left. */
  async schedule(id: string, organizationId: string): Promise<FixedAssetSchedule> {
    const asset = await this.findOne(id, organizationId);
    const posted = await this.dataSource.getRepository(FixedAssetDepreciation).find({
      where: { organizationId, fixedAssetId: id },
      order: { periodEnd: 'ASC' },
    });
    return {
      posted: posted.map((row) => ({
        periodEnd: row.periodEnd,
        amount: row.amount,
        accumulatedAfter: row.accumulatedAfter,
        bookValueAfter: row.bookValueAfter,
        journalEntryId: row.journalEntryId,
      })),
      projected: asset.status === FixedAssetStatus.IN_USE ? remainingSchedule(asset) : [],
    };
  }

  /**
   * Edit an asset in use.
   *
   * Before any month has been charged here, anything may change. After, only what affects the
   * future: its name, branch and description, the expense account the next charges go to, and the
   * estimates — useful life, residual value, method — which the next run applies to what is left
   * (a change in accounting estimate is prospective, IAS 8). What fixed its value from the start
   * does not change; see `VALUATION_FIELDS`.
   */
  async update(id: string, dto: UpdateFixedAssetDto, organizationId: string): Promise<FixedAsset> {
    return this.dataSource.transaction(async (manager) => {
      const asset = await manager.findOne(FixedAsset, {
        where: { id, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!asset) throw new NotFoundError('fixed_assets.fixed_asset_id_not_found', { id });
      if (asset.status !== FixedAssetStatus.IN_USE) {
        throw new ConflictError('fixed_assets.asset_retired_cannot_edit', { number: asset.number });
      }

      const charged = await manager.count(FixedAssetDepreciation, { where: { organizationId, fixedAssetId: id } });
      if (charged > 0) {
        const locked = VALUATION_FIELDS.filter((field) => dto[field] !== undefined && !sameValue(asset, field, dto));
        if (locked.length > 0) {
          throw new ConflictError('fixed_assets.valuation_locked_after_depreciation', {
            number: asset.number,
            fields: locked.join(', '),
          });
        }
      }

      const next = {
        name: dto.name !== undefined ? dto.name.trim() : asset.name,
        description: dto.description !== undefined ? dto.description?.trim() || null : asset.description,
        branchId: dto.branchId !== undefined ? dto.branchId : asset.branchId,
        acquisitionDate: dto.acquisitionDate ?? asset.acquisitionDate,
        inServiceDate: dto.inServiceDate ?? asset.inServiceDate,
        cost: dto.cost !== undefined ? roundAmount(dto.cost) : asset.cost,
        residualValue: dto.residualValue !== undefined ? roundAmount(dto.residualValue) : asset.residualValue,
        usefulLifeMonths: dto.usefulLifeMonths ?? asset.usefulLifeMonths,
        depreciationMethod: dto.depreciationMethod ?? asset.depreciationMethod,
        assetAccountId: dto.assetAccountId ?? asset.assetAccountId,
        accumulatedDepreciationAccountId: dto.accumulatedDepreciationAccountId ?? asset.accumulatedDepreciationAccountId,
        depreciationExpenseAccountId:
          dto.depreciationExpenseAccountId !== undefined ? dto.depreciationExpenseAccountId : asset.depreciationExpenseAccountId,
        vendorBillId: dto.vendorBillId !== undefined ? dto.vendorBillId : asset.vendorBillId,
        openingAccumulatedDepreciation:
          dto.openingAccumulatedDepreciation !== undefined
            ? roundAmount(dto.openingAccumulatedDepreciation)
            : asset.openingAccumulatedDepreciation,
      };
      const openingThrough =
        dto.openingDepreciatedThrough !== undefined
          ? dto.openingDepreciatedThrough
          : asset.openingAccumulatedDepreciation > 0 && asset.depreciatedThrough
            ? asset.depreciatedThrough.slice(0, 7)
            : null;

      if (charged > 0) {
        // The estimates may change, but never below what has already been charged.
        if (toCents(asset.accumulatedDepreciation) > toCents(next.cost - next.residualValue)) {
          throw new BadRequestError('fixed_assets.residual_below_charged', {
            number: asset.number,
            maximum: roundAmount(next.cost - asset.accumulatedDepreciation),
          });
        }
        if (next.residualValue > next.cost) throw new BadRequestError('fixed_assets.residual_above_cost');
        if (!next.assetAccountId || !next.accumulatedDepreciationAccountId) {
          throw new BadRequestError('fixed_assets.accounts_required');
        }
        await this.assertReferences(manager, organizationId, next);
        Object.assign(asset, next, {
          bookValue: roundAmount(asset.cost - asset.accumulatedDepreciation),
        });
        return manager.save(asset);
      }

      const depreciatedThrough = this.validateValuation(next, openingThrough);
      await this.assertReferences(manager, organizationId, next);
      Object.assign(asset, next, {
        accumulatedDepreciation: next.openingAccumulatedDepreciation,
        bookValue: roundAmount(next.cost - next.openingAccumulatedDepreciation),
        depreciatedThrough,
      });
      return manager.save(asset);
    });
  }

  /**
   * Only an asset no month has been charged for here can be deleted.
   *
   * This deleted any asset once, including one depreciated for years: the ledger kept its cost and
   * its accumulated depreciation while the register no longer listed it. An asset registered by
   * mistake is deleted; one that has been charged is retired through disposal, which books the
   * result.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const asset = await manager.findOne(FixedAsset, { where: { id, organizationId }, lock: { mode: 'pessimistic_write' } });
      if (!asset) throw new NotFoundError('fixed_assets.fixed_asset_id_not_found', { id });
      const charged = await manager.count(FixedAssetDepreciation, { where: { organizationId, fixedAssetId: id } });
      if (charged > 0 || asset.status !== FixedAssetStatus.IN_USE) {
        throw new ConflictError('fixed_assets.asset_in_books_dispose_instead', { name: asset.name });
      }
      await manager.delete(FixedAsset, { id, organizationId });
    });
  }

  /**
   * Retire an asset: sold, scrapped, lost.
   *
   * First every month up to the one before the disposal is charged — the asset leaves the books at
   * its carrying amount on the day, not at whatever the last run happened to leave. Then one entry
   * takes the cost and the accumulated depreciation out, books what it was sold for, and the
   * difference as a gain or a loss.
   */
  async dispose(
    id: string,
    dto: DisposeAssetDto,
    organizationId: string,
    actorUserId: string | null,
  ): Promise<FixedAsset> {
    return this.dataSource.transaction(async (manager) => {
      const asset = await manager.findOne(FixedAsset, { where: { id, organizationId }, lock: { mode: 'pessimistic_write' } });
      if (!asset) throw new NotFoundError('fixed_assets.fixed_asset_id_not_found', { id });
      if (asset.status !== FixedAssetStatus.IN_USE) {
        throw new ConflictError('fixed_assets.asset_not_found_has_already_disposed');
      }
      if (dto.disposalDate < asset.acquisitionDate) {
        throw new BadRequestError('fixed_assets.disposal_before_acquisition', { date: asset.acquisitionDate });
      }
      // A month charged after the disposal would be depreciation of an asset the company no longer
      // had; it must be reversed before the asset can leave on that date.
      if (asset.depreciatedThrough && asset.depreciatedThrough >= endOfMonthIso(dto.disposalDate)) {
        throw new ConflictError('fixed_assets.disposal_before_last_depreciation', {
          number: asset.number,
          through: asset.depreciatedThrough,
        });
      }
      if (!asset.assetAccountId || !asset.accumulatedDepreciationAccountId) {
        throw new BadRequestError('fixed_assets.accounts_required');
      }

      const salePrice = roundAmount(dto.salePrice);
      if (salePrice > 0 && !dto.cashAccountId) throw new BadRequestError('fixed_assets.proceeds_account_required');

      const lastMonthBefore = previousDay(startOfMonthIso(dto.disposalDate));
      if (lastMonthBefore >= asset.inServiceDate.slice(0, 7)) {
        await this.depreciation.chargeAsset(manager, asset, lastMonthBefore);
      }

      const carrying = roundAmount(asset.cost - asset.accumulatedDepreciation);
      const result = roundAmount(salePrice - carrying);

      if (result > 0 && !dto.gainOnDisposalAccountId) throw new BadRequestError('fixed_assets.gain_account_required');
      if (result < 0 && !dto.lossOnDisposalAccountId) throw new BadRequestError('fixed_assets.loss_account_required');
      for (const accountId of [dto.cashAccountId, dto.gainOnDisposalAccountId, dto.lossOnDisposalAccountId]) {
        if (accountId) await assertPostableAccount(manager, organizationId, accountId);
      }

      const ledger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!ledger) throw new BadRequestError('fixed_assets.no_default_ledger_has_configured_organization');
      const journal = await this.journalLookup.findByCode(organizationId, 'ACT-FIJOS', manager);
      if (!journal) throw new BadRequestError('fixed_assets.fixed_assets_journal_act_fijos_not');

      const label = `${asset.number} ${asset.name}`;
      const words = await this.narrative.describeAll(manager, organizationId, {
        header: { key: 'ledger.fixed_asset.disposal_entry', params: { asset: label, reason: dto.disposalReason } },
        proceeds: { key: 'ledger.fixed_asset.sale_proceeds', params: { asset: label } },
        accumulated: { key: 'ledger.fixed_asset.accumulated_reversal', params: { asset: label } },
        cost: { key: 'ledger.fixed_asset.cost_reversal', params: { asset: label } },
        gain: { key: 'ledger.fixed_asset.gain', params: { asset: label } },
        loss: { key: 'ledger.fixed_asset.loss', params: { asset: label } },
      });
      const line = (accountId: string, debit: number, credit: number, description: string): CreateJournalEntryLineDto => ({
        accountId,
        debit,
        credit,
        description,
        valuations: [{ ledgerId: ledger.id, debit, credit }],
      });

      const lines: CreateJournalEntryLineDto[] = [];
      if (salePrice > 0) lines.push(line(dto.cashAccountId as string, salePrice, 0, words.proceeds));
      if (asset.accumulatedDepreciation > 0) {
        lines.push(line(asset.accumulatedDepreciationAccountId, asset.accumulatedDepreciation, 0, words.accumulated));
      }
      lines.push(line(asset.assetAccountId, 0, asset.cost, words.cost));
      if (result > 0) lines.push(line(dto.gainOnDisposalAccountId as string, 0, result, words.gain));
      if (result < 0) lines.push(line(dto.lossOnDisposalAccountId as string, -result, 0, words.loss));

      const entry = await this.assetPosting.createWithManager(
        manager,
        { date: dto.disposalDate, description: words.header, journalId: journal.id, lines } as CreateJournalEntryDto,
        organizationId,
        { actorUserId },
      );

      asset.status = salePrice > 0 ? FixedAssetStatus.SOLD : FixedAssetStatus.DISPOSED;
      asset.bookValue = carrying;
      asset.disposalDate = dto.disposalDate;
      asset.disposalProceeds = salePrice;
      asset.disposalReason = dto.disposalReason.trim();
      asset.disposalJournalEntryId = entry.id;
      asset.disposedByUserId = actorUserId;
      return manager.save(asset);
    });
  }

  /**
   * The figures an asset is valued on, checked together: the database checks each one, this says
   * which one is wrong and why. Returns the month an opening balance was charged through.
   */
  private validateValuation(
    values: {
      acquisitionDate: string;
      inServiceDate: string;
      cost: number;
      residualValue: number;
      openingAccumulatedDepreciation: number;
      assetAccountId: string | null;
      accumulatedDepreciationAccountId: string | null;
    },
    openingThrough: string | null,
  ): IsoDate | null {
    if (values.inServiceDate < values.acquisitionDate) {
      throw new BadRequestError('fixed_assets.in_service_before_acquisition');
    }
    if (values.residualValue > values.cost) throw new BadRequestError('fixed_assets.residual_above_cost');
    if (!values.assetAccountId || !values.accumulatedDepreciationAccountId) {
      throw new BadRequestError('fixed_assets.accounts_required');
    }
    const opening = values.openingAccumulatedDepreciation;
    if (opening <= 0) return null;
    if (toCents(opening) > toCents(values.cost - values.residualValue)) {
      throw new BadRequestError('fixed_assets.opening_above_depreciable', {
        maximum: roundAmount(values.cost - values.residualValue),
      });
    }
    if (!openingThrough) throw new BadRequestError('fixed_assets.opening_through_required');
    const through = endOfMonthIso(`${openingThrough}-01`);
    if (through < endOfMonthIso(values.inServiceDate)) {
      throw new BadRequestError('fixed_assets.opening_through_before_service');
    }
    return through;
  }

  /** The accounts, the branch and the bill an asset names belong to the company and can be used. */
  private async assertReferences(
    manager: EntityManager,
    organizationId: string,
    values: {
      assetAccountId: string | null;
      accumulatedDepreciationAccountId: string | null;
      depreciationExpenseAccountId: string | null;
      branchId: string | null;
      vendorBillId: string | null;
    },
  ): Promise<void> {
    for (const accountId of [
      values.assetAccountId,
      values.accumulatedDepreciationAccountId,
      values.depreciationExpenseAccountId,
    ]) {
      if (accountId) await assertPostableAccount(manager, organizationId, accountId);
    }
    if (values.branchId) {
      const [branch] = await manager.query(
        `SELECT 1 FROM "branches" WHERE "id" = $1 AND "organization_id" = $2 AND "is_active" = true`,
        [values.branchId, organizationId],
      );
      if (!branch) throw new BadRequestError('fixed_assets.branch_not_found');
    }
    if (values.vendorBillId) {
      const [bill] = await manager.query(
        `SELECT 1 FROM "vendor_bills" WHERE "id" = $1 AND "organization_id" = $2`,
        [values.vendorBillId, organizationId],
      );
      if (!bill) throw new BadRequestError('fixed_assets.vendor_bill_not_found');
    }
  }
}

/** The account exists in this company, is active and takes postings. */
async function assertPostableAccount(manager: EntityManager, organizationId: string, accountId: string): Promise<void> {
  const account = await manager.findOne(Account, { where: { id: accountId, organizationId } });
  if (!account) throw new BadRequestError('fixed_assets.account_not_found');
  if (!account.isActive || !account.isPostable) {
    throw new BadRequestError('fixed_assets.account_not_postable', { code: account.code, name: account.name });
  }
}

function sameValue(asset: FixedAsset, field: (typeof VALUATION_FIELDS)[number], dto: UpdateFixedAssetDto): boolean {
  // The month an opening balance covers is not kept apart once runs have moved on from it, so any
  // value sent for it is a request to change it.
  if (field === 'openingDepreciatedThrough') return false;
  const current = asset[field as keyof FixedAsset];
  const requested = dto[field as keyof UpdateFixedAssetDto];
  return typeof current === 'number' ? toCents(current) === toCents(Number(requested)) : current === requested;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
