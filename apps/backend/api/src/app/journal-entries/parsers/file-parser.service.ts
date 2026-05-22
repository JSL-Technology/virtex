
import { Injectable, BadRequestException } from '@nestjs/common';
import * as Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { CsvParsingOptionsDto } from '../dto/journal-entry-import.dto';

export enum FileType {
    CSV = 'text/csv',
    EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

@Injectable()
export class FileParserService {
    
    async parse(file: Express.Multer.File, options?: CsvParsingOptionsDto): Promise<{ headers: string[], data: any[] }> {
        if (file.mimetype === FileType.CSV) {
            return this.parseCsv(file.buffer, options);
        } else if (file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel')) {
            return this.parseExcel(file.buffer);
        } else {
            throw new BadRequestException(`Tipo de archivo no soportado: ${file.mimetype}`);
        }
    }

    private async parseCsv(buffer: Buffer, options?: CsvParsingOptionsDto): Promise<{ headers: string[], data: any[] }> {
        return new Promise((resolve, reject) => {
            Papa.parse(buffer.toString('utf-8'), {
                header: true,
                skipEmptyLines: true,
                delimiter: options?.delimiter || ',',
                quoteChar: options?.quoteChar || '"',
                complete: (results) => {
                    if (results.errors.length > 0) {
                        return reject(new BadRequestException('Error al parsear el archivo CSV: ' + JSON.stringify(results.errors)));
                    }
                    resolve({ headers: results.meta.fields || [], data: results.data });
                },
                error: (error) => reject(new BadRequestException('Error al parsear el archivo CSV: ' + error.message)),
            });
        });
    }
    
    private async parseExcel(buffer: Buffer): Promise<{ headers: string[], data: any[] }> {
        try {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet);
            const headers = data.length > 0 ? Object.keys((data[0] as any)) : [];
            return { headers, data };
        } catch (error) {
            throw new BadRequestException('Error al parsear el archivo Excel: ' + error.message);
        }
    }
}