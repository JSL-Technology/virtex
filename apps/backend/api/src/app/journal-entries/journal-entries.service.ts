
import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
  Repository,
  DataSource,
  QueryRunner,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
import {
  JournalEntry,
  JournalEntryStatus,
  JournalEntryType,
} from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from './dto/create-journal-entry.dto';
import { Account } from '../chart-of-accounts/entities/account.entity';
import {
  UpdateJournalEntryDto,
  ReverseJournalEntryDto,
} from './dto/journal-entry-actions.dto';
import { StorageService } from '../storage/storage.service';
import { JournalEntryAttachment } from './entities/journal-entry-attachment.entity';
import { BalanceUpdateService } from '../chart-of-accounts/balance-update.service';
import {
  AccountingPeriod,
  PeriodStatus,
} from '../accounting/entities/accounting-period.entity';
import { Journal } from './entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { WorkflowsService } from '../workflows/workflows.service';
import { DocumentTypeForApproval } from '../workflows/entities/approval-policy.entity';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Readable } from 'stream';
import { DimensionRule } from '../dimensions/entities/dimension-rule.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { JournalEntryLineValuation } from './entities/journal-entry-line-valuation.entity';
import { LedgerMappingRule } from '../accounting/entities/ledger-mapping-rule.entity';

@Injectable()
export class JournalEntriesService {
  private readonly logger = new Logger(JournalEntriesService.name);

  constructor(
    @InjectRepository(JournalEntry)
    private readonly journalEntryRepository: Repository<JournalEntry>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(JournalEntryAttachment)
    private readonly attachmentRepository: Repository<JournalEntryAttachment>,
    @InjectRepository(DimensionRule)
    private readonly dimensionRuleRepository: Repository<DimensionRule>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly balanceUpdateService: BalanceUpdateService,
    private readonly workflowsService: WorkflowsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    createDto: CreateJournalEntryDto,
    organizationId: string,
  ): Promise<JournalEntry> {
    const totalDebit = createDto.lines.reduce(
      (sum, line) => sum + (Number(line.debit) || 0),
      0,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const defaultLedger = await queryRunner.manager.findOneBy(Ledger, {
        organizationId,
        isDefault: true,
      });
      if (!defaultLedger) {
        throw new BadRequestException(
          'No se ha configurado un libro contable por defecto para la organización.',
        );
      }


      createDto.lines.forEach((line) => {
        if (!line.valuations || line.valuations.length === 0) {
          line.valuations = [
            {
              ledgerId: defaultLedger.id,
              debit: line.debit,
              credit: line.credit,
            },
          ];
        }
      });


      const entry = queryRunner.manager.create(JournalEntry, {
        ...createDto,
        organizationId,
        status: JournalEntryStatus.DRAFT,
        ledgerId: defaultLedger.id,
      });
      const savedDraft = await queryRunner.manager.save(entry);


      const approvalRequest = await this.workflowsService.startApprovalProcess(
        organizationId,
        savedDraft.id,
        DocumentTypeForApproval.JOURNAL_ENTRY,
        totalDebit,
      );

      if (approvalRequest) {

        savedDraft.status = JournalEntryStatus.PENDING_APPROVAL;
        this.logger.log(`Asiento ${savedDraft.id} enviado para aprobación.`);
      } else {

        this.logger.log(
          `Asiento ${savedDraft.id} no requiere aprobación. Contabilizando...`,
        );
        const postedEntry = await this._postJournalEntry(
          queryRunner.manager,
          createDto,
          organizationId,
        );
        await queryRunner.manager.remove(savedDraft);
        await queryRunner.commitTransaction();
        return postedEntry;
      }

      const finalEntry = await queryRunner.manager.save(savedDraft);
      await queryRunner.commitTransaction();
      return finalEntry;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        'Error al crear asiento contable con flujo de aprobación',
        error.stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async submitForApproval(
    journalEntryId: string,
    organizationId: string,
  ): Promise<JournalEntry> {
    const entry = await this.journalEntryRepository.findOne({
      where: { id: journalEntryId, organizationId },
      relations: ['lines'],
    });
    
    if (!entry) throw new NotFoundException('Asiento no encontrado.');
    
    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        'Solo los asientos en borrador pueden ser enviados a aprobación.',
      );
    }

    const totalDebit = entry.lines.reduce(
      (sum, line) => sum + Number(line.debit),
      0,
    );

    const approvalRequest = await this.workflowsService.startApprovalProcess(
      organizationId,
      entry.id,
      DocumentTypeForApproval.JOURNAL_ENTRY,
      totalDebit,
    );

    if (approvalRequest) {
      entry.status = JournalEntryStatus.PENDING_APPROVAL;
      return this.journalEntryRepository.save(entry);
    } else {

      return this.dataSource.transaction(async (manager) => {
        const dto = this.mapEntityToDto(entry);
        const postedEntry = await this._postJournalEntry(
          manager,
          dto,
          organizationId,
        );
        await manager.remove(entry);
        return postedEntry;
      });
    }
  }

