
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { Ledger } from './entities/ledger.entity';
import { LedgerMappingRule } from './entities/ledger-mapping-rule.entity';
import { CreateOrUpdateLedgerMapDto } from './dto/ledger-mapping.dto';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { LocalizedResult } from '../i18n/localized-message';

@Injectable()
export class LedgerMappingService {
  /**
   * Every rule names accounts of this company, and each source account once (FIN-AC-05).
   *
   * The rules were inserted as sent: an account of another company was stopped only by the
   * database's same-tenant guard, as a bare foreign-key violation, and a source account named twice
   * by the unique index, as a bare conflict — neither saying which rule. Checked here first, by its
   * position in the list, before the existing rules are replaced.
   */
  private static async assertMappingsFit(
    manager: EntityManager,
    organizationId: string,
    mappings: ReadonlyArray<{ sourceAccountId: string; parentAccountId: string }>,
  ): Promise<void> {
    const ids = [...new Set(mappings.flatMap((mapping) => [mapping.sourceAccountId, mapping.parentAccountId]))];
    const own = new Set(
      ids.length
        ? (await manager.find(Account, { where: { organizationId, id: In(ids) }, select: { id: true } })).map((account) => account.id)
        : [],
    );
    const firstLine = new Map<string, number>();
    mappings.forEach((mapping, index) => {
      const line = index + 1;
      if (!own.has(mapping.sourceAccountId) || !own.has(mapping.parentAccountId)) {
        throw new BadRequestError('accounting.ledger_mapping_account_not_found', { line });
      }
      const first = firstLine.get(mapping.sourceAccountId);
      if (first !== undefined) {
        throw new BadRequestError('accounting.ledger_mapping_source_repeated', { line, first });
      }
      firstLine.set(mapping.sourceAccountId, line);
    });
  }

  constructor(
    @InjectRepository(LedgerMappingRule)
    private readonly ruleRepository: Repository<LedgerMappingRule>,
    @InjectRepository(Ledger)
    private readonly ledgerRepository: Repository<Ledger>,
    private readonly dataSource: DataSource,
  ) {}

  async getMapForLedgerPair(
    sourceLedgerId: string,
    targetLedgerId: string,
    organizationId: string,
  ): Promise<LedgerMappingRule[]> {
    return this.ruleRepository.find({
      where: { sourceLedgerId, targetLedgerId, organizationId },
      relations: ['sourceAccount', 'targetAccount'],
    });
  }

  async createOrUpdateMap(
    dto: CreateOrUpdateLedgerMapDto,
    organizationId: string,
  ): Promise<LocalizedResult<{ created: number }>> {
    const { sourceLedgerId, targetLedgerId, mappings } = dto;

    return this.dataSource.transaction(async (manager) => {

      const [sourceLedger, targetLedger] = await Promise.all([
        manager.findOneBy(Ledger, { id: sourceLedgerId, organizationId }),
        manager.findOneBy(Ledger, { id: targetLedgerId, organizationId }),
      ]);
      if (!sourceLedger || !targetLedger) {
        throw new NotFoundError('accounting.one_both_ledgers_not_found');
      }
      if (sourceLedgerId === targetLedgerId) {
        throw new BadRequestError('accounting.ledger_mapping_same_ledger');
      }
      await LedgerMappingService.assertMappingsFit(manager, organizationId, mappings);


      await manager.delete(LedgerMappingRule, {
        sourceLedgerId,
        targetLedgerId,
        organizationId,
      });

      if (mappings.length === 0) {
        return { messageKey: 'accounting.all_existing_rules_deleted', created: 0 };
      }


      const newRules = mappings.map((m) =>
        manager.create(LedgerMappingRule, {
          organizationId,
          sourceLedgerId,
          targetLedgerId,
          sourceAccountId: m.sourceAccountId,
          targetAccountId: m.parentAccountId,
          multiplier: m.multiplier ?? 1.0,
        }),
      );


      await manager.save(newRules);

      return {
        messageKey: 'accounting.ledger_map_updated',
        messageParams: { source: sourceLedger.name, target: targetLedger.name },
        created: newRules.length,
      };
    });
  }
}