
import { Injectable } from '@nestjs/common';
import { RegisterUserDto } from '../../../auth/dto/register-user.dto';

export interface FiscalStrategy {
  validateTaxId(taxId: string): Promise<boolean>;
  getTaxIdDetails(taxId: string): Promise<any>;
  getConfig(): any;
}

@Injectable()
export abstract class BaseFiscalStrategy implements FiscalStrategy {
  abstract validateTaxId(taxId: string): Promise<boolean>;
  abstract getTaxIdDetails(taxId: string): Promise<any>;
  abstract getConfig(): any;
}
