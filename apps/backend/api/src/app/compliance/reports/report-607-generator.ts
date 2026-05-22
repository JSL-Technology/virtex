
import { Injectable } from '@nestjs/common';
import { FiscalReportGenerator, ReportData } from './fiscal-report.interface';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Between, Not, IsNull, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class Report607Generator implements FiscalReportGenerator {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
  ) {}

  async generate(organizationId: string, year: number, month: number): Promise<ReportData> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const sales = await this.invoiceRepository.find({
      relations: ['customer'],
      where: {
        organizationId,
        issueDate: Between(startDate.toISOString(), endDate.toISOString()),
        ncfNumber: Not(IsNull()),
      },
    });

    const lines = sales.map(sale => {

      return '...';
    });

    const content = lines.join('\n');
    return {
      fileName: `DGII_F_607_${organizationId}_${year}${String(month).padStart(2, '0')}.txt`,
      content,
      mimeType: 'text/plain',
    };
  }
}