
import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { FixedAsset, FixedAssetStatus } from './entities/fixed-asset.entity';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';

@Injectable()
export class FixedAssetsService {
  constructor(
    @InjectRepository(FixedAsset)
    private fixedAssetRepository: Repository<FixedAsset>,
    private readonly dataSource: DataSource,
    private readonly journalEntriesService: JournalEntriesService,
  ) {}

  create(createFixedAssetDto: CreateFixedAssetDto, organizationId: string): Promise<FixedAsset> {
    const newAsset = this.fixedAssetRepository.create({ ...createFixedAssetDto, organizationId });
    newAsset.bookValue = newAsset.cost;
    return this.fixedAssetRepository.save(newAsset);
  }

  findAll(organizationId: string): Promise<FixedAsset[]> {
    return this.fixedAssetRepository.find({ where: { organizationId } });
  }

  async findOne(id: string, organizationId: string): Promise<FixedAsset> {
    const asset = await this.fixedAssetRepository.findOneBy({ id, organizationId });
    if (!asset) {
        throw new NotFoundException(`Activo fijo con ID "${id}" no encontrado.`);
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
        throw new NotFoundException(`Activo fijo con ID "${id}" no encontrado.`);
    }
  }

  async dispose(
    id: string,
    disposeDto: DisposeAssetDto,
    organizationId: string,
  ): Promise<{ message: string }> {
    return this.dataSource.transaction(async (manager) => {

      const asset = await manager.findOneBy(FixedAsset, { id, organizationId });
      if (!asset || asset.status !== FixedAssetStatus.IN_USE) {
        throw new NotFoundException('Activo no encontrado o ya ha sido dado de baja.');
      }
      
      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
          throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
      }

      const fixedAssetJournal = await manager.findOneBy(Journal, { organizationId, code: 'ACT-FIJOS' });
      if (!fixedAssetJournal) {
          throw new BadRequestException('Diario de Activos Fijos (ACT-FIJOS) no encontrado.');
      }

      const { disposalDate, salePrice, disposalReason, cashAccountId, gainOnDisposalAccountId, lossOnDisposalAccountId } = disposeDto;
      
      const bookValue = asset.cost - asset.accumulatedDepreciation;
      const gainOrLoss = salePrice - bookValue;
      
      const journalLines = [
        { 
          accountId: cashAccountId, 
          debit: salePrice, 
          credit: 0, 
          description: `Venta de activo: ${asset.name}`,
          valuations: [{ ledgerId: defaultLedger.id, debit: salePrice, credit: 0 }]
        },
        { 
          accountId: asset.accumulatedDepreciationAccountId, 
          debit: asset.accumulatedDepreciation, 
          credit: 0, 
          description: `Baja Dep. Acum. ${asset.name}`,
          valuations: [{ ledgerId: defaultLedger.id, debit: asset.accumulatedDepreciation, credit: 0 }]
        },
        { 
          accountId: asset.assetAccountId, 
          debit: 0, 
          credit: asset.cost, 
          description: `Baja de Activo Fijo: ${asset.name}`,
          valuations: [{ ledgerId: defaultLedger.id, debit: 0, credit: asset.cost }]
        }
      ];

      if (gainOrLoss > 0) {
          journalLines.push({ 
            accountId: gainOnDisposalAccountId, 
            debit: 0, 
            credit: gainOrLoss, 
            description: `Ganancia en venta de activo: ${asset.name}`,
            valuations: [{ ledgerId: defaultLedger.id, debit: 0, credit: gainOrLoss }]
          });
      } else if (gainOrLoss < 0) {
          journalLines.push({ 
            accountId: lossOnDisposalAccountId, 
            debit: Math.abs(gainOrLoss), 
            credit: 0, 
            description: `Pérdida en venta de activo: ${asset.name}`,
            valuations: [{ ledgerId: defaultLedger.id, debit: Math.abs(gainOrLoss), credit: 0 }]
          });
      }
      
      const entryDto: CreateJournalEntryDto = {
        date: disposalDate.toISOString(),
        description: `Baja de activo: ${asset.name}. Motivo: ${disposalReason}`,
        journalId: fixedAssetJournal.id,
        lines: journalLines,
      };


      if (!manager.queryRunner) {
        throw new InternalServerErrorException('No se pudo obtener el QueryRunner de la transacción.');
      }
      await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, entryDto, organizationId);


      asset.status = FixedAssetStatus.DISPOSED;
      await manager.save(asset);
      
      return { message: 'El activo ha sido dado de baja exitosamente.' };
    });
  }
}