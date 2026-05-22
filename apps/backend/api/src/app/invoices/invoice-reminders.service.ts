
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InvoicesService } from './invoices.service';


@Injectable()
export class InvoiceRemindersService {
  constructor(
    private readonly invoicesService: InvoicesService,

  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleOverdueInvoiceReminders() {
    const overdueInvoices = await this.invoicesService.findOverdueInvoices();
    for (const invoice of overdueInvoices) {


    }
  }
}