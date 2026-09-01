
import { Injectable, Logger } from '@nestjs/common';
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
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';


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
      throw new BadRequestError('INTERCOMPANY.TRANSACCIONES_INTERCOMPANIA_DEBEN_SER_ENTRE_ORGANIZACIONES_DIFERENTES');
    }
    

    const intercompanyTx = await this.dataSource.transaction(async (manager) => {

      const fromOrg = await manager.findOneBy(Organization, { id: fromOrganizationId });
      const toOrg = await manager.findOneBy(Organization, { id: toOrganizationId });
      if (!fromOrg || !toOrg) {
        throw new NotFoundError('INTERCOMPANY.ORGANIZACIONES_NO_FUE_ENCONTRADA');
      }

      const fromSettings = await manager.findOneBy(OrganizationSettings, { organizationId: fromOrganizationId });
      const toSettings = await manager.findOneBy(OrganizationSettings, { organizationId: toOrganizationId });
      if (!fromSettings?.defaultIntercompanyReceivableAccountId || !toSettings?.defaultIntercompanyPayableAccountId) {
        throw new BadRequestError('INTERCOMPANY.CUENTAS_INTERCOMPANIA_DEFECTO_NO_ESTAN_CONFIGURADAS_AMBAS');
      }
      
      const generalJournal = await manager.findOneBy(Journal, { organizationId: fromOrganizationId, type: 'GENERAL' });
      if (!generalJournal) {
        throw new BadRequestError('INTERCOMPANY.ORGANIZACION_ORIGEN_NO_TIENE_DIARIO_TIPO_GENERAL');
      }

      const toGeneralJournal = await manager.findOneBy(Journal, { organizationId: toOrganizationId, type: 'GENERAL' });
      if (!toGeneralJournal) {
        throw new BadRequestError('INTERCOMPANY.ORGANIZACION_DESTINO_NO_TIENE_DIARIO_TIPO_GENERAL');
      }


      let toAmount = amount;
      if (fromSettings.baseCurrency !== toSettings.baseCurrency) {
        const rate = await manager.findOne(ExchangeRate, {
            where: { fromCurrency: fromSettings.baseCurrency, toCurrency: toSettings.baseCurrency },
            order: { date: 'DESC' }
        });
        if (!rate) {
          throw new BadRequestError('INTERCOMPANY.NO_ENCONTRO_TASA_CAMBIO', { baseCurrency: fromSettings.baseCurrency, baseCurrency2: toSettings.baseCurrency });
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
        throw new InternalServerError('INTERCOMPANY.NO_PUDO_OBTENER_QUERY_RUNNER_ASIENTO_ORIGEN');
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

        throw new InternalServerError('INTERCOMPANY.ERROR_CONSISTENCIA_DATOS_PREPARAR_ASIENTO_DESTINO');
    }
    
    if (!toSettings.defaultIntercompanyPayableAccountId) {
        throw new InternalServerError('INTERCOMPANY.CUENTA_PAGAR_INTERCOMPANIA_DEFECTO_NO_ESTA_CONFIGURADA', { toOrganizationId });
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