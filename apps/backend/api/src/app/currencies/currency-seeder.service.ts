import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Currency } from './entities/currency.entity';
import { CURRENCY_CATALOGUE } from './currency-catalogue';

/**
 * Brings the `currency` table into agreement with {@link CURRENCY_CATALOGUE} on every boot.
 *
 * Runs unconditionally and is idempotent: it upserts by ISO code and never deletes, so a currency
 * a tenant added by hand survives, and a code that is already present is left with whatever name
 * and symbol the operator chose. Reference data that the schema has a foreign key against must
 * exist before the first transaction, not after somebody notices it does not.
 */
@Injectable()
export class CurrencySeederService implements OnModuleInit {
  private readonly logger = new Logger(CurrencySeederService.name);

  constructor(
    @InjectRepository(Currency)
    private readonly currencyRepository: Repository<Currency>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  async seed(): Promise<number> {
    const existing = await this.currencyRepository.find({ select: ['code'], withDeleted: true });
    const known = new Set(existing.map((c) => c.code));

    const missing = CURRENCY_CATALOGUE.filter((c) => !known.has(c.code));
    if (missing.length === 0) return 0;

    // `name` carries a unique constraint of its own, so a partially seeded table (or a tenant that
    // typed "Euro" by hand) must not abort the batch. Insert one by one, ignoring conflicts.
    let inserted = 0;
    for (const definition of missing) {
      const result = await this.currencyRepository
        .createQueryBuilder()
        .insert()
        .into(Currency)
        .values({ code: definition.code, name: definition.name, symbol: definition.symbol })
        .orIgnore()
        .execute();
      if (result.identifiers.length > 0) inserted += 1;
    }

    this.logger.log(`Catálogo de monedas sembrado: ${inserted} moneda(s) añadida(s).`);
    return inserted;
  }
}
