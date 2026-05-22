
import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BankStatement,
  StatementStatus,
} from './entities/bank-statement.entity';
import { Repository, Between, DataSource, In } from 'typeorm';
import { UploadStatementDto } from './dto/upload-statement.dto';
import { CsvParserService } from './parsers/csv-parser.service';
import { Account } from '../chart-of-accounts/entities/account.entity';
import {
  BankTransaction,
  TransactionStatus,
} from './entities/bank-transaction.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import {
  ReconciliationRule,
  RuleConditionOperator,
  RuleConditionField,
} from './entities/reconciliation-rule.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { MatchTransactionsDto } from './dto/match-transactions.dto';
import { addDays, subDays } from 'date-fns';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(BankStatement)
    private readonly statementRepository: Repository<BankStatement>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepository: Repository<JournalEntryLine>,
    @InjectRepository(ReconciliationRule)
    private readonly ruleRepository: Repository<ReconciliationRule>,
    private readonly csvParser: CsvParserService,
    private readonly dataSource: DataSource,
    private readonly journalEntriesService: JournalEntriesService,
  ) {}
  
  async processStatementUpload(
    file: Express.Multer.File,
    dto: UploadStatementDto,
    organizationId: string,
  ): Promise<BankStatement> {
    const account = await this.accountRepository.findOne({
      where: { id: dto.accountId, organizationId },
    });
    if (!account) {
      throw new BadRequestException(
        'La cuenta bancaria especificada no es válida.',
      );
    }

    const newStatement = this.statementRepository.create({
      organizationId,
      accountId: dto.accountId,
      fileName: file.originalname,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      startingBalance: dto.startingBalance,
      endingBalance: dto.endingBalance,
      status: StatementStatus.PROCESSING,
    });

    const savedStatement = await this.statementRepository.save(newStatement);

    try {
      const transactions = await this.csvParser.parse(file.buffer, {
        date: dto.dateColumn,
        description: dto.descriptionColumn,
        debit: dto.debitColumn,
        credit: dto.creditColumn,
        amount: dto.amountColumn,
      });
      savedStatement.transactions = transactions.map((t) => {
        const bankTx = new BankTransaction();
        bankTx.date = t.date;
        bankTx.description = t.description;
        bankTx.debit = t.debit;
        bankTx.credit = t.credit;
        return bankTx;
      });

      savedStatement.status = StatementStatus.COMPLETED;
    } catch (error) {
      this.logger.error('Fallo al procesar el archivo CSV', error.stack);
      savedStatement.status = StatementStatus.FAILED;
      await this.statementRepository.save(savedStatement);
      throw new BadRequestException(
        'El formato del archivo CSV no es válido, está corrupto, o el mapeo de columnas es incorrecto.',
      );
    }

    const finalStatement = await this.statementRepository.save(savedStatement);
    this.autoReconcileStatement(finalStatement.id, organizationId).catch(err => {
        this.logger.error(`Error en el proceso de auto-conciliación asíncrono para el estado de cuenta ${finalStatement.id}`, err.stack);
    });
    return finalStatement;
  }

  getStatements(
    accountId: string,
    organizationId: string,
  ): Promise<BankStatement[]> {
    return this.statementRepository.find({
      where: { accountId, organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async getReconciliationView(
    statementId: string,
    organizationId: string,
  ) {
    const statement = await this.statementRepository.findOne({
      where: { id: statementId, organizationId },
      relations: ['transactions', 'transactions.matchedEntryLine', 'transactions.matchedEntryLine.journalEntry'],
    });

    if (!statement) {
      throw new NotFoundException('Estado de cuenta no encontrado.');
    }

    const searchStartDate = subDays(statement.startDate, 30);
    const searchEndDate = addDays(statement.endDate, 30);

    const alreadyMatchedLines = await this.dataSource.manager.find(BankTransaction, {
        where: { statement: { accountId: statement.accountId }, status: In([TransactionStatus.MATCHED, TransactionStatus.MANUALLY_MATCHED])},
        select: ['matchedEntryLineId']
    });
    const matchedLineIds = alreadyMatchedLines.map(tx => tx.matchedEntryLineId).filter(id => id !== null);

    const ledgerEntriesQuery = this.journalEntryLineRepository.createQueryBuilder("line")
        .leftJoinAndSelect("line.journalEntry", "journalEntry")
        .where("line.accountId = :accountId", { accountId: statement.accountId })
        .andWhere("journalEntry.date BETWEEN :searchStartDate AND :searchEndDate", { searchStartDate, searchEndDate });

    if (matchedLineIds.length > 0) {
        ledgerEntriesQuery.andWhere("line.id NOT IN (:...matchedLineIds)", { matchedLineIds });
    }

    const ledgerEntries = await ledgerEntriesQuery.orderBy("journalEntry.date", "ASC").getMany();

    return {
      statement,
      ledgerEntries,
    };
  }

  async autoReconcileStatement(statementId: string, organizationId: string) {
    this.logger.log(`Iniciando auto-conciliación para el estado de cuenta: ${statementId}`);
    
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;
      const statement = await manager.findOne(BankStatement, {
        where: { id: statementId, organizationId },
        relations: ['transactions'],
      });

      if (!statement) {
        this.logger.error(`autoReconcileStatement: No se encontró el estado de cuenta con ID ${statementId}`);
        return;
      }

      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
        this.logger.error(`Libro contable por defecto no encontrado para la organización ${organizationId}. El proceso se omitirá.`);
        return;
      }
      
      const reconciliationJournal = await manager.findOneBy(Journal, { organizationId, code: 'CONCIL' });
      if (!reconciliationJournal) {
          throw new BadRequestException('Diario de Conciliación (CONCIL) no encontrado.');
      }

      const rules = await manager.findBy(ReconciliationRule, { organizationId });
      const unreconciledTransactions = statement.transactions.filter(
        (t) => t.status === TransactionStatus.UNRECONCILED,
      );

      for (const transaction of unreconciledTransactions) {
        for (const rule of rules) {
          const isMatch = this.checkRuleMatch(rule, transaction);

          if (isMatch) {
            this.logger.log(`Regla "${rule.name}" coincidió para la transacción: ${transaction.description}`);
            
            const entryDto: CreateJournalEntryDto = {
                date: transaction.date.toISOString(),
                description: `Conciliación Automática: ${transaction.description}`,
                journalId: reconciliationJournal.id,
                lines: [
                  { 
                    accountId: statement.accountId, 
                    debit: transaction.debit, 
                    credit: transaction.credit, 
                    description: transaction.description,
                    valuations: [{
                      ledgerId: defaultLedger.id,
                      debit: transaction.debit,
                      credit: transaction.credit
                    }]
                  },
                  { 
                    accountId: rule.targetAccountId, 
                    debit: transaction.credit, 
                    credit: transaction.debit, 
                    description: `Regla: ${rule.name}`,
                    valuations: [{
                      ledgerId: defaultLedger.id,
                      debit: transaction.credit,
                      credit: transaction.debit
                    }]
                  },
                ],
            };
            
            const newEntry = await this.journalEntriesService.createWithQueryRunner(queryRunner, entryDto, organizationId);

            transaction.status = TransactionStatus.MATCHED;
            transaction.matchedEntryLineId = newEntry.lines[0].id;
            await manager.save(transaction);
            break; 
          }
        }
      }
      await queryRunner.commitTransaction();
    } catch(err) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`Error en la auto-conciliación para el estado de cuenta ${statementId}`, err.stack);
    } finally {
        await queryRunner.release();
    }
    this.logger.log(`Auto-conciliación finalizada para el estado de cuenta: ${statementId}`);
  }

  async matchTransactions(
    dto: MatchTransactionsDto,
    organizationId: string
  ): Promise<{ success: boolean; message: string }> {
      const { statementId, matches } = dto;
      
      return this.dataSource.transaction(async manager => {
        const statement = await manager.findOneBy(BankStatement, { id: statementId, organizationId });
        if (!statement) {
            throw new NotFoundException('Estado de cuenta no encontrado.');
        }

        for(const match of matches) {
            const bankTx = await manager.findOneBy(BankTransaction, { id: match.bankTransactionId, statementId });
            const journalLine = await manager.findOneBy(JournalEntryLine, { id: match.journalEntryLineId });

            if (!bankTx || !journalLine) {
                throw new BadRequestException(`La transacción bancaria o el asiento contable especificado no es válido (ID Tx: ${match.bankTransactionId}, ID Asiento: ${match.journalEntryLineId})`);
            }
            if (bankTx.status !== TransactionStatus.UNRECONCILED) {
                this.logger.warn(`Intento de conciliar una transacción ya procesada: ${bankTx.id}`);
                continue;
            }

            bankTx.status = TransactionStatus.MANUALLY_MATCHED;
            bankTx.matchedEntryLineId = journalLine.id;
            

            journalLine.isReconciled = true;

            await manager.save(bankTx);
            await manager.save(journalLine);
        }

        this.logger.log(`${matches.length} transacciones conciliadas manualmente para el estado de cuenta ${statementId}`);
        return { success: true, message: `${matches.length} transacciones han sido conciliadas exitosamente.` };
      });
  }

  private checkRuleMatch(
    rule: ReconciliationRule,
    transaction: BankTransaction,
  ): boolean {
    const amount = transaction.debit > 0 ? transaction.debit : transaction.credit;
    const targetField =
      rule.conditionField === RuleConditionField.DESCRIPTION
        ? transaction.description.toLowerCase()
        : amount.toString();

    const conditionValue = rule.conditionValue.toLowerCase();

    switch (rule.conditionOperator) {
      case RuleConditionOperator.CONTAINS:
        return targetField.includes(conditionValue);
      case RuleConditionOperator.EQUALS:
        return targetField === conditionValue;
      case RuleConditionOperator.STARTS_WITH:
        return targetField.startsWith(conditionValue);
    }
    return false;
  }
}