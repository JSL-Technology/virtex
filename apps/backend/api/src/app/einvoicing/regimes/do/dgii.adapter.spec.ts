import { ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Invoice, InvoiceType, PaymentMethod } from '../../../invoices/entities/invoice.entity';
import { EcfCertificate } from '../../entities/ecf-certificate.entity';
import { FiscalRegimeContext } from '../fiscal-regime.types';
import { DgiiRegimeAdapter } from './dgii.adapter';

/**
 * The Dominican regime as an adapter of the one pipeline.
 *
 * The document's own content is `ecf-xml-builder.spec.ts`'s subject and the DGII's rules are
 * `ecf-validator.service`'s; what is checked here is what the adapter adds around them, which is
 * what the second pipeline used to do and what a regime must never get wrong:
 *
 * - the order: build and validate BEFORE a signature is spent, seal before anything is sent;
 * - the código de seguridad and the QR of the representación impresa, derived from the SIGNED
 *   document, so what the DGII's portal resolves is what was transmitted;
 * - an outage is a contingency — the comprobante is issued and owed — and never a rejection;
 * - from the second attempt on, ask the DGII whether it already holds the e-NCF instead of
 *   transmitting it twice, which is how one sale ends with two fiscal documents;
 * - the DGII's three verdicts, including «Aceptado Condicional», which is neither of the other two.
 *
 * Nothing leaves this process: the signer, the transport and the DGII's endpoints are doubles.
 */
