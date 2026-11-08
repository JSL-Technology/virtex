import { DataSource } from 'typeorm';
import { FiscalSubmissionService, backoffMinutes } from './fiscal-submission.service';
import { FiscalSubmissionStatus } from '../entities/fiscal-submission.entity';
import { FiscalRegimeAdapter, FiscalTransmissionResult, RegimeNotConfigured } from '../regimes/fiscal-regime.types';
import { createTestOrganization, describeWithDb, dropTestOrganization, newId, openTestDataSource } from '../../common/database/testing/integration-db';

/**
 * FAC-EINV-01 (audit 2026-11-07): seven regimes could build, seal and transmit, and no issued
 * invoice ever reached them. This drives the outbox against PostgreSQL with a regime adapter that
 * records what it is asked to do — the exchange with a real authority needs the taxpayer's own
 * certificate and contract, and is never simulated in the product.
 */
describe('backoffMinutes', () => {
  it('doubles from two minutes and stops at six hours', () => {
    expect([1, 2, 3, 4].map(backoffMinutes)).toEqual([2, 4, 8, 16]);
    expect(backoffMinutes(40)).toBe(360);
  });
});

describeWithDb('FiscalSubmissionService, against PostgreSQL', () => {
  jest.setTimeout(60_000);
  let ds: DataSource;
  let organizationId: string;
  let customerId: string;
  let next: () => Promise<FiscalTransmissionResult>;
  let calls: string[];
  let service: FiscalSubmissionService;

  const adapter: FiscalRegimeAdapter = {
    countryCode: 'MX',
    regime: 'CFDI 4.0',
    build: async () => {
      calls.push('build');
      return { payload: '<cfdi/>', contentType: 'application/xml', documentKey: null };
    },
    loadCertificate: async () => {
      calls.push('certificate');
      return { privateKeyPem: 'k', certificatePem: 'c' };
    },
    seal: (document) => {
      calls.push('seal');
      return { ...document, payload: '<cfdi Sello="x"/>' };
    },
    transmit: async () => {
      calls.push('transmit');
      return next();
    },
    checkStatus: async (handle) => {
      calls.push(`status:${handle}`);
      return next();
    },
  };
  const registry = { forCountry: (country: string | null) => ((country ?? '').toUpperCase() === 'MX' ? adapter : null) };

  const invoice = async () => {
    const id = await newId(ds);
    await ds.query(
      `INSERT INTO invoices (id, organization_id, "invoiceNumber", "customerName", "issueDate", "dueDate", subtotal, tax, total,
                             total_in_base_currency, version, customer_id, status, fiscal_number)
       VALUES ($1, $2, $3, 'QA Cliente', '2026-11-08', '2026-11-08', 100, 16, 116, 116, 1, $4, 'Pending', $5)`,
      [id, organizationId, `QA-EINV-${id.slice(0, 8)}`, customerId, `A-${id.slice(0, 6)}`],
    );
    await ds.transaction((manager) =>
      service.registerPending({ id, organizationId, fiscalNumber: 'A-1' } as never, 'MX', manager),
    );
    return id;
  };
  const row = async (invoiceId: string) =>
    (await ds.query(`SELECT status, attempts, tracking_id, payload, messages, next_attempt_at FROM fiscal_submissions WHERE invoice_id = $1`, [invoiceId]))[0];

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'einv-outbox');
    await ds.query(`UPDATE organizations SET country = 'MX' WHERE id = $1`, [organizationId]);
    [{ id: customerId }] = await ds.query(`INSERT INTO customers ("companyName", organization_id) VALUES ('QA Cliente', $1) RETURNING id`, [organizationId]);
    service = new FiscalSubmissionService(ds, registry as never);
  });

  beforeEach(() => {
    calls = [];
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM fiscal_submissions WHERE organization_id = $1`, [organizationId]);
    await ds.query(`DELETE FROM invoices WHERE organization_id = $1`, [organizationId]);
    await ds.query(`DELETE FROM customers WHERE organization_id = $1`, [organizationId]);
    await dropTestOrganization(ds, organizationId);
  });

  it('builds, seals and transmits, stores what it sent, and records the verdict', async () => {
    const id = await invoice();
    next = async () => ({ status: 'ACCEPTED', trackingId: 'UUID-1', authorization: '<timbre/>', messages: ['Timbrado'] });
    const result = await service.process(id, organizationId);
    expect(calls).toEqual(['build', 'certificate', 'seal', 'transmit']);
    expect(result?.status).toBe(FiscalSubmissionStatus.ACCEPTED);
    expect(await row(id)).toMatchObject({ status: 'ACCEPTED', attempts: 1, tracking_id: 'UUID-1', payload: '<cfdi Sello="x"/>', messages: ['Timbrado'] });
  });

  it('registering twice is one obligation, and a decided document is never sent again', async () => {
    const id = await invoice();
    await ds.transaction((manager) => service.registerPending({ id, organizationId } as never, 'MX', manager));
    next = async () => ({ status: 'ACCEPTED', trackingId: 'UUID-2', messages: [] });
    await service.process(id, organizationId);
    calls = [];
    await service.process(id, organizationId);
    expect(calls).toEqual([]);
    expect(Number((await ds.query(`SELECT count(*) FROM fiscal_submissions WHERE invoice_id = $1`, [id]))[0].count)).toBe(1);
  });

  it('two workers racing for the same document: exactly one transmits', async () => {
    const id = await invoice();
    next = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { status: 'ACCEPTED', trackingId: 'UUID-3', messages: [] };
    };
    await Promise.all([service.process(id, organizationId), service.process(id, organizationId), service.process(id, organizationId)]);
    expect(calls.filter((call) => call === 'transmit')).toHaveLength(1);
  });

  it('without the tenant configuration it is NOT_CONFIGURED, not rejected, and waits', async () => {
    const id = await invoice();
    next = async () => ({ status: 'NOT_CONFIGURED', messages: ['La transmisión de MX no está configurada'] });
    await service.process(id, organizationId);
    const stored = await row(id);
    expect(stored.status).toBe('NOT_CONFIGURED');
    expect(new Date(stored.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    // Saving the settings makes it due again at once.
    expect(await service.requeueNotConfigured(organizationId, 'MX')).toBeGreaterThanOrEqual(1);
    expect((await row(id)).next_attempt_at).toBeNull();
  });

  it('a missing certificate is a settings problem: NOT_CONFIGURED with the reason', async () => {
    const id = await invoice();
    const original = adapter.loadCertificate;
    adapter.loadCertificate = async () => {
      throw new RegimeNotConfigured('CFDI 4.0', 'el CSD del emisor');
    };
    try {
      await service.process(id, organizationId);
    } finally {
      adapter.loadCertificate = original;
    }
    expect((await row(id)).status).toBe('NOT_CONFIGURED');
    expect(calls).not.toContain('transmit');
  });

  it('a lost answer is SENT and asked about, never resent', async () => {
    const id = await invoice();
    next = async () => ({ status: 'PENDING', trackingId: 'TRACK-9', messages: ['timeout'] });
    await service.process(id, organizationId);
    expect((await row(id)).status).toBe('SENT');

    // Due now: the poll asks by the tracking handle and records the verdict.
    await ds.query(`UPDATE fiscal_submissions SET next_attempt_at = NULL WHERE invoice_id = $1`, [id]);
    const [{ id: submissionId }] = await ds.query(`SELECT id FROM fiscal_submissions WHERE invoice_id = $1`, [id]);
    calls = [];
    next = async () => ({ status: 'REJECTED', messages: ['RFC del receptor inválido'] });
    await service.poll(submissionId, organizationId);
    expect(calls).toEqual(['status:TRACK-9']);
    expect((await row(id)).status).toBe('REJECTED');
    await expect(service.retryNow(submissionId, organizationId)).rejects.toMatchObject({ messageKey: 'einvoicing.submission_already_decided' });
  });

  it('a failure on our side is ERROR with backoff, and is retried', async () => {
    const id = await invoice();
    const original = adapter.build;
    adapter.build = async () => {
      throw new Error('falta la clave del producto SAT');
    };
    try {
      await service.process(id, organizationId);
    } finally {
      adapter.build = original;
    }
    const stored = await row(id);
    expect(stored.status).toBe('ERROR');
    expect(new Date(stored.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect((await service.findDue(organizationId)).some((due) => due.invoiceId === id)).toBe(false);
  });
});
