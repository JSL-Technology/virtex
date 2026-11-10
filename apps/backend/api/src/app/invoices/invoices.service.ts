import { Injectable, Logger } from '@nestjs/common';
import { likeTerm } from '../common/database/search-term';
import { BUSINESS_EVENTS } from '../contracts/business-events/business-events.contract';
import { standardSalesTaxRate } from '../inventory/contracts/sellable-product.contract';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Invoice,
  InvoiceStatus,
  InvoiceType,
  ModificationCode,
  DebitNoteReason,
  CancellationMode,
  PaymentMethod,
} from './entities/invoice.entity';
import { InvoiceLineItem, TaxTreatment } from './entities/invoice-line-item.entity';
import { CreateInvoiceDto, InvoiceLineDto } from './dto/create-invoice.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CancelInvoiceBodyDto, DebitNoteBodyDto } from './dto/debit-note.dto';
import {
  cancellationRouteFor,
  fiscalAuthorityOf,
  fiscalDocumentTypesFor,
  fiscalIdentifierLabel,
  knownMarket,
  marketFor,
  type CancellationRoute,
} from '../markets';
import { fiscalReasonsOn, type FiscalReason } from '../localization/contracts/fiscal-reasons.contract';
import { CustomersService } from '../customers/customers.service';
import { InventoryService } from '../inventory/inventory.service';
import { Product, ProductKind } from '../inventory/entities/product.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { FiscalAdapterFactory } from './adapters/fiscal-adapter.factory';
import { DocumentSequencesService } from '../shared/document-sequences/document-sequences.service';
import { DocumentType } from '../shared/document-sequences/entities/document-sequence.entity';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { EcfSubmissionService } from '../einvoicing/services/ecf-submission.service';
import { InvoicePostingService } from './services/invoice-posting.service';
import { PriceResolver, type ResolvedPrice } from '../price-lists/price-resolver.service';
import { FiscalSubmissionService } from '../einvoicing/services/fiscal-submission.service';
import { TransmissionConfigService } from '../einvoicing/services/transmission-config.service';
import { ComputedDocument, computeDocument, TaxableLineInput } from './sales-tax.engine';
import { statutoryTaxRatesOn } from '../localization/contracts/statutory-tax-rates.contract';
import { roundAmount, roundToCurrency, toMinorUnits } from '../common/money';
import { WithholdingResolverService } from './services/withholding-resolver.service';
import { TenantBookkeepingProvisioner } from '../accounting/provisioning/tenant-bookkeeping.provisioner';
import { EcfSubmission } from '../einvoicing/entities/ecf-submission.entity';
import { InvoiceRenderContext } from './services/invoice-renderer.service';
import { EmissionKind, FiscalDocumentTypeOption } from './interfaces/fiscal-adapter.interface';
import { certificatePolicyFor } from '../einvoicing/contracts/certificate-policy';
import type { FiscalEmissionMode } from '../organizations/contracts/fiscal-emission-mode.contract';

/** One type the invoice form may offer, with what stands in its way (see `issuableTypes`). */
/** How each line of a previewed document was priced, in the order of its lines. */
export interface LinePricing {
  unitPrice: number;
  priceListId: string | null;
  listPrice: number | null;
}

/** A preview: the computed figures, and the price each line will carry. */
export type PreviewedDocument = ComputedDocument & { pricing: LinePricing[] };

export interface IssuableTypeOption extends FiscalDocumentTypeOption {
  /** Always stated here: from the adapter, or from the market's catalogue. */
  electronic: boolean;
  /** The company holds a live range for it. */
  available: boolean;
  /** Available, and nothing else is missing: it can be issued now. */
  issuable: boolean;
  /** Catalogue key naming what is missing, or null. */
  blockedBy: string | null;
}

export interface IssuableTypes {
  mode: FiscalEmissionMode;
  options: IssuableTypeOption[];
  certificateReady: boolean;
  /**
   * The kind an invoice with no type chosen is issued as, in a market that has both kinds; null
   * where there is no choice to make.
   */
  automaticKind: EmissionKind | null;
  /** The market has traditional and electronic types: the emission mode means something there. */
  bothKinds: boolean;
  /** The market's electronic documents are signed with a certificate the company uploads. */
  certificateRequired: boolean;
}
import { fiscalDate, organizationTimeZone } from '../shared/fiscal-clock';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { Tax, TaxType } from '../taxes/entities/tax.entity';
import { TaxDeterminationService } from '../localization/fiscal/tax-determination/tax-determination.service';
import {
  TaxDetermination,
  TaxDeterminationAddress,
} from '../localization/fiscal/tax-determination/tax-determination.types';
import { Customer } from '../customers/entities/customer.entity';
import { toIsoDate } from '../common/dates';
import {
  TransitionPreview,
  Precondition,
  TransitionEffect,
  LedgerEffect,
  LedgerEffectLine,
} from '../shared/transitions/transition-preview';
import { REMEDIES } from '../shared/transitions/remedies';
import { runAsTenantJob } from '../shared/tenancy/tenant-job';
import { I18nService } from '../i18n/i18n.service';
import { currentLanguage } from '../i18n/request-locale';
import { isLocalizedError } from '../i18n/localized.exception';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { applyBranchScope, assertDocumentInScope, loadBranchScope, reassignDocumentBranch, resolveDocumentBranch } from '../organizations/contracts/branch.contract';

export interface InvoiceListQuery {
  page?: number;
  limit?: number;
  status?: InvoiceStatus;
  customerId?: string;
  /** Leave drafts out: what a customer sees of their own documents (CS-01). */
  excludeDrafts?: boolean;
  /** One branch. Refused if it is outside the caller's branches. */
  branchId?: string;
  /** Who is asking; when given, the list never shows documents outside their branches. */
  actorUserId?: string;
  from?: string;
  to?: string;
  search?: string;
  /** A column of the list (`INVOICE_LIST_SORT`); anything else keeps the default order. */
  sort?: string;
  direction?: string;
}

/**
 * The columns the invoice list can be ordered by (QA B-01). A whitelist, because the value comes
 * from the query string and becomes SQL: an unknown column is ignored, never interpolated.
 */
export const INVOICE_LIST_SORT: Readonly<Record<string, string>> = {
  number: 'invoice.invoiceNumber',
  fiscalNumber: 'invoice.fiscalNumber',
  customer: 'invoice.customerName',
  issueDate: 'invoice.issueDate',
  dueDate: 'invoice.dueDate',
  total: 'invoice.total',
  status: 'invoice.status',
};

/** What the invoicing screen needs to present a correct form for this tenant's market. */
export interface InvoicingContext {
  ready: boolean;
  missing: string[];
  countryCode: string | null;
  baseCurrency: string;
  taxRates: number[];
  /**
   * The fixed taxes of the tenant's catalogue in force today (FAC-TX-01), with their amount per
   * unit in the books' currency: what a product can carry beside its rate.
   */
  fixedTaxes: Array<{ id: string; name: string; amount: number }>;
  /**
   * Whether the market's regime issues sales debit notes through the product (FAC-INV-05): the
   * screen offers one only where the server would issue it.
   */
  debitNotes: boolean;
  taxRequiresConfiguration: boolean;
  /**
   * How the market's tax is set (`markets/<cc>/taxes.ts`). `BY_JURISDICTION` (the United States) means
   * the rate is determined from the buyer's address and the jurisdictions the company registered —
   * the form shows the rate the server determined instead of asking for one.
   */
  taxModel: 'NATIONAL_RATES' | 'BY_JURISDICTION';
  /**
   * The jurisdictions the company collects in, in a `BY_JURISDICTION` market: state and combined
   * rate, so the form can say «sales tax by destination — 2 states registered» or send the person
   * to register the first one.
   */
  registeredJurisdictions: Array<{ stateCode: string; rate: number }>;
  /**
   * In a `BY_JURISDICTION` market, what happens with no jurisdiction registered: the United States
   * invoices without tax (no nexus, no tax), every other market refuses to issue until its tax is
   * configured (LOC-01). The form used to tell a Brazilian company, in the United States' words,
   * that its invoice «will be issued without tax» — which the server then refused (audit
   * 2026-11-07, LOC-03).
   */
  untaxedWithoutRegistration: boolean;
  /** The types the company may offer on an invoice, each with what stands in its way. */
  fiscalDocumentTypes: IssuableTypeOption[];
  /** Traditional, electronic, or both (`OrganizationSettings.fiscalEmissionMode`). */
  emissionMode: FiscalEmissionMode;
  /** The kind an invoice with no type chosen is issued as, or null where there is no choice. */
  automaticKind: EmissionKind | null;
  /** The market has both kinds of document, so the emission mode applies to it. */
  emissionModeApplies: boolean;
  /** The market's electronic documents need a signing certificate the company uploads. */
  certificateRequired: boolean;
  /** The market's tax authority, as it calls itself (`DGII`, `SAT`, `DIAN`), or null. */
  fiscalAuthority: string | null;
  /** The name of the company's fiscal identifier in its market (`RNC`, `RFC`, `NIT`…). */
  taxIdLabel: string;
  serviceChargeRate: number;
  /**
   * The tenant's default credit period in days, for a customer with no terms of their own.
   *
   * A new invoice used to open with its due date equal to its issue date — "due on receipt" —
   * whatever terms the business actually sells on, and the ageing report then called the document
   * overdue the next morning.
   */
  defaultPaymentTermDays: number;
  /**
   * Today in the tenant's own time zone, `YYYY-MM-DD`: the date a new document opens with.
   *
   * The form used to take the BROWSER's date. A browser on UTC — or a person travelling — dated a
   * Dominican invoice the next day every evening after 20:00, while the stock movement and the
   * ledger, which use the tenant's clock, kept the right day.
   */
  today: string;
}

export interface PaginatedInvoices {
  items: Invoice[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * The sales-document lifecycle: build, issue, credit, collect.
 *
 * ## The shape of the rewrite
 *
 * A document is now built in two distinct steps, because conflating them was the source of several
 * defects at once:
 *
 * * **Building** computes the lines and totals and assigns an internal number. It consumes no
 *   fiscal numbering, moves no stock and posts nothing. This is what a draft is — previously every
 *   document was issued the moment it was created, so preparing one burned an e-NCF that the DGII
 *   then expected to receive.
 * * **Issuing** draws the fiscal number, moves the stock, posts the ledger entry and hands the
 *   document to the e-CF pipeline. All of it inside one transaction, so a document is never issued
 *   without its accounting, and its accounting never exists without the document.
 *
 * Amounts are never taken from the request. Prices and tax treatment come from the catalogue, the
 * arithmetic comes from `sales-tax.engine.ts`, and the request may only choose among options the
 * catalogue and the market actually allow.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    private readonly orgSettings: OrgSettingsService,
    private readonly exchangeRateResolver: ExchangeRateResolver,
    private readonly customersService: CustomersService,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly documentSequencesService: DocumentSequencesService,
    private readonly fiscalAdapterFactory: FiscalAdapterFactory,
    private readonly saasService: SaasService,
    private readonly ecfSubmissionService: EcfSubmissionService,
    private readonly posting: InvoicePostingService,
    private readonly i18n: I18nService,
    private readonly bookkeeping: TenantBookkeepingProvisioner,
    /** Decides what the buyer withholds, from the parties and the sale, not from the request. */
    private readonly withholdingResolver: WithholdingResolverService,
    /** Decides the rate where the market has no national one: the United States, Brazil. */
    private readonly taxDetermination: TaxDeterminationService,
    /** The customer's price list, the default list for the currency, then the catalogue. */
    private readonly prices: PriceResolver,
    /** The electronic regimes of every market but DO: outbox, transmission and verdict (FAC-EINV-01). */
    private readonly fiscalSubmissions: FiscalSubmissionService,
    private readonly transmission: TransmissionConfigService,
  ) {}

  /** Invoices whose regime submission was registered in this process, to transmit after commit. */
  private readonly regimeSubmissionsToSend = new Set<string>();

  // ── Creation ───────────────────────────────────────────────────────────────

