
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { FixedAsset, FixedAssetStatus } from './entities/fixed-asset.entity';
import { Page, resolvePaging, toPage } from '../common/pagination';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';
import { LocalizedMessage } from '../i18n/localized-message';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';

@Injectable()
export class FixedAssetsService {
  constructor(
    @InjectRepository(FixedAsset)
    private fixedAssetRepository: Repository<FixedAsset>,
    private readonly dataSource: DataSource,
    private readonly journalEntriesService: JournalEntriesService,
    /** Narratives in the tenant's books language; see `LedgerNarrativeService`. */
    private readonly narrative: LedgerNarrativeService = new LedgerNarrativeService(
      new I18nService(),
    ),
  ) {}

  create(createFixedAssetDto: CreateFixedAssetDto, organizationId: string): Promise<FixedAsset> {
    const newAsset = this.fixedAssetRepository.create({ ...createFixedAssetDto, organizationId });
    newAsset.bookValue = newAsset.cost;
    return this.fixedAssetRepository.save(newAsset);
  }

  /**
   * A page of assets, newest first.
   *
   * It returned every asset the tenant owned. A manufacturer or a hotel group carries tens of
   * thousands, and the list screen asked for all of them at once.
   */
  async findAll(
    organizationId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<Page<FixedAsset>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const [rows, total] = await this.fixedAssetRepository.findAndCount({
      where: { organizationId },
      order: { purchaseDate: 'DESC', id: 'DESC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  async findOne(id: string, organizationId: string): Promise<FixedAsset> {
    const asset = await this.fixedAssetRepository.findOneBy({ id, organizationId });
    if (!asset) {
        throw new NotFoundError('FIXED_ASSETS.ACTIVO_FIJO_ID_NO_ENCONTRADO', { id });
    }
    return asset;
  }

  async update(id: string, updateFixedAssetDto: UpdateFixedAssetDto, organizationId: string): Promise<FixedAsset> {
    const asset = await this.findOne(id, organizationId);
    const updatedAsset = this.fixedAssetRepository.merge(asset, updateFixedAssetDto);
    return this.fixedAssetRepository.save(updatedAsset);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.fixedAssetRepository.delete({ id, organizationId });
    if (result.affected === 0) {
        throw new NotFoundError('FIXED_ASSETS.ACTIVO_FIJO_ID_NO_ENCONTRADO', { id });
    }
  }

  async dispose(
    id: string,
    disposeDto: DisposeAssetDto,
    organizationId: string,
  ): Promise<LocalizedMessage> {
    return this.dataSource.transaction(async (manager) => {

      const asset = await manager.findOneBy(FixedAsset, { id, organizationId });
      if (!asset || asset.status !== FixedAssetStatus.IN_USE) {
        throw new NotFoundError('FIXED_ASSETS.ACTIVO_NO_ENCONTRADO_YA_HA_SIDO_DADO');
      }
      
      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
          throw new BadRequestError('FIXED_ASSETS.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
      }

      const fixedAssetJournal = await manager.findOneBy(Journal, { organizationId, code: 'ACT-FIJOS' });
      if (!fixedAssetJournal) {
          throw new BadRequestError('FIXED_ASSETS.DIARIO_ACTIVOS_FIJOS_ACT_FIJOS_NO_ENCONTRADO');
      }

      const { disposalDate, salePrice, disposalReason, cashAccountId, gainOnDisposalAccountId, lossOnDisposalAccountId } = disposeDto;
      
      const bookValue = asset.cost - asset.accumulatedDepreciation;
      const gainOrLoss = salePrice - bookValue;

      const words = await this.narrative.describeAll(manager, organizationId, {
        header: {
          key: 'LEDGER.FIXED_ASSET.DISPOSAL_ENTRY',
          params: { asset: asset.name, reason: disposalReason },
        },
        proceeds: { key: 'LEDGER.FIXED_ASSET.SALE_PROCEEDS', params: { asset: asset.name } },
        accumulated: {
          key: 'LEDGER.FIXED_ASSET.ACCUMULATED_REVERSAL',
          params: { asset: asset.name },
        },
        cost: { key: 'LEDGER.FIXED_ASSET.COST_REVERSAL', params: { asset: asset.name } },
        gain: { key: 'LEDGER.FIXED_ASSET.GAIN', params: { asset: asset.name } },
        loss: { key: 'LEDGER.FIXED_ASSET.LOSS', params: { asset: asset.name } },
      });
      
      const journalLines = [
        { 
          accountId: cashAccountId, 
          debit: salePrice, 
          credit: 0, 
          description: words.proceeds,
          valuations: [{ ledgerId: defaultLedger.id, debit: salePrice, credit: 0 }]
        },
        { 
          accountId: asset.accumulatedDepreciationAccountId, 
          debit: asset.accumulatedDepreciation, 
          credit: 0, 
          description: words.accumulated,
          valuations: [{ ledgerId: defaultLedger.id, debit: asset.accumulatedDepreciation, credit: 0 }]
        },
        { 
          accountId: asset.assetAccountId, 
          debit: 0, 
          credit: asset.cost, 
          description: words.cost,
          valuations: [{ ledgerId: defaultLedger.id, debit: 0, credit: asset.cost }]
        }
      ];

      if (gainOrLoss > 0) {
          journalLines.push({ 
            accountId: gainOnDisposalAccountId, 
            debit: 0, 
            credit: gainOrLoss, 
            description: words.gain,
            valuations: [{ ledgerId: defaultLedger.id, debit: 0, credit: gainOrLoss }]
          });
      } else if (gainOrLoss < 0) {
          journalLines.push({ 
            accountId: lossOnDisposalAccountId, 
            debit: Math.abs(gainOrLoss), 
            credit: 0, 
            description: words.loss,
            valuations: [{ ledgerId: defaultLedger.id, debit: Math.abs(gainOrLoss), credit: 0 }]
          });
      }
      
      const entryDto: CreateJournalEntryDto = {
        date: disposalDate.toISOString(),
        description: words.header,
        journalId: fixedAssetJournal.id,
        lines: journalLines,
      };


      if (!manager.queryRunner) {
        throw new InternalServerError('FIXED_ASSETS.NO_PUDO_OBTENER_QUERYRUNNER_TRANSACCION');
      }
      await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, entryDto, organizationId);


      asset.status = FixedAssetStatus.DISPOSED;
      await manager.save(asset);
      
      return { messageKey: 'FIXED_ASSETS.ACTIVO_DADO_BAJA_EXITOSAMENTE' };
    });
  }
}