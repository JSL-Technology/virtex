import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, Repository } from 'typeorm';
import { FixedAsset, FixedAssetStatus, DepreciationMethod } from './entities/fixed-asset.entity';
import { FixedAssetDepreciation } from './entities/fixed-asset-depreciation.entity';
import { FixedAssetCategory } from './entities/fixed-asset-category.entity';
import { Page, resolvePaging, toPage } from '../common/pagination';
import {
  CreateFixedAssetDto,
  DisposeAssetDto,
  FixedAssetsQueryDto,
  TaxBookDto,
  UpdateFixedAssetDto,
} from './dto/fixed-asset.dto';
import { AssetPostingService } from './asset-posting.service';
import { DepreciationService } from './depreciation.service';
import { TaxBookService, type TaxBookSchedule, type TaxBookSummary } from './tax-book.service';
import { openingTerms, revisedTerms, type TaxBookAsset } from './tax-book-terms';
import { organizationDefaultAccounts } from '../organizations/contracts/default-accounts.contract';
import { organizationMarket } from '../organizations/contracts/market.contract';
import { marketFor, type MarketTaxDepreciation } from '../markets';
import type { DepreciationConvention, LocalizedName } from '@virtex/shared/types';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { Ledger } from '../accounting/entities/ledger.entity';
import { assertPostableAccount } from './fixed-asset-accounts';
import { CreateJournalEntryDto, CreateJournalEntryLineDto } from '../journal-entries/dto/create-journal-entry.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';
import { allocateDocumentNumber, DOCUMENT_SEQUENCE_SCOPE } from '../shared/numbering/document-numbers';
import { roundAmount, toCents } from '../common/money';
import { endOfMonthIso, toIsoDate, yearOf, type IsoDate } from '../common/dates';
import { remainingSchedule, ScheduledCharge } from './depreciation-schedule';
import { SYSTEM_JOURNALS } from '../contracts/ledger-posting/system-journals';
import { LedgerText, narrated } from '../contracts/ledger-posting/ledger-text';

/** An asset as the register shows it: with its category and its tax book. */
export type FixedAssetView = FixedAsset & {
  category: { id: string; code: string; name: string; nameTranslations: LocalizedName } | null;
  taxBook: TaxBookSummary | null;
};

/** The asset's depreciation board: what has been charged, and what remains to be. */
export interface FixedAssetSchedule {
  posted: Array<{
    periodEnd: string;
    amount: number;
    accumulatedAfter: number;
    bookValueAfter: number;
    journalEntryId: string;
    /** The run that charged it; null for a month charged before runs were recorded. */
    runId: string | null;
  }>;
  projected: ScheduledCharge[];
  /** The tax book's months charged and the rest of its schedule; null when it keeps none. */
  taxBook: TaxBookSchedule | null;
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
  // It decided how much the first month charged took.
  'depreciationConvention',
  'openingAccumulatedDepreciation',
  'openingDepreciatedThrough',
  'assetAccountId',
  'accumulatedDepreciationAccountId',
] as const;

