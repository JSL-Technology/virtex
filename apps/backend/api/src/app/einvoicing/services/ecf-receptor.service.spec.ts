import { EcfReceptorService, NotReceivedReason } from './ecf-receptor.service';

/** The pure parts of the reception service: reading a supplier's e-CF and writing the ARECF. */
describe('EcfReceptorService', () => {
  const ecf = `<?xml version="1.0" encoding="UTF-8"?>
<ECF><Encabezado><Version>1.0</Version>
  <IdDoc><TipoeCF>31</TipoeCF><eNCF>E310000000123</eNCF></IdDoc>
  <Emisor><RNCEmisor>131000001</RNCEmisor><RazonSocialEmisor>Proveedor &amp; Hijos SRL</RazonSocialEmisor><FechaEmision>15-10-2026</FechaEmision></Emisor>
  <Comprador><RNCComprador>101000001</RNCComprador></Comprador>
  <Totales><MontoGravadoTotal>1000.00</MontoGravadoTotal><TotalITBIS>180.00</TotalITBIS><MontoTotal>1180.00</MontoTotal></Totales>
</Encabezado></ECF>`;

  it('reads what the inbox and the 606 need from the e-CF', () => {
    expect(EcfReceptorService.parseEcf(ecf)).toEqual({
      ecfType: '31',
      ncf: 'E310000000123',
      issuerRnc: '131000001',
      issuerName: 'Proveedor & Hijos SRL',
      buyerRnc: '101000001',
      issueDate: '2026-10-15',
      total: 1180,
      itbis: 180,
      currencyCode: 'DOP',
    });
  });

  it('reads the currency of a foreign-currency e-CF', () => {
    const usd = ecf.replace('</Totales>', '</Totales><OtraMoneda><TipoMoneda>USD</TipoMoneda></OtraMoneda>');
    expect(EcfReceptorService.parseEcf(usd).currencyCode).toBe('USD');
  });

  it('refuses XML that does not parse', () => {
    expect(() => EcfReceptorService.parseEcf('<ECF><IdDoc>')).toThrow();
  });

  it('writes an ARECF «recibido» with no reason code', () => {
    const xml = EcfReceptorService.buildAck({
      issuerRnc: '131000001', buyerRnc: '101000001', ncf: 'E310000000123', reason: null,
      timestamp: '15-10-2026 10:00:00',
    });
    expect(xml).toContain('<ARECF');
    expect(xml).toContain('<Estado>0</Estado>');
    expect(xml).not.toContain('CodigoMotivoNoRecibido');
    expect(xml).toContain('<FechaHoraAcuseRecibo>15-10-2026 10:00:00</FechaHoraAcuseRecibo>');
  });

  it('writes an ARECF «no recibido» with the DGII reason code', () => {
    const xml = EcfReceptorService.buildAck({
      issuerRnc: '131000001', buyerRnc: '101000001', ncf: 'E310000000123',
      reason: NotReceivedReason.DUPLICATE, timestamp: '15-10-2026 10:00:00',
    });
    expect(xml).toContain('<Estado>1</Estado>');
    expect(xml).toContain('<CodigoMotivoNoRecibido>3</CodigoMotivoNoRecibido>');
  });

  describe('tokens', () => {
    const service = new EcfReceptorService(
      {} as never, {} as never, {} as never, {} as never,
      { get: () => 'test-secret-test-secret-test-secret' } as never,
    );

    it('refuses a token it did not issue', () => {
      expect(() => service.assertToken('101000001', 'Bearer abc.def')).toThrow();
      expect(() => service.assertToken('101000001', undefined)).toThrow();
    });
  });
});
