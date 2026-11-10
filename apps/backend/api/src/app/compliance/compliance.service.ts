import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { organizationTimeZone } from '../shared/fiscal-clock';
import { PurchaseFiscalRecordsRegistry } from '../contracts/fiscal-records/purchase-fiscal-records.registry';
import { monthBounds } from '../common/dates';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { CollectedWithholding, DominicanRepublicReports, TillFiscalSale } from './reports/dr-reports';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { DataSource } from 'typeorm';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import {
  MexicanAccountingPeriod,
  MexicanElectronicAccounting,
  PolizasRequestType,
} from './reports/mx-electronic-accounting';

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly dataSource: DataSource,
    /** The ledger's own figures, so the Mexican filings and the statements cannot disagree. */
    private readonly balances: AccountBalancesService,
    /** Purchasing's answer for the purchases returns, without importing its tables. */
    private readonly purchaseRecords: PurchaseFiscalRecordsRegistry,
  ) {}

  // ── Mexico: contabilidad electrónica (Anexo 24, versión 1.3) ───────────────

  /**
   * The three XML files a Mexican taxpayer files with the SAT.
   *
   * The `NumUnIdenPol` the Pólizas file needs — a gap-free consecutive per journal per fiscal
   * year, allocated inside the posting transaction — is the requirement that normally forces a
   * ledger rewrite, and this product already produced it. What was missing was the serialisation.
   *
   * The files are unsigned. Sealing them with the taxpayer's FIEL and submitting them through the
   * Buzón Tributario is the accountant's step, and a file this product claimed to have sealed and
   * had not would be worse than an honest unsigned one.
   */
  private mexicanAccounting(): MexicanElectronicAccounting {
    return new MexicanElectronicAccounting(this.dataSource.manager, this.balances);
  }

  generateMexicanCatalogo(period: MexicanAccountingPeriod): Promise<string> {
    return this.mexicanAccounting().catalogo(period);
  }

  generateMexicanBalanza(
    period: MexicanAccountingPeriod,
    options: { tipoEnvio?: 'N' | 'C'; fechaModBal?: string } = {},
  ): Promise<string> {
    return this.mexicanAccounting().balanza(period, options);
  }

  generateMexicanPolizas(
    period: MexicanAccountingPeriod,
    options: { tipoSolicitud?: PolizasRequestType; numOrden?: string; numTramite?: string } = {},
  ): Promise<string> {
    return this.mexicanAccounting().polizas(period, options);
  }

  // ── DGII periodic reports ──────────────────────────────────────────────────

  async generate607Report(organizationId: string, year: number, month: number): Promise<string> {
    await this.assertDominicanRepublic(organizationId, '607');
    const organization = await this.requireOrganization(organizationId);
    return DominicanRepublicReports.generate607Report(
      organizationId,
      year,
      month,
      this.invoiceRepository,
      organization,
      await this.tillFiscalSales(organization, year, month),
      await this.collectedWithholdings(organizationId, year, month),
    );
  }

  /**
   * What customers withheld from us on the period's invoices, from the receipts that carried it
   * (607 boxes 7, 10 and 12). A voided receipt withheld nothing.
   */
  private async collectedWithholdings(
    organizationId: string,
    year: number,
    month: number,
  ): Promise<Map<string, CollectedWithholding>> {
    const { from, to } = monthBounds(year, month);
    const rows: Array<{ invoice_id: string; tax: string; income_tax: string; withheld_on: string }> = await this.dataSource.query(
      `SELECT l.invoice_id,
              SUM(l.tax_withheld)::text AS tax,
              SUM(l.income_tax_withheld)::text AS income_tax,
              to_char(MAX(p.payment_date), 'YYYY-MM-DD') AS withheld_on
         FROM customer_payment_lines l
         JOIN customer_payments p ON p.id = l.payment_id
         JOIN invoices i ON i.id = l.invoice_id
        WHERE p.organization_id = $1 AND i.organization_id = $1
          AND p.status <> 'VOID'
          AND i."issueDate" BETWEEN $2 AND $3
          AND (l.tax_withheld <> 0 OR l.income_tax_withheld <> 0)
        GROUP BY l.invoice_id`,
      [organizationId, from, to],
    );
    return new Map(
      rows.map((row) => [
        row.invoice_id,
        { tax: Number(row.tax), incomeTax: Number(row.income_tax), date: row.withheld_on },
      ]),
    );
  }

  /**
   * The month's till tickets that carry a comprobante, dated in the company's fiscal time zone
   * (QA R3-C02). Read straight from the tills' journal so the fiscal module does not depend on the
   * point-of-sale module's entities.
   */
  private async tillFiscalSales(organization: Organization, year: number, month: number): Promise<TillFiscalSale[]> {
    const { from, to } = monthBounds(year, month);
    const timeZone = organizationTimeZone(organization);
    const rows: Array<{
      fiscal_number: string;
      sale_date: string;
      items: Array<{ lineSubtotal: number; isService?: boolean }>;
      tax: string;
      total: string;
      change_due: string;
      payments: Array<{ method: string; amount: number }>;
      payment_method: string | null;
      status: string;
      void_reason: string | null;
    }> = await this.invoiceRepository.manager.query(
      // pos_sales mixes naming conventions: "createdAt" and "paymentMethod" are camelCase columns.
      // Written as snake_case they made this query fail, so the 607 and 608 answered 500 for every
      // Dominican tenant (audit 2026-11-07, FAC-CMP-01). compliance-till-sales.spec.ts runs it
      // against the real schema so a rename cannot slip past again.
      `SELECT fiscal_number, to_char("createdAt" AT TIME ZONE $2, 'YYYY-MM-DD') AS sale_date, items, tax, total,
              change_due, payments, "paymentMethod" AS payment_method, status, void_reason
         FROM pos_sales
        WHERE organization_id = $1 AND fiscal_number IS NOT NULL
          AND ("createdAt" AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
        ORDER BY "createdAt"`,
      [organization.id, timeZone, from, to],
    );
    return rows.map((row) => {
      const services = (row.items ?? []).filter((i) => i.isService).reduce((sum, i) => sum + Number(i.lineSubtotal), 0);
      const goods = (row.items ?? []).filter((i) => !i.isService).reduce((sum, i) => sum + Number(i.lineSubtotal), 0);
      const by = { cash: 0, card: 0, transfer: 0, other: 0 } as Record<'cash' | 'card' | 'transfer' | 'other', number>;
      const payments = row.payments?.length ? row.payments : [{ method: row.payment_method ?? 'cash', amount: Number(row.total) + Number(row.change_due) }];
      for (const p of payments) {
        const method = (['cash', 'card', 'transfer'] as const).find((m) => m === p.method) ?? 'other';
        by[method] += Number(p.amount);
      }
      // Change always comes out of the cash tendered.
      by.cash = Math.max(0, by.cash - Number(row.change_due));
      return {
        fiscalNumber: row.fiscal_number,
        date: row.sale_date,
        goods,
        services,
        tax: Number(row.tax),
        ...by,
        voided: row.status !== 'PAID',
        voidReason: row.void_reason,
      };
    });
  }

  async generate606Report(organizationId: string, year: number, month: number): Promise<string> {
    await this.assertDominicanRepublic(organizationId, '606');
    const documents = await this.purchaseRecords
      .source()
      .fiscalDocuments({ organizationId, ...monthBounds(year, month) });
    return DominicanRepublicReports.generate606Report(
      year,
      month,
      documents,
      await this.requireOrganization(organizationId),
    );
  }

  async generate608Report(organizationId: string, year: number, month: number): Promise<string> {
    await this.assertDominicanRepublic(organizationId, '608');
    const organization = await this.requireOrganization(organizationId);
    return DominicanRepublicReports.generate608Report(
      organizationId,
      year,
      month,
      this.invoiceRepository,
      organization,
      await this.tillFiscalSales(organization, year, month),
    );
  }

  async generate609Report(organizationId: string, year: number, month: number): Promise<string> {
    await this.assertDominicanRepublic(organizationId, '609');
    const documents = await this.purchaseRecords
      .source()
      .foreignPurchases({ organizationId, ...monthBounds(year, month) }, 'DO');
    return DominicanRepublicReports.generate609Report(
      year,
      month,
      documents,
      await this.requireOrganization(organizationId),
    );
  }

  private async requireOrganization(organizationId: string): Promise<Organization> {
    const organization = await this.organizationRepository.findOne({ where: { id: organizationId } });
    if (!organization) throw new NotFoundError('compliance.organization_not_found');
    return organization;
  }

  /**
   * The 606/607/608/609 are formats of the Dominican tax authority. Generating one for a Mexican or
   * Chilean tenant produced a plausible-looking file that means nothing to their own authority —
   * the previous code carried a `TODO: Check organization country` and shipped it anyway.
   */
  private async assertDominicanRepublic(organizationId: string, report: string): Promise<void> {
    const organization = await this.requireOrganization(organizationId);
    const country = (organization.country ?? '').toUpperCase();
    if (country !== 'DO') {
      throw new BadRequestError('compliance.report_format_dgii_dominican_republic_filing', {
        report,
        country: organization.country ?? '—',
      });
    }
  }
}
