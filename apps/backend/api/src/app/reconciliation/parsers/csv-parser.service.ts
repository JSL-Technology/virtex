
import { Injectable } from '@nestjs/common';
import * as Papa from 'papaparse';

interface BankTransactionRow {
  date: Date;
  description: string;
  debit: number;
  credit: number;
}

interface ColumnMapping {
  date: string;
  description: string;

  debit?: string;
  credit?: string;
  amount?: string;
}

@Injectable()
export class CsvParserService {
  async parse(
    fileBuffer: Buffer,
    mapping: ColumnMapping,
  ): Promise<BankTransactionRow[]> {
    const content = fileBuffer.toString('utf-8');

    return new Promise((resolve, reject) => {
      Papa.parse(content, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        complete: (results) => {
          if (results.errors.length > 0) {
            return reject(
              new Error(
                'Errores de parsing: ' + JSON.stringify(results.errors),
              ),
            );
          }

          const transactions = (results.data as any[]).map((row: any) => {
            const date = new Date(row[mapping.date]);

            let debit = parseFloat(row[mapping.debit!] || '0');
            let credit = parseFloat(row[mapping.credit!] || '0');

            if (mapping.amount && row[mapping.amount]) {
              const amount = parseFloat(row[mapping.amount]);
              if (amount > 0) {
                debit = amount;
              } else {
                credit = Math.abs(amount);
              }
            }

            return {
              date: date,
              description: row[mapping.description] || '',
              debit: isNaN(debit) ? 0 : debit,
              credit: isNaN(credit) ? 0 : credit,
            };
          });

          resolve(transactions);
        },
        error: (error) => {
          reject(error);
        },
      });
    });
  }
}