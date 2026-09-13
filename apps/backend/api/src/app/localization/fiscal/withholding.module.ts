import { Module } from '@nestjs/common';
import { WithholdingResolverService } from '../../invoices/services/withholding-resolver.service';

/**
 * The withholding resolver, on its own, because both sides of the ledger need it.
 *
 * It was a private provider of `InvoicesModule`, which is why the purchase side could not use it
 * and took its withholding amounts straight off the request instead. The service injects nothing —
 * it works on the `EntityManager` its caller hands it — so a module that provides and exports it
 * costs nothing and removes the question of whether invoices and payables may import each other.
 */
@Module({
  providers: [WithholdingResolverService],
  exports: [WithholdingResolverService],
})
export class WithholdingModule {}
