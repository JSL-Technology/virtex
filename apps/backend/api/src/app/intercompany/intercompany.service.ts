
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { CreateIntercompanyTransactionDto } from './dto/create-intercompany-transaction.dto';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { IntercompanyTransaction, IntercompanyTransactionStatus } from './entities/intercompany-transaction.entity';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { Journal } from '../journal-entries/entities/journal.entity';


export interface DestinationEntryJobData {
  intercompanyTransactionId: string;
  toOrganizationId: string;
  toEntryDto: CreateJournalEntryDto;
}

@Injectable()
export class IntercompanyService {
  private readonly logger = new Logger(IntercompanyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly journalEntriesService: JournalEntriesService,
    @InjectQueue('intercompany-jobs') private readonly intercompanyQueue: Queue<DestinationEntryJobData>,
  ) {}

  async create(
    dto: CreateIntercompanyTransactionDto,
    fromOrganizationId: string,
  ): Promise<IntercompanyTransaction> {
    const { toOrganizationId, date, amount, currency, description, fromAccountId, toAccountId } = dto;

    if (fromOrganizationId === toOrganizationId) {
      throw new BadRequestException('Las transacciones intercompañía deben ser entre organizaciones diferentes.');
    }
    

    const intercompanyTx = await this.dataSource.transaction(async (manager) => {

      const fromOrg = await manager.findOneBy(Organization, { id: fromOrganizationId });
      const toOrg = await manager.findOneBy(Organization, { id: toOrganizationId });
      if (!fromOrg || !toOrg) {
        throw new NotFoundException('Una de las organizaciones no fue encontrada.');
      }

      const fromSettings = await manager.findOneBy(OrganizationSettings, { organizationId: fromOrganizationId });
      const toSettings = await manager.findOneBy(OrganizationSettings, { organizationId: toOrganizationId });
      if (!fromSettings?.defaultIntercompanyReceivableAccountId || !toSettings?.defaultIntercompanyPayableAccountId) {
        throw new BadRequestException('Las cuentas intercompañía por defecto no están configuradas en una o ambas organizaciones.');
      }
      
      const generalJournal = await manager.findOneBy(Journal, { organizationId: fromOrganizationId, type: 'GENERAL' });
      if (!generalJournal) {
        throw new BadRequestException(`La organización de origen no tiene un diario de tipo 'GENERAL' configurado.`);
      }

      const toGeneralJournal = await manager.findOneBy(Journal, { organizationId: toOrganizationId, type: 'GENERAL' });
      if (!toGeneralJournal) {
        throw new BadRequestException(`La organización de destino no tiene un diario de tipo 'GENERAL' configurado.`);
      }


      let toAmount = amount;
      if (fromSettings.baseCurrency !== toSettings.baseCurrency) {
        const rate = await manager.findOne(ExchangeRate, {
            where: { fromCurrency: fromSettings.baseCurrency, toCurrency: toSettings.baseCurrency },
            order: { date: 'DESC' }
        });
        if (!rate) {
          throw new BadRequestException(`No se encontró tasa de cambio de ${fromSettings.baseCurrency} a ${toSettings.baseCurrency}.`);
        }
        toAmount = amount * rate.rate;
      }


      const fromEntryDto: CreateJournalEntryDto = {
        date,
        description: `Intercompañía (->${toOrg.legalName}): ${description}`,
        currencyCode: currency,
        journalId: generalJournal.id,
        lines: [
          { 
            accountId: fromSettings.defaultIntercompanyReceivableAccountId, 
            debit: amount, 
            credit: 0, 
            description: `Préstamo a ${toOrg.legalName}` 
          },
          { 
            accountId: fromAccountId, 
            debit: 0, 
            credit: amount, 
            description: `Salida de fondos` 
          },
        ]
      };

      if (!manager.queryRunner) {
        throw new InternalServerErrorException('No se pudo obtener el Query Runner para el asiento de origen.');
      }

      const fromJournalEntry = await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, fromEntryDto, fromOrganizationId);


      const newIntercompanyTx = manager.create(IntercompanyTransaction, {
        fromOrganizationId, 
        toOrganizationId, 
        amount, 
        currency, 
        description,
        transactionDate: new Date(date),
        sourceJournalEntryId: fromJournalEntry.id,
        status: IntercompanyTransactionStatus.PENDING,
      });

      return manager.save(newIntercompanyTx);
    });



    const toSettings = await this.dataSource.getRepository(OrganizationSettings).findOneBy({ organizationId: toOrganizationId });
    const toGeneralJournal = await this.dataSource.getRepository(Journal).findOneBy({ organizationId: toOrganizationId, type: 'GENERAL' });
    const fromOrg = await this.dataSource.getRepository(Organization).findOneBy({ id: fromOrganizationId });



    if (!toSettings || !toGeneralJournal || !fromOrg) {
        this.logger.error(`Error crítico de consistencia de datos para la transacción intercompañía ${intercompanyTx.id}. Faltan datos de destino.`);

        throw new InternalServerErrorException('Error de consistencia de datos al preparar el asiento de destino.');
    }
    
    if (!toSettings.defaultIntercompanyPayableAccountId) {
        throw new InternalServerErrorException(`La cuenta por pagar intercompañía por defecto no está configurada en la organización de destino ${toOrganizationId}.`);
    }


    let toAmount = amount;
     if (toSettings.baseCurrency !== currency) {
        const rate = await this.dataSource.getRepository(ExchangeRate).findOne({
            where: { fromCurrency: currency, toCurrency: toSettings.baseCurrency },
            order: { date: 'DESC' }
        });
        toAmount = amount * (rate?.rate || 1);
     }

    const toEntryDto: CreateJournalEntryDto = {
        date,
        description: `Intercompañía (<-${fromOrg.legalName}): ${description}`,
        currencyCode: toSettings.baseCurrency,
        journalId: toGeneralJournal.id,
        lines: [
          { 
            accountId: toAccountId, 
            debit: toAmount, 
            credit: 0, 
            description: `Recepción de fondos` 
          },
          { 
            accountId: toSettings.defaultIntercompanyPayableAccountId, 
            debit: 0, 
            credit: toAmount, 
            description: `Deuda con ${fromOrg.legalName}` 
          },
        ]
    };
    
    const jobData: DestinationEntryJobData = {
        intercompanyTransactionId: intercompanyTx.id,
        toOrganizationId: toOrganizationId,
        toEntryDto: toEntryDto,
    };
    

    await this.intercompanyQueue.add('create-destination-entry', jobData, {
        jobId: `intercompany-${intercompanyTx.id}`,
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 1000 * 60,
        },
    });

    this.logger.log(`Trabajo encolado para el asiento de destino de la transacción intercompañía ${intercompanyTx.id}`);

    return intercompanyTx;
  }
}