  @OnEvent('approval.request.approved', { async: true })
  async handleApproval(payload: {
    documentId: string;
    documentType: string;
    organizationId: string;
  }) {
    if (payload.documentType !== DocumentTypeForApproval.JOURNAL_ENTRY) {
      return;
    }
    this.logger.log(
      `Recibida aprobación para asiento contable ${payload.documentId}`,
    );

    await this.dataSource.transaction(async (manager) => {
      const entry = await manager.findOne(JournalEntry, {
        where: {
          id: payload.documentId,
          organizationId: payload.organizationId,
        },
      });
      if (!entry || entry.status !== JournalEntryStatus.PENDING_APPROVAL) {
        this.logger.warn(
          `Asiento ${payload.documentId} no encontrado o no está pendiente de aprobación.`,
        );
        return;
      }

      const dto = this.mapEntityToDto(entry);
      await this._postJournalEntry(manager, dto, payload.organizationId);
      await manager.remove(entry);
    });
  }

  async createReversalEntry(
    id: string,
    organizationId: string,
  ): Promise<JournalEntry> {
    const originalEntry = await this.journalEntryRepository.findOne({
      where: { id, organizationId },
      relations: ['lines'],
    });
    
    if (!originalEntry) throw new NotFoundException('Asiento no encontrado.');
    
    if (!originalEntry.reversesNextPeriod) {
      throw new BadRequestException(
        'Este asiento no está marcado para reversión automática.',
      );
    }


    const reversalDate = new Date(
      originalEntry.date.getFullYear(),
      originalEntry.date.getMonth() + 1,
      1,
    );
    
    const reversalDto: ReverseJournalEntryDto = {
      reversalDate: reversalDate.toISOString(),
      reason: 'Reversión automática de ajuste de fin de período.',
    };
    
    return this.reverse(id, organizationId, reversalDto);
  }

  private async _postJournalEntry(
    manager: EntityManager,
    createDto: CreateJournalEntryDto,
    organizationId: string,
  ): Promise<JournalEntry> {
    const { lines, date, journalId, currencyCode, exchangeRate, ...entryData } =
      createDto;
    const entryDate = new Date(date);


    if (!lines || lines.length < 2)
      throw new BadRequestException(
        'Un asiento contable debe tener al menos dos líneas.',
      );

    const defaultLedger = await manager.findOneBy(Ledger, {
      organizationId,
      isDefault: true,
    });
    if (!defaultLedger)
      throw new BadRequestException(
        'Libro contable por defecto no encontrado.',
      );

    const totalDebit = lines.reduce(
      (sum, line) => sum + (Number(line.debit) || 0),
      0,
    );
    const totalCredit = lines.reduce(
      (sum, line) => sum + (Number(line.credit) || 0),
      0,
    );

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException('El asiento contable no está balanceado.');
    }


    const period = await manager.findOne(AccountingPeriod, {
      where: {
        organizationId,
        startDate: LessThanOrEqual(entryDate),
        endDate: MoreThanOrEqual(entryDate),
      },
    });

    if (!period || period.status === PeriodStatus.CLOSED) {
      throw new ForbiddenException(
        'La fecha del asiento corresponde a un período contable cerrado o no definido.',
      );
    }


    await this._validateDimensionRules(manager, lines, organizationId);

    const accountIds = [...new Set(lines.map((line) => line.accountId))];


    const accounts = await manager
      .createQueryBuilder(Account, 'account')
      .where('account.id IN (:...accountIds)', { accountIds })
      .andWhere('account.organizationId = :organizationId', { organizationId })
      .setLock('pessimistic_write')
      .getMany();

    if (accounts.length !== accountIds.length) {
      throw new BadRequestException(
        'Una o más cuentas contables no fueron encontradas, están inactivas o no pertenecen a la organización.',
      );
    }

    const accountMap = new Map(accounts.map((acc) => [acc.id, acc]));

