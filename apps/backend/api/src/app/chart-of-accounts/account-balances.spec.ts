import {
  closingSideFor,
  previousDay,
  toIsoDate,
  toNaturalAmount,
} from './account-balances.service';
import { AccountType } from './enums/account-enums';

/**
 * The sign convention, which two independent closing implementations each got wrong.
 *
 * A balance is signed `debit − credit`, so revenue and liabilities are negative. The monthly close
 * assigned `debit = balance` to revenue and then filtered out any line whose debit and credit were
 * not both positive — dropping every revenue account from every close. The year-end close inverted
 * the signs the other way and produced an entry out of balance by twice total expenses.
 *
 * Both derived the arithmetic inline. There is one implementation now, and these are its tests.
 */
describe('the sign convention', () => {
  describe('closingSideFor', () => {
    it('closes a debit balance with a credit', () => {
      // An expense account with normal activity: debits exceed credits.
      expect(closingSideFor(300)).toEqual({ debit: 0, credit: 300 });
    });

    it('closes a credit balance with a debit', () => {
      // A revenue account with normal activity: a negative signed balance.
      expect(closingSideFor(-500)).toEqual({ debit: 500, credit: 0 });
    });

    it('closes a contra-revenue account, whose balance runs the other way', () => {
      // Sales returns sit in revenue but hold a debit balance. The old filter
      // (`line.debit > 0 || line.credit > 0` applied to `debit = balance`) dropped these too.
      expect(closingSideFor(75)).toEqual({ debit: 0, credit: 75 });
    });

    it('closes an expense account holding a refund credit balance', () => {
      expect(closingSideFor(-40)).toEqual({ debit: 40, credit: 0 });
    });

    it('emits nothing for an account already at zero', () => {
      expect(closingSideFor(0)).toEqual({ debit: 0, credit: 0 });
    });

    it('always produces a line, whatever the sign — nothing is silently dropped', () => {
      for (const balance of [-1000, -0.01, 0.01, 1000]) {
        const { debit, credit } = closingSideFor(balance);
        expect(debit + credit).toBeCloseTo(Math.abs(balance), 10);
      }
    });
  });

  describe('a whole period closes to zero', () => {
    it('leaves every result account flat and moves the profit to equity', () => {
      // Revenue 500 (credit, so −500 signed); expenses 300 (debit, +300 signed).
      const resultBalances = [-500, 300];

      const lines = resultBalances.map(closingSideFor);
      const totalDebit = lines.reduce((t, l) => t + l.debit, 0);
      const totalCredit = lines.reduce((t, l) => t + l.credit, 0);

      // Each account is returned to zero by its own line.
      resultBalances.forEach((balance, i) => {
        expect(balance + lines[i].debit - lines[i].credit).toBe(0);
      });

      // The result is the negated sum of the signed balances: a profit of 200.
      const signedSum = resultBalances.reduce((t, b) => t + b, 0);
      expect(-signedSum).toBe(200);

      // Retained earnings takes the side opposite the lines above, so a profit credits equity.
      const retained = closingSideFor(-signedSum);
      expect(retained).toEqual({ debit: 0, credit: 200 });
      expect(totalDebit + retained.debit).toBe(totalCredit + retained.credit);
    });

    it('balances for a loss as well as a profit', () => {
      const resultBalances = [-200, 350]; // revenue 200, expenses 350 → loss of 150
      const lines = resultBalances.map(closingSideFor);
      const signedSum = resultBalances.reduce((t, b) => t + b, 0);
      expect(-signedSum).toBe(-150);

      // A loss debits equity.
      const retained = closingSideFor(-signedSum);
      expect(retained).toEqual({ debit: 150, credit: 0 });

      const totalDebit = lines.reduce((t, l) => t + l.debit, 0) + retained.debit;
      const totalCredit = lines.reduce((t, l) => t + l.credit, 0) + retained.credit;
      expect(totalDebit).toBe(totalCredit);
    });
  });

  describe('toNaturalAmount', () => {
    it('presents revenue and liabilities positive, assets and expenses unchanged', () => {
      expect(toNaturalAmount(AccountType.REVENUE, -500)).toBe(500);
      expect(toNaturalAmount(AccountType.LIABILITY, -1200)).toBe(1200);
      expect(toNaturalAmount(AccountType.EQUITY, -900)).toBe(900);
      expect(toNaturalAmount(AccountType.ASSET, 750)).toBe(750);
      expect(toNaturalAmount(AccountType.EXPENSE, 300)).toBe(300);
    });

    it('keeps the accounting equation when every side is presented naturally', () => {
      // Assets 1000 = Liabilities 400 + Equity 600, held signed as +1000, −400, −600.
      const assets = toNaturalAmount(AccountType.ASSET, 1000);
      const liabilities = toNaturalAmount(AccountType.LIABILITY, -400);
      const equity = toNaturalAmount(AccountType.EQUITY, -600);
      expect(assets).toBe(liabilities + equity);
    });
  });
});

describe('date handling at period boundaries', () => {
  it('reads a date column string without shifting it', () => {
    expect(toIsoDate('2026-01-31')).toBe('2026-01-31');
  });

  it('takes the UTC calendar date from a Date, not the server local one', () => {
    // 2026-02-01T02:00Z is still 31 January in Santo Domingo. A period boundary computed from the
    // local calendar files this posting under the wrong month.
    expect(toIsoDate(new Date('2026-02-01T02:00:00.000Z'))).toBe('2026-02-01');
  });

  it('steps back across a month boundary', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
  });

  it('steps back across a leap day', () => {
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
  });

  it('steps back across a year boundary', () => {
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});
