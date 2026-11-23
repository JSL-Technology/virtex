import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { LocalizedName } from '@virtex/shared/types';
import { FixedAsset, FixedAssetCapitalization } from './entities/fixed-asset.entity';
import { AssetPostingService } from './asset-posting.service';
import { assertPostableAccount } from './fixed-asset-accounts';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { CreateJournalEntryDto, CreateJournalEntryLineDto } from '../journal-entries/dto/create-journal-entry.dto';
import { ModuleSlug } from '../journal-entries/accounting-posting.port';
import { Ledger } from '../accounting/entities/ledger.entity';
import { resolvePostingPeriod } from '../accounting/period-status';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { LEDGER_STATUSES_SQL } from '../contracts/accounting/ledger-statuses.contract';
import { SYSTEM_JOURNALS } from '../contracts/ledger-posting/system-journals';
import { LedgerText, narrated } from '../contracts/ledger-posting/ledger-text';
import { BadRequestError, ConflictError } from '../i18n/localized.exception';
import { roundAmount, toCents } from '../common/money';
import { toIsoDate, type IsoDate } from '../common/dates';
import { Page, Paging, toPage } from '../common/pagination';
import { REGISTER_REASON, REGISTER_REASONS, TRACED_REASONS, reasonsSql, type RegisterReason } from './register-reasons';

/** How an asset's cost entered the ledger, as a request states it. */
export interface CapitalizationRequest {
  method: Exclude<FixedAssetCapitalization, FixedAssetCapitalization.UNLINKED>;
  /** `VENDOR_BILL`: the posted bill that bought it. */
  vendorBillId?: string;
  /** `JOURNAL_ENTRY`: the entry already in the books that brought its cost in. */
  journalEntryId?: string;
  /** `POSTED`: what the acquisition is credited to, and its date — the acquisition's by default. */
  offsetAccountId?: string;
  date?: string;
}

/** A purchase or an entry that debited a fixed-asset account, with what is left to register. */
export interface CapitalizationSource {
  kind: 'VENDOR_BILL' | 'JOURNAL_ENTRY';
  /** The bill's id for a bill; the entry's for an entry. */
  id: string;
  journalEntryId: string;
  entryNumber: string | null;
  date: string;
  /** The supplier's document number, or the entry's description. */
  reference: string | null;
  supplier: string | null;
  accountId: string;
  accountCode: string;
  accountName: LocalizedName;
  debited: number;
  registered: number;
  available: number;
}

/**
 * What an account of the register keeps: assets' cost, their accumulated depreciation, or both — a
 * register that credits depreciation to the asset account itself.
 */
export type ReconciliationRole = 'COST' | 'ACCUMULATED' | 'BOTH';

/**
 * One account of the register against the ledger on a day, in the sense the account keeps: a debit
 * for cost, a credit for accumulated depreciation.
 */
export interface ReconciliationAccount {
  accountId: string;
  code: string;
  name: LocalizedName;
  role: ReconciliationRole;
  /** The assets standing on it that day: acquired, and not disposed of. */
  assets: number;
  register: number;
  ledger: number;
  /** The ledger less the register — `untraced − unlinked`, to the cent. */
  difference: number;
  /** What the ledger has here that no asset of the register is behind. */
  untraced: number;
  /** What the register has here, or took out, with no source in the ledger that day. */
  unlinked: number;
}

export interface ReconciliationReport {
  asOf: string;
  accounts: ReconciliationAccount[];
  /** Every account in debit terms: the register's net carrying amount against the ledger's. */
  totals: { register: number; ledger: number; difference: number; untraced: number; unlinked: number };
  /** How many assets and ledger movements explain the difference — each listed apart, by page. */
  counts: { unlinkedAssets: number; untracedPostings: number };
}

/**
 * Why an asset's cost is not in the ledger on the day: it never said how it got there; the bill or
 * entry it names is not posted, or was reversed — a bill voided — by then; or it was posted later,
 * as a bill that arrives after the asset entered service.
 */
export type UnlinkedReason = 'NEVER_LINKED' | 'SOURCE_NOT_POSTED' | 'SOURCE_REVERSED' | 'SOURCE_LATER';

/** An asset the register carries, or carried and disposed of, with no source in the ledger that day. */
export interface UnlinkedAsset {
  id: string;
  number: string;
  name: string;
  accountId: string | null;
  accumulatedAccountId: string | null;
  cost: number;
  openingAccumulated: number;
  reason: UnlinkedReason;
  /** The entry it names — its own acquisition, or its bill's or entry's —, when it names one. */
  entryId: string | null;
  entryNumber: string | null;
  entryDate: string | null;
  /** Disposed of by the day: the register took out a cost the ledger never had. */
  disposalDate: string | null;
}

/** A movement of the ledger on the register's accounts that no asset is behind. */
export interface UntracedPosting {
  entryId: string;
  entryNumber: string | null;
  date: string;
  description: string;
  accountId: string;
  /** In the sense the account keeps, as its row in the report. */
  amount: number;
}