    for (const account of accounts) {
      if (!account.isPostable) {
        throw new BadRequestException(
          `La cuenta '${account.code} - ${account.name['es']}' no permite contabilización.`,
        );
      }
      if (account.isBlockedForPosting) {
        throw new ForbiddenException(
          `La cuenta '${account.code} - ${account.name['es']}' está bloqueada para nuevas transacciones.`,
        );
      }
    }


    const allMappingRules = await manager.find(LedgerMappingRule, {
      where: { organizationId },
    });
    const rulesBySource = new Map<string, LedgerMappingRule[]>();
    for (const rule of allMappingRules) {
      const key = `${rule.sourceLedgerId}-${rule.sourceAccountId}`;
      if (!rulesBySource.has(key)) {
        rulesBySource.set(key, []);
      }
      rulesBySource.get(key)!.push(rule);
    }

    const settings = await manager.findOneBy(OrganizationSettings, {
      organizationId,
    });
    const baseCurrency = settings?.baseCurrency || 'USD';
    const isForeignCurrencyTx = currencyCode && currencyCode !== baseCurrency;
    if (isForeignCurrencyTx && (!exchangeRate || exchangeRate <= 0)) {
      throw new BadRequestException(
        'Se requiere una tasa de cambio (exchangeRate) positiva para transacciones en moneda extranjera.',
      );
    }

    const journalEntry = manager.create(JournalEntry, {
      ...entryData,
      date: entryDate,
      organizationId,
      journalId,
      currencyCode,
      exchangeRate,
      ledgerId: defaultLedger.id,
      status: JournalEntryStatus.POSTED,
      lines: [],
    });
    const savedEntry = await manager.save(journalEntry);

    const finalLines: JournalEntryLine[] = [];
    for (const lineDto of lines) {
      const lineEntity = manager.create(JournalEntryLine, {
        ...lineDto,
        journalEntry: savedEntry,
        account: accountMap.get(lineDto.accountId),
        valuations: [],
      });


      if (isForeignCurrencyTx) {
        lineEntity.foreignCurrencyDebit = lineDto.debit;
        lineEntity.foreignCurrencyCredit = lineDto.credit;
        lineEntity.debit = lineDto.debit * exchangeRate!;
        lineEntity.credit = lineDto.credit * exchangeRate!;
        lineEntity.exchangeRate = exchangeRate;
        lineEntity.currencyCode = currencyCode;
      }


      const initialValuations = lineDto.valuations || [];
      const processedValuations = new Map<string, JournalEntryLineValuation>();

      for (const valuation of initialValuations) {
        const baseValuation = manager.create(JournalEntryLineValuation, {
          ledgerId: valuation.ledgerId,
          debit: valuation.debit,
          credit: valuation.credit,
        });
        processedValuations.set(valuation.ledgerId, baseValuation);

        const key = `${valuation.ledgerId}-${lineEntity.accountId}`;
        const applicableRules = rulesBySource.get(key);

        if (applicableRules) {
          for (const rule of applicableRules) {
            const newEvaluation = manager.create(JournalEntryLineValuation, {
              ledgerId: rule.targetLedgerId,
              debit: valuation.debit * Number(rule.multiplier),
              credit: valuation.credit * Number(rule.multiplier),
            });


            if (!processedValuations.has(newEvaluation.ledgerId)) {
              processedValuations.set(newEvaluation.ledgerId, newEvaluation);
            }
          }
        }
      }

      lineEntity.valuations = Array.from(processedValuations.values());
      const savedLine = await manager.save(lineEntity);
      finalLines.push(savedLine);
    }

    savedEntry.lines = finalLines;


    const allLedgersToUpdate = new Set<string>();
    finalLines.forEach((line) =>
      line.valuations.forEach((v) => allLedgersToUpdate.add(v.ledgerId)),
    );

    for (const ledgerId of allLedgersToUpdate) {
      const balanceUpdates = new Map<string, number>();
      for (const line of finalLines) {
        const valuation = line.valuations?.find((v) => v.ledgerId === ledgerId);
        if (valuation) {
          const netChange = Number(valuation.debit) - Number(valuation.credit);
          balanceUpdates.set(
            line.accountId,
            (balanceUpdates.get(line.accountId) || 0) + netChange,
          );
        }
      }
      if (balanceUpdates.size > 0) {
        await this.balanceUpdateService.queueBalanceUpdates(
          organizationId,
          ledgerId,
          balanceUpdates,
          savedEntry.id,
        );
      }
    }

