// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDefinition } from '../contracts';
import { accounting } from './accounting';
import { documents } from './documents';
import { einvoicing } from './einvoicing';
import { identity } from './identity';
import { payments } from './payments';
import { payroll } from './payroll';
import { profile } from './profile';
import { purchases } from './purchases';
import { returns } from './returns';
import { taxes } from './taxes';

/** Honduras. */
export const market: MarketDefinition = {
  code: 'HN',
  profile,
  identity,
  taxes,
  documents,
  purchases,
  payments,
  accounting,
  payroll,
  returns,
  einvoicing,
};