const REGISTER_REASONS_SQL = reasonsSql(REGISTER_REASONS);
const TRACED_REASONS_SQL = reasonsSql(TRACED_REASONS);
/** Bill statuses whose entry is in the books. */
const UNPOSTED_BILL_STATUSES = new Set(['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'VOID']);

/**
 * How an asset's cost entered the ledger, and whether the register and the ledger agree (audit
 * 2026-11-07, FINB-15).
 *
 * Registering an asset posted nothing and said nothing of how its cost had reached the books: the
 * register carried 122 800 of cost while the asset account stood at zero, and no report put them
 * side by side. Every asset now names its source — the supplier bill that bought it, an entry
 * already in the books, or the acquisition the register posts itself — and the source must have
 * debited its asset account by at least what is registered from it. The reconciliation puts each
 * account's register against its ledger balance, and names what explains the difference.
 */
@Injectable()
export class FixedAssetCapitalizationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly assetPosting: AssetPostingService,
    private readonly journalLookup: JournalLookupService,
    private readonly narrative: LedgerNarrativeService,
  ) {}

  /**
   * Record how `asset` entered the ledger: check a link to a bill or an entry, or post its
   * acquisition. A capitalization the register posted before is reversed first.
   */
  async capitalize(manager: EntityManager, asset: FixedAsset, request: CapitalizationRequest, actorUserId: string | null): Promise<void> {
    const organizationId = asset.organizationId;
    if (request.method === FixedAssetCapitalization.VENDOR_BILL) {
      if (!request.vendorBillId) throw new BadRequestError('fixed_assets.capitalization_bill_required');
      const bill = await this.billOf(manager, organizationId, request.vendorBillId);
      if (!bill) throw new BadRequestError('fixed_assets.vendor_bill_not_found');
      if (!bill.journalEntryId || UNPOSTED_BILL_STATUSES.has(bill.status)) {
        throw new ConflictError('fixed_assets.capitalization_bill_not_posted', { bill: bill.label });
      }
      await this.assertAvailable(manager, asset, bill.journalEntryId, bill.label);
      await this.release(manager, asset, 'ledger.fixed_asset.capitalization_replaced', actorUserId);
      Object.assign(asset, {
        capitalizationMethod: FixedAssetCapitalization.VENDOR_BILL,
        vendorBillId: bill.id,
        capitalizationEntryId: null,
        capitalizationOffsetAccountId: null,
      });
      return;
    }
    if (request.method === FixedAssetCapitalization.JOURNAL_ENTRY) {
      if (!request.journalEntryId) throw new BadRequestError('fixed_assets.capitalization_entry_required');
      const entry = await this.entryOf(manager, organizationId, request.journalEntryId);
      if (!entry) throw new BadRequestError('fixed_assets.capitalization_entry_not_found');
      const label = entry.entryNumber ?? entry.id.slice(0, 8);
      if (!entry.inLedger || entry.isReversed) throw new ConflictError('fixed_assets.capitalization_entry_not_posted', { entry: label });
      // The register's own entries are its accounting, not a purchase an asset came from.
      if (entry.systemReason && REGISTER_REASONS.includes(entry.systemReason as RegisterReason)) {
        throw new BadRequestError('fixed_assets.capitalization_entry_of_register', { entry: label });
      }
      await this.assertAvailable(manager, asset, entry.id, label);
      await this.release(manager, asset, 'ledger.fixed_asset.capitalization_replaced', actorUserId);
      Object.assign(asset, {
        capitalizationMethod: FixedAssetCapitalization.JOURNAL_ENTRY,
        vendorBillId: null,
        capitalizationEntryId: entry.id,
        capitalizationOffsetAccountId: null,
      });
      return;
    }
    if (!request.offsetAccountId) throw new BadRequestError('fixed_assets.capitalization_offset_required');
    if (request.offsetAccountId === asset.assetAccountId || request.offsetAccountId === asset.accumulatedDepreciationAccountId) {
      throw new BadRequestError('fixed_assets.capitalization_offset_is_asset_account');
    }
    await assertPostableAccount(manager, organizationId, request.offsetAccountId);
    const date = toIsoDate(request.date ?? asset.acquisitionDate);
    if (date < toIsoDate(asset.acquisitionDate)) throw new BadRequestError('fixed_assets.capitalization_before_acquisition');
    const previous = asset.capitalizationMethod === FixedAssetCapitalization.POSTED ? asset.capitalizationEntryId : null;
    await this.release(manager, asset, 'ledger.fixed_asset.capitalization_replaced', actorUserId);
    const entry = await this.postAcquisition(manager, asset, request.offsetAccountId, date, actorUserId, previous);
    Object.assign(asset, {
      capitalizationMethod: FixedAssetCapitalization.POSTED,
      vendorBillId: null,
      capitalizationEntryId: entry.id,
      capitalizationOffsetAccountId: request.offsetAccountId,
    });
  }

  /**
   * After an edit of what values the asset — before anything was charged — its capitalization
   * follows: the acquisition posted here is posted again on the new figures, and a link to a bill
   * or an entry is checked again against what it debited.
   */
  async refresh(manager: EntityManager, asset: FixedAsset, actorUserId: string | null): Promise<void> {
    if (asset.capitalizationMethod === FixedAssetCapitalization.POSTED && asset.capitalizationEntryId && asset.capitalizationOffsetAccountId) {
      const [entry] = await manager.query<{ date: string }[]>(`SELECT "date"::text AS "date" FROM "journal_entries" WHERE "id" = $1`, [
        asset.capitalizationEntryId,
      ]);
      const date = entry && entry.date >= toIsoDate(asset.acquisitionDate) ? entry.date : toIsoDate(asset.acquisitionDate);
      await this.capitalize(manager, asset, { method: FixedAssetCapitalization.POSTED, offsetAccountId: asset.capitalizationOffsetAccountId, date }, actorUserId);
      return;
    }
    if (asset.capitalizationMethod === FixedAssetCapitalization.VENDOR_BILL && asset.vendorBillId) {
      const bill = await this.billOf(manager, asset.organizationId, asset.vendorBillId);
      if (bill?.journalEntryId) await this.assertAvailable(manager, asset, bill.journalEntryId, bill.label);
      return;
    }
    if (asset.capitalizationMethod === FixedAssetCapitalization.JOURNAL_ENTRY && asset.capitalizationEntryId) {
      const entry = await this.entryOf(manager, asset.organizationId, asset.capitalizationEntryId);
      if (entry) await this.assertAvailable(manager, asset, entry.id, entry.entryNumber ?? entry.id.slice(0, 8));
    }
  }

  /**
   * Undo what the register posted to capitalize `asset`: its acquisition is reversed — on its own
   * date while that month is open, today otherwise. A link to a bill or an entry posted nothing
   * here, and undoing it posts nothing.
   */
  async release(manager: EntityManager, asset: FixedAsset, reasonKey: string, actorUserId: string | null): Promise<void> {
    if (asset.capitalizationMethod !== FixedAssetCapitalization.POSTED || !asset.capitalizationEntryId) return;
    const [entry] = await manager.query<{ date: string; is_reversed: boolean }[]>(
      `SELECT "date"::text AS "date", "is_reversed" FROM "journal_entries" WHERE "id" = $1 AND "organization_id" = $2`,
      [asset.capitalizationEntryId, asset.organizationId],
    );
    if (!entry || entry.is_reversed) return;
    const reason = await this.narrative.describe(manager, asset.organizationId, reasonKey, { asset: `${asset.number} ${asset.name}` });
    const reversalDate = (await this.isPostable(manager, asset.organizationId, entry.date)) ? entry.date : await organizationToday(manager, asset.organizationId);
    await this.assetPosting.reverse(manager, asset.capitalizationEntryId, asset.organizationId, { reversalDate, reason: reason.text }, {
      actorUserId,
      systemReason: REGISTER_REASON.acquisition,
      idempotencyKey: `fixed-asset-acquisition:${asset.id}:reversal:${asset.capitalizationEntryId}`,
    });
  }

  /**
   * The purchases and entries that debited a fixed-asset account and still have cost to register:
   * what is waiting to become an asset. Bills first by date, then entries.
   */
  async sources(
    organizationId: string,
    paging: Paging,
    filter: { accountId?: string; search?: string; vendorBillId?: string; journalEntryId?: string } = {},
  ): Promise<Page<CapitalizationSource>> {
    const manager = this.dataSource.manager;
    const ledgerId = await this.defaultLedgerId(manager, organizationId);
    const search = filter.search?.trim() ? `%${filter.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const scope = `
      WITH cost_accounts AS (${COST_ACCOUNTS_SQL}),
      debits AS (
        SELECT e."id" AS entry_id, e."entry_number", e."date", e."description", l."account_id",
               SUM(v."debit" - v."credit") AS debited
          FROM "journal_entries" e
          JOIN "journal_entry_lines" l ON l."journal_entry_id" = e."id"
          JOIN "journal_entry_line_valuations" v ON v."journal_entry_line_id" = l."id" AND v."ledger_id" = $2
         WHERE e."organization_id" = $1 AND e."status" IN ${LEDGER_STATUSES_SQL} AND NOT e."is_reversed" AND e."reverses_entry_id" IS NULL
           AND COALESCE(e."system_reason", '') NOT IN ${REGISTER_REASONS_SQL}
           AND l."account_id" IN (SELECT "id" FROM cost_accounts)
           AND ($3::uuid IS NULL OR l."account_id" = $3::uuid)
         GROUP BY e."id", l."account_id"
        HAVING SUM(v."debit" - v."credit") > 0
      ),
      registered AS (${REGISTERED_BY_SOURCE_SQL}),
      source AS (
        SELECT d.*, COALESCE(r.registered, 0) AS registered, d.debited - COALESCE(r.registered, 0) AS available,
               b."id" AS bill_id, b."supplier_invoice_number", b."supplier_fiscal_number", s."name" AS supplier,
               a."code" AS account_code, a."name" AS account_name
          FROM debits d
          JOIN "accounts" a ON a."id" = d."account_id"
          LEFT JOIN registered r ON r.entry_id = d.entry_id AND r.account_id = d.account_id
          LEFT JOIN "vendor_bills" b ON b."journal_entry_id" = d.entry_id AND b."organization_id" = $1
          LEFT JOIN "suppliers" s ON s."id" = b."vendor_id"
         WHERE d.debited - COALESCE(r.registered, 0) > 0.004
           AND ($4::text IS NULL OR d."entry_number" ILIKE $4 OR d."description" ILIKE $4 OR b."supplier_invoice_number" ILIKE $4
                OR b."supplier_fiscal_number" ILIKE $4 OR s."name" ILIKE $4)
           AND ($5::uuid IS NULL OR b."id" = $5::uuid)
           AND ($6::uuid IS NULL OR d.entry_id = $6::uuid)
      )`;
    const params = [organizationId, ledgerId, filter.accountId ?? null, search, filter.vendorBillId ?? null, filter.journalEntryId ?? null];
    const rows: Array<Record<string, unknown>> = await manager.query(
      `${scope} SELECT * FROM source ORDER BY "date" DESC, "entry_number" DESC NULLS LAST LIMIT $7 OFFSET $8`,
      [...params, paging.take, paging.skip],
    );
    const [{ total }] = await manager.query<{ total: number }[]>(`${scope} SELECT COUNT(*)::int AS total FROM source`, params);
    return toPage(
      rows.map((row) => ({
        kind: row['bill_id'] ? 'VENDOR_BILL' : 'JOURNAL_ENTRY',
        id: String(row['bill_id'] ?? row['entry_id']),
        journalEntryId: String(row['entry_id']),
        entryNumber: (row['entry_number'] as string | null) ?? null,
        date: toIsoDate(row['date'] as string | Date),
        reference: ((row['supplier_invoice_number'] ?? row['supplier_fiscal_number'] ?? row['description']) as string | null) ?? null,
        supplier: (row['supplier'] as string | null) ?? null,
        accountId: String(row['account_id']),
        accountCode: String(row['account_code']),
        accountName: row['account_name'] as LocalizedName,
        debited: amount(row['debited']),
        registered: amount(row['registered']),
        available: amount(row['available']),
      })),
      Number(total),
      paging,
    );
  }

  /**
   * The register against the ledger on `asOf`, account by account — every asset account and
   * accumulated depreciation account the register or its categories use: what the register holds
   * there that day (the assets acquired and not disposed of), what the ledger says, the difference,
   * and what explains it to the cent — the register's costs with no source in the ledger that day,
   * and the ledger's movements with no asset behind them. Those two are listed apart, by page.
   */
  async reconciliation(organizationId: string, asOf: IsoDate): Promise<ReconciliationReport> {
    const manager = this.dataSource.manager;
    const ledgerId = await this.defaultLedgerId(manager, organizationId);
    const scope = await this.accountScope(manager, organizationId);
    const counts = { unlinkedAssets: 0, untracedPostings: 0 };
    if (scope.length === 0) return { asOf, accounts: [], totals: { register: 0, ledger: 0, difference: 0, untraced: 0, unlinked: 0 }, counts };
    const accountIds = scope.map((account) => account.id);

    // The register, in debit terms: each standing asset's cost on its asset account, its
    // accumulated depreciation — the opening and every charge in the ledger by the day — on its
    // accumulated account; and what of either has no source in the ledger that day.
    const registerRows: Array<{ account_id: string; assets: number; register: string; unlinked: string }> = await manager.query(
      `${ASSETS_AS_OF}
       SELECT x.account_id, (COUNT(DISTINCT x.asset_id) FILTER (WHERE x.standing))::int AS assets,
              COALESCE(SUM(x.register), 0) AS register, COALESCE(SUM(x.unlinked), 0) AS unlinked
         FROM (
           SELECT c."asset_account_id" AS account_id, c."id" AS asset_id, c.standing,
                  CASE WHEN c.standing THEN c."cost" ELSE 0 END AS register,
                  CASE WHEN c.unlinked_reason IS NOT NULL THEN c."cost" ELSE 0 END AS unlinked
             FROM classified c WHERE c."asset_account_id" IS NOT NULL
           UNION ALL
           SELECT c."accumulated_depreciation_account_id", c."id", c.standing,
                  CASE WHEN c.standing THEN -(c."opening_accumulated_depreciation" + COALESCE(ch.amount, 0)) ELSE 0 END,
                  CASE WHEN c.unlinked_reason IS NOT NULL THEN -c."opening_accumulated_depreciation" ELSE 0 END
             FROM classified c LEFT JOIN charged ch ON ch."fixed_asset_id" = c."id"
            WHERE c."accumulated_depreciation_account_id" IS NOT NULL
         ) x
        GROUP BY x.account_id`,
      [organizationId, asOf],
    );
    // The ledger, in debit terms: each account's balance, and what of it no asset is behind.
    const ledgerRows: Array<{ account_id: string; balance: string; untraced: string }> = await manager.query(
      `${MOVEMENT_AS_OF} SELECT "account_id", SUM(net) AS balance, SUM(amount) AS untraced FROM untraced GROUP BY "account_id"`,
      [organizationId, asOf, ledgerId, accountIds],
    );
    const [{ untracedCount }] = await manager.query<{ untracedCount: number }[]>(
      `${MOVEMENT_AS_OF} SELECT COUNT(*)::int AS "untracedCount" FROM untraced WHERE ${LISTED}`,
      [organizationId, asOf, ledgerId, accountIds],
    );
    const [{ unlinkedCount }] = await manager.query<{ unlinkedCount: number }[]>(
      `${ASSETS_AS_OF} SELECT COUNT(*)::int AS "unlinkedCount" FROM classified WHERE unlinked_reason IS NOT NULL`,
      [organizationId, asOf],
    );
    counts.untracedPostings = Number(untracedCount);
    counts.unlinkedAssets = Number(unlinkedCount);

    const registerOf = new Map(registerRows.map((row) => [row.account_id, row]));
    const ledgerOf = new Map(ledgerRows.map((row) => [row.account_id, row]));
    const totals = { register: 0, ledger: 0, untraced: 0, unlinked: 0 };
    const accounts: ReconciliationAccount[] = [];
    for (const account of scope) {
      const registerRow = registerOf.get(account.id);
      const ledgerRow = ledgerOf.get(account.id);
      const debit = {
        register: toCents(Number(registerRow?.register ?? 0)),
        ledger: toCents(Number(ledgerRow?.balance ?? 0)),
        untraced: toCents(Number(ledgerRow?.untraced ?? 0)),
        unlinked: toCents(Number(registerRow?.unlinked ?? 0)),
      };
      const assets = Number(registerRow?.assets ?? 0);
      // An account the register uses but nothing reached, nor stands on, says nothing.
      if (assets === 0 && Object.values(debit).every((cents) => cents === 0)) continue;
      totals.register += debit.register;
      totals.ledger += debit.ledger;
      totals.untraced += debit.untraced;
      totals.unlinked += debit.unlinked;
      const sign = account.role === 'ACCUMULATED' ? -1 : 1;
      accounts.push({
        accountId: account.id,
        code: account.code,
        name: account.name,
        role: account.role,
        assets,
        register: fromCents(sign * debit.register),
        ledger: fromCents(sign * debit.ledger),
        difference: fromCents(sign * (debit.ledger - debit.register)),
        untraced: fromCents(sign * debit.untraced),
        unlinked: fromCents(sign * debit.unlinked),
      });
    }
    const order: Record<ReconciliationRole, number> = { COST: 0, BOTH: 1, ACCUMULATED: 2 };
    accounts.sort((a, b) => order[a.role] - order[b.role] || a.code.localeCompare(b.code));
    return {
      asOf,
      accounts,
      totals: {
        register: fromCents(totals.register),
        ledger: fromCents(totals.ledger),
        difference: fromCents(totals.ledger - totals.register),
        untraced: fromCents(totals.untraced),
        unlinked: fromCents(totals.unlinked),
      },
      counts,
    };
  }

  /**
   * The assets whose cost is not in the ledger on `asOf` — held still, or disposed of since —, each
   * with why: never linked, its source not posted or reversed by then, or posted later.
   */
  async unlinkedAssets(organizationId: string, asOf: IsoDate, paging: Paging): Promise<Page<UnlinkedAsset>> {
    const manager = this.dataSource.manager;
    const rows: Array<Record<string, unknown>> = await manager.query(
      `${ASSETS_AS_OF}
       SELECT c."id", c."number", c."name", c."asset_account_id", c."accumulated_depreciation_account_id", c."cost",
              c."opening_accumulated_depreciation", c.unlinked_reason, c.entry_id, c.entry_number, c.entry_date::text AS entry_date,
              CASE WHEN NOT c.standing THEN c."disposal_date"::text END AS disposal_date
         FROM classified c WHERE c.unlinked_reason IS NOT NULL
        ORDER BY c."number" LIMIT $3 OFFSET $4`,
      [organizationId, asOf, paging.take, paging.skip],
    );
    const [{ total }] = await manager.query<{ total: number }[]>(
      `${ASSETS_AS_OF} SELECT COUNT(*)::int AS total FROM classified WHERE unlinked_reason IS NOT NULL`,
      [organizationId, asOf],
    );
    return toPage(
      rows.map((row) => ({
        id: String(row['id']),
        number: String(row['number']),
        name: String(row['name']),
        accountId: (row['asset_account_id'] as string | null) ?? null,
        accumulatedAccountId: (row['accumulated_depreciation_account_id'] as string | null) ?? null,
        cost: amount(row['cost']),
        openingAccumulated: amount(row['opening_accumulated_depreciation']),
        reason: row['unlinked_reason'] as UnlinkedReason,
        entryId: (row['entry_id'] as string | null) ?? null,
        entryNumber: (row['entry_number'] as string | null) ?? null,
        entryDate: (row['entry_date'] as string | null) ?? null,
        disposalDate: (row['disposal_date'] as string | null) ?? null,
      })),
      Number(total),
      paging,
    );
  }

  /**
   * What the ledger moved on the register's accounts by `asOf` with no asset behind it, newest
   * first: a purchase not registered yet, what is left of one registered in part, a posting nobody
   * registered. An entry reversed by then and its reversal cancel, and neither is listed.
   */
  async untracedPostings(organizationId: string, asOf: IsoDate, paging: Paging): Promise<Page<UntracedPosting>> {
    const manager = this.dataSource.manager;
    const scope = await this.accountScope(manager, organizationId);
    if (scope.length === 0) return toPage([], 0, paging);
    const ledgerId = await this.defaultLedgerId(manager, organizationId);
    const params = [organizationId, asOf, ledgerId, scope.map((account) => account.id)];
    const rows: Array<Record<string, unknown>> = await manager.query(
      `${MOVEMENT_AS_OF} SELECT * FROM untraced WHERE ${LISTED} ORDER BY "date" DESC, "entry_number" DESC NULLS LAST, "entry_id", "account_id" LIMIT $5 OFFSET $6`,
      [...params, paging.take, paging.skip],
    );
    const [{ total }] = await manager.query<{ total: number }[]>(`${MOVEMENT_AS_OF} SELECT COUNT(*)::int AS total FROM untraced WHERE ${LISTED}`, params);
    const signOf = new Map(scope.map((account) => [account.id, account.role === 'ACCUMULATED' ? -1 : 1]));
    return toPage(
      rows.map((row) => ({
        entryId: String(row['entry_id']),
        entryNumber: (row['entry_number'] as string | null) ?? null,
        date: toIsoDate(row['date'] as string | Date),
        description: String(row['description'] ?? ''),
        accountId: String(row['account_id']),
        amount: amount((signOf.get(String(row['account_id'])) ?? 1) * Number(row['amount'])),
      })),
      Number(total),
      paging,
    );
  }

  /**
   * The accounts the register keeps — those its assets and its categories use — with what each
   * keeps: an account used for cost and for accumulated depreciation both is one row, in debit terms.
   */
  private async accountScope(
    manager: EntityManager,
    organizationId: string,
  ): Promise<Array<{ id: string; code: string; name: LocalizedName; role: ReconciliationRole }>> {
    const rows: Array<{ id: string; code: string; name: LocalizedName; for_cost: boolean; for_accumulated: boolean }> = await manager.query(
      `SELECT a."id", a."code", a."name", bool_or(x.role = 'COST') AS for_cost, bool_or(x.role = 'ACCUMULATED') AS for_accumulated
         FROM (
           SELECT "asset_account_id" AS account_id, 'COST' AS role FROM "fixed_asset" WHERE "organization_id" = $1
           UNION ALL SELECT "accumulated_depreciation_account_id", 'ACCUMULATED' FROM "fixed_asset" WHERE "organization_id" = $1
           UNION ALL SELECT "asset_account_id", 'COST' FROM "fixed_asset_categories" WHERE "organization_id" = $1
           UNION ALL SELECT "accumulated_depreciation_account_id", 'ACCUMULATED' FROM "fixed_asset_categories" WHERE "organization_id" = $1
         ) x
         JOIN "accounts" a ON a."id" = x.account_id
        GROUP BY a."id", a."code", a."name"`,
      [organizationId],
    );
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      role: row.for_cost && row.for_accumulated ? 'BOTH' : row.for_cost ? 'COST' : 'ACCUMULATED',
    }));
  }

  /**
   * The source has debited the asset's account by at least what is registered from it on that
   * account, this asset included: one bill of 200 000 cannot capitalize two assets of 150 000.
   */
  private async assertAvailable(manager: EntityManager, asset: FixedAsset, entryId: string, label: string): Promise<void> {
    if (!asset.assetAccountId) throw new BadRequestError('fixed_assets.accounts_required');
    const ledgerId = await this.defaultLedgerId(manager, asset.organizationId);
    const [{ debited }] = await manager.query<{ debited: string }[]>(
      `SELECT COALESCE(SUM(v."debit" - v."credit"), 0)::text AS debited
         FROM "journal_entry_lines" l
         JOIN "journal_entry_line_valuations" v ON v."journal_entry_line_id" = l."id" AND v."ledger_id" = $3
        WHERE l."journal_entry_id" = $1 AND l."account_id" = $2`,
      [entryId, asset.assetAccountId, ledgerId],
    );
    const [account] = await manager.query<{ code: string }[]>(`SELECT "code" FROM "accounts" WHERE "id" = $1`, [asset.assetAccountId]);
    if (toCents(Number(debited)) <= 0) {
      throw new BadRequestError('fixed_assets.capitalization_source_not_on_account', { source: label, account: account?.code ?? '' });
    }
    const [{ registered }] = await manager.query<{ registered: string }[]>(
      `SELECT COALESCE(SUM(fa."cost"), 0)::text AS registered
         FROM "fixed_asset" fa
         LEFT JOIN "vendor_bills" b ON b."id" = fa."vendor_bill_id"
        WHERE fa."organization_id" = $1 AND fa."id" <> $2 AND fa."asset_account_id" = $3
          AND ((fa."capitalization_method" = 'VENDOR_BILL' AND b."journal_entry_id" = $4)
            OR (fa."capitalization_method" = 'JOURNAL_ENTRY' AND fa."capitalization_entry_id" = $4))`,
      [asset.organizationId, asset.id ?? '00000000-0000-0000-0000-000000000000', asset.assetAccountId, entryId],
    );
    const available = roundAmount(Number(debited) - Number(registered));
    if (toCents(asset.cost) > toCents(available)) {
      throw new ConflictError('fixed_assets.capitalization_exceeds_source', {
        source: label,
        account: account?.code ?? '',
        available: Math.max(0, available),
      });
    }
  }

  /** The acquisition, posted by the register: the cost in, the opening depreciation with it, the rest against `offsetAccountId`. */
  private async postAcquisition(
    manager: EntityManager,
    asset: FixedAsset,
    offsetAccountId: string,
    date: IsoDate,
    actorUserId: string | null,
    previousEntryId: string | null,
  ) {
    const organizationId = asset.organizationId;
    if (!asset.assetAccountId) throw new BadRequestError('fixed_assets.accounts_required');
    const opening = roundAmount(asset.openingAccumulatedDepreciation);
    if (opening > 0 && !asset.accumulatedDepreciationAccountId) throw new BadRequestError('fixed_assets.accounts_required');
    const ledger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
    if (!ledger) throw new BadRequestError('fixed_assets.no_default_ledger_has_configured_organization');
    const journal = await this.journalLookup.requireByCode(organizationId, SYSTEM_JOURNALS.fixedAssets.code, manager);
    const label = `${asset.number} ${asset.name}`;
    const words = await this.narrative.describeAll(manager, organizationId, {
      header: { key: 'ledger.fixed_asset.acquisition_entry', params: { asset: label } },
      cost: { key: 'ledger.fixed_asset.acquisition_cost', params: { asset: label } },
      accumulated: { key: 'ledger.fixed_asset.acquisition_accumulated', params: { asset: label } },
      offset: { key: 'ledger.fixed_asset.acquisition_offset', params: { asset: label } },
    });
    const acquired = toIsoDate(asset.acquisitionDate);
    const line = (accountId: string, debit: number, credit: number, text: LedgerText, originDate?: string): CreateJournalEntryLineDto => ({
      accountId,
      debit,
      credit,
      ...narrated(text),
      ...(originDate ? { originDate } : {}),
      valuations: [{ ledgerId: ledger.id, debit, credit }],
    });
    const lines: CreateJournalEntryLineDto[] = [line(asset.assetAccountId, roundAmount(asset.cost), 0, words.cost, acquired)];
    if (opening > 0 && asset.accumulatedDepreciationAccountId) {
      lines.push(line(asset.accumulatedDepreciationAccountId, 0, opening, words.accumulated, acquired));
    }
    const net = roundAmount(asset.cost - opening);
    if (net > 0) lines.push(line(offsetAccountId, 0, net, words.offset));
    return this.assetPosting.createWithManager(
      manager,
      { date, ...narrated(words.header), journalId: journal.id, lines } as CreateJournalEntryDto,
      organizationId,
      // A document of the register: locked in the journal, leading back to the asset.
      { actorUserId, systemReason: REGISTER_REASON.acquisition, idempotencyKey: `fixed-asset-acquisition:${asset.id}:${previousEntryId ?? 'first'}` },
    );
  }

  private async billOf(
    manager: EntityManager,
    organizationId: string,
    billId: string,
  ): Promise<{ id: string; status: string; journalEntryId: string | null; label: string } | null> {
    const [bill] = await manager.query<Array<{ id: string; status: string; journal_entry_id: string | null; reference: string | null; supplier: string | null }>>(
      `SELECT b."id", b."status", b."journal_entry_id", COALESCE(b."supplier_invoice_number", b."supplier_fiscal_number") AS reference, s."name" AS supplier
         FROM "vendor_bills" b LEFT JOIN "suppliers" s ON s."id" = b."vendor_id"
        WHERE b."id" = $1 AND b."organization_id" = $2`,
      [billId, organizationId],
    );
    if (!bill) return null;
    const label = [bill.supplier, bill.reference].filter(Boolean).join(' · ') || bill.id.slice(0, 8);
    return { id: bill.id, status: bill.status, journalEntryId: bill.journal_entry_id, label };
  }

  private async entryOf(
    manager: EntityManager,
    organizationId: string,
    entryId: string,
  ): Promise<{ id: string; entryNumber: string | null; inLedger: boolean; isReversed: boolean; systemReason: string | null } | null> {
    const [entry] = await manager.query<Array<{ id: string; entry_number: string | null; in_ledger: boolean; is_reversed: boolean; system_reason: string | null }>>(
      `SELECT "id", "entry_number", "status" IN ${LEDGER_STATUSES_SQL} AS in_ledger, "is_reversed", "system_reason"
         FROM "journal_entries" WHERE "id" = $1 AND "organization_id" = $2`,
      [entryId, organizationId],
    );
    return entry
      ? { id: entry.id, entryNumber: entry.entry_number, inLedger: entry.in_ledger, isReversed: entry.is_reversed, systemReason: entry.system_reason }
      : null;
  }

  private async defaultLedgerId(manager: EntityManager, organizationId: string): Promise<string> {
    const ledger = await manager.findOne(Ledger, { where: { organizationId, isDefault: true }, select: ['id'] });
    if (!ledger) throw new BadRequestError('fixed_assets.no_default_ledger_has_configured_organization');
    return ledger.id;
  }

  private async isPostable(manager: EntityManager, organizationId: string, date: IsoDate): Promise<boolean> {
    try {
      await resolvePostingPeriod(manager, organizationId, date, ModuleSlug.GL);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * The accounts a fixed asset's cost lives in: those the register and its categories use, and every
 * postable non-current asset account of debit nature — where a purchase of one is booked.
 */
const COST_ACCOUNTS_SQL = `
  SELECT a."id" FROM "accounts" a
   WHERE a."organization_id" = $1 AND (
         a."id" IN (SELECT "asset_account_id" FROM "fixed_asset" WHERE "organization_id" = $1 AND "asset_account_id" IS NOT NULL)
      OR a."id" IN (SELECT "asset_account_id" FROM "fixed_asset_categories" WHERE "organization_id" = $1 AND "asset_account_id" IS NOT NULL)
      OR (a."type" = 'ASSET' AND a."category" = 'NON_CURRENT_ASSET' AND a."nature" = 'DEBIT' AND a."isPostable" AND a."isActive"))`;

/**
 * Every asset acquired by `$2`, with the entry it names as its source — its own acquisition, or its
 * bill's or entry's — and, when that source is not in the ledger that day, why. `standing`: not
 * disposed of by then. `charged`: each asset's depreciation in the ledger by then, on its entries'
 * dates — a month charged before its bill arrived counts from its month.
 */
const ASSETS_AS_OF = `
  WITH source AS (
    SELECT fa."id", fa."number", fa."name", fa."cost", fa."opening_accumulated_depreciation", fa."acquisition_date", fa."disposal_date",
           fa."asset_account_id", fa."accumulated_depreciation_account_id", fa."capitalization_method",
           COALESCE(ce."id", be."id") AS entry_id,
           COALESCE(ce."entry_number", be."entry_number") AS entry_number,
           COALESCE(ce."date", be."date") AS entry_date,
           COALESCE(ce."status", be."status") IN ${LEDGER_STATUSES_SQL} AS entry_posted
      FROM "fixed_asset" fa
      LEFT JOIN "journal_entries" ce ON ce."id" = fa."capitalization_entry_id"
      LEFT JOIN "vendor_bills" b ON b."id" = fa."vendor_bill_id" AND fa."capitalization_method" = 'VENDOR_BILL'
      LEFT JOIN "journal_entries" be ON be."id" = b."journal_entry_id"
     WHERE fa."organization_id" = $1 AND fa."acquisition_date" <= $2::date
  ),
  classified AS (
    SELECT s.*,
           (s."disposal_date" IS NULL OR s."disposal_date" > $2::date) AS standing,
           CASE
             WHEN s."capitalization_method" = 'UNLINKED' THEN 'NEVER_LINKED'
             WHEN s.entry_id IS NULL OR NOT COALESCE(s.entry_posted, false) THEN 'SOURCE_NOT_POSTED'
             WHEN EXISTS (SELECT 1 FROM "journal_entries" r
                           WHERE r."reverses_entry_id" = s.entry_id AND r."date" <= $2::date AND r."status" IN ${LEDGER_STATUSES_SQL}) THEN 'SOURCE_REVERSED'
             WHEN s.entry_date > $2::date THEN 'SOURCE_LATER'
           END AS unlinked_reason
      FROM source s
  ),
  charged AS (
    SELECT d."fixed_asset_id", SUM(d."amount") AS amount
      FROM "fixed_asset_depreciations" d
      JOIN "journal_entries" e ON e."id" = d."journal_entry_id"
     WHERE d."organization_id" = $1 AND e."date" <= $2::date AND e."status" IN ${LEDGER_STATUSES_SQL}
     GROUP BY d."fixed_asset_id"
  )`;

/**
 * The ledger on the register's accounts (`$4`) by `$2`, in the default ledger (`$3`), entry by
 * entry and account by account, in debit terms — and what of each no asset is behind (`amount`):
 *
 *  - the register's own accounting is traced by construction: each asset's current acquisition,
 *    its disposal, its depreciation runs, and the reversal of any of them;
 *  - a bill or an entry still in the ledger is traced for what the assets acquired by then
 *    registered from it — their cost on the asset account, their opening depreciation on the
 *    accumulated one;
 *  - an entry reversed by then is nobody's source: it and its reversal cancel;
 *  - anything else — an acquisition replaced since, a purchase nobody registered — is untraced.
 */
const MOVEMENT_AS_OF = `
  WITH lines AS (
    SELECT e."id" AS entry_id, e."entry_number", e."date", e."description", e."reverses_entry_id", e."system_reason",
           o."system_reason" AS reversed_reason, l."account_id", SUM(v."debit" - v."credit") AS net
      FROM "journal_entries" e
      LEFT JOIN "journal_entries" o ON o."id" = e."reverses_entry_id"
      JOIN "journal_entry_lines" l ON l."journal_entry_id" = e."id"
      JOIN "journal_entry_line_valuations" v ON v."journal_entry_line_id" = l."id" AND v."ledger_id" = $3
     WHERE e."organization_id" = $1 AND e."status" IN ${LEDGER_STATUSES_SQL} AND e."date" <= $2::date
       AND l."account_id" = ANY($4::uuid[])
     GROUP BY e."id", o."system_reason", l."account_id"
  ),
  reversed AS (
    SELECT DISTINCT r."reverses_entry_id" AS "id" FROM "journal_entries" r
     WHERE r."organization_id" = $1 AND r."reverses_entry_id" IN (SELECT entry_id FROM lines)
       AND r."date" <= $2::date AND r."status" IN ${LEDGER_STATUSES_SQL}
  ),
  acquisitions AS (
    SELECT fa."capitalization_entry_id" AS "id" FROM "fixed_asset" fa
     WHERE fa."organization_id" = $1 AND fa."capitalization_method" = 'POSTED' AND fa."capitalization_entry_id" IS NOT NULL
  ),
  registered AS (
    SELECT x.entry_id, x.account_id, SUM(x.amount) AS amount FROM (
      SELECT COALESCE(fa."capitalization_entry_id", b."journal_entry_id") AS entry_id, fa."asset_account_id" AS account_id, fa."cost" AS amount
        FROM "fixed_asset" fa
        LEFT JOIN "vendor_bills" b ON b."id" = fa."vendor_bill_id" AND fa."capitalization_method" = 'VENDOR_BILL'
       WHERE fa."organization_id" = $1 AND fa."capitalization_method" IN ('VENDOR_BILL', 'JOURNAL_ENTRY') AND fa."acquisition_date" <= $2::date
      UNION ALL
      SELECT COALESCE(fa."capitalization_entry_id", b."journal_entry_id"), fa."accumulated_depreciation_account_id", -fa."opening_accumulated_depreciation"
        FROM "fixed_asset" fa
        LEFT JOIN "vendor_bills" b ON b."id" = fa."vendor_bill_id" AND fa."capitalization_method" = 'VENDOR_BILL'
       WHERE fa."organization_id" = $1 AND fa."capitalization_method" IN ('VENDOR_BILL', 'JOURNAL_ENTRY') AND fa."acquisition_date" <= $2::date
         AND fa."opening_accumulated_depreciation" <> 0
    ) x
     WHERE x.entry_id IS NOT NULL AND x.account_id IS NOT NULL
     GROUP BY x.entry_id, x.account_id
  ),
  untraced AS (
    SELECT l.*,
           CASE
             WHEN l."system_reason" IN ${TRACED_REASONS_SQL} OR l.reversed_reason IN ${TRACED_REASONS_SQL} THEN 0
             WHEN l.entry_id IN (SELECT "id" FROM acquisitions) OR l."reverses_entry_id" IN (SELECT "id" FROM acquisitions) THEN 0
             WHEN l.entry_id IN (SELECT "id" FROM reversed) THEN l.net
             ELSE l.net - COALESCE(r.amount, 0)
           END AS amount
      FROM lines l
      LEFT JOIN registered r ON r.entry_id = l.entry_id AND r.account_id = l.account_id
  )`;

/**
 * Listed: what no asset is behind. An entry reversed by the day and its reversal cancel to the
 * cent, and neither is listed — listed, they would read as two movements nobody explained.
 */
const LISTED = `abs(untraced.amount) > 0.004 AND untraced."reverses_entry_id" IS NULL AND untraced.entry_id NOT IN (SELECT "id" FROM reversed)`;

/** The cost registered from each source entry, on each asset account. */
const REGISTERED_BY_SOURCE_SQL = `
  SELECT COALESCE(fa."capitalization_entry_id", b."journal_entry_id") AS entry_id, fa."asset_account_id" AS account_id, SUM(fa."cost") AS registered
    FROM "fixed_asset" fa
    LEFT JOIN "vendor_bills" b ON b."id" = fa."vendor_bill_id" AND fa."capitalization_method" = 'VENDOR_BILL'
   WHERE fa."organization_id" = $1 AND fa."capitalization_method" IN ('VENDOR_BILL', 'JOURNAL_ENTRY')
   GROUP BY 1, 2`;

function amount(value: unknown): number {
  return roundAmount(Number(value ?? 0)) || 0;
}

/** An amount from its cents, a credit shown as a debit's opposite never reading «-0». */
function fromCents(cents: number): number {
  return cents / 100 || 0;
}