    this.logger.log(
      `Asiento #${savedEntry.id.substring(0, 8)} contabilizado. Actualización de saldos encolada.`,
    );
    return savedEntry;
  }

  public async createWithQueryRunner(
    queryRunner: QueryRunner,
    createDto: CreateJournalEntryDto,
    organizationId: string,
  ): Promise<JournalEntry> {
    return this._postJournalEntry(
      queryRunner.manager,
      createDto,
      organizationId,
    );
  }



  findAll(organizationId: string): Promise<JournalEntry[]> {
    return this.journalEntryRepository.find({
      where: { organizationId },
      order: { date: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<JournalEntry> {
    const entry = await this.journalEntryRepository.findOne({
      where: { id, organizationId },
      relations: [
        'lines',
        'lines.account',
        'reversesEntry',
        'reversedByEntry',
        'modifiedToEntry',
        'modifiedFromEntry',
        'attachments',
        'journal',
        'ledger',
      ],
    });
    if (!entry) {
      throw new NotFoundException(
        `Asiento contable con ID "${id}" no encontrado.`,
      );
    }
    return entry;
  }

  async update(
    id: string,
    organizationId: string,
    updateDto: UpdateJournalEntryDto,
  ): Promise<JournalEntry> {
    return this.dataSource.transaction(async (manager) => {
      const originalEntry = await manager.findOne(JournalEntry, {
        where: { id, organizationId },
        relations: ['lines'],
      });
      if (!originalEntry)
        throw new NotFoundException('Asiento original no encontrado.');
      if (originalEntry.status !== JournalEntryStatus.POSTED)
        throw new BadRequestException(
          'Solo se pueden modificar asientos contabilizados.',
        );
      if (originalEntry.lines.some((line) => line.isReconciled)) {
        throw new ForbiddenException(
          'No se puede modificar un asiento que contiene líneas conciliadas.',
        );
      }

      const reversalDto: ReverseJournalEntryDto = {
        reversalDate: new Date().toISOString(),
        reason: `Modificación: ${updateDto.modificationReason}`,
      };
      const reversalEntry = await this._reverse(
        id,
        organizationId,
        reversalDto,
        manager,
      );

      const newEntry = await this._postJournalEntry(
        manager,
        updateDto,
        organizationId,
      );

      originalEntry.status = JournalEntryStatus.MODIFIED;
      originalEntry.modifiedToEntryId = newEntry.id;
      await manager.save(originalEntry);

      this.logger.log(
        `Asiento ${id} modificado atómicamente. Nuevo asiento ${newEntry.id} creado.`,
      );
      return newEntry;
    });
  }

  async reverse(
    id: string,
    organizationId: string,
    reverseDto: ReverseJournalEntryDto,
  ): Promise<JournalEntry> {
    return this.dataSource.transaction(async (manager) => {
      return this._reverse(id, organizationId, reverseDto, manager);
    });
  }

  private async _reverse(
    id: string,
    organizationId: string,
    reverseDto: ReverseJournalEntryDto,
    manager: EntityManager,
  ): Promise<JournalEntry> {
    const originalEntry = await manager.findOne(JournalEntry, {
      where: { id, organizationId },
      relations: ['lines', 'lines.valuations'],
    });
    if (!originalEntry)
      throw new NotFoundException('Asiento a reversar no encontrado.');
    if (originalEntry.isReversed)
      throw new BadRequestException('Este asiento ya ha sido reversado.');
    if (originalEntry.lines.some((line) => line.isReconciled)) {
      throw new ForbiddenException(
        'No se puede reversar un asiento que contiene líneas conciliadas.',
      );
    }

    const reversedLines = originalEntry.lines.map((line) => ({
      accountId: line.accountId,
      debit: Number(line.credit),
      credit: Number(line.debit),
      description: `Reversión: ${line.description || originalEntry.description}`,
      dimensions: line.dimensions,
      valuations: line.valuations?.map((v) => ({
        ledgerId: v.ledgerId,
        debit: Number(v.credit),
        credit: Number(v.debit),
      })),
    }));

    const reversalDtoForCreation: CreateJournalEntryDto = {
      date: reverseDto.reversalDate,
      description: `Reversión de asiento ${originalEntry.id.substring(0, 8)}. Razón: ${reverseDto.reason}`,
      journalId: originalEntry.journalId,
      lines: reversedLines,
      currencyCode: originalEntry.currencyCode,
      exchangeRate: originalEntry.exchangeRate
        ? Number(originalEntry.exchangeRate)
        : undefined,
    };

    const reversalEntry = await this._postJournalEntry(
      manager,
      reversalDtoForCreation,
      organizationId,
    );

    reversalEntry.reversesEntryId = originalEntry.id;
    await manager.save(reversalEntry);

    originalEntry.isReversed = true;
    await manager.save(originalEntry);

    return reversalEntry;
  }

  async createSystemReversal(
    journalEntryId: string,
    organizationId: string,
    options: { reversalDate: string; reason: string; journalId: string },
    manager: EntityManager,
  ): Promise<JournalEntry> {
    const reversalDto: ReverseJournalEntryDto = {
      reversalDate: options.reversalDate,
      reason: options.reason,
    };
    
    return this._reverse(journalEntryId, organizationId, reversalDto, manager);
  }



  private async _validateDimensionRules(
    manager: EntityManager,
    lines: CreateJournalEntryLineDto[],
    organizationId: string,
  ): Promise<void> {
    const accountIds = [...new Set(lines.map((line) => line.accountId))];
    if (accountIds.length === 0) {
      return;
    }

    const rules = await manager.find(DimensionRule, {
      where: {
        accountId: In(accountIds),
        isRequired: true,
      },
      relations: ['dimension'],
    });

    if (rules.length === 0) {
      return;
    }

    const rulesByAccount = new Map<string, DimensionRule[]>();
    for (const rule of rules) {
      if (!rulesByAccount.has(rule.accountId)) {
        rulesByAccount.set(rule.accountId, []);
      }
      rulesByAccount.get(rule.accountId)!.push(rule);
    }

    for (const line of lines) {
      const lineRules = rulesByAccount.get(line.accountId);
      if (lineRules) {
        for (const rule of lineRules) {
          const dimensionKey = rule.dimension.name;
          if (!line.dimensions || !line.dimensions[dimensionKey]) {
            const account = await manager.findOneBy(Account, {
              id: line.accountId,
            });
            throw new BadRequestException(
              `La cuenta contable '${account?.code} - ${account?.name['es']}' requiere la dimensión obligatoria '${dimensionKey}'.`,
            );
          }
        }
      }
    }
  }

  private mapEntityToDto(entry: JournalEntry): CreateJournalEntryDto {
    return {
      date: new Date(entry.date).toISOString(),
      description: entry.description,
      journalId: entry.journalId,
      currencyCode: entry.currencyCode,
      exchangeRate: entry.exchangeRate ? Number(entry.exchangeRate) : undefined,
      lines: entry.lines.map((l) => ({
        accountId: l.accountId,
        debit: Number(l.debit),
        credit: Number(l.credit),
        description: l.description,
        dimensions: l.dimensions,
        valuations: l.valuations
          ? l.valuations.map((v) => ({
              ledgerId: v.ledgerId,
              debit: Number(v.debit),
              credit: Number(v.credit),
            }))
          : [],
      })),
    };
  }



  async addAttachment(
    journalEntryId: string,
    file: Express.Multer.File,
    organizationId: string,
    uploadedByUserId: string,
  ): Promise<JournalEntryAttachment> {
    const entry = await this.findOne(journalEntryId, organizationId);





    const storedFile = await this.storageService.upload(
      {
        fileName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
      },
      organizationId,
    );

    const attachment = this.attachmentRepository.create({
      journalEntryId,
      organizationId,
      fileName: file.originalname,
      fileType: file.mimetype,
      fileSize: storedFile.fileSize,
      storageKey: storedFile.storageKey,
      uploadedByUserId,
    });

    return this.attachmentRepository.save(attachment);
  }

  async getAttachment(
    attachmentId: string,
    organizationId: string,
  ): Promise<{
    metadata: JournalEntryAttachment;
    streamable: { stream: Readable; mimeType: string; fileSize: number };
  }> {
    const attachment = await this.attachmentRepository.findOneBy({
      id: attachmentId,
      organizationId,
    });
    if (!attachment) throw new NotFoundException('Adjunto no encontrado.');

    const { stream, fileSize, mimeType } = await this.storageService.getStream(
      attachment.storageKey,
    );
    return { metadata: attachment, streamable: { stream, mimeType, fileSize } };
  }

  async deleteAttachment(
    attachmentId: string,
    organizationId: string,
  ): Promise<void> {
    const attachment = await this.attachmentRepository.findOneBy({
      id: attachmentId,
      organizationId,
    });
    if (!attachment) throw new NotFoundException('Adjunto no encontrado.');

    await this.storageService.delete(attachment.storageKey);
    await this.attachmentRepository.remove(attachment);
  }
}