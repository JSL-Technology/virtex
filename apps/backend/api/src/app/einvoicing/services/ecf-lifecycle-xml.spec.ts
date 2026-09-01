import { EcfLifecycleXmlBuilder } from './ecf-lifecycle-xml.builder';

/**
 * The two DGII messages that had transport code, endpoints and no builder at all: a tenant could
 * neither answer a supplier's comprobante nor declare numbers it would never use.
 */
describe('EcfLifecycleXmlBuilder', () => {
  const builder = new EcfLifecycleXmlBuilder();

  describe('aprobación comercial (ACECF)', () => {
    const base = {
      rncEmisor: '130862346',
      rncComprador: '101010101',
      eNCF: 'E310000000042',
      fechaEmision: '15-08-2026',
      montoTotal: 1180,
      fechaHoraAprobacion: '31-08-2026 20:30:00',
    };

    it('is rooted at ACECF so the signature reference resolves', () => {
      const xml = builder.buildCommercialApproval({ ...base, estado: '1' });
      expect(xml).toContain('<ACECF');
      expect(xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    });

    it('names both parties and the comprobante being answered', () => {
      const xml = builder.buildCommercialApproval({ ...base, estado: '1' });
      expect(xml).toContain('<RNCEmisor>130862346</RNCEmisor>');
      expect(xml).toContain('<RNCComprador>101010101</RNCComprador>');
      expect(xml).toContain('<eNCF>E310000000042</eNCF>');
      expect(xml).toContain('<FechaEmision>15-08-2026</FechaEmision>');
    });

    it('quotes the total to the cent, which is what the DGII matches on', () => {
      const xml = builder.buildCommercialApproval({ ...base, montoTotal: 1180.5, estado: '1' });
      expect(xml).toContain('<MontoTotal>1180.50</MontoTotal>');
    });

    it('omits the rejection reason on an approval — an empty element is a schema violation', () => {
      const xml = builder.buildCommercialApproval({ ...base, estado: '1' });
      expect(xml).toContain('<Estado>1</Estado>');
      expect(xml).not.toContain('DetalleMotivoRechazo');
    });

    it('carries the reason on a rejection', () => {
      const xml = builder.buildCommercialApproval({
        ...base,
        estado: '2',
        detalleMotivoRechazo: 'La mercancía no fue recibida.',
      });
      expect(xml).toContain('<Estado>2</Estado>');
      expect(xml).toContain('<DetalleMotivoRechazo>La mercancía no fue recibida.</DetalleMotivoRechazo>');
    });

    it('stamps the answer with a local timestamp', () => {
      const xml = builder.buildCommercialApproval({ ...base, estado: '1' });
      expect(xml).toContain('<FechaHoraAprobacionComercial>31-08-2026 20:30:00</FechaHoraAprobacionComercial>');
    });
  });

  describe('anulación de e-NCF (ANECF)', () => {
    const ctx = {
      rnc: '130862346',
      fechaHoraAnulacion: '31-08-2026 20:30:00',
      ranges: [{ tipoECF: '31', desde: 'E310000000042', hasta: 'E310000000050' }],
    };

    it('is rooted at ANECF', () => {
      const xml = builder.buildSequenceVoid(ctx);
      expect(xml).toContain('<ANECF');
    });

    it('counts the numbers annulled, inclusive of both ends', () => {
      const xml = builder.buildSequenceVoid(ctx);
      // 42 through 50 is nine numbers, not eight.
      expect(xml).toContain('<CantidadeNCFAnulados>9</CantidadeNCFAnulados>');
    });

    it('counts a single number as one', () => {
      expect(
        builder.countRange({ tipoECF: '31', desde: 'E310000000042', hasta: 'E310000000042' }),
      ).toBe(1);
    });

    it('declares the ends of the stretch and its document type', () => {
      const xml = builder.buildSequenceVoid(ctx);
      expect(xml).toContain('<TipoeCF>31</TipoeCF>');
      expect(xml).toContain('<SecuenciaeNCFDesde>E310000000042</SecuenciaeNCFDesde>');
      expect(xml).toContain('<SecuenciaeNCFHasta>E310000000050</SecuenciaeNCFHasta>');
    });

    it('totals across several stretches', () => {
      const xml = builder.buildSequenceVoid({
        ...ctx,
        ranges: [
          { tipoECF: '31', desde: 'E310000000042', hasta: 'E310000000050' },
          { tipoECF: '32', desde: 'E320000000001', hasta: 'E320000000010' },
        ],
      });
      expect(xml).toContain('<CantidadeNCFAnulados>19</CantidadeNCFAnulados>');
      expect(xml).toContain('Linea="1"');
      expect(xml).toContain('Linea="2"');
    });
  });
});