describe('the DGII regime, as an adapter', () => {
  /** The issuer, as the organizations module stores it. By shape, not by class: the entity belongs
   *  to another module and a spec of this one may not import it (verify:boundaries). */
  const ORGANIZATION = {
    id: 'org-1',
    legalName: 'QA Emisora SRL',
    taxId: '131246753',
    timezone: 'America/Santo_Domingo',
    country: 'DO',
    fiscalProfile: {},
  };

  /** The comprobante as the builder serialises it: the fields the QR quotes, and no signature. */
  const UNSIGNED_XML = [
    '<ECF><Encabezado><IdDoc><TipoeCF>31</TipoeCF><eNCF>E310000000007</eNCF></IdDoc>',
    '<Emisor><RNCEmisor>131246753</RNCEmisor></Emisor>',
    '<Comprador><RNCComprador>101010632</RNCComprador></Comprador>',
    '<FechaEmision>09-11-2026</FechaEmision>',
    '<Totales><MontoTotal>1180.00</MontoTotal></Totales></Encabezado>',
    '<FechaHoraFirma>09-11-2026 14:05:31</FechaHoraFirma></ECF>',
  ].join('');
  const SIGNED_XML = UNSIGNED_XML.replace('</ECF>', '<Signature/></ECF>');

  const invoice = (overrides: Partial<Invoice> = {}): Invoice =>
    ({
      id: 'inv-1',
      organizationId: 'org-1',
      fiscalNumber: 'E310000000007',
      fiscalDocumentType: 'E31',
      invoiceNumber: 'FAC-000007',
      issueDate: '2026-11-09',
      dueDate: '2026-11-09',
      currencyCode: 'DOP',
      paymentMethod: PaymentMethod.CASH,
      type: InvoiceType.INVOICE,
      total: 1180,
      lineItems: [],
      ...overrides,
    }) as unknown as Invoice;

  /**
   * The rows the adapter reads: the issuer, its settings and its active DGII certificate.
   *
   * Dispatched by the entity's NAME rather than by its class, so this spec needs no import of
   * another module's entities — the same reason the integration specs ask for repositories by name.
   */
  const manager = (certificate: Partial<EcfCertificate> | null = { id: 'cert-1', isActive: true }) =>
    ({
      findOne: jest.fn(async (entity: unknown) => {
        switch (typeof entity === 'function' ? entity.name : String(entity)) {
          case 'Organization':
            return ORGANIZATION;
          case 'OrganizationSettings':
            return { baseCurrency: 'DOP' };
          case 'EcfCertificate':
            return certificate;
          default:
            return null;
        }
      }),
      // The ITBIS rates in force on the document's own date, which the validator checks against.
      query: jest.fn(async () => [{ rate: '18.00', in_force: true }, { rate: '16.00', in_force: true }]),
    }) as unknown as EntityManager;

  function build(options: {
    send?: jest.Mock;
    trackIds?: jest.Mock;
    status?: jest.Mock;
    token?: jest.Mock;
    validate?: jest.Mock;
    certificate?: Partial<EcfCertificate> | null;
    attempt?: number;
  } = {}) {
    const calls: string[] = [];
    const validator = {
      assertValid: options.validate ?? jest.fn(() => calls.push('validate')),
    };
    const builder = {
      montoTotal: jest.fn(() => 1180),
      build: jest.fn(() => {
        calls.push('build');
        return UNSIGNED_XML;
      }),
    };
    const signer = {
      // Echoes what it was given, as a signature does: the sealed document is the built one.
      sign: jest.fn((xml: string) => {
        calls.push('sign');
        return xml.replace('</ECF>', '<Signature/></ECF>');
      }),
      securityCode: jest.fn(() => 'A1B2C3'),
    };
    const transport = {
      sendEcf: options.send ?? jest.fn(async () => ({ trackId: 'trk-1', estado: 'Aceptado', mensajes: [], raw: {} })),
      queryTrackIds: options.trackIds ?? jest.fn(async () => []),
      queryStatus: options.status ?? jest.fn(async () => ({ estado: 'EnProceso', mensajes: [], raw: {} })),
    };
    const adapter = new DgiiRegimeAdapter(
      { load: jest.fn(() => ({ privateKeyPem: '', certificatePem: '' })) } as never,
      signer as never,
      builder as never,
      validator as never,
      { getToken: options.token ?? jest.fn(async () => 'token') } as never,
      transport as never,
      { endpointsFor: jest.fn(async () => ({ timbre: 'https://ecf.dgii.gov.do/certecf/consultatimbre', timbreConsumo: 'https://ecf.dgii.gov.do/certecf/consultatimbrefc' })) } as never,
    );
    const context: FiscalRegimeContext = {
      invoice: invoice(),
      organizationId: 'org-1',
      manager: manager(options.certificate),
      attempt: options.attempt ?? 1,
    };
    return { adapter, context, calls, builder, signer, transport, validator };
  }

  it('is the DGII regime of the Dominican market', () => {
    const { adapter } = build();
    expect(adapter.countryCode).toBe('DO');
    expect(adapter.regime).toBe('DGII e-CF');
  });

  it('validates the comprobante before it is built, and never signs an invalid one', async () => {
    const refusal = new Error('e-CF rejected by pre-flight validation');
    const { adapter, context, signer } = build({
      validate: jest.fn(() => {
        throw refusal;
      }),
    });

    await expect(adapter.build(context)).rejects.toBe(refusal);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('seals the document and derives the security code and the QR from what was signed', async () => {
    const { adapter, context } = build();

    const built = await adapter.build(context);
    expect(built).toMatchObject({ contentType: 'application/xml', documentKey: null });

    const sealed = await adapter.seal(built, { privateKeyPem: '', certificatePem: '' }, context);

    // The código de seguridad IS the document's key here: the DGII derives it from the signature.
    expect(sealed.documentKey).toBe('A1B2C3');
    // Every QR parameter is read back out of the signed document, so the portal resolves what was
    // transmitted — including the total and the signing timestamp, percent-encoded.
    expect(sealed.verificationUrl).toBe(
      'https://ecf.dgii.gov.do/certecf/consultatimbre?RncEmisor=131246753&RncComprador=101010632' +
        '&ENCF=E310000000007&FechaEmision=09-11-2026&MontoTotal=1180.00' +
        '&FechaFirma=09-11-2026%2014%3A05%3A31&CodigoSeguridad=A1B2C3',
    );
  });

  it('refuses to sign for a company with no active certificate, as a settings problem', async () => {
    const { adapter, context } = build({ certificate: null });
    await expect(adapter.loadCertificate(context)).rejects.toMatchObject({
      regime: 'DGII e-CF',
      missing: 'tu certificado digital de la DGII',
    });
  });

  it('refuses a certificate that has expired rather than sealing with it', async () => {
    const { adapter, context } = build({
      certificate: { id: 'cert-1', isActive: true, notAfter: new Date('2020-01-01') } as Partial<EcfCertificate>,
    });
    await expect(adapter.loadCertificate(context)).rejects.toMatchObject({
      messageKey: 'einvoicing.certificate.expired',
    });
  });

  it('takes the DGII’s verdict as it comes, including the third one', async () => {
    for (const [estado, status] of [
      ['Aceptado', 'ACCEPTED'],
      ['Aceptado Condicional', 'ACCEPTED_WITH_OBSERVATIONS'],
      ['Rechazado', 'REJECTED'],
      ['EnProceso', 'PENDING'],
      ['algo que la DGII no documentó', 'PENDING'],
    ] as const) {
      const { adapter, context } = build({
        send: jest.fn(async () => ({ trackId: 'trk-9', estado, mensajes: ['m'], raw: { estado } })),
      });
      const result = await adapter.transmit({ payload: SIGNED_XML, contentType: 'application/xml', documentKey: 'A1B2C3' }, context);
      expect(result).toMatchObject({ status, trackingId: 'trk-9', messages: ['m'] });
    }
  });

  it('calls an outage a contingency: the comprobante is issued and owed, not rejected', async () => {
    const { adapter, context } = build({
      send: jest.fn(async () => {
        throw new ServiceUnavailableException('DGII no disponible');
      }),
    });

    const result = await adapter.transmit(
      { payload: SIGNED_XML, contentType: 'application/xml', documentKey: 'A1B2C3' },
      context,
    );

    expect(result.status).toBe('CONTINGENCY');
    expect(result.messages[0]).toContain('DGII no disponible');
  });

  it('does not ask about an e-NCF on the first attempt, and adopts an existing trackId afterwards', async () => {
    const trackIds = jest.fn(async () => [{ trackId: 'trk-prev', estado: 'Aceptado' }]);

    const first = build({ trackIds });
    await first.adapter.transmit({ payload: SIGNED_XML, contentType: 'application/xml', documentKey: null }, first.context);
    expect(trackIds).not.toHaveBeenCalled();
    expect(first.transport.sendEcf).toHaveBeenCalledTimes(1);

    const second = build({ trackIds, attempt: 2 });
    const result = await second.adapter.transmit(
      { payload: SIGNED_XML, contentType: 'application/xml', documentKey: null },
      second.context,
    );

    // The DGII already had it: adopted, and NOT transmitted a second time.
    expect(result).toMatchObject({ status: 'ACCEPTED', trackingId: 'trk-prev' });
    expect(second.transport.sendEcf).not.toHaveBeenCalled();
    expect(result.messages[0]).toContain('trk-prev');
  });

  it('transmits anyway when the idempotency lookup itself fails, rather than not transmitting', async () => {
    const { adapter, context, transport } = build({
      attempt: 3,
      trackIds: jest.fn(async () => {
        throw new Error('timeout');
      }),
    });

    const result = await adapter.transmit({ payload: SIGNED_XML, contentType: 'application/xml', documentKey: null }, context);

    expect(transport.sendEcf).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ACCEPTED');
  });

  it('asks the DGII again by trackId, and reports what it answers', async () => {
    const { adapter, context } = build({
      status: jest.fn(async () => ({ estado: 'Aceptado Condicional', mensajes: ['Observación'], raw: {} })),
    });

    await expect(adapter.checkStatus('trk-1', context)).resolves.toMatchObject({
      status: 'ACCEPTED_WITH_OBSERVATIONS',
      trackingId: 'trk-1',
      messages: ['Observación'],
    });
  });

  it('routes a consumer comprobante to the consumer timbre, as the DGII separates them', async () => {
    const { adapter, context } = build();
    const consumer = { ...context, invoice: invoice({ fiscalNumber: 'E320000000001', fiscalDocumentType: 'E32' }) };

    const sealed = await adapter.seal(
      {
        payload: UNSIGNED_XML.replace('<TipoeCF>31</TipoeCF>', '<TipoeCF>32</TipoeCF>'),
        contentType: 'application/xml',
        documentKey: null,
      },
      { privateKeyPem: '', certificatePem: '' },
      consumer,
    );

    expect(sealed.verificationUrl).toContain('consultatimbrefc?');
  });
});
