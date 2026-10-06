import { roundAmount } from '../common/money';
import type { VendorBill } from './entities/vendor-bill.entity';

/**
 * What a posted bill made payable to the supplier: its total less what was withheld from them.
 *
 * The balance starts here, so it is the yardstick for «owes in full» when something that reduced
 * the balance is undone: a voided payment or debit note returns the bill to OPEN only when the
 * balance is back to this, not to the bill's total, which a bill with withholding never reaches.
 */
export function billPayable(bill: Pick<VendorBill, 'total' | 'taxWithheld' | 'incomeTaxWithheld'>): number {
  return roundAmount(Number(bill.total) - Number(bill.taxWithheld ?? 0) - Number(bill.incomeTaxWithheld ?? 0));
}