  /**
   * Create a document. Issued immediately unless the caller asks for a draft.
   *
   * The e-CF transmission is triggered AFTER the transaction commits: a slow or unreachable DGII
   * must never roll back a sale that is already recorded.
   */
  async create(dto: CreateInvoiceDto, organizationId: string, actorUserId: string | null = null): Promise<Invoice> {
    const issue = dto.issue !== false;

    const created = await this.dataSource.transaction(async (manager) => {
      const invoice = await this.buildDocument(dto, organizationId, manager);
      // Where it was issued: the branch asked for if the person may use it, else theirs, else the
      // headquarters; none for a company without branches. See `resolveDocumentBranch`.
      invoice.branchId = await resolveDocumentBranch(manager, organizationId, actorUserId, dto.branchId);
      const saved = await manager.save(invoice);
      if (!issue) {
        this.logger.log(`Borrador ${saved.invoiceNumber} creado.`);
        return saved;
      }
      return this.issueWithin(saved, dto.fiscalDocumentType ?? null, organizationId, manager);
    });

    // Every new invoice, draft or issued, is a business fact a process may start from.
    this.eventEmitter.emit(BUSINESS_EVENTS.INVOICE_CREATED, {
      organizationId,
      actorUserId,
      invoiceId: created.id,
      invoiceNumber: created.invoiceNumber,
      status: created.status,
      total: Number(created.total ?? 0),
      currencyCode: (created as { currencyCode?: string }).currencyCode ?? null,
      customerId: created.customer?.id ?? (created as { customerId?: string }).customerId ?? null,
      customerName: (created.customer as { companyName?: string } | undefined)?.companyName ?? null,
    });
    if (created.status !== InvoiceStatus.DRAFT) {
      this.eventEmitter.emit('invoice.issued', created);
      this.triggerFiscalTransmission(created);
    }
    return created;
  }

  /** Turn an existing draft into an issued document. */
  async issue(invoiceId: string, organizationId: string, type?: string): Promise<Invoice> {
    const issued = await this.dataSource.transaction(async (manager) => {
      // The draft, locked before its status is read. Six concurrent issues of one draft used to
      // all read DRAFT and all draw an NCF: the invoice kept the last and five fiscal numbers were
      // burned — a gap the DGII sees (audit 2026-10-31, INV-01). The second issuer now waits, then
      // reads ISSUED and is refused before reaching the numbering.
      await manager.query(
        `SELECT "id" FROM "invoices" WHERE "id" = $1 AND "organization_id" = $2 FOR UPDATE`,
        [invoiceId, organizationId],
      );
      const invoice = await manager.getRepository(Invoice).findOne({
        where: { id: invoiceId, organizationId },
        relations: ['lineItems', 'customer'],
      });
      if (!invoice) throw new NotFoundError('invoices.invoice_invoice_id_not_found', { invoiceId });
      if (invoice.status !== InvoiceStatus.DRAFT) {
        throw new ConflictError('invoices.document_invoice_number_has_already_issued', { invoiceNumber: invoice.invoiceNumber });
      }
      return this.issueWithin(invoice, type ?? null, organizationId, manager);
    });

    this.eventEmitter.emit('invoice.issued', issued);
    this.triggerFiscalTransmission(issued);
    return issued;
  }