/** How the register's form names each of them, for a message that lists them. */
const VALUATION_FIELD_LABELS: Record<(typeof VALUATION_FIELDS)[number], string> = {
  cost: 'fixed_assets.form.cost',
  acquisitionDate: 'fixed_assets.form.acquisition_date',
  inServiceDate: 'fixed_assets.form.in_service_date',
  depreciationConvention: 'fixed_assets.form.convention',
  openingAccumulatedDepreciation: 'fixed_assets.form.opening_accumulated',
  openingDepreciatedThrough: 'fixed_assets.form.opening_through',
  assetAccountId: 'fixed_assets.form.asset_account',
  accumulatedDepreciationAccountId: 'fixed_assets.form.accumulated_account',
};

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
    private readonly taxBooks: TaxBookService,
    private readonly i18n: I18nService,
    /** Narratives in the tenant's books language; see `LedgerNarrativeService`. */
    private readonly narrative: LedgerNarrativeService = new LedgerNarrativeService(new I18nService()),
  ) {}

  /**
   * Register an asset. What is not stated comes from its category — life, method, convention,
   * residual share, accounts — and the accumulated depreciation and expense accounts, last, from the
   * company's defaults. Each is copied onto the asset: a later change to the category rewrites
   * nothing. Its tax book opens on the terms sent, or on its category's.
   */
  async create(dto: CreateFixedAssetDto, organizationId: string, actorUserId: string | null): Promise<FixedAssetView> {
    const id = await this.dataSource.transaction(async (manager) => {
      const category = dto.categoryId ? await this.assignableCategory(manager, organizationId, dto.categoryId) : null;
      const defaults = await this.defaultAccounts(manager, organizationId);
      const cost = roundAmount(dto.cost);
      const method = dto.depreciationMethod ?? category?.depreciationMethod ?? DepreciationMethod.STRAIGHT_LINE;
      const values = {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        branchId: dto.branchId ?? null,
        categoryId: category?.id ?? null,
        acquisitionDate: dto.acquisitionDate,
        inServiceDate: dto.inServiceDate ?? dto.acquisitionDate,
        cost,
        residualValue: roundAmount(dto.residualValue ?? (category ? cost * category.residualRate : 0)),
        usefulLifeMonths: dto.usefulLifeMonths ?? category?.usefulLifeMonths ?? null,
        depreciationMethod: method,
        decliningAnnualRate: decliningRateOf(method, dto.decliningAnnualRate, category),
        depreciationConvention: (dto.depreciationConvention ??
          category?.depreciationConvention ??
          (await this.depreciation.defaultConvention(manager, organizationId))) as DepreciationConvention,
        assetAccountId: dto.assetAccountId ?? category?.assetAccountId ?? null,
        accumulatedDepreciationAccountId:
          dto.accumulatedDepreciationAccountId ?? category?.accumulatedDepreciationAccountId ?? defaults.accumulated,
        // Null charges the company's default at each run, so it follows a change of that default.
        depreciationExpenseAccountId:
          dto.depreciationExpenseAccountId !== undefined ? dto.depreciationExpenseAccountId : (category?.depreciationExpenseAccountId ?? null),
        vendorBillId: dto.vendorBillId ?? null,
        openingAccumulatedDepreciation: roundAmount(dto.openingAccumulatedDepreciation ?? 0),
      };
      if (!values.usefulLifeMonths) throw new BadRequestError('fixed_assets.useful_life_required');
      const depreciatedThrough = this.validateValuation(values, dto.openingDepreciatedThrough ?? null);
      await this.assertReferences(manager, organizationId, values);
      const taxTerms = openingTerms(dto.taxBook, taxBookAssetOf(values), category, await this.marketTaxDepreciation(manager, organizationId));

      const number = await allocateDocumentNumber(
        manager,
        organizationId,
        DOCUMENT_SEQUENCE_SCOPE.FIXED_ASSET,
        'AF',
        yearOf(values.acquisitionDate),
      );
      const asset = await manager.save(
        manager.create(FixedAsset, {
          ...values,
          usefulLifeMonths: values.usefulLifeMonths,
          organizationId,
          number,
          accumulatedDepreciation: values.openingAccumulatedDepreciation,
          bookValue: roundAmount(values.cost - values.openingAccumulatedDepreciation),
          depreciatedThrough,
          status: FixedAssetStatus.IN_USE,
          createdByUserId: actorUserId,
        }),
      );
      if (taxTerms) await this.taxBooks.open(manager, asset, taxTerms);
      return asset.id;
    });
    return this.findOne(id, organizationId);
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
      .leftJoin('asset.category', 'category')
      .addSelect(['category.id', 'category.code', 'category.name', 'category.nameTranslations'])
      .where('asset.organizationId = :organizationId', { organizationId });
    if (query.status) qb.andWhere('asset.status = :status', { status: query.status });
    if (query.categoryId) qb.andWhere('asset.categoryId = :categoryId', { categoryId: query.categoryId });
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

  /** The asset, with its category and its tax book. */
  async findOne(id: string, organizationId: string): Promise<FixedAssetView> {
    const asset = await this.requireAsset(id, organizationId);
    const [category, books] = await Promise.all([
      asset.categoryId
        ? this.dataSource.getRepository(FixedAssetCategory).findOne({
            where: { id: asset.categoryId, organizationId },
            select: ['id', 'code', 'name', 'nameTranslations'],
          })
        : null,
      this.taxBooks.summaries(this.dataSource.manager, organizationId, [asset.id]),
    ]);
    return Object.assign(asset, {
      category: category ? { id: category.id, code: category.code, name: category.name, nameTranslations: category.nameTranslations } : null,
      taxBook: books.get(asset.id) ?? null,
    });
  }

  /** The months charged here, and the projection of the ones left — in both books. */
  async schedule(id: string, organizationId: string): Promise<FixedAssetSchedule> {
    const asset = await this.requireAsset(id, organizationId);
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
        runId: row.runId,
      })),
      projected: asset.status === FixedAssetStatus.IN_USE ? remainingSchedule(asset) : [],
      taxBook: await this.taxBooks.schedule(this.dataSource.manager, asset),
    };
  }

  private async requireAsset(id: string, organizationId: string): Promise<FixedAsset> {
    const asset = await this.fixedAssetRepository.findOneBy({ id, organizationId });
    if (!asset) throw new NotFoundError('fixed_assets.fixed_asset_id_not_found', { id });
    return asset;
  }

  /**
   * Edit an asset in use.
   *
   * Before any month has been charged here, anything may change. After, only what affects the
   * future: its name, branch, category and description, the expense account the next charges go
   * to, and the estimates — useful life, residual value, method and its rate — which the next run
   * applies to what is left (a change in accounting estimate is prospective, IAS 8). What fixed its
   * value from the start does not change; see `VALUATION_FIELDS`. A month charged in either book
   * counts: the tax book was charged on the same cost.
   *
   * Its tax book opens, changes or goes with `taxBook` — see `TaxBookService.revise`.
   */
  async update(id: string, dto: UpdateFixedAssetDto, organizationId: string): Promise<FixedAssetView> {
    await this.dataSource.transaction(async (manager) => {
      const asset = await manager.findOne(FixedAsset, {
        where: { id, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!asset) throw new NotFoundError('fixed_assets.fixed_asset_id_not_found', { id });
      if (asset.status !== FixedAssetStatus.IN_USE) {
        throw new ConflictError('fixed_assets.asset_retired_cannot_edit', { number: asset.number });
      }

      const charged = await this.chargedMonths(manager, organizationId, id);
      if (charged > 0) {
        const locked = VALUATION_FIELDS.filter((field) => dto[field] !== undefined && !sameValue(asset, field, dto));
        if (locked.length > 0) {
          throw new ConflictError('fixed_assets.valuation_locked_after_depreciation', {
            number: asset.number,
            fields: this.i18n.listOf(locked.map((field) => VALUATION_FIELD_LABELS[field])),
          });
        }
      }

      const previous = { cost: asset.cost, convention: asset.depreciationConvention };
      const category =
        dto.categoryId !== undefined && dto.categoryId !== asset.categoryId && dto.categoryId !== null
          ? await this.assignableCategory(manager, organizationId, dto.categoryId)
          : null;
      const method = dto.depreciationMethod ?? asset.depreciationMethod;
      const next = {
        name: dto.name !== undefined ? dto.name.trim() : asset.name,
        description: dto.description !== undefined ? dto.description?.trim() || null : asset.description,
        branchId: dto.branchId !== undefined ? dto.branchId : asset.branchId,
        categoryId: dto.categoryId !== undefined ? (category?.id ?? dto.categoryId) : asset.categoryId,
        acquisitionDate: dto.acquisitionDate ?? asset.acquisitionDate,
        inServiceDate: dto.inServiceDate ?? asset.inServiceDate,
        cost: dto.cost !== undefined ? roundAmount(dto.cost) : asset.cost,
        residualValue: dto.residualValue !== undefined ? roundAmount(dto.residualValue) : asset.residualValue,
        usefulLifeMonths: dto.usefulLifeMonths ?? asset.usefulLifeMonths,
        depreciationMethod: method,
        // Another method carries no rate: changing to one drops it.
        decliningAnnualRate: decliningRateOf(
          method,
          dto.decliningAnnualRate !== undefined
            ? dto.decliningAnnualRate
            : method === DepreciationMethod.DECLINING_BALANCE
              ? asset.decliningAnnualRate
              : null,
          null,
        ),
        depreciationConvention: dto.depreciationConvention ?? asset.depreciationConvention,
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
      } else {
        const depreciatedThrough = this.validateValuation(next, openingThrough);
        await this.assertReferences(manager, organizationId, next);
        Object.assign(asset, next, {
          accumulatedDepreciation: next.openingAccumulatedDepreciation,
          bookValue: roundAmount(next.cost - next.openingAccumulatedDepreciation),
          depreciatedThrough,
        });
      }
      await manager.save(asset);
      await this.updateTaxBook(manager, asset, dto, previous);
    });
    return this.findOne(id, organizationId);
  }

  /**
   * The tax book after an edit: opened when the asset has none, revised when it has one, removed by
   * null. A book whose basis was the asset's cost, or whose convention was the asset's, follows a
   * change of it — which the asset allows only while nothing was charged in either book.
   */
  private async updateTaxBook(
    manager: EntityManager,
    asset: FixedAsset,
    dto: UpdateFixedAssetDto,
    previous: { cost: number; convention: string },
  ): Promise<void> {
    const book = await this.taxBooks.bookOf(manager, asset.id, true);
    const market = await this.marketTaxDepreciation(manager, asset.organizationId);
    if (dto.taxBook === null) {
      if (book) await this.taxBooks.remove(manager, book, asset.number);
      return;
    }
    if (!book) {
      if (dto.taxBook === undefined) return;
      const category = asset.categoryId ? await manager.findOne(FixedAssetCategory, { where: { id: asset.categoryId } }) : null;
      const terms = openingTerms(dto.taxBook, taxBookAssetOf(asset), category, market);
      if (terms) await this.taxBooks.open(manager, asset, terms);
      return;
    }
    const followsCost = toCents(book.cost) === toCents(previous.cost) && toCents(asset.cost) !== toCents(previous.cost);
    const followsConvention =
      book.depreciationConvention === previous.convention && asset.depreciationConvention !== previous.convention;
    if (dto.taxBook === undefined && !followsCost && !followsConvention) return;
    const request: TaxBookDto = { ...(dto.taxBook ?? {}) };
    if (followsCost && request.cost === undefined) request.cost = asset.cost;
    if (followsConvention && request.convention === undefined) request.convention = asset.depreciationConvention as DepreciationConvention;
    await this.taxBooks.revise(manager, book, revisedTerms(book, request, taxBookAssetOf(asset), market), asset.number);
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
      const charged = await this.chargedMonths(manager, organizationId, id);
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
   * charges the disposal month through the day it leaves, by the asset's convention (FINB-12: that
   * month was never charged, so the carrying amount — and the loss — were overstated by it), takes
   * the cost and the accumulated depreciation out, books what it was sold for, and the difference
   * as a gain or a loss.
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

      // The months still due before the disposal month, charged by the disposal's own run; and that
      // month's charge through the day it leaves, which this entry carries.
      const depreciation = await this.depreciation.prepareDisposal(manager, asset, dto.disposalDate, actorUserId);
      const stub = depreciation.stub;
      const accumulatedOnTheDay = roundAmount(asset.accumulatedDepreciation + (stub?.amount ?? 0));
      const carrying = roundAmount(asset.cost - accumulatedOnTheDay);
      const result = roundAmount(salePrice - carrying);

      if (result > 0 && !dto.gainOnDisposalAccountId) throw new BadRequestError('fixed_assets.gain_account_required');
      if (result < 0 && !dto.lossOnDisposalAccountId) throw new BadRequestError('fixed_assets.loss_account_required');
      for (const accountId of [dto.cashAccountId, dto.gainOnDisposalAccountId, dto.lossOnDisposalAccountId]) {
        if (accountId) await assertPostableAccount(manager, organizationId, accountId);
      }

      const ledger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!ledger) throw new BadRequestError('fixed_assets.no_default_ledger_has_configured_organization');
      const journal = await this.journalLookup.requireByCode(organizationId, SYSTEM_JOURNALS.fixedAssets.code, manager);

      const label = `${asset.number} ${asset.name}`;
      const words = await this.narrative.describeAll(manager, organizationId, {
        header: { key: 'ledger.fixed_asset.disposal_entry', params: { asset: label, reason: dto.disposalReason } },
        proceeds: { key: 'ledger.fixed_asset.sale_proceeds', params: { asset: label } },
        accumulated: { key: 'ledger.fixed_asset.accumulated_reversal', params: { asset: label } },
        cost: { key: 'ledger.fixed_asset.cost_reversal', params: { asset: label } },
        gain: { key: 'ledger.fixed_asset.gain', params: { asset: label } },
        loss: { key: 'ledger.fixed_asset.loss', params: { asset: label } },
      });
      const line = (
        accountId: string,
        debit: number,
        credit: number,
        description: LedgerText,
        originDate?: string,
      ): CreateJournalEntryLineDto => ({
        accountId,
        debit,
        credit,
        ...narrated(description),
        ...(originDate ? { originDate } : {}),
        valuations: [{ ledgerId: ledger.id, debit, credit }],
      });
      // The cost and the depreciation leave the books from where they came in: the acquisition
      // (FIN-AC-04). Restated for inflation from the disposal date instead, the asset's restated
      // cost would outlive it by the inflation since it was bought.
      const acquired = toIsoDate(asset.acquisitionDate);

      const lines: CreateJournalEntryLineDto[] = [];
      // The disposal month's depreciation first: what the asset wore down in it before it left.
      if (stub) lines.push(...(await this.depreciation.chargeLines(manager, organizationId, asset, stub, stub, ledger.id)));
      if (salePrice > 0) lines.push(line(dto.cashAccountId as string, salePrice, 0, words.proceeds));
      if (accumulatedOnTheDay > 0) {
        lines.push(line(asset.accumulatedDepreciationAccountId, accumulatedOnTheDay, 0, words.accumulated, acquired));
      }
      lines.push(line(asset.assetAccountId, 0, asset.cost, words.cost, acquired));
      if (result > 0) lines.push(line(dto.gainOnDisposalAccountId as string, 0, result, words.gain));
      if (result < 0) lines.push(line(dto.lossOnDisposalAccountId as string, -result, 0, words.loss));

      const entry = await this.assetPosting.createWithManager(
        manager,
        { date: dto.disposalDate, ...narrated(words.header), journalId: journal.id, lines } as CreateJournalEntryDto,
        organizationId,
        // A disposal is a document of the register: the entry says so and leads back to the asset,
        // instead of reading as a hand-made entry nobody can trace (FINB-17).
        { actorUserId, systemReason: 'fixed-asset-disposal', idempotencyKey: `fixed-asset-disposal:${asset.id}` },
      );

      await this.depreciation.recordDisposalCharge(manager, asset, depreciation, entry.id);
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

  /** Months charged for the asset in either book: the accounting one and its tax book. */
  private async chargedMonths(manager: EntityManager, organizationId: string, assetId: string): Promise<number> {
    const [row] = await manager.query<{ months: number }[]>(
      `SELECT (SELECT COUNT(*) FROM "fixed_asset_depreciations" WHERE "organization_id" = $1 AND "fixed_asset_id" = $2)
            + (SELECT COUNT(*) FROM "fixed_asset_book_charges" c JOIN "fixed_asset_books" b ON b."id" = c."book_id"
                WHERE b."organization_id" = $1 AND b."fixed_asset_id" = $2) AS months`,
      [organizationId, assetId],
    );
    return Number(row?.months ?? 0);
  }

  /** A category of the company that new assets may be registered in. */
  private async assignableCategory(manager: EntityManager, organizationId: string, categoryId: string): Promise<FixedAssetCategory> {
    const category = await manager.findOne(FixedAssetCategory, { where: { id: categoryId, organizationId } });
    if (!category) throw new BadRequestError('fixed_assets.category_not_found', { id: categoryId });
    if (!category.isActive) throw new BadRequestError('fixed_assets.category_inactive', { code: category.code });
    return category;
  }

  /** The company's default accumulated depreciation account: the last of an asset's defaults. */
  private async defaultAccounts(manager: EntityManager, organizationId: string): Promise<{ accumulated: string | null }> {
    const defaults = await organizationDefaultAccounts(manager, organizationId, ['defaultAccumulatedDepreciationAccountId']);
    return { accumulated: defaults.defaultAccumulatedDepreciationAccountId };
  }

  private async marketTaxDepreciation(manager: EntityManager, organizationId: string): Promise<MarketTaxDepreciation | null> {
    const { country } = await organizationMarket(manager, organizationId);
    return marketFor(country).accounting.taxDepreciation;
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


/**
 * The yearly rate of a declining balance: the one sent, else the category's when it uses the same
 * method, else — a company whose books follow the tax law — the category's tax rate when the tax
 * method is the same. Only a declining balance has one.
 */
function decliningRateOf(
  method: DepreciationMethod,
  sent: number | null | undefined,
  category: FixedAssetCategory | null,
): number | null {
  if (method !== DepreciationMethod.DECLINING_BALANCE) {
    if (sent !== undefined && sent !== null) throw new BadRequestError('fixed_assets.declining_rate_only_for_declining');
    return null;
  }
  const rate =
    sent ??
    (category?.depreciationMethod === DepreciationMethod.DECLINING_BALANCE ? category.decliningAnnualRate : null) ??
    (category?.taxMethod === DepreciationMethod.DECLINING_BALANCE ? category.taxAnnualRate : null);
  if (rate === null || rate === undefined) throw new BadRequestError('fixed_assets.declining_rate_required');
  return rate;
}

/** What of the asset a tax book's terms are resolved against. */
function taxBookAssetOf(asset: { cost: number; inServiceDate: string | Date; depreciationConvention: string }): TaxBookAsset {
  return {
    cost: asset.cost,
    inServiceDate: typeof asset.inServiceDate === 'string' ? asset.inServiceDate : asset.inServiceDate.toISOString().slice(0, 10),
    depreciationConvention: asset.depreciationConvention as DepreciationConvention,
  };
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
