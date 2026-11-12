import type { MarketReturnFiling, ReturnAccountRecord, ReturnDataset, ReturnJournalRecord } from '../../contracts';
import { MX_FILINGS, balanza, catalogo, polizas } from './index';

/**
 * Mexico's electronic accounting: the three documents of Anexo 24, versión 1.3.
 *
 * The figures come from the ledger — the integration spec in `compliance/returns/` proves that
 * against a real one, so that a filing and the statements it came from cannot disagree. These
 * assert the serialisation itself: the attributes each schema declares, the sense in which a
 * balance is stated, and what each document refuses rather than filing blank.
 */
describe('SAT electronic accounting', () => {
  const account = (overrides: Partial<ReturnAccountRecord> = {}): ReturnAccountRecord => ({
    code: '102.01',
    name: 'Bancos nacionales',
    nature: 'DEBIT',
    groupingCode: '102.01',
    openingBalance: 0,
    debit: 0,
    credit: 0,
    closingBalance: 0,
    ...overrides,
  });

  const entry = (overrides: Partial<ReturnJournalRecord> = {}): ReturnJournalRecord => ({
    number: 'DIARIO-2026-000001',
    date: '2026-06-10',
    description: 'Venta de contado',
    lines: [
      { accountCode: '102.01', accountName: 'Bancos nacionales', description: 'Cobro', debit: 1160, credit: 0 },
      { accountCode: '401.01', accountName: 'Ventas', description: 'Venta', debit: 0, credit: 1000 },
    ],
    ...overrides,
  });

  const dataset = (
    parts: { accounts?: readonly ReturnAccountRecord[]; journals?: readonly ReturnJournalRecord[]; taxId?: string } = {},
  ): ReturnDataset => ({
    filer: {
      taxId: parts.taxId ?? 'AAA010101AAA',
      legalName: 'Mi Empresa SA de CV',
      country: 'MX',
      fiscalProfile: { regimenFiscal: '601' },
    },
    period: { year: 2026, month: 6, from: '2026-06-01', to: '2026-06-30' },
    sales: async () => [],
    purchases: async () => [],
    foreignPurchases: async () => [],
    accounts: async () => parts.accounts ?? [],
    journals: async () => parts.journals ?? [],
    payslips: async () => [],
    employeeEvents: async () => [],
  });

  const xmlOf = async (filing: MarketReturnFiling, data: ReturnDataset, options = {}): Promise<string> => {
    const result = await filing.build(data, options);
    if (!result.file) throw new Error(`refused: ${result.refusal?.messageKey}`);
    return result.file;
  };

  describe('Catálogo de cuentas', () => {
    it('states each account with its grouping code, its level and its nature', async () => {
      const xml = await xmlOf(
        catalogo,
        dataset({
          accounts: [
            account({ code: '102', name: 'Bancos', groupingCode: '102' }),
            account({ code: '102.01' }),
            account({ code: '201.01', name: 'Proveedores', groupingCode: '201.01', nature: 'CREDIT' }),
          ],
        }),
      );

      expect(xml).toContain('Version="1.3"');
      expect(xml).toContain('RFC="AAA010101AAA"');
      expect(xml).toContain('Mes="06"');
      expect(xml).toContain('Anio="2026"');
      expect(xml).toContain('CodAgrup="102" NumCta="102" Desc="Bancos" Nivel="1" Natur="D"');
      // A sub-account names its parent by its own number, which is what makes the file a tree.
      expect(xml).toContain('NumCta="102.01" Desc="Bancos nacionales" Nivel="2" Natur="D" SubCtaDe="102"');
      expect(xml).toContain('Natur="A"');
    });

    it('refuses an unmapped account rather than filing a blank code', async () => {
      const result = await catalogo.build(dataset({ accounts: [account({ code: '999', groupingCode: null })] }), {});
      expect(result.refusal).toMatchObject({
        messageKey: 'compliance.count_account_have_no_sat_grouping',
        params: { count: 1, example: '999' },
      });
    });

    it('refuses to build anything for a taxpayer with no RFC', async () => {
      const result = await catalogo.build(dataset({ taxId: '  ' }), {});
      expect(result.refusal).toMatchObject({ messageKey: 'compliance.organization_has_no_rfc_file_sat' });
    });
  });

  describe('Balanza de comprobación', () => {
    it('states balances in the account’s own sense and leaves out what neither moved nor carried one', async () => {
      const xml = await xmlOf(
        balanza,
        dataset({
          accounts: [
            account({ openingBalance: 500, debit: 1160, credit: 0, closingBalance: 1660 }),
            // A liability: the ledger signs it `debit − credit`, the SAT states what is owed.
            account({ code: '201.01', nature: 'CREDIT', openingBalance: -300, credit: 200, closingBalance: -500 }),
            account({ code: '999', groupingCode: '999' }),
          ],
        }),
      );

      expect(xml).toContain('TipoEnvio="N"');
      expect(xml).toContain('NumCta="102.01" SaldoIni="500.00" Debe="1160.00" Haber="0.00" SaldoFin="1660.00"');
      expect(xml).toContain('NumCta="201.01" SaldoIni="300.00" Debe="0.00" Haber="200.00" SaldoFin="500.00"');
      expect(xml).not.toContain('NumCta="999"');
    });

    it('carries the correction date only on a complementary filing', async () => {
      const data = dataset({ accounts: [account({ debit: 10, closingBalance: 10 })] });
      // The SAT rejects `FechaModBal` on an ordinary filing, which is why it is not always written.
      expect(await xmlOf(balanza, data, { fechaModBal: '2026-07-15' })).not.toContain('FechaModBal');

      const complementary = await xmlOf(balanza, data, { tipoEnvio: 'C', fechaModBal: '2026-07-15' });
      expect(complementary).toContain('TipoEnvio="C"');
      expect(complementary).toContain('FechaModBal="2026-07-15"');
    });

    it('counts the accounts it filed, not the chart', async () => {
      const result = await balanza.build(
        dataset({ accounts: [account({ debit: 10, closingBalance: 10 }), account({ code: '999' })] }),
        {},
      );
      expect(result.file ? result.records : null).toBe(1);
    });
  });

  describe('Pólizas del periodo', () => {
    it('uses the ledger’s own consecutive as NumUnIdenPol and lists every line', async () => {
      const xml = await xmlOf(polizas, dataset({ journals: [entry()] }), { numOrden: 'ABC1234567/26' });

      expect(xml).toContain('TipoSolicitud="AF"');
      expect(xml).toContain('NumUnIdenPol="DIARIO-2026-000001"');
      expect(xml).toContain('Fecha="2026-06-10"');
      expect(xml).toContain('NumCta="102.01" DesCta="Bancos nacionales" Concepto="Cobro" Debe="1160.00" Haber="0.00"');
      expect(xml).toContain('NumCta="401.01" DesCta="Ventas" Concepto="Venta" Debe="0.00" Haber="1000.00"');
    });

    it('refuses a filing that names no procedure, because the SAT rejects one', async () => {
      // Which of the two references is required depends on the kind of request, so the declaration
      // cannot say it: the generator does, before anything is built.
      const data = dataset({ journals: [entry()] });
      expect((await polizas.build(data, { tipoSolicitud: 'AF' })).refusal).toMatchObject({
        messageKey: 'returns.mx.polizas_order_required',
      });
      expect((await polizas.build(data, { tipoSolicitud: 'CO' })).refusal).toMatchObject({
        messageKey: 'returns.mx.polizas_procedure_required',
      });
    });

    it('writes the order number only for the procedures that carry one', async () => {
      const data = dataset({ journals: [entry()] });
      // `NumOrden` belongs to the audits (AF, FC); `NumTramite` to a refund (DE) or an offset (CO).
      // Writing the wrong one, or both, is a rejected upload.
      const audit = await xmlOf(polizas, data, { tipoSolicitud: 'AF', numOrden: 'ABC1234567/26', numTramite: 'IGNORADO' });
      expect(audit).toContain('NumOrden="ABC1234567/26"');
      expect(audit).not.toContain('NumTramite');

      const refund = await xmlOf(polizas, data, { tipoSolicitud: 'DE', numTramite: 'TR-2026-9', numOrden: 'IGNORADO' });
      expect(refund).toContain('NumTramite="TR-2026-9"');
      expect(refund).not.toContain('NumOrden');
    });
  });

  it('declares what each document is, for the door that offers it', () => {
    expect(MX_FILINGS.map((filing) => filing.code)).toEqual(['catalogo', 'balanza', 'polizas']);
    expect(catalogo.tracked).toBe(true);
    expect(balanza.tracked).toBe(true);
    // The SAT asks for the Pólizas when it audits or refunds: eleven months «not filed» would be
    // eleven months that were never due.
    expect(polizas.tracked).toBe(false);
    expect(polizas.periodicity).toBe('ON_REQUEST');
    expect(balanza.fileName({ year: 2026, month: 6, from: '2026-06-01', to: '2026-06-30' })).toBe('SAT_balanza_202606.xml');
  });
});
