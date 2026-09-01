
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Ledger } from './entities/ledger.entity';
import { LedgerMappingRule } from './entities/ledger-mapping-rule.entity';
import { CreateOrUpdateLedgerMapDto } from './dto/ledger-mapping.dto';
import { NotFoundError } from '../i18n/localized.exception';
import { LocalizedResult } from '../i18n/localized-message';

@Injectable()
export class LedgerMappingService {
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
        throw new NotFoundError('ACCOUNTING.UNO_AMBOS_LIBROS_CONTABLES_NO_FUERON_ENCONTRADOS');
      }


      await manager.delete(LedgerMappingRule, {
        sourceLedgerId,
        targetLedgerId,
        organizationId,
      });

      if (mappings.length === 0) {
        return { messageKey: 'ACCOUNTING.TODAS_REGLAS_EXISTENTES_FUERON_ELIMINADAS', created: 0 };
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
        messageKey: 'ACCOUNTING.LEDGER_MAP_UPDATED',
        messageParams: { source: sourceLedger.name, target: targetLedger.name },
        created: newRules.length,
      };
    });
  }
}