  /**
   * What issuing this invoice would do, without doing it.
   *
   * Runs `issueWithin` — the real transition, not a re-derivation of it — inside a transaction that
   * is always rolled back, then reads the rows it wrote. A second function that worked out what
   * WOULD happen would be a second source of truth about money, and the two would drift.
   *
   * Nothing escapes the rollback: the fiscal number, the stock movement and both postings are
   * database writes, and the non-database effects (`invoice.issued`, the e-CF submission) are
   * emitted by `issue()` AFTER its transaction commits, so this path never reaches them.
   */
  async previewIssue(
    invoiceId: string,
    organizationId: string,
    type?: string,
  ): Promise<TransitionPreview> {
    const preconditions: Precondition[] = [];
    const effects: TransitionEffect[] = [];

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      const manager = runner.manager;
      const invoice = await manager.getRepository(Invoice).findOne({
        where: { id: invoiceId, organizationId },
        relations: ['lineItems', 'customer'],
      });

      if (!invoice) throw new NotFoundError('invoices.invoice_invoice_id_not_found', { invoiceId });

      if (invoice.status !== InvoiceStatus.DRAFT) {
        preconditions.push({
          code: 'invoices.document_invoice_number_has_already_issued',
          status: 'failed',
          messageKey: 'invoices.document_invoice_number_has_already_issued',
          params: { invoiceNumber: invoice.invoiceNumber },
        });
        return { canExecute: false, preconditions, effects };
      }

      preconditions.push({
        code: 'invoices.precondition.draft',
        status: 'passed',
        messageKey: 'invoices.precondition.draft',
        params: {},
      });

      const issued = await this.issueWithin(invoice, type ?? null, organizationId, manager);

      // Everything below reads back what the real code just wrote, inside the doomed transaction.
      if (issued.fiscalNumber) {
        effects.push({
          kind: 'sequence',
          titleKey: 'invoices.effect.fiscal_number',
          value: issued.fiscalNumber,
          documentType: issued.fiscalDocumentType ?? undefined,
        });
        preconditions.push({
          code: 'invoices.precondition.sequence_available',
          status: 'passed',
          messageKey: 'invoices.precondition.sequence_available',
          params: { number: issued.fiscalNumber },
        });
      }

      for (const [entryId, titleKey] of [
        [issued.journalEntryId, 'invoices.effect.revenue_entry'],
        [issued.costJournalEntryId, 'invoices.effect.cost_entry'],
      ] as const) {
        if (!entryId) continue;
        const effect = await this.describeLedgerEffect(entryId, titleKey, manager);
        if (effect) effects.push(effect);
      }

      const movements = (issued.lineItems ?? []).filter((l) => l.productId && !l.isService);
      if (movements.length) {
        effects.push({
          kind: 'stock',
          titleKey: 'invoices.effect.stock',
          movements: movements.map((l) => ({
            productName: l.description ?? l.productId ?? '',
            quantity: Number(l.quantity),
          })),
        });
      }

      return { canExecute: true, preconditions, effects };
    } catch (error) {
      // A domain error IS the blocking precondition, phrased by the code that would have blocked it.
      if (isLocalizedError(error)) {
        preconditions.push({
          code: error.code,
          status: 'failed',
          messageKey: error.messageKey,
          params: error.params,
          remedy: REMEDIES[error.code],
        });
        return { canExecute: false, preconditions, effects };
      }
      throw error;
    } finally {
      // Always. A preview that could commit would be the most expensive bug in the product.
      await runner.rollbackTransaction().catch(() => undefined);
      await runner.release().catch(() => undefined);
    }
  }

  /** One posted entry, expressed as debit/credit lines a person can read. */
  private async describeLedgerEffect(
    entryId: string,
    titleKey: string,
    manager: EntityManager,
  ): Promise<LedgerEffect | null> {
    // tenant-scope-guard-allow: el asiento que esta misma transacción acaba de contabilizar, por
    // su id. `journal_entries` lleva política de aislamiento, que es la red debajo.
    const entry = await manager.getRepository(JournalEntry).findOne({
      where: { id: entryId },
      relations: ['lines'],
    });
    if (!entry) return null;

    const accountIds = [...new Set((entry.lines ?? []).map((l) => l.accountId))];
    const accounts = accountIds.length
      ? await manager.getRepository(Account).find({ where: { id: In(accountIds) } })
      : [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const language = currentLanguage();

    const lines: LedgerEffectLine[] = (entry.lines ?? []).map((line) => {
      const account = byId.get(line.accountId);
      const name = account?.name;
      return {
        accountCode: account?.code ?? '',
        accountName:
          typeof name === 'string' ? name : (name?.[language] ?? Object.values(name ?? {})[0] ?? ''),
        debit: Number(line.debit ?? 0),
        credit: Number(line.credit ?? 0),
        description: line.description,
      };
    });

    return {
      kind: 'ledger',
      titleKey,
      currencyCode: entry.currencyCode ?? '',
      lines,
      totalDebit: lines.reduce((sum, l) => sum + l.debit, 0),
      totalCredit: lines.reduce((sum, l) => sum + l.credit, 0),
    };
  }

  /**
   * Everything that makes a document real, in the caller's transaction: plan limit, fiscal number,
   * stock movement and ledger posting.
   */
  private async issueWithin(
    invoice: Invoice,
    requestedType: string | null,
    organizationId: string,
    manager: EntityManager,
  ): Promise<Invoice> {
    // Counted at issuance, not at draft: a plan quota is about documents that exist fiscally.
    // A credit note is not metered. It corrects a sale already counted, and a voided invoice is
    // undone with one: refusing it when the quota is spent left a taxpayer unable to correct a
    // document — a fiscal obligation — until the next billing month (audit 2026-11-07, FAC-INV-01).
    if (invoice.type !== InvoiceType.CREDIT_NOTE) {
      await this.saasService.enforceLimit(manager, organizationId, SaasResource.INVOICES);
    }

    const adapter = await this.fiscalAdapterFactory.getAdapter(organizationId, manager);

    // Which kind an invoice is issued as when nobody chose a type, and whether a chosen type is
    // one the company issues at all. A credit note follows the document it modifies instead.
    const organization = await manager
      .getRepository(Organization)
      .findOne({ where: { id: organizationId }, select: ['id', 'country', 'taxId'] });
    const countryCode = organization?.country ?? null;
    let emissionKind: EmissionKind | null = null;
    if (invoice.type === InvoiceType.INVOICE) {
      const issuable = await this.issuableTypes(
        organizationId,
        countryCode,
        await this.fiscalToday(organizationId, manager),
        manager,
      );
      if (requestedType && issuable.options.length && !issuable.options.some((o) => o.code === requestedType.toUpperCase())) {
        throw new BadRequestError('invoices.document_type_not_allowed_by_emission_mode', {
          type: requestedType,
        });
      }
      emissionKind = requestedType ? null : issuable.automaticKind;
    }

    // The same requirement the context reports, enforced where the number is drawn (QA R3-A11).
    if ((await this.issuableTypes(organizationId, countryCode, await this.fiscalToday(organizationId, manager), manager)).options.length > 0
      && !organization?.taxId?.trim()) {
      throw new BadRequestError('invoices.issuer_tax_id_required');
    }

    let assignment;
    if (invoice.type === InvoiceType.CREDIT_NOTE) {
      assignment = await adapter.assignCreditNoteNumber({
        invoice,
        organizationId,
        manager,
        requestedType,
        originalInvoice: await this.requireOriginal(invoice, organizationId, manager),
      });
    } else if (invoice.type === InvoiceType.DEBIT_NOTE) {
      // A market whose regime cannot issue one through the product refuses it before a number is
      // drawn, rather than numbering a document its authority would reject (FAC-INV-05).
      if (!adapter.assignDebitNoteNumber) {
        throw new BadRequestError('invoices.debit_note_not_supported_in_market', { country: countryCode ?? '—' });
      }
      assignment = await adapter.assignDebitNoteNumber({
        invoice,
        organizationId,
        manager,
        requestedType,
        originalInvoice: await this.requireOriginal(invoice, organizationId, manager),
      });
    } else {
      assignment = await adapter.assignSalesNumber({ invoice, organizationId, manager, requestedType, emissionKind });
    }

    invoice.fiscalNumber = assignment.fiscalNumber;
    invoice.fiscalDocumentType = assignment.documentType;
    invoice.fiscalNumberExpiresAt = assignment.expiresAt;
    invoice.fiscalSequence = assignment.sequence;
    invoice.fiscalSeries = assignment.series;

    // An electronic document that cannot be signed must not be issued: its number would be
    // consumed and the authority would never receive it. Checked before anything is written, so
    // the issue preview shows it as the blocking condition, with the way to fix it. In every market
    // whose regime signs with the company's certificate, not only the Dominican one.
    const owesTransmission =
      this.needsSignature(countryCode, assignment.documentType) && this.fiscalSubmissions.handles(countryCode);
    if (this.needsSignature(countryCode, assignment.documentType)) {
      await this.ecfSubmissionService.assertReadyToSign(organizationId, manager);
    }
    // An electronic document nobody can transmit must not be issued either: its number would be
    // spent on a document the authority never receives (FAC-EINV-01). The channel is the
    // tenant's own (FAC-EINV-04), configured in settings.
    if (owesTransmission && !(await this.transmission.isConfigured(organizationId, countryCode as string, manager))) {
      throw new BadRequestError('invoices.transmission_not_configured', { country: countryCode });
    }

    invoice.issuedAt = new Date();
    invoice.status =
      invoice.type === InvoiceType.CREDIT_NOTE ? InvoiceStatus.CREDIT_NOTE : InvoiceStatus.PENDING;

    if (invoice.type === InvoiceType.INVOICE) {
      await this.moveStockForIssue(invoice, manager);
    }

    await this.posting.post(invoice, manager);
    const saved = await manager.save(invoice);

    // The transmission it owes commits with it (see `EcfSubmissionService.registerPending`).
    if (saved.isElectronicFiscalDocument) {
      await this.ecfSubmissionService.registerPending(saved, manager);
    } else if (owesTransmission) {
      // The outbox row commits with the invoice: the obligation to transmit cannot be lost.
      await this.fiscalSubmissions.registerPending(saved, countryCode as string, manager);
      this.regimeSubmissionsToSend.add(saved.id);
    }

    this.logger.log(
      `Documento ${saved.invoiceNumber}${saved.fiscalNumber ? ` / ${saved.fiscalNumber}` : ''} emitido ` +
        `por ${saved.total.toFixed(2)} ${saved.currencyCode}.`,
    );
    return saved;
  }

  /**
   * The rate a sale bears in a market with no national rate — the United States, Brazil.
   *
   * Applied to every taxed line of the document, replacing whatever rate the request or the
   * catalogue carried. In these markets the rate is a property of **where the goods go**, not of
   * the product: the same item is 8.25 % in one Texas city and 6.25 % in another, and the seller
   * collects nothing at all in a state it is not registered in. Until now
   * `allowedTaxFractions` returned null for them and the client's number was stored verbatim.
   *
   * Returns null where the country's rate does come from a table, which is every other market.
   */
  private async determinedTaxRate(
    organizationId: string,
    countryCode: string | null,
    customer: Customer,
    organizationAddress: TaxDeterminationAddress | null,
    asOf: string,
  ): Promise<{ rate: number; determination: TaxDetermination } | null> {
    if (!this.taxDetermination.requiresDetermination(countryCode)) return null;

    const determination = await this.taxDetermination.determine({
      organizationId,
      destination: {
        countryCode: (customer.country ?? countryCode ?? '').toUpperCase(),
        stateCode: customer.stateOrProvince ?? null,
        city: customer.city ?? null,
        postalCode: customer.postalCode ?? null,
      },
      origin: organizationAddress,
      asOf,
    });

    if (determination.outcome === 'NOT_DETERMINABLE') {
      // Issuing here would be guessing the rate, which is what this replaces. The message names
      // what is missing — usually the buyer's state — so it can be fixed in one edit.
      throw new BadRequestError(
        determination.reasonKey ?? 'localization.tax_sale_could_not_determined',
        determination.reasonParams ?? {},
      );
    }

    return { rate: determination.rate, determination };
  }

  /**
   * The rates in the tenant's own tax catalogue, as fractions.
   *
   * The catalogue is seeded from the market's taxes at provisioning and editable afterwards,
   * and until now nothing in the calculation path read it: a tenant that added a reduced rate for
   * a specific good, or absorbed a rate decreed between releases, had it refused as a rate its
   * country does not levy. Two sources of truth for one fact, and the maintained one was dead.
   */
  private async tenantTaxRates(
    organizationId: string,
    manager: EntityManager,
    onDate?: string,
  ): Promise<number[]> {
    const taxes = await manager.getRepository(Tax).find({
      where: { organizationId },
      select: { id: true, rate: true, type: true, effectiveFrom: true, effectiveTo: true },
    });
    return taxes
      // A fixed-amount tax is not a rate (audit 2026-11-07, FAC-TX-01): «Fijo 50» used to admit a
      // 50 % ITBIS on any line.
      .filter((tax) => (tax.type ?? TaxType.PERCENTAGE) === TaxType.PERCENTAGE)
      // Only what is in force on the document's date (LOC-06).
      .filter((tax) => !onDate || ((!tax.effectiveFrom || tax.effectiveFrom <= onDate) && (!tax.effectiveTo || tax.effectiveTo >= onDate)))
      .map((tax) => Number(tax.rate) / 100)
      .filter((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 1);
  }

  /**
   * Everything a document's tax validation needs for its date (audit 2026-11-07, SP-03): the
   * national rates in force on it, from `statutory_tax_rates`, and the tenant's own rates in force
   * on it. Never today's rates for yesterday's document.
   */
  private async taxRatesOn(
    organizationId: string,
    countryCode: string | null,
    date: string,
    manager: EntityManager,
  ): Promise<{ tenantTaxRates: number[]; statutoryTaxRates: number[] | null; taxDate: string }> {
    return {
      tenantTaxRates: await this.tenantTaxRates(organizationId, manager, date),
      statutoryTaxRates: await statutoryTaxRatesOn(manager, countryCode, date),
      taxDate: date,
    };
  }

  /**
   * What the document would come to, computed by the server.
   *
   * ## Why this endpoint exists
   *
   * The invoice form computed its own subtotal, discount, tax, service charge and withholding to
   * show the user a running total. The server has never accepted a total from the client, so the
   * books were never at risk — but it was a second implementation of the document arithmetic, and
   * it had already diverged: the client charged tax on the line subtotal *before* the document
   * discount, which is the defect this product spent a release fixing on the server. A user
   * therefore watched one figure while composing and was issued another.
   *
   * There is now one implementation. The form asks for the figures instead of deriving them, so
   * the number on screen while composing is the number that will be issued, including the parts a
   * client cannot know at all: the tax rate the catalogue carries for a product, the excise, and
   * what the buyer's regime withholds.
   *
   * Reads only. No numbering, no stock, no posting, nothing written.
   */
  async preview(dto: CreateInvoiceDto, organizationId: string): Promise<PreviewedDocument> {
    const manager = this.dataSource.manager;

    const organization = await manager.getRepository(Organization).findOne({
      where: { id: organizationId },
      select: ['id', 'country', 'state', 'city', 'postalCode'],
    });
    const customer = await this.customersService.findOne(dto.customerId, organizationId);
    const { currencyCode, exchangeRate, baseCurrency } = await this.resolveCurrency(
      organizationId,
      dto.currencyCode,
      dto.issueDate,
    );

    const products = await this.loadProducts(dto.lineItems, organizationId, manager);
    const fixedTaxPerUnit = await this.fixedTaxesPerUnit(products, organizationId, toIsoDate(dto.issueDate), exchangeRate, manager);
    const listPrices = await this.listPrices(dto, organizationId, customer.id, currencyCode, manager);
    const standardRate = await standardSalesTaxRate(manager, organizationId);
    const determined = await this.determinedTaxRate(
      organizationId,
      organization?.country ?? null,
      customer,
      this.addressOf(organization),
      toIsoDate(dto.issueDate),
    );
    const taxInputs: TaxableLineInput[] = [];
    const resolved: ResolvedLine[] = [];
    for (const [index, lineDto] of dto.lineItems.entries()) {
      const line = this.resolveLine(lineDto, products, index, determined?.rate, standardRate, {
        listPrice: listPrices[index],
        catalogueApplies: currencyCode === baseCurrency,
        exciseUnitAmount: fixedTaxPerUnit(lineDto.productId),
      });
      resolved.push(line);
      taxInputs.push({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate,
        taxTreatment: line.taxTreatment,
        taxRate: line.taxRate,
        exciseRate: line.exciseRate,
        exciseUnitAmount: line.exciseUnitAmount,
        isService: line.isService,
      });
    }

    const withholding = await this.withholdingResolver.resolve(
      manager,
      organizationId,
      customer,
      resolved.some((line) => line.isService) ? 'SERVICES' : 'GOODS',
      {
        taxWithholdingRate: dto.taxWithholdingRate,
        incomeTaxWithholdingRate: dto.incomeTaxWithholdingRate,
        withholdingOverrideReason: dto.withholdingOverrideReason,
        documentDate: toIsoDate(dto.issueDate),
      },
    );

    const computed = computeDocument({
      countryCode: organization?.country ?? null,
      currencyCode,
      ...(await this.taxRatesOn(organizationId, organization?.country ?? null, toIsoDate(dto.issueDate), manager)),
      lines: taxInputs,
      documentDiscountRate: dto.documentDiscountRate,
      serviceChargeRate: dto.serviceChargeRate,
      taxWithholdingRate: withholding.taxWithholdingRate,
      incomeTaxWithholdingRate: withholding.incomeTaxWithholdingRate,
    });
    return {
      ...computed,
      pricing: resolved.map((line) => ({
        unitPrice: line.unitPrice,
        priceListId: line.priceListId,
        listPrice: line.listPrice,
      })),
    };
  }

  /**
   * Build the document from the catalogue and the market's rules. Pure of side effects beyond
   * reading: no numbering, no stock, no posting.
   */
  private async buildDocument(
    dto: CreateInvoiceDto,
    organizationId: string,
    manager: EntityManager,
  ): Promise<Invoice> {
    const gaps = await this.bookkeeping.invoicingGaps(organizationId, manager);
    if (gaps.length > 0) {
      // `missing` is a list of `invoices.gaps.*` keys; the client translates each (QA A-17).
      throw new BadRequestError('invoices.organization_cannot_invoice_yet', { missing: gaps });
    }

    const organization = await manager.getRepository(Organization).findOne({
      where: { id: organizationId },
      // The seller's own address as well as its country: an origin-sourced state prices an
      // intrastate sale at the seller's rate, not the buyer's.
      select: ['id', 'country', 'state', 'city', 'postalCode'],
    });
    const customer = await this.customersService.findOne(dto.customerId, organizationId);

    if (new Date(dto.dueDate) < new Date(dto.issueDate)) {
      throw new BadRequestError('invoices.due_date_cannot_earlier_than_issue');
    }

    const { currencyCode, exchangeRate, baseCurrency } = await this.resolveCurrency(
      organizationId,
      dto.currencyCode,
      dto.issueDate,
    );

    const products = await this.loadProducts(dto.lineItems, organizationId, manager);
    const fixedTaxPerUnit = await this.fixedTaxesPerUnit(products, organizationId, toIsoDate(dto.issueDate), exchangeRate, manager);
    const listPrices = await this.listPrices(dto, organizationId, customer.id, currencyCode, manager);
    const standardRate = await standardSalesTaxRate(manager, organizationId);
    const determined = await this.determinedTaxRate(
      organizationId,
      organization?.country ?? null,
      customer,
      this.addressOf(organization),
      toIsoDate(dto.issueDate),
    );

    const taxInputs: TaxableLineInput[] = [];
    const resolved: ResolvedLine[] = [];

    for (const [index, lineDto] of dto.lineItems.entries()) {
      const line = this.resolveLine(lineDto, products, index, determined?.rate, standardRate, {
        listPrice: listPrices[index],
        catalogueApplies: currencyCode === baseCurrency,
        exciseUnitAmount: fixedTaxPerUnit(lineDto.productId),
      });
      resolved.push(line);
      taxInputs.push({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate,
        taxTreatment: line.taxTreatment,
        taxRate: line.taxRate,
        exciseRate: line.exciseRate,
        exciseUnitAmount: line.exciseUnitAmount,
        isService: line.isService,
      });
    }

    // ── Withholding ──────────────────────────────────────────────────────────
    //
    // Resolved on the server from the buyer's fiscal classification, the tenant's country and
    // what is being sold. It used to arrive on the request as any fraction between 0 and 1, with
    // nothing to compare it against — so the amount the buyer remits to the authority on the
    // seller's behalf, and which the seller then claims as a credit, was whatever the client sent.
    // A rate that differs from the regime is still accepted, but only with a stated reason, and it
    // is recorded on the document as an exception rather than passing as the rule.
    const withholding = await this.withholdingResolver.resolve(
      manager,
      organizationId,
      customer,
      // Services when any line is one: every regime that distinguishes the two withholds on
      // services, so treating a mixed document as goods under-withholds.
      resolved.some((line) => line.isService) ? 'SERVICES' : 'GOODS',
      {
        taxWithholdingRate: dto.taxWithholdingRate,
        incomeTaxWithholdingRate: dto.incomeTaxWithholdingRate,
        withholdingOverrideReason: dto.withholdingOverrideReason,
        documentDate: toIsoDate(dto.issueDate),
      },
    );

    const computed = computeDocument({
      countryCode: organization?.country ?? null,
      currencyCode,
      ...(await this.taxRatesOn(organizationId, organization?.country ?? null, toIsoDate(dto.issueDate), manager)),
      lines: taxInputs,
      documentDiscountRate: dto.documentDiscountRate,
      serviceChargeRate: dto.serviceChargeRate,
      taxWithholdingRate: withholding.taxWithholdingRate,
      incomeTaxWithholdingRate: withholding.incomeTaxWithholdingRate,
    });

    const lineItems = resolved.map((line, index) => {
      const c = computed.lines[index];
      const entity = manager.create(InvoiceLineItem, {
        productId: line.productId,
        description: line.description,
        sortOrder: index,
        quantity: line.quantity,
        unitOfMeasure: line.unitOfMeasure,
        price: line.unitPrice,
        priceListId: line.priceListId,
        listPrice: line.listPrice,
        discountRate: line.discountRate,
        discountAmount: c.discountAmount,
        lineSubtotal: c.subtotal,
        documentDiscountAmount: c.documentDiscountAmount,
        taxableBase: c.taxableBase,
        taxRate: c.taxRate,
        taxAmount: c.taxAmount,
        taxTreatment: c.taxTreatment,
        isService: c.isService,
        exciseAmount: c.exciseAmount,
        exciseUnitAmount: line.exciseUnitAmount,
        // Snapshotted from the product, like the rate beside it: a document is a record of what
        // was declared, not a view over the catalogue as it stands today.
        fiscalCodes: line.fiscalCodes,
        unitCost: line.unitCost,
        creditedQuantity: 0,
      });
      return entity;
    });

    const invoiceNumber = await this.documentSequencesService.getNextNumber(
      organizationId,
      DocumentType.CUSTOMER_INVOICE,
      manager,
    );

    const costOfSale = roundToCurrency(
      resolved.reduce(
        (sum, line) => (line.movesStock ? sum + line.quantity * line.unitCost : sum),
        0,
      ),
      currencyCode,
    );

    const payment = await this.resolvePaymentMethod(dto, organizationId, manager);

    return manager.create(Invoice, {
      organizationId,
      invoiceNumber,
      customerId: customer.id,
      customerName: customer.companyName,
      customerAddress: customer.address ?? null,
      customerTaxId: customer.taxId ?? null,
      issueDate: dto.issueDate,
      dueDate: dto.dueDate,
      lineItems,
      subtotal: computed.subtotal,
      discountTotal: computed.discountTotal,
      taxedTotal: computed.taxedTotal,
      exemptTotal: computed.exemptTotal,
      goodsTotal: computed.goodsTotal,
      servicesTotal: computed.servicesTotal,
      tax: computed.tax,
      // Stored, not dropped. It is inside `total`, so an invoice carrying excise and recording it
      // nowhere produced a ledger entry out of balance by exactly that amount.
      excise: computed.excise,
      serviceCharge: computed.serviceCharge,
      taxWithheld: computed.taxWithheld,
      incomeTaxWithheld: computed.incomeTaxWithheld,
      // Which rule produced the withholding, so a filing can be traced back to it, and the reason
      // when the tenant overrode the rule. Without these the figure is unreconstructable: nothing
      // recorded which regime, if any, it was supposed to come from.
      withholdingRegimeCodes: withholding.regimeCodes,
      withholdingOverrideReason: withholding.override?.reason ?? null,
      // Which jurisdictions produced the rate, so a return can be filed per jurisdiction and a
      // sale correctly left untaxed for want of nexus is distinguishable from one nobody taxed.
      taxDetermination: determined
        ? {
            outcome: determined.determination.outcome,
            rate: determined.determination.rate,
            source: determined.determination.source,
            components: determined.determination.components,
            reasonKey: determined.determination.reasonKey,
          }
        : null,
      total: computed.total,
      netReceivable: computed.netReceivable,
      balance: computed.netReceivable,
      creditedTotal: 0,
      status: InvoiceStatus.DRAFT,
      type: InvoiceType.INVOICE,
      paymentMethod: payment.kind,
      paymentMethodCode: payment.code,
      notes: dto.notes,
      currencyCode,
      exchangeRate,
      // Rounded to the BASE currency's minor unit, because that is the currency it is measured in.
      // Rounding it to the document's scale gives a USD invoice into Chilean books two decimals
      // CLP does not have, and a CLP invoice into dollar books a whole peso of lost precision.
      totalInBaseCurrency: roundToCurrency(computed.total * exchangeRate, baseCurrency),
      costOfSale,
    });
  }

  /**
   * How the document is paid: the company's own method when the request names one, else the
   * settlement kind it states or the one its dates imply.
   *
   * A company outside the Dominican Republic keeps its own payment methods (ACH, Zelle — QA C-06),
   * and the invoice records which one by its code. The settlement KIND is still what every
   * e-invoicing adapter maps to its authority's code, so it is taken from the method itself rather
   * than from the request: a request saying «ZELLE, paid in cash» is answered «ZELLE, a transfer».
   * A retired or unknown code is refused, not silently replaced.
   */
  private async resolvePaymentMethod(
    dto: CreateInvoiceDto,
    organizationId: string,
    manager: EntityManager,
  ): Promise<{ kind: PaymentMethod; code: string | null }> {
    const code = dto.paymentMethodCode?.trim().toUpperCase();
    if (!code) return { kind: dto.paymentMethod ?? this.inferPaymentMethod(dto), code: null };

    const [method]: Array<{ kind: PaymentMethod }> = await manager.query(
      `SELECT "kind" FROM "payment_methods" WHERE "organization_id" = $1 AND "code" = $2 AND "is_active"`,
      [organizationId, code],
    );
    if (!method) throw new BadRequestError('invoices.payment_method_code_unknown', { code });
    return { kind: method.kind, code };
  }

  // ── Line resolution ────────────────────────────────────────────────────────

  /**
   * What the applicable price list says for each line, by index (FAC-PL-01). A free-text line,
   * or one the list does not carry, gets `undefined` and the catalogue applies.
   */
  private async listPrices(
    dto: CreateInvoiceDto,
    organizationId: string,
    customerId: string,
    currencyCode: string,
    manager: EntityManager,
  ): Promise<Array<ResolvedPrice | undefined>> {
    const queries = dto.lineItems
      .map((line, index) => ({ index, productId: line.productId, quantity: Number(line.quantity) }))
      .filter((q): q is { index: number; productId: string; quantity: number } => Boolean(q.productId));
    const out: Array<ResolvedPrice | undefined> = new Array(dto.lineItems.length).fill(undefined);
    if (queries.length === 0) return out;
    const resolved = await this.prices.resolve(
      organizationId,
      { customerId, currencyCode, date: toIsoDate(dto.issueDate) },
      queries,
      manager,
    );
    resolved.forEach((price, i) => {
      if (price.unitPrice !== null) out[queries[i].index] = price;
    });
    return out;
  }

  /**
   * The fixed tax each product carries per unit, in the document's currency (FAC-TX-01).
   *
   * A product names a row of the tenant's catalogue; the amount there is in the books' currency, so
   * a dollar invoice charges it at the document's rate. Only a FIXED tax in force on the document's
   * date may be charged: one that is not is refused, never charged at a stale amount or skipped.
   */
  private async fixedTaxesPerUnit(
    products: Map<string, Product>,
    organizationId: string,
    date: string,
    exchangeRate: number,
    manager: EntityManager,
  ): Promise<(productId: string | null | undefined) => number> {
    const ids = [...new Set([...products.values()].map((p) => p.exciseTaxId).filter((id): id is string => Boolean(id)))];
    const amounts = new Map<string, number>();
    if (ids.length > 0) {
      const taxes = await manager.getRepository(Tax).find({ where: { id: In(ids), organizationId } });
      for (const tax of taxes) {
        if ((tax.type ?? TaxType.PERCENTAGE) !== TaxType.FIXED) {
          throw new BadRequestError('invoices.fixed_tax_not_fixed', { tax: tax.name });
        }
        if ((tax.effectiveFrom && tax.effectiveFrom > date) || (tax.effectiveTo && tax.effectiveTo < date)) {
          throw new BadRequestError('invoices.fixed_tax_not_in_force', { tax: tax.name, date });
        }
        amounts.set(tax.id, Number(tax.rate) / (exchangeRate > 0 ? exchangeRate : 1));
      }
      const missing = ids.filter((id) => !amounts.has(id));
      if (missing.length > 0) throw new BadRequestError('invoices.fixed_tax_not_found');
    }
    return (productId) => {
      const taxId = productId ? products.get(productId)?.exciseTaxId : null;
      return taxId ? (amounts.get(taxId) ?? 0) : 0;
    };
  }

  private async loadProducts(
    lines: InvoiceLineDto[],
    organizationId: string,
    manager: EntityManager,
  ): Promise<Map<string, Product>> {
    const ids = Array.from(new Set(lines.map((l) => l.productId).filter(Boolean))) as string[];
    if (ids.length === 0) return new Map();

    const products = await manager
      .getRepository(Product)
      .find({ where: { id: In(ids), organizationId } });

    const map = new Map(products.map((p) => [p.id, p]));
    const missing = ids.filter((id) => !map.has(id));
    if (missing.length > 0) {
      throw new BadRequestError('invoices.product_p1_not_found_p2_catalogue', { p1: missing.length > 1 ? 's' : '', p2: missing.length > 1 ? 's' : '', p3: missing.join(', ') });
    }
    return map;
  }

  /**
   * Turn a request line into a priced, classified line.
   *
   * The tax RATE is derived here, from the catalogue, and the request may only override the
   * TREATMENT (an export sale of a normally taxed good, say). Taking the rate from the client made
   * it impossible to distinguish an exempt item from a taxable one billed at zero.
   */
  private resolveLine(
    dto: InvoiceLineDto,
    products: Map<string, Product>,
    index: number,
    /**
     * The rate the destination's jurisdictions levy, in a market with no national rate.
     *
     * When present it replaces the product's and the request's: in the United States the rate is a
     * property of where the goods go, not of the item, and the same product is 8.25 % in one Texas
     * city and 6.25 % in another.
     */
    determinedRate?: number,
    /** The tenant's standard rate, for a taxed product that carries none. */
    standardRate?: number,
    pricing: {
      /** What the applicable price list says for this line, if anything. */
      listPrice?: ResolvedPrice;
      /**
       * Whether the catalogue price may stand in for a missing one. The catalogue is kept in the
       * base currency; billing its figure as dollars on a dollar invoice charged 58 times too
       * little (or too much). In another currency a line needs its own price or a list's.
       */
      catalogueApplies: boolean;
      /** The product's fixed tax per unit, already in the document's currency (FAC-TX-01). */
      exciseUnitAmount?: number;
    } = { catalogueApplies: true },
  ): ResolvedLine {
    const product = dto.productId ? products.get(dto.productId) : undefined;

    const description = (dto.description ?? product?.name ?? '').trim();
    if (!description) {
      throw new BadRequestError('invoices.line_p1_needs_description_product_from', { p1: index + 1 });
    }

    const listed = pricing.listPrice?.unitPrice ?? null;
    const unitPrice =
      dto.unitPrice ?? listed ?? (pricing.catalogueApplies ? Number(product?.price ?? NaN) : NaN);
    if (!Number.isFinite(unitPrice)) {
      throw new BadRequestError('invoices.line_p1_has_no_price_enter', { p1: index + 1 });
    }

    const isService = dto.isService ?? product?.kind === ProductKind.SERVICE;
    const treatment = dto.taxTreatment ?? this.treatmentOf(product);
    // Same rule as the till (`effectiveProductTaxRate`): a taxed product with no rate of its own
    // is taxed at the tenant's standard rate, never at zero.
    const productRate = Number(product?.taxRate ?? 0);
    const taxRate =
      treatment === TaxTreatment.TAXED
        ? (determinedRate ??
          dto.taxRate ??
          (productRate > 0 ? productRate : (standardRate ?? 0)))
        : 0;

    return {
      productId: product?.id ?? null,
      description,
      quantity: dto.quantity,
      unitPrice,
      priceListId: listed !== null ? (pricing.listPrice?.priceListId ?? null) : null,
      listPrice: listed,
      discountRate: dto.discountRate ?? 0,
      taxTreatment: treatment,
      taxRate,
      exciseRate: Number(product?.exciseRate ?? 0),
      exciseUnitAmount: pricing.exciseUnitAmount ?? 0,
      fiscalCodes: this.fiscalCodesOf(product),
      isService,
      unitOfMeasure: dto.unitOfMeasure ?? product?.unitOfMeasure ?? 'UND',
      unitCost: Number(product?.cost ?? 0),
      // Only a stocked good moves inventory. A service, or a free-text concept, does not.
      movesStock: Boolean(product) && !isService && product?.kind === ProductKind.GOOD,
    };
  }

  /**
   * The catalogue values a document line must carry in the tenant's market.
   *
   * `fiscalItemCode` predates this and is the Mexican `ClaveProdServ` under an older name; it is
   * folded in so a product configured before the map existed keeps working.
   */
  private fiscalCodesOf(product: Product | undefined): Record<string, string> | null {
    if (!product) return null;
    const codes = { ...(product.fiscalCodes ?? {}) };
    if (product.fiscalItemCode && !codes['claveProdServ']) {
      codes['claveProdServ'] = product.fiscalItemCode;
    }
    return Object.keys(codes).length > 0 ? codes : null;
  }

  /** The seller's own address, for the states that source an intrastate sale to it. */
  private addressOf(organization: Organization | null): TaxDeterminationAddress | null {
    if (!organization?.country) return null;
    return {
      countryCode: organization.country.toUpperCase(),
      stateCode: organization.state ?? null,
      city: organization.city ?? null,
      postalCode: organization.postalCode ?? null,
    };
  }

  private treatmentOf(product: Product | undefined): TaxTreatment {
    const raw = (product?.taxTreatment ?? TaxTreatment.TAXED) as TaxTreatment;
    return Object.values(TaxTreatment).includes(raw) ? raw : TaxTreatment.TAXED;
  }

  /** A document due after its issue date is sold on credit; same-day is a cash sale. */
  private inferPaymentMethod(dto: CreateInvoiceDto): PaymentMethod {
    return dto.dueDate > dto.issueDate ? PaymentMethod.CREDIT : PaymentMethod.CASH;
  }

  // ── Currency ───────────────────────────────────────────────────────────────

  /**
   * Resolve the document currency and its rate to the tenant's functional currency.
   *
   * `exchange_rates.rate` is stored as units of `toCurrency` per 1 `fromCurrency` (base →
   * transaction). `Invoice.exchangeRate` is documented as the rate FROM the transaction currency TO
   * the base currency, so it is the inverse; multiplying by the raw rate inflated the base-currency
   * total by rate².
   */
  private async resolveCurrency(
    organizationId: string,
    requested: string | undefined,
    issueDate: string,
  ): Promise<{ currencyCode: string; exchangeRate: number; baseCurrency: string }> {
    const settings = await this.orgSettings.getForOrg(organizationId);
    const baseCurrency = settings?.baseCurrency || 'USD';
    const currencyCode = (requested || baseCurrency).toUpperCase();

    if (currencyCode === baseCurrency) {
      return { currencyCode, exchangeRate: 1, baseCurrency };
    }

    // Through the resolver, not a direct row lookup. The lookup asked only for a
    // `base → transaction` row and inverted it, so a tenant holding the pair the other way round —
    // the common case, since providers quote against the dollar — got "no rate found" for a
    // currency it had rates for, and a tenant with neither leg on file (COP books, EUR invoice)
    // could never be served at all. The resolver tries direct, inverse and a cross through the
    // dollar, and returns the rate in the direction asked for.
    const rateType = await this.exchangeRateResolver.rateTypeFor(organizationId);
    const exchangeRate = await this.exchangeRateResolver.rateFor(
      currencyCode,
      baseCurrency,
      issueDate,
      undefined,
      rateType,
    );

    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new BadRequestError('invoices.exchange_rate_configured_currency_code_not', { currencyCode });
    }
    return { currencyCode, exchangeRate, baseCurrency };
  }

  // ── Stock ──────────────────────────────────────────────────────────────────

  private async moveStockForIssue(invoice: Invoice, manager: EntityManager): Promise<void> {
    let costOfSale = 0;
    let movedAny = false;
    for (const line of invoice.lineItems ?? []) {
      if (!line.productId || line.isService) continue;
      movedAny = true;
      // The cost of sale is what the stock ledger relieved, AT ISSUANCE — not the product cost
      // copied when the draft was saved. A receipt or a revaluation between the two used to leave
      // the inventory account at 160,00 while stock × cost said 150,00 (audit 2026-10-31,
      // inventory INV-01). The line keeps the cost it actually left at, for the credit note that
      // will one day bring it back.
      const relieved = await this.inventoryService.decreaseStock(
        line.productId,
        line.quantity,
        manager,
        invoice.organizationId,
        {
          place: { branchId: invoice.branchId },
          type: 'SALE_DISPATCH',
          reference: invoice.fiscalNumber ?? invoice.invoiceNumber,
          sourceType: 'invoice',
          sourceId: invoice.id,
        },
      );
      line.unitCost = relieved.unitCost;
      costOfSale += line.quantity * relieved.unitCost;
    }
    if (movedAny) {
      invoice.costOfSale = roundToCurrency(costOfSale, invoice.currencyCode);
    }
  }

  // ── Drafts ─────────────────────────────────────────────────────────────────

  /** Replace the contents of a draft. Issued documents are immutable by law and by design. */
  async updateDraft(
    invoiceId: string,
    dto: CreateInvoiceDto,
    organizationId: string,
    actorUserId: string | null = null,
  ): Promise<Invoice> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Invoice);
      const existing = await repo.findOne({
        where: { id: invoiceId, organizationId },
        relations: ['lineItems'],
      });
      if (!existing) throw new NotFoundError('invoices.invoice_invoice_id_not_found', { invoiceId });
      if (existing.status !== InvoiceStatus.DRAFT) {
        throw new ConflictError('invoices.only_draft_can_edited_issued_document');
      }

      const rebuilt = await this.buildDocument(dto, organizationId, manager);
      // Keep identity and numbering; replace contents.
      await manager.getRepository(InvoiceLineItem).delete({ invoiceId: existing.id });

      Object.assign(existing, {
        customerId: rebuilt.customerId,
        customerName: rebuilt.customerName,
        customerAddress: rebuilt.customerAddress,
        customerTaxId: rebuilt.customerTaxId,
        issueDate: rebuilt.issueDate,
        dueDate: rebuilt.dueDate,
        lineItems: rebuilt.lineItems,
        subtotal: rebuilt.subtotal,
        discountTotal: rebuilt.discountTotal,
        taxedTotal: rebuilt.taxedTotal,
        exemptTotal: rebuilt.exemptTotal,
        goodsTotal: rebuilt.goodsTotal,
        servicesTotal: rebuilt.servicesTotal,
        tax: rebuilt.tax,
        excise: rebuilt.excise,
        serviceCharge: rebuilt.serviceCharge,
        taxWithheld: rebuilt.taxWithheld,
        incomeTaxWithheld: rebuilt.incomeTaxWithheld,
        total: rebuilt.total,
        netReceivable: rebuilt.netReceivable,
        balance: rebuilt.netReceivable,
        paymentMethod: rebuilt.paymentMethod,
        paymentMethodCode: rebuilt.paymentMethodCode,
        notes: rebuilt.notes,
        currencyCode: rebuilt.currencyCode,
        exchangeRate: rebuilt.exchangeRate,
        totalInBaseCurrency: rebuilt.totalInBaseCurrency,
        costOfSale: rebuilt.costOfSale,
        branchId: await reassignDocumentBranch(manager, organizationId, actorUserId, existing.branchId, dto.branchId),
      });

      return manager.save(existing);
    });
  }

  /** Discard a draft. It consumed no fiscal numbering, so nothing needs to be declared. */
  async discardDraft(invoiceId: string, organizationId: string): Promise<void> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id: invoiceId, organizationId },
    });
    if (!invoice) throw new NotFoundError('invoices.invoice_invoice_id_not_found', { invoiceId });
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new ConflictError('invoices.issued_document_not_deleted_void_with');
    }
    await this.invoicesRepository.delete({ id: invoiceId, organizationId });
  }

  // ── Credit notes ───────────────────────────────────────────────────────────

  /**
   * Credit part or all of an issued invoice.
   *
   * ## What this fixes
   *
   * The previous implementation validated each requested quantity against the ORIGINAL line and
   * kept no record of what had already been credited, so ten partial notes could each credit the
   * full quantity. A partial note also left the invoice's balance untouched — the customer returned
   * goods and still owed the full amount — and the code said so: "Let's keep it simple".
   *
   * Now every line carries `creditedQuantity`, the invoice carries `creditedTotal`, both are
   * checked before the note is built, and the note reduces the outstanding balance.
   */
  async createCreditNote(dto: CreateCreditNoteDto, organizationId: string): Promise<Invoice> {
    const created = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Invoice);

      // Serialise concurrent credit notes against the same invoice: two of them checking the
      // remaining creditable amount at once would both pass and together over-credit it. The lock
      // is taken on the invoice row alone — `FOR UPDATE` cannot be applied to the nullable side of
      // the outer joins that loading the relations produces.
      await repo
        .createQueryBuilder('invoice')
        .where('invoice.id = :id', { id: dto.invoiceId })
        .andWhere('invoice.organizationId = :organizationId', { organizationId })
        .setLock('pessimistic_write')
        .getOne();

      const original = await repo.findOne({
        where: { id: dto.invoiceId, organizationId },
        relations: ['lineItems', 'customer'],
      });

      if (!original) {
        throw new NotFoundError('invoices.original_invoice_invoice_id_not_found', { invoiceId: dto.invoiceId });
      }
      if (original.status === InvoiceStatus.DRAFT) {
        throw new BadRequestError('invoices.draft_not_credited_delete_edit_directly');
      }
      if (original.status === InvoiceStatus.VOID) {
        throw new ConflictError('invoices.invoice_has_already_voided_full');
      }
      if (original.type !== InvoiceType.INVOICE) {
        throw new BadRequestError('invoices.only_invoice_can_credited');
      }

      const selections = this.resolveCreditSelections(original, dto);
      const isFullCredit = this.isFullCredit(original, selections);
      const baseCurrency =
        (await this.orgSettings.getForOrg(organizationId, manager))?.baseCurrency ?? 'USD';

      const creditCountry = (
        await manager
          .getRepository(Organization)
          .findOne({ where: { id: organizationId }, select: ['id', 'country'] })
      )?.country;
      const computed = computeDocument({
        countryCode: creditCountry,
        currencyCode: original.currencyCode,
        // A credit note re-prices lines of a document that was already accepted, so the rates it
        // carries are the ones in force on THE ORIGINAL's date (SP-03): crediting a March 2024
        // Ecuadorian invoice after the April change still credits 12 %, not 15 %.
        ...(await this.taxRatesOn(organizationId, creditCountry ?? null, toIsoDate(original.issueDate), manager)),
        lines: selections.map((s) => ({
          quantity: s.quantity,
          unitPrice: s.line.price,
          discountRate: s.line.discountRate,
          taxTreatment: s.line.taxTreatment,
          taxRate: s.line.taxRate,
          // The excise the original line bore, as a rate, so the note credits it too. Omitting it
          // credited the tax and the base and left the customer charged the excise for goods they
          // returned.
          exciseRate: proportion(s.line.exciseAmount, s.line.taxableBase || s.line.lineSubtotal),
          isService: s.line.isService,
        })),
        // The note inherits the invoice's document-level rates so the credit mirrors what was
        // actually charged, proportionally.
        documentDiscountRate: proportion(original.discountTotal, original.subtotal),
        serviceChargeRate: proportion(
          original.serviceCharge,
          original.subtotal - original.discountTotal,
        ),
        taxWithholdingRate: proportion(original.taxWithheld, original.tax),
        incomeTaxWithholdingRate: proportion(
          original.incomeTaxWithheld,
          original.subtotal - original.discountTotal,
        ),
      });

      if (
        toMinorUnits(computed.total, original.currencyCode) >
        toMinorUnits(original.creditableRemaining, original.currencyCode)
      ) {
        throw new BadRequestError('invoices.amount_credit_amount_exceeds_creditable_balance', {
          amount: computed.total,
          invoiceNumber: original.invoiceNumber,
          remaining: original.creditableRemaining,
        });
      }

      const creditNoteNumber = await this.documentSequencesService.getNextNumber(
        organizationId,
        DocumentType.CREDIT_NOTE,
        manager,
      );

      // The credit note's own date, in the TENANT's zone. Taken from the server clock in UTC, a
      // note raised in Santo Domingo after 20:00 was dated tomorrow — and a note dated after the
      // period close lands in a month the taxpayer has already reported.
      const today = await this.fiscalToday(organizationId, manager);
      const noteLines = selections.map((s, index) => {
        const c = computed.lines[index];
        return manager.create(InvoiceLineItem, {
          productId: s.line.productId,
          sourceLineId: s.line.id,
          description: s.line.description,
          sortOrder: index,
          quantity: s.quantity,
          unitOfMeasure: s.line.unitOfMeasure,
          price: s.line.price,
          discountRate: s.line.discountRate,
          discountAmount: c.discountAmount,
          lineSubtotal: c.subtotal,
          documentDiscountAmount: c.documentDiscountAmount,
          taxableBase: c.taxableBase,
          taxRate: c.taxRate,
          taxAmount: c.taxAmount,
          taxTreatment: c.taxTreatment,
          isService: c.isService,
          exciseAmount: c.exciseAmount,
          unitCost: s.line.unitCost,
          creditedQuantity: 0,
        });
      });

      const restock = dto.restockGoods !== false;
      const costOfSale = restock
        ? roundToCurrency(
            selections.reduce(
              (sum, s) => (s.line.productId && !s.line.isService ? sum + s.quantity * s.line.unitCost : sum),
              0,
            ),
            original.currencyCode,
          )
        : 0;

      const creditNote = manager.create(Invoice, {
        organizationId,
        invoiceNumber: creditNoteNumber,
        originalInvoiceId: original.id,
        modificationCode:
          dto.modificationCode ??
          (isFullCredit ? ModificationCode.ANNULMENT : ModificationCode.AMOUNT_CORRECTION),
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.CREDIT_NOTE,
        // Issued where the invoice it corrects was issued.
        branchId: original.branchId,
        customerId: original.customerId,
        customerName: original.customerName,
        customerAddress: original.customerAddress,
        customerTaxId: original.customerTaxId,
        issueDate: today,
        dueDate: today,
        currencyCode: original.currencyCode,
        exchangeRate: original.exchangeRate,
        paymentMethod: original.paymentMethod,
        paymentMethodCode: original.paymentMethodCode ?? null,
        lineItems: noteLines,
        subtotal: computed.subtotal,
        discountTotal: computed.discountTotal,
        taxedTotal: computed.taxedTotal,
        exemptTotal: computed.exemptTotal,
        goodsTotal: computed.goodsTotal,
        servicesTotal: computed.servicesTotal,
        tax: computed.tax,
        excise: computed.excise,
        serviceCharge: computed.serviceCharge,
        taxWithheld: computed.taxWithheld,
        incomeTaxWithheld: computed.incomeTaxWithheld,
        total: computed.total,
        netReceivable: computed.netReceivable,
        balance: 0,
        creditedTotal: 0,
        totalInBaseCurrency: roundToCurrency(
          computed.total * original.exchangeRate,
          baseCurrency,
        ),
        costOfSale,
        notes: dto.reason || `Nota de crédito de la factura ${original.invoiceNumber}`,
      });

      const savedNote = await manager.save(creditNote);
      const issuedNote = await this.issueWithin(savedNote, null, organizationId, manager);

      // Return the goods to stock, unless the credit is a price adjustment or the goods came back
      // unsellable.
      if (restock) {
        for (const selection of selections) {
          if (!selection.line.productId || selection.line.isService) continue;
          await this.inventoryService.increaseStock(
            selection.line.productId,
            selection.quantity,
            manager,
            organizationId,
            {
              // Back into the warehouse of the branch that sold them.
              place: { branchId: original.branchId },
              type: 'SALE_RETURN',
              reference: issuedNote.fiscalNumber ?? issuedNote.invoiceNumber,
              sourceType: 'credit_note',
              sourceId: issuedNote.id,
            },
          );
        }
      }

      // Record the credit against the original, so a second note cannot credit the same goods.
      for (const selection of selections) {
        selection.line.creditedQuantity = round6(
          selection.line.creditedQuantity + selection.quantity,
        );
        await manager.save(selection.line);
      }
      original.creditedTotal = roundToCurrency(
        original.creditedTotal + computed.total,
        original.currencyCode,
      );
      original.balance = roundToCurrency(
        Math.max(0, original.balance - computed.netReceivable),
        original.currencyCode,
      );
      if (isFullCredit) {
        original.status = InvoiceStatus.VOID;
        original.voidedAt = new Date();
        original.voidReason = dto.reason ?? 'Anulada por nota de crédito total';
        // Reversed by the note, not annulled: a fiscal return still counts it as the sale it was.
        original.cancellationMode = CancellationMode.CREDIT_NOTE;
        original.balance = 0;
      } else if (original.balance <= 0.005) {
        original.status = InvoiceStatus.PAID;
        original.balance = 0;
      }
      await manager.save(original);

      this.eventEmitter.emit('invoice.credit-note-created', {
        originalInvoice: original,
        creditNote: issuedNote,
      });
      return issuedNote;
    });

    this.triggerFiscalTransmission(created);
    return created;
  }

  // ── Debit notes and cancellation (audit 2026-11-07, FAC-INV-05) ───────────────

  /**
   * Add a charge to an issued invoice: interest for paying late, freight billed afterwards, a price
   * agreed higher. A document of its own — numbered, posted Dr receivable / Cr revenue and tax,
   * collected like an invoice — that names the invoice it modifies.
   *
   * Country-neutral by construction. The reason is the product's own (`DebitNoteReason`) and each
   * regime writes its authority's code for it; the market's adapter numbers it, or refuses it where
   * the product's builder for that authority does not issue debit notes yet — before any number is
   * drawn. Lines state their tax treatment: whether late-payment interest bears VAT is a question
   * each market answers differently, and the server does not answer it for the user.
   *
   * Tax is the rate in force on the date of the operation it taxes: the original's, for a price
   * increase — it changes the value of that operation — and the note's own for a new charge. The
   * buyer's withholding is resolved for the note itself, by its regimes, as for any document.
   * Both rules are the general ones; confirm each market's with a local accountant.
   */
  async createDebitNote(invoiceId: string, dto: DebitNoteBodyDto, organizationId: string, actorUserId: string | null = null): Promise<Invoice> {
    const created = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Invoice);
      await repo
        .createQueryBuilder('invoice')
        .where('invoice.id = :id', { id: invoiceId })
        .andWhere('invoice.organizationId = :organizationId', { organizationId })
        .setLock('pessimistic_write')
        .getOne();
      const original = await repo.findOne({ where: { id: invoiceId, organizationId }, relations: ['customer'] });
      if (!original) throw new NotFoundError('invoices.original_invoice_invoice_id_not_found', { invoiceId });
      if (original.type !== InvoiceType.INVOICE) throw new BadRequestError('invoices.only_invoice_can_be_debited');
      if (original.status === InvoiceStatus.DRAFT) throw new BadRequestError('invoices.draft_cannot_be_debited');
      if (original.status === InvoiceStatus.VOID) throw new ConflictError('invoices.invoice_has_already_voided_full');

      const country = (await manager.getRepository(Organization).findOne({ where: { id: organizationId }, select: ['id', 'country'] }))?.country ?? null;
      const adapter = await this.fiscalAdapterFactory.getAdapter(organizationId, manager);
      if (!adapter.assignDebitNoteNumber) {
        throw new BadRequestError('invoices.debit_note_not_supported_in_market', { authority: fiscalAuthorityOf(country) });
      }

      const today = await this.fiscalToday(organizationId, manager);
      const taxDate = dto.reason === DebitNoteReason.PRICE_INCREASE ? toIsoDate(original.issueDate) : today;
      const standardRate = await standardSalesTaxRate(manager, organizationId);
      const lines = dto.lines.map((line) => ({
        description: line.description.trim(),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxTreatment: line.taxTreatment,
        taxRate: line.taxTreatment === TaxTreatment.TAXED ? (line.taxRate ?? standardRate ?? 0) : 0,
        isService: line.isService,
      }));
      const customer = original.customer ?? (await this.customersService.findOne(original.customerId, organizationId));
      const withholding = await this.withholdingResolver.resolve(
        manager,
        organizationId,
        customer,
        lines.some((line) => line.isService) ? 'SERVICES' : 'GOODS',
        { documentDate: today },
      );
      const computed = computeDocument({
        countryCode: country,
        currencyCode: original.currencyCode,
        ...(await this.taxRatesOn(organizationId, country, taxDate, manager)),
        lines: lines.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxTreatment: line.taxTreatment,
          taxRate: line.taxRate,
          isService: line.isService,
        })),
        taxWithholdingRate: withholding.taxWithholdingRate,
        incomeTaxWithholdingRate: withholding.incomeTaxWithholdingRate,
      });

      const baseCurrency = (await this.orgSettings.getForOrg(organizationId, manager))?.baseCurrency ?? original.currencyCode;
      const note = manager.create(Invoice, {
        organizationId,
        invoiceNumber: await this.documentSequencesService.getNextNumber(organizationId, DocumentType.DEBIT_NOTE, manager),
        originalInvoiceId: original.id,
        adjustmentReason: dto.reason,
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.DEBIT_NOTE,
        branchId: original.branchId,
        customerId: original.customerId,
        customerName: original.customerName,
        customerAddress: original.customerAddress,
        customerTaxId: original.customerTaxId,
        issueDate: today,
        dueDate: today,
        currencyCode: original.currencyCode,
        exchangeRate: original.exchangeRate,
        paymentMethod: original.paymentMethod,
        paymentMethodCode: original.paymentMethodCode ?? null,
        lineItems: lines.map((line, index) => {
          const c = computed.lines[index];
          return manager.create(InvoiceLineItem, {
            productId: null,
            description: line.description,
            sortOrder: index,
            quantity: line.quantity,
            unitOfMeasure: line.isService ? 'SRV' : 'UND',
            price: line.unitPrice,
            discountRate: 0,
            discountAmount: c.discountAmount,
            lineSubtotal: c.subtotal,
            documentDiscountAmount: c.documentDiscountAmount,
            taxableBase: c.taxableBase,
            taxRate: c.taxRate,
            taxAmount: c.taxAmount,
            taxTreatment: c.taxTreatment,
            isService: c.isService,
            exciseAmount: c.exciseAmount,
            unitCost: 0,
            creditedQuantity: 0,
          });
        }),
        subtotal: computed.subtotal,
        discountTotal: computed.discountTotal,
        taxedTotal: computed.taxedTotal,
        exemptTotal: computed.exemptTotal,
        goodsTotal: computed.goodsTotal,
        servicesTotal: computed.servicesTotal,
        tax: computed.tax,
        excise: computed.excise,
        serviceCharge: computed.serviceCharge,
        taxWithheld: computed.taxWithheld,
        incomeTaxWithheld: computed.incomeTaxWithheld,
        withholdingRegimeCodes: withholding.regimeCodes,
        total: computed.total,
        netReceivable: computed.netReceivable,
        // Collected like an invoice: its own balance, owed by the customer.
        balance: computed.netReceivable,
        creditedTotal: 0,
        totalInBaseCurrency: roundToCurrency(computed.total * original.exchangeRate, baseCurrency),
        costOfSale: 0,
        notes: dto.description.trim(),
      });
      const saved = await manager.save(note);
      const issued = await this.issueWithin(saved, null, organizationId, manager);
      this.eventEmitter.emit('invoice.debit-note-created', { originalInvoice: original, debitNote: issued, actorUserId });
      return issued;
    });
    this.triggerFiscalTransmission(created);
    return created;
  }

  /**
   * How this invoice can be cancelled in its market (FAC-INV-05), for the screen to offer exactly
   * that: the route, the authority's reasons where it keeps a catalogue, and whether the invoice is
   * still untouched enough to be cancelled at all.
   */
  async cancellationOptions(invoiceId: string, organizationId: string): Promise<{
    route: CancellationRoute['kind'];
    authority: string;
    reasons: FiscalReason[];
    cancellable: boolean;
    blockedBy: string | null;
  }> {
    const manager = this.dataSource.manager;
    const invoice = await manager.getRepository(Invoice).findOne({ where: { id: invoiceId, organizationId } });
    if (!invoice) throw new NotFoundError('invoices.invoice_id_not_found', { id: invoiceId });
    const country = (await manager.getRepository(Organization).findOne({ where: { id: organizationId }, select: ['id', 'country'] }))?.country ?? null;
    const route = cancellationRouteFor(country, invoice);
    const today = await this.fiscalToday(organizationId, manager);
    const blockedBy = await this.cancellationBlocker(invoice, route, organizationId, manager);
    return {
      route: route.kind,
      authority: fiscalAuthorityOf(country),
      reasons: route.kind === 'REPORT' ? await fiscalReasonsOn(manager, country, route.reasonCatalogue, today) : [],
      cancellable: blockedBy === null,
      blockedBy,
    };
  }

  /**
   * Cancel an issued invoice without a credit note, the way its market allows (FAC-INV-05).
   *
   * A commercial document the authority never saw is voided; a Dominican pre-printed comprobante is
   * annulled with one of the DGII's reasons and declared in the 608; where the authority only
   * accepts a credit note — or registers cancellations itself, which no regime of the product does
   * yet — the request is refused, saying which way the document can go back. Only an invoice
   * nothing has touched: not collected in any part, not credited, not modified by a note. Its entries
   * are mirrored on the day it is cancelled and its goods return to stock, in one transaction.
   */
  async cancel(invoiceId: string, dto: CancelInvoiceBodyDto, organizationId: string, actorUserId: string | null = null): Promise<Invoice> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Invoice);
      await repo
        .createQueryBuilder('invoice')
        .where('invoice.id = :id', { id: invoiceId })
        .andWhere('invoice.organizationId = :organizationId', { organizationId })
        .setLock('pessimistic_write')
        .getOne();
      const invoice = await repo.findOne({ where: { id: invoiceId, organizationId }, relations: ['lineItems'] });
      if (!invoice) throw new NotFoundError('invoices.invoice_id_not_found', { id: invoiceId });
      const country = (await manager.getRepository(Organization).findOne({ where: { id: organizationId }, select: ['id', 'country'] }))?.country ?? null;
      const route = cancellationRouteFor(country, invoice);
      const blockedBy = await this.cancellationBlocker(invoice, route, organizationId, manager);
      if (blockedBy) {
        throw new ConflictError(blockedBy, { authority: fiscalAuthorityOf(country), status: invoice.status });
      }

      const today = await this.fiscalToday(organizationId, manager);
      const code = dto.reasonCode?.trim().toUpperCase() || null;
      if (route.kind === 'REPORT') {
        // The return that declares the annulment codes its reason from the authority's catalogue.
        const reasons = await fiscalReasonsOn(manager, country, route.reasonCatalogue, today);
        if (!code) throw new BadRequestError('invoices.cancellation_reason_code_required');
        if (!reasons.some((reason) => reason.code === code)) {
          throw new BadRequestError('invoices.cancellation_reason_code_not_in_catalogue', { code, authority: fiscalAuthorityOf(country) });
        }
      } else if (code) {
        throw new BadRequestError('invoices.cancellation_reason_code_not_applicable');
      }

      const entries = await this.posting.postCancellation(invoice, today, manager);
      for (const line of invoice.lineItems ?? []) {
        if (!line.productId || line.isService) continue;
        await this.inventoryService.increaseStock(line.productId, Number(line.quantity), manager, organizationId, {
          place: { branchId: invoice.branchId },
          type: 'SALE_RETURN',
          reference: invoice.fiscalNumber ?? invoice.invoiceNumber,
          sourceType: 'invoice_cancellation',
          sourceId: invoice.id,
        });
      }

      invoice.status = InvoiceStatus.VOID;
      invoice.voidedAt = new Date();
      invoice.voidReason = dto.reason.trim();
      invoice.cancellationMode = route.kind === 'REPORT' ? CancellationMode.REPORTED : CancellationMode.VOID;
      invoice.cancellationReasonCode = code;
      invoice.cancellationJournalEntryId = entries.revenueEntryId;
      invoice.cancellationCostJournalEntryId = entries.costEntryId;
      invoice.balance = 0;
      const saved = await manager.save(invoice);
      this.eventEmitter.emit('invoice.cancelled', { invoice: saved, actorUserId });
      this.logger.log(`Factura ${saved.invoiceNumber}${saved.fiscalNumber ? ` / ${saved.fiscalNumber}` : ''} anulada (${route.kind}).`);
      return saved;
    });
  }

  /**
   * Why this invoice cannot be cancelled without a credit note, as a message key; null when it can.
   * The market's rule first, then the document's own state.
   */
  private async cancellationBlocker(invoice: Invoice, route: CancellationRoute, organizationId: string, manager: EntityManager): Promise<string | null> {
    if (invoice.type !== InvoiceType.INVOICE) return 'invoices.only_invoice_can_be_cancelled';
    if (invoice.status === InvoiceStatus.VOID) return 'invoices.invoice_has_already_voided_full';
    if (route.kind === 'CREDIT_NOTE_ONLY') return 'invoices.cancellation_credit_note_only';
    if (route.kind === 'AUTHORITY_EVENT') return 'invoices.cancellation_authority_event_not_available';
    if (invoice.status !== InvoiceStatus.PENDING) return 'invoices.cancellation_only_untouched';
    // A document already handed to an authority's regime is that authority's to cancel, whatever
    // the route says (an electronic type is already CREDIT_NOTE_ONLY or AUTHORITY_EVENT above,
    // from the market's catalogue; this guards a document whose type was not recorded).
    const [submitted] = await manager.query(`SELECT 1 FROM "fiscal_submissions" WHERE "invoice_id" = $1 LIMIT 1`, [invoice.id]);
    if (submitted) return 'invoices.cancellation_credit_note_only';
    const [touched] = await manager.query(
      `SELECT
         (SELECT count(*)::int FROM "customer_payment_lines" l JOIN "customer_payments" p ON p."id" = l."payment_id"
           WHERE l."invoice_id" = $1 AND p."status" <> 'VOID') AS collections,
         (SELECT count(*)::int FROM "invoices" n
           WHERE n."original_invoice_id" = $1 AND n."organization_id" = $2 AND n."status" <> 'Void') AS notes`,
      [invoice.id, organizationId],
    );
    if (touched.collections > 0 || Number(invoice.creditedTotal) > 0 || touched.notes > 0) return 'invoices.cancellation_only_untouched';
    return null;
  }

  /** Which lines and quantities the note credits, validated against what is still creditable. */
  private resolveCreditSelections(
    original: Invoice,
    dto: CreateCreditNoteDto,
  ): CreditSelection[] {
    const lines = original.lineItems ?? [];
    if (lines.length === 0) {
      throw new BadRequestError('invoices.original_invoice_has_no_lines_credit');
    }

    if (!dto.items || dto.items.length === 0) {
      const selections = lines
        .map((line) => ({ line, quantity: round6(line.quantity - line.creditedQuantity) }))
        .filter((s) => s.quantity > 0);
      if (selections.length === 0) {
        throw new ConflictError('invoices.invoice_has_already_credited_full');
      }
      return selections;
    }

    const byId = new Map(lines.map((line) => [line.id, line]));
    const selections: CreditSelection[] = [];
    const seen = new Set<string>();

    for (const item of dto.items) {
      if (seen.has(item.lineId)) {
        throw new BadRequestError('invoices.line_line_id_appears_twice_request', { lineId: item.lineId });
      }
      seen.add(item.lineId);

      const line = byId.get(item.lineId);
      if (!line) {
        throw new BadRequestError('invoices.line_line_id_does_not_belong', { lineId: item.lineId, invoiceNumber: original.invoiceNumber });
      }
      const available = round6(line.quantity - line.creditedQuantity);
      if (item.quantity > available + 1e-6) {
        throw new BadRequestError('invoices.credit_exceeds_remaining', {
          quantity: item.quantity,
          description: line.description,
          available,
          invoiced: line.quantity,
        });
      }
      selections.push({ line, quantity: item.quantity });
    }
    return selections;
  }

  /** True when the note exhausts every remaining quantity on the invoice. */
  private isFullCredit(original: Invoice, selections: CreditSelection[]): boolean {
    const requested = new Map(selections.map((s) => [s.line.id, s.quantity]));
    return (original.lineItems ?? []).every((line) => {
      const remaining = round6(line.quantity - line.creditedQuantity);
      return remaining <= 1e-6 || Math.abs((requested.get(line.id) ?? 0) - remaining) <= 1e-6;
    });
  }

  private async requireOriginal(
    invoice: Invoice,
    organizationId: string,
    manager: EntityManager,
  ): Promise<Invoice> {
    if (!invoice.originalInvoiceId) {
      throw new BadRequestError('invoices.credit_note_must_reference_invoice_modifies');
    }
    const original = await manager
      .getRepository(Invoice)
      .findOne({ where: { id: invoice.originalInvoiceId, organizationId } });
    if (!original) {
      throw new NotFoundError('invoices.invoice_referenced_credit_note_does_not');
    }
    return original;
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /**
   * Paginated listing.
   *
   * The previous `findAll` returned every invoice of the tenant with its customer relation, over a
   * table whose only index was its primary key. On any real dataset that is a sequential scan of
   * every tenant's invoices per request; the client then downloaded the whole list a second time
   * just to compute "previous / next".
   */
  async findAll(organizationId: string, query: InvoiceListQuery = {}): Promise<PaginatedInvoices> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));

    const qb = this.invoicesRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.customer', 'customer')
      .where('invoice.organizationId = :organizationId', { organizationId });

    if (query.status) qb.andWhere('invoice.status = :status', { status: query.status });
    if (query.customerId) qb.andWhere('invoice.customerId = :customerId', { customerId: query.customerId });
    if (query.excludeDrafts) qb.andWhere('invoice.status <> :draft', { draft: InvoiceStatus.DRAFT });
    if (query.actorUserId || query.branchId) {
      const scope = await loadBranchScope(this.dataSource.manager, organizationId, query.actorUserId ?? null);
      applyBranchScope(qb, 'invoice', scope, query.branchId);
    }
    if (query.from) qb.andWhere('invoice.issueDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('invoice.issueDate <= :to', { to: query.to });
    // `likeTerm` escapes `%` and `_`: a search for "50%" is a search for those characters.
    const search = likeTerm(query.search);
    if (search) {
      qb.andWhere(
        '(invoice.invoiceNumber ILIKE :search OR invoice.fiscalNumber ILIKE :search OR invoice.customerName ILIKE :search)',
        { search },
      );
    }

    // The chosen column first, then the default order as the tie-break, so equal values (the
    // same customer, the same date) keep a stable order from page to page.
    const sortColumn = query.sort ? INVOICE_LIST_SORT[query.sort] : undefined;
    if (sortColumn) {
      qb.orderBy(sortColumn, query.direction?.toLowerCase() === 'desc' ? 'DESC' : 'ASC', 'NULLS LAST')
        .addOrderBy('invoice.issueDate', 'DESC');
    } else {
      qb.orderBy('invoice.issueDate', 'DESC');
    }
    const [items, total] = await qb
      .addOrderBy('invoice.createdAt', 'DESC')
      .addOrderBy('invoice.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  async findOne(id: string, organizationId: string, actorUserId?: string): Promise<Invoice> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id, organizationId },
      relations: ['lineItems', 'lineItems.product', 'customer', 'branch'],
    });
    if (!invoice) {
      throw new NotFoundError('invoices.invoice_id_not_found', { id });
    }
    if (actorUserId) {
      assertDocumentInScope(await loadBranchScope(this.dataSource.manager, organizationId, actorUserId), invoice.branchId);
    }
    invoice.lineItems?.sort((a, b) => a.sortOrder - b.sortOrder);
    return invoice;
  }

  /**
   * Everything the printed representation needs: the document, the issuer, and the e-CF submission
   * that carries the security code and QR the norm requires on the page.
   */
  /** How the company appears on the invoices it e-mails: sender name, reply address, copy. */
  async senderIdentity(organizationId: string) {
    return this.orgSettings.mailIdentity(organizationId);
  }

  async renderContext(
    invoiceId: string,
    organizationId: string,
  ): Promise<{ invoice: Invoice; context: InvoiceRenderContext }> {
    const invoice = await this.findOne(invoiceId, organizationId);
    const organization = await this.dataSource.getRepository(Organization).findOne({
      where: { id: organizationId },
    });
    if (!organization) throw new NotFoundError('invoices.organization_not_found');

    const submission = await this.dataSource.getRepository(EcfSubmission).findOne({
      where: { invoiceId: invoice.id, organizationId },
    });

    // The issuer's house style for the numbers and dates it sends (`regional_format`).
    const regionalFormat = (await this.orgSettings.getForOrg(organizationId))?.regionalFormat ?? null;

    return { invoice, context: { invoice, organization, submission, regionalFormat } };
  }

  /**
   * What this company can issue today, type by type — the one answer the form, the issue preview
   * and the issue itself all use.
   *
   * A type is `available` when the company can draw a number for it today (`FiscalAdapter.liveTypes`:
   * a live authorised range, or no range at all in a market whose numbers are not drawn from one)
   * and `issuable` when, besides, nothing else stands in the way: an electronic type, in a market
   * whose regime signs with the company's certificate, also needs that certificate. Traditional
   * documents (the Dominican serie B, or any market's printed types) need none: they are numbered
   * and printed, and nothing is transmitted when they are issued.
   *
   * It used to be one yes/no for the whole company, computed from every type the MARKET defines:
   * a Dominican company with only B ranges and no certificate was told it could not invoice.
   */
  async issuableTypes(
    organizationId: string,
    countryCode: string | null,
    today: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<IssuableTypes> {
    // Read outside the caller's transaction: a setting, not part of what the document writes.
    const settings = await this.orgSettings.getForOrg(organizationId);
    const mode: FiscalEmissionMode = settings?.fiscalEmissionMode ?? 'BOTH';
    const adapter = this.fiscalAdapterFactory.forCountry(countryCode);
    const certificateRequired = certificatePolicyFor(countryCode) !== null;

    // Every type says whether it is electronic, from the market's catalogue when the adapter
    // does not: the same rule in every country.
    const all = adapter.availableSalesTypes().map((option) => ({
      ...option,
      electronic: option.electronic ?? this.isElectronicType(countryCode, option.code),
    }));
    // The mode only narrows a market that has both kinds; in one that has only electronic types
    // (or only traditional ones) there is nothing to choose, and the mode cannot empty the list.
    const bothKinds = all.some((option) => option.electronic) && all.some((option) => !option.electronic);
    const offered = all.filter(
      (option) => !bothKinds || mode === 'BOTH' || (mode === 'ELECTRONIC') === option.electronic,
    );
    if (!offered.length) {
      return { mode, options: [], certificateReady: true, automaticKind: null, bothKinds, certificateRequired };
    }

    const live = await adapter.liveTypes({
      organizationId,
      codes: offered.map((option) => option.code),
      today,
      manager,
    });

    const needsCertificate = (option: { electronic: boolean }) => certificateRequired && option.electronic;
    const certificateReady = offered.some(needsCertificate)
      ? await this.ecfSubmissionService.isReadyToSign(organizationId, manager)
      : true;
    // Outside DO an electronic type also needs the tenant's transmission channel (FAC-EINV-01/04).
    const needsTransmission = (option: { electronic: boolean }) =>
      needsCertificate(option) && this.fiscalSubmissions.handles(countryCode);
    const transmissionReady = offered.some(needsTransmission)
      ? await this.transmission.isConfigured(organizationId, countryCode as string, manager)
      : true;

    const options: IssuableTypeOption[] = offered.map((option) => {
      const available = live.has(option.code);
      const signable = !needsCertificate(option) || certificateReady;
      const transmittable = !needsTransmission(option) || transmissionReady;
      return {
        ...option,
        available,
        issuable: available && signable && transmittable,
        blockedBy: !available
          ? 'invoices.type_blocked.no_range'
          : !signable
            ? 'invoices.type_blocked.no_certificate'
            : !transmittable
              ? 'invoices.type_blocked.no_transmission'
              : null,
      };
    });

    // The kind an invoice with no type chosen is issued as: the first the mode allows in which the
    // company can issue one of the types the adapter picks by itself. Electronic first, because it
    // is where the law is going; traditional when that is all the company can issue today.
    let automaticKind: EmissionKind | null = null;
    if (bothKinds) {
      const candidates: EmissionKind[] =
        mode === 'ELECTRONIC' ? ['ELECTRONIC'] : mode === 'TRADITIONAL' ? ['TRADITIONAL'] : ['ELECTRONIC', 'TRADITIONAL'];
      const automatic = (kind: EmissionKind, option: IssuableTypeOption) =>
        option.electronic === (kind === 'ELECTRONIC') &&
        (adapter.automaticTypes?.(kind) ?? [option.code]).includes(option.code);
      automaticKind =
        candidates.find((kind) => options.some((option) => option.issuable && automatic(kind, option))) ??
        candidates[0];
    }

    return { mode, options, certificateReady, automaticKind, bothKinds, certificateRequired };
  }

  /**
   * Whether a document type of this market is signed and transmitted, from the market's catalogue.
   *
   * Codes are compared as the authority writes them and without leading zeros, because an adapter
   * may offer AFIP's `01` where the catalogue lists `1`. A code the catalogue does not list is
   * electronic exactly when the market has a regime that signs.
   */
  private isElectronicType(countryCode: string | null, code: string | null | undefined): boolean {
    if (!code) return false;
    const wanted = code.toUpperCase();
    const bare = wanted.replace(/^0+(?=\d)/, '');
    const spec = fiscalDocumentTypesFor(countryCode ?? '').find(
      (entry) => entry.code === wanted || entry.code.replace(/^0+(?=\d)/, '') === bare,
    );
    return spec ? spec.isElectronic : certificatePolicyFor(countryCode) !== null;
  }

  /** The document must be signed with the company's certificate before it may be issued. */
  private needsSignature(countryCode: string | null, documentType: string | null | undefined): boolean {
    return Boolean(documentType) && certificatePolicyFor(countryCode) !== null && this.isElectronicType(countryCode, documentType);
  }

  /**
   * Everything the invoicing screen needs before it can present a sensible form: whether the tenant
   * can issue at all, in which currency, and which fiscal document types its market offers.
   *
   * The client used to hardcode `USD` as the default currency and `0.18` as the tax rate on every
   * line, for every market — so a Mexican tenant saw an 18 % rate where the IVA is 16 %, and a
   * Dominican one invoiced in dollars by default. A client cannot know these; the server does.
   */
  async invoicingContext(organizationId: string): Promise<InvoicingContext> {
    const [missing, organization, settings] = await Promise.all([
      this.bookkeeping.invoicingGaps(organizationId, this.dataSource.manager),
      this.dataSource.getRepository(Organization).findOne({
        where: { id: organizationId },
        select: ['id', 'country', 'taxId'],
      }),
      this.orgSettings.getForOrg(organizationId),
    ]);

    const countryCode = organization?.country ?? null;
    const market = marketFor(countryCode);
    // The rates a new document may carry are the ones in force today in the tenant's time zone.
    const ratesToday = await this.taxRatesOn(organizationId, countryCode, await this.fiscalToday(organizationId), this.dataSource.manager);
    const tenantRates = [...new Set(ratesToday.tenantTaxRates)].sort(
      (a, b) => b - a,
    );
    const jurisdictions =
      market.taxes.model === 'BY_JURISDICTION'
        ? await this.registeredJurisdictions(organizationId)
        : [];

    /**
     * A market that numbers its documents needs a live range before one can be issued.
     *
     * This was not asked, so the contract said `ready: true, missing: []` for a tenant that could
     * not issue anything: the POST then failed with `compliance.no_active_ncf_sequence_type_type`
     * and the screen, having been told it was ready, had nothing better to show than "The document
     * could not be saved." A readiness answer that omits the one thing actually missing is worse
     * than no readiness answer, because the screen trusts it.
     *
     * Only for markets whose adapter numbers sales documents — the generic adapter offers no sales
     * types, and a tenant there is not waiting on a range that does not exist.
     */
    const gaps = [...missing];
    const today = await this.fiscalToday(organizationId);
    const issuable = await this.issuableTypes(organizationId, countryCode, today);
    if (issuable.options.length > 0 && !issuable.options.some((option) => option.issuable)) {
      // Nothing can be issued. Say what is missing for the kind the company issues — a range, or
      // the certificate that signs the electronic ones it holds a range for.
      if (!issuable.options.some((option) => option.available)) {
        gaps.push(
          issuable.mode === 'ELECTRONIC'
            ? 'invoices.gaps.fiscal_sequence_electronic'
            : issuable.mode === 'TRADITIONAL'
              ? 'invoices.gaps.fiscal_sequence_traditional'
              : 'invoices.gaps.fiscal_sequence',
        );
      } else if (!issuable.certificateReady) {
        gaps.push('invoices.gaps.signing_certificate');
      }
    }

    // A comprobante names its issuer: without the company's own tax id the document carries an
    // empty «RNC:» and the 607 an empty header, which the authority rejects (QA R3-A11). Nothing is
    // issuable until it is recorded.
    if (issuable.options.length > 0 && !organization?.taxId?.trim()) {
      gaps.push('invoices.gaps.issuer_tax_id');
      for (const option of issuable.options) option.issuable = false;
    }

    return {
      ready: gaps.length === 0,
      missing: gaps,
      countryCode,
      baseCurrency: settings?.baseCurrency ?? 'USD',
      /**
       * The rates the line selector offers, as fractions, highest first: the standard rate leads.
       *
       * The tenant's own tax catalogue when it has one — the rates it configured, including a
       * reduced rate it added — and the market's scheme only for a tenant whose catalogue is empty.
       * It used to be the scheme alone, so a rate the tenant configured never reached the form.
       */
      taxRates: tenantRates.length > 0 ? tenantRates : [...(ratesToday.statutoryTaxRates ?? [])],
      fixedTaxes: (
        await this.dataSource.manager.getRepository(Tax).find({
          where: { organizationId, type: TaxType.FIXED },
          order: { name: 'ASC' },
        })
      )
        .filter((tax) => (!tax.effectiveFrom || tax.effectiveFrom <= today) && (!tax.effectiveTo || tax.effectiveTo >= today))
        .map((tax) => ({ id: tax.id, name: tax.name, amount: Number(tax.rate) })),
      debitNotes: typeof this.fiscalAdapterFactory.forCountry(countryCode).assignDebitNoteNumber === 'function',
      taxRequiresConfiguration: market.taxes.scheme.configurationRequired,
      taxModel: market.taxes.model,
      registeredJurisdictions: jurisdictions,
      untaxedWithoutRegistration: market.taxes.scheme.noRegistrationMeansNoTax === true,
      fiscalDocumentTypes: issuable.options,
      emissionMode: issuable.mode,
      automaticKind: issuable.automaticKind,
      emissionModeApplies: issuable.bothKinds,
      certificateRequired: issuable.certificateRequired,
      fiscalAuthority: knownMarket(countryCode)?.profile.fiscalAuthority ?? null,
      taxIdLabel: fiscalIdentifierLabel(countryCode ?? ''),
      /** The legal service charge the market applies, as a fraction. Zero where none applies. */
      serviceChargeRate: market.taxes.serviceChargeRate,
      /**
       * The tenant's default credit period, so a new invoice opens with a due date that means
       * something. It used to open due on the day it was issued, whatever the tenant sells on.
       */
      defaultPaymentTermDays: settings?.defaultPaymentTermDays ?? 0,
      today,
    };
  }

  /**
   * The combined rate the company collects per registered state, today: the state row plus the
   * county, city and district rows under it. What the invoice form names when it says where sales
   * tax will be charged.
   */
  private async registeredJurisdictions(
    organizationId: string,
  ): Promise<Array<{ stateCode: string; rate: number }>> {
    const rows: Array<{ state_code: string; rate: string }> = await this.dataSource.query(
      `SELECT "state_code", SUM("rate") AS rate
         FROM "tax_jurisdictions"
        WHERE "organization_id" = $1 AND "is_registered"
          AND "effective_from" <= CURRENT_DATE
          AND ("effective_to" IS NULL OR "effective_to" >= CURRENT_DATE)
        GROUP BY "state_code"
        ORDER BY "state_code"`,
      [organizationId],
    );
    return rows.map((row) => ({ stateCode: row.state_code, rate: Number(row.rate) }));
  }

  /**
   * Today's date as the TENANT's tax authority reads it, `YYYY-MM-DD`.
   *
   * Not `new Date().toISOString()`. The server runs in UTC and every market this product sells into
   * is behind it, so between 20:00 and midnight local the UTC date is already tomorrow: a document
   * dated a day into the future, and on the last evening of a month, a document reported in the
   * wrong period.
   */
  private async fiscalToday(organizationId: string, manager?: EntityManager): Promise<string> {
    const repo = manager
      ? manager.getRepository(Organization)
      : this.dataSource.getRepository(Organization);
    const org = await repo.findOne({
      where: { id: organizationId },
      select: ['id', 'country', 'timezone'],
    });
    return fiscalDate(organizationTimeZone(org));
  }

  // ── e-CF ───────────────────────────────────────────────────────────────────

  /**
   * Hand an electronic document to the e-CF pipeline, after the sale is committed.
   *
   * Fire-and-forget by design: the submission row records the outcome and the reconciler retries
   * anything left in contingency or error. A DGII outage must not fail a sale that is already made.
   */
  private triggerFiscalTransmission(invoice: Invoice): void {
    if (this.regimeSubmissionsToSend.delete(invoice.id)) {
      // Same posture as the e-CF: after the commit, on its own tenant context; the reconciler
      // picks up anything this attempt does not finish.
      runAsTenantJob(this.dataSource, invoice.organizationId, () =>
        this.fiscalSubmissions.process(invoice.id, invoice.organizationId),
      ).catch((error) =>
        this.logger.error(`Fiscal transmission for ${invoice.invoiceNumber} failed: ${(error as Error).message}`),
      );
      return;
    }
    if (!invoice.isElectronicFiscalDocument) return;
    // On its own connection and tenant context. The request's connection is released as soon as
    // the response is sent, and running on it failed every transmission with "Query runner already
    // released". The PENDING row was committed with the invoice, so if this attempt never runs the
    // reconciler sends it.
    runAsTenantJob(this.dataSource, invoice.organizationId, () =>
      this.ecfSubmissionService.submitInvoice(invoice.id, invoice.organizationId),
    ).catch((error) =>
      this.logger.error(
        `e-CF transmission for ${invoice.invoiceNumber} failed: ${(error as Error).message}`,
      ),
    );
  }
}

interface ResolvedLine {
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  /** The list that had a price for the line, and that price (see `InvoiceLineItem.listPrice`). */
  priceListId: string | null;
  listPrice: number | null;
  discountRate: number;
  taxTreatment: TaxTreatment;
  taxRate: number;
  exciseRate: number;
  /** The product's fixed tax per unit, in the document's currency (FAC-TX-01). */
  exciseUnitAmount: number;
  /** The catalogue values the market's regime needs on this line, from the product. */
  fiscalCodes: Record<string, string> | null;
  isService: boolean;
  unitOfMeasure: string;
  unitCost: number;
  movesStock: boolean;
}

interface CreditSelection {
  line: InvoiceLineItem;
  quantity: number;
}

/** Safe ratio: zero when the denominator is zero, which is the correct rate for "nothing charged". */
function proportion(part: number, whole: number): number {
  if (!Number.isFinite(whole) || Math.abs(whole) < 1e-9) return 0;
  const ratio = part / whole;
  return ratio > 0 && ratio <= 1 ? ratio : 0;
}

function round6(value: number): number {
  return roundAmount(value, 6);
}
