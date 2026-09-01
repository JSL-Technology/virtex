import { EcfXmlBuilderService, EcfBuildContext } from './ecf-xml-builder.service';
import { EcfValidatorService } from './ecf-validator.service';

/**
 * The comprobante the DGII actually receives.
 *
 * Nothing tested this. The builder emitted eleven elements, omitted everything else the schema
 * marks mandatory, coded nothing, and could not express a foreign currency — and the only way to
 * discover any of that was a rejection with the e-NCF already spent.
 */
describe('e-CF XML builder', () => {
  const builder = new EcfXmlBuilderService();
  const validator = new EcfValidatorService();

  const context = (overrides: Partial<EcfBuildContext> = {}): EcfBuildContext => ({
    tipoECF: '31',
    eNCF: 'E310000000001',
    fechaVencimientoSecuencia: '31-12-2027',
    tipoIngresos: '01',
    tipoPago: '1',
    formasPago: [{ forma: '01', monto: 1180 }],
    fechaEmision: '31-08-2026',
    fechaHoraFirma: '31-08-2026 10:15:00',
    emisor: {
      rnc: '131190317',
      razonSocial: 'ACME SRL',
      direccion: 'Av. 27 de Febrero 100',
      municipio: '3201',
      provincia: '32',
    },
    comprador: { rnc: '101234563', razonSocial: 'Cliente SRL' },
    items: [
      {
        nombre: 'Mercancía',
        indicadorBienoServicio: '1',
        cantidad: 1,
        precioUnitario: 1000,
        itbisTasa: 0.18,
      },
    ],
    ...overrides,
  });

  const value = (xml: string, tag: string): string | null => {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match ? match[1] : null;
  };

  describe('structure', () => {
    it('declares the schema namespace', () => {
      expect(builder.build(context())).toContain('xmlns:xsi');
    });

    it('carries the authorization expiry the schema requires', () => {
      expect(value(builder.build(context()), 'FechaVencimientoSecuencia')).toBe('31-12-2027');
    });

    it('declares the payment breakdown on a cash sale', () => {
      const xml = builder.build(context());
      expect(xml).toContain('<TablaFormasPago>');
      expect(value(xml, 'FormaPago')).toBe('01');
      expect(value(xml, 'MontoPago')).toBe('1180.00');
    });

    it('declares the payment deadline on a credit sale instead', () => {
      const xml = builder.build(
        context({ tipoPago: '2', formasPago: undefined, fechaLimitePago: '30-09-2026' }),
      );
      expect(xml).not.toContain('<TablaFormasPago>');
      expect(value(xml, 'FechaLimitePago')).toBe('30-09-2026');
    });

    it('numbers the lines from one and paginates', () => {
      const xml = builder.build(
        context({
          items: [
            { nombre: 'A', indicadorBienoServicio: '1', cantidad: 1, precioUnitario: 100, itbisTasa: 0.18 },
            { nombre: 'B', indicadorBienoServicio: '2', cantidad: 1, precioUnitario: 100, itbisTasa: 0.18 },
          ],
        }),
      );
      expect(xml).toContain('<NumeroLinea>1</NumeroLinea>');
      expect(xml).toContain('<NumeroLinea>2</NumeroLinea>');
      expect(value(xml, 'NoLineaHasta')).toBe('2');
    });
  });

  describe('tax buckets', () => {
    it('separates the 18 % and 16 % bases', () => {
      const xml = builder.build(
        context({
          items: [
            { nombre: 'A', indicadorBienoServicio: '1', cantidad: 1, precioUnitario: 1000, itbisTasa: 0.18 },
            { nombre: 'B', indicadorBienoServicio: '1', cantidad: 1, precioUnitario: 500, itbisTasa: 0.16 },
          ],
        }),
      );
      expect(value(xml, 'MontoGravadoI1')).toBe('1000.00');
      expect(value(xml, 'MontoGravadoI2')).toBe('500.00');
      expect(value(xml, 'TotalITBIS1')).toBe('180.00');
      expect(value(xml, 'TotalITBIS2')).toBe('80.00');
      expect(value(xml, 'MontoTotal')).toBe('1760.00');
    });

    it('distinguishes an exempt line from a zero-rated one', () => {
      // Exempt (4) carries no right to deduct; zero-rated (3) — an export — does. Collapsing both
      // onto "exempt" denies the exporter a deduction they are entitled to.
      const xml = builder.build(
        context({
          items: [
            { nombre: 'Libro', indicadorBienoServicio: '1', cantidad: 1, precioUnitario: 300, itbisTasa: 0, exento: true },
            { nombre: 'Export', indicadorBienoServicio: '1', cantidad: 1, precioUnitario: 200, itbisTasa: 0 },
          ],
        }),
      );
      expect(value(xml, 'MontoExento')).toBe('300.00');
      expect(value(xml, 'MontoGravadoI3')).toBe('200.00');
      expect(xml).toContain('<IndicadorFacturacion>4</IndicadorFacturacion>');
      expect(xml).toContain('<IndicadorFacturacion>3</IndicadorFacturacion>');
    });

    it('charges ITBIS on the base including the excise', () => {
      const xml = builder.build(
        context({
          items: [
            {
              nombre: 'Bebida', indicadorBienoServicio: '1', cantidad: 1,
              precioUnitario: 1000, itbisTasa: 0.18, montoImpuestoSelectivo: 100,
            },
          ],
        }),
      );
      expect(value(xml, 'TotalITBIS')).toBe('198.00');
      expect(value(xml, 'MontoImpuestoAdicional')).toBe('100.00');
    });
  });

  describe('one total, one source', () => {
    it('reports the same total it emits, so the QR cannot disagree with the comprobante', () => {
      const ctx = context({
        items: Array.from({ length: 7 }, (_, i) => ({
          nombre: `Línea ${i + 1}`,
          indicadorBienoServicio: '1' as const,
          cantidad: 3,
          precioUnitario: 10.01 + i * 0.37,
          itbisTasa: 0.18,
        })),
      });
      expect(value(builder.build(ctx), 'MontoTotal')).toBe(builder.montoTotal(ctx).toFixed(2));
    });
  });

  describe('foreign currency', () => {
    it('declares the currency and rate, instead of passing dollars off as pesos', () => {
      const xml = builder.build(
        context({ otraMoneda: { tipoMoneda: 'USD', tipoCambio: 58.5, montoTotal: 20.17 } }),
      );
      expect(value(xml, 'TipoMoneda')).toBe('USD');
      expect(value(xml, 'TipoCambio')).toBe('58.5000');
      expect(value(xml, 'MontoTotalOtraMoneda')).toBe('20.17');
    });
  });

  describe('credit notes', () => {
    it('references the comprobante it modifies, with the reason it was issued', () => {
      const xml = builder.build(
        context({
          tipoECF: '34',
          eNCF: 'E340000000001',
          modifica: {
            eNCFModificado: 'E310000000001',
            fechaEmisionModificado: '30-08-2026',
            // An annulment is code 1. The previous builder always transmitted 3 (corrects amounts),
            // even when the note annulled the document outright.
            codigoModificacion: '1',
          },
        }),
      );
      expect(value(xml, 'NCFModificado')).toBe('E310000000001');
      expect(value(xml, 'CodigoModificacion')).toBe('1');
    });
  });

  describe('validation before signing', () => {
    it('passes a complete comprobante', () => {
      expect(validator.validate(context(), 1180)).toEqual([]);
    });

    it.each([
      ['sin vencimiento de secuencia', { fechaVencimientoSecuencia: undefined }, 'FechaVencimientoSecuencia'],
      ['sin dirección del emisor', { emisor: { rnc: '131190317', razonSocial: 'ACME' } }, 'DireccionEmisor'],
      ['sin comprador en crédito fiscal', { comprador: undefined }, 'RNCComprador'],
      ['sin forma de pago al contado', { formasPago: [] }, 'TablaFormasPago'],
    ])('rejects a comprobante %s', (_label, overrides, field) => {
      const issues = validator.validate(context(overrides as Partial<EcfBuildContext>), 1180);
      expect(issues.map((i) => i.field)).toContain(field);
    });

    it('rejects a municipality that is not a coded value', () => {
      const issues = validator.validate(
        context({
          emisor: {
            rnc: '131190317', razonSocial: 'ACME', direccion: 'Calle 1',
            municipio: 'Santo Domingo Este', provincia: '32',
          },
        }),
        1180,
      );
      expect(issues.map((i) => i.field)).toContain('Municipio');
    });

    it('requires the buyer on a consumo above the DGII threshold', () => {
      const consumo = context({ tipoECF: '32', eNCF: 'E320000000001', comprador: undefined });
      expect(validator.validate(consumo, 100_000).map((i) => i.field)).not.toContain('RNCComprador');
      expect(validator.validate(consumo, 300_000).map((i) => i.field)).toContain('RNCComprador');
    });

    it('rejects a payment breakdown that does not add up to the total', () => {
      const issues = validator.validate(context({ formasPago: [{ forma: '01', monto: 1 }] }), 1180);
      expect(issues.map((i) => i.field)).toContain('TablaFormasPago');
    });

    it('rejects a type that does not match the e-NCF it was drawn from', () => {
      const issues = validator.validate(context({ tipoECF: '32' }), 1180);
      expect(issues.map((i) => i.field)).toContain('eNCF');
    });
  });
});
