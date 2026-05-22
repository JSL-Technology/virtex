
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, Between, DataSource } from 'typeorm';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { GeneralLedgerReportDto } from '../journal-entries/dto/general-ledger-report.dto';
import { JournalReportDto } from '../journal-entries/dto/journal-report.dto';
import { JournalEntryStatus } from '../journal-entries/entities/journal-entry.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CustomerPaymentLine } from '../customers/entities/customer-payment-line.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepository: Repository<JournalEntryLine>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly dataSource: DataSource,
  ) {}

  async getAgingReport(organizationId: string, ledgerId?: string): Promise<any> {
    const today = new Date();
    const ledgerRepo = this.dataSource.getRepository(Ledger);
    let targetLedger: Ledger | null;

    if (ledgerId) {
      targetLedger = await ledgerRepo.findOneBy({ id: ledgerId, organizationId });
      if (!targetLedger) {
        throw new NotFoundException(`Libro contable con ID "${ledgerId}" no encontrado.`);
      }
    } else {
      targetLedger = await ledgerRepo.findOneBy({ organizationId, isDefault: true });
    }

    if (!targetLedger) {
        throw new BadRequestException('No se pudo determinar el libro contable para el reporte. No se especificó uno y no hay uno por defecto.');
    }

    const settings = await this.dataSource.getRepository(OrganizationSettings).findOneBy({ organizationId });
    if (!settings || !settings.defaultAccountsReceivableId) {
        throw new BadRequestException('La cuenta de Cuentas por Cobrar por defecto no está configurada.');
    }
    const arAccountId = settings.defaultAccountsReceivableId;

    const openInvoices = await this.invoiceRepository.find({
      where: {
        organizationId,
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID]),
      },
      relations: ['customer'],
    });

    if (openInvoices.length === 0) {
        return { message: "No hay facturas pendientes de pago para generar el reporte." };
    }

    const paymentLines = await this.dataSource.getRepository(CustomerPaymentLine)
        .createQueryBuilder('line')
        .innerJoin('line.payment', 'payment')
        .innerJoin('payment.journalEntry', 'je')
        .innerJoin('je.lines', 'je_line', 'je_line.accountId = :arAccountId', { arAccountId })
        .innerJoin('je_line.valuations', 'valuation')
        .where('line.invoiceId IN (:...invoiceIds)', { invoiceIds: openInvoices.map(i => i.id) })
        .andWhere('valuation.ledgerId = :ledgerId', { ledgerId: targetLedger.id })
        .select(['line.invoiceId as "invoiceId"', 'SUM(valuation.credit) as "paidAmount"'])
        .groupBy('line.invoiceId')
        .getRawMany();

    const paymentsByInvoice = new Map<string, number>(paymentLines.map(p => [p.invoiceId, parseFloat(p.paidAmount)]));

    const report = {
      reportDate: today.toISOString(),
      ledger: { id: targetLedger.id, name: targetLedger.name },
      buckets: {
        '0-30': { amount: 0, count: 0, invoices: [] as any[] },
        '31-60': { amount: 0, count: 0, invoices: [] as any[] },
        '61-90': { amount: 0, count: 0, invoices: [] as any[] },
        '91+': { amount: 0, count: 0, invoices: [] as any[] },
      },
      total: { amount: 0, count: 0 },
    };

    openInvoices.forEach(invoice => {
        const totalInLedger = invoice.totalInBaseCurrency;
        const paidInLedger = paymentsByInvoice.get(invoice.id) || 0;
        const recalculatedBalance = totalInLedger - paidInLedger;

        if (recalculatedBalance <= 0.01) return;

        const dueDate = new Date(invoice.dueDate);
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 3600 * 24));
        let bucketKey: keyof typeof report.buckets = '0-30';

        if (daysOverdue > 90) bucketKey = '91+';
        else if (daysOverdue > 60) bucketKey = '61-90';
        else if (daysOverdue > 30) bucketKey = '31-60';
        
        const invoiceData = {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            customerName: invoice.customer.companyName,
            dueDate: invoice.dueDate,
            balance: recalculatedBalance
        };
        
        const bucket = report.buckets[bucketKey];
        bucket.amount += recalculatedBalance;
        bucket.count++;
        bucket.invoices.push(invoiceData);

        report.total.amount += recalculatedBalance;
        report.total.count++;
    });

    return report;
  }

  async generateGeneralLedgerReport(organizationId: string, options: GeneralLedgerReportDto): Promise<any> {
    const { ledgerId, startDate, endDate, accountIds, includeDrafts, sortBy } = options;

    const query = this.journalEntryLineRepository.createQueryBuilder('line')
      .leftJoinAndSelect('line.journalEntry', 'entry')
      .leftJoinAndSelect('line.account', 'account')
      .leftJoinAndSelect('line.valuations', 'valuation')
      .where('entry.organizationId = :organizationId', { organizationId })
      .andWhere('valuation.ledgerId = :ledgerId', { ledgerId })
      .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (accountIds && accountIds.length > 0) {
      query.andWhere('line.accountId IN (:...accountIds)', { accountIds });
    }

    if (!includeDrafts) {
      query.andWhere("entry.status = :status", { status: JournalEntryStatus.POSTED });
    }

    if (sortBy === 'account') {
      query.orderBy('account.code', 'ASC').addOrderBy('entry.date', 'ASC');
    } else {
      query.orderBy('entry.date', 'ASC').addOrderBy('account.code', 'ASC');
    }

    const lines = await query.getMany();

    return lines.map(line => {
        const valuation = line.valuations.find(v => v.ledgerId === ledgerId);
        return {
            date: line.journalEntry.date,
            accountCode: line.account.code,
            accountName: line.account.name,
            journalEntryId: line.journalEntry.id,
            description: line.description || line.journalEntry.description,
            debit: valuation?.debit || 0,
            credit: valuation?.credit || 0,
            dimensions: line.dimensions
        };
    });
  }

  async generateJournalReport(organizationId: string, options: JournalReportDto): Promise<any> {
    const { startDate, endDate, journalIds } = options;
    const ledgerId = (options as any).ledgerId;

    const query = this.journalEntryLineRepository.createQueryBuilder('line')
      .leftJoinAndSelect('line.journalEntry', 'entry')
      .leftJoinAndSelect('entry.journal', 'journal')
      .leftJoinAndSelect('line.account', 'account')
      .leftJoinAndSelect('line.valuations', 'valuation')
      .leftJoinAndSelect('valuation.ledger', 'ledger')
      .where('entry.organizationId = :organizationId', { organizationId })
      .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate });

    if (journalIds && journalIds.length > 0) {
      query.andWhere('entry.journalId IN (:...journalIds)', { journalIds });
    }
    
    if (ledgerId) {
        query.andWhere('valuation.ledgerId = :ledgerId', { ledgerId });
    }

    query.orderBy('entry.date', 'ASC').addOrderBy('entry.createdAt', 'ASC');

    const lines = await query.getMany();
    
    const entriesMap = new Map();
    for (const line of lines) {
        const targetLedgerId = ledgerId || line.journalEntry.ledgerId;
        const valuation = line.valuations.find(v => v.ledgerId === targetLedgerId);

        if (!valuation) continue;

        if (!entriesMap.has(line.journalEntry.id)) {
            entriesMap.set(line.journalEntry.id, {
                id: line.journalEntry.id,
                date: line.journalEntry.date,
                description: line.journalEntry.description,
                journalName: line.journalEntry.journal.name,
                ledgerName: valuation.ledger.name,
                status: line.journalEntry.status,
                lines: []
            });
        }
        
        entriesMap.get(line.journalEntry.id).lines.push({
            accountCode: line.account.code,
            accountName: line.account.name,
            description: line.description,
            debit: valuation.debit,
            credit: valuation.credit,
            dimensions: line.dimensions,
        });
    }

    return Array.from(entriesMap.values());
  }
}