import { Injectable, OnModuleInit } from '@nestjs/common';
import { CashPositionRegistry, CashPositionSummary } from '../contracts/treasury/cash-position.contract';
import { TreasuryService } from './treasury.service';

/** Treasury's answer to "how much cash is there", for modules that may not import treasury. */
@Injectable()
export class CashPositionProvider implements OnModuleInit {
  constructor(
    private readonly registry: CashPositionRegistry,
    private readonly treasury: TreasuryService,
  ) {}

  onModuleInit(): void {
    this.registry.provide(this);
  }

  async summary(organizationId: string): Promise<CashPositionSummary> {
    const position = await this.treasury.cashPosition(organizationId);
    return { asOfDate: position.asOfDate, baseCurrency: position.baseCurrency, total: position.total };
  }
}
