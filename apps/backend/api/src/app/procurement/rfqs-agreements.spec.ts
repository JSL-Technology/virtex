import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { Supplier, SupplierStatus } from '../suppliers/entities/supplier.entity';
import { PurchaseRequisition, PurchaseRequisitionStatus } from './entities/purchase-requisition.entity';
import { PurchaseOrder, PurchaseOrderStatus } from './entities/purchase-order.entity';
import { ProcurementService } from './procurement.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { RfqsService } from './rfqs.service';
import { PurchaseAgreementsService } from './purchase-agreements.service';
import { RfqStatus } from './entities/purchase-rfq.entity';
import { SupplierQuoteStatus } from './entities/supplier-quote.entity';
import { PurchaseAgreementStatus } from './entities/purchase-agreement.entity';

/**
 * Requests for quotation and purchase agreements (audit 2026-11-07, CMP-15), against PostgreSQL.
 *
 * The two capabilities the audit found missing from the purchasing cycle. What is tested is what
 * makes them controls rather than forms: the quotation's totals are the server's; the award is
 * one, at the quoted prices, and a dearer winner needs a reason; an agreement's ceilings hold
 * across every release still standing — including two released at the same moment.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('quotations and agreements', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let requisitions: ProcurementService;
  let orders: PurchaseOrdersService;
  let rfqs: RfqsService;
  let agreements: PurchaseAgreementsService;
  const goodsReceipts = {
    receiveGoods: jest.fn(async (_m: unknown, _o: string, receipt: { lines: readonly unknown[] }) => ({ journalEntryId: null, stocked: receipt.lines.map(() => false), warehouseId: null })),
    returnGoods: jest.fn(async () => null),
    absorbReceivedCostDifference: jest.fn(async () => ({ absorbed: 0, units: 0 })),
  };

  let organizationId: string;
  let supplierA: string;
  let supplierB: string;
  let supplierC: string;
  const BUYER = '55555555-5555-4555-8555-555555555555';
  const APPROVER = '66666666-6666-4666-8666-666666666666';
  // Days counted from the company's own today (America/Santo_Domingo), which is what the server reads.
  const iso = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();
    requisitions = new ProcurementService(dataSource.getRepository(PurchaseRequisition), dataSource);
    orders = new PurchaseOrdersService(dataSource.getRepository(PurchaseOrder), dataSource, requisitions, goodsReceipts);
    rfqs = new RfqsService(dataSource, orders, requisitions);
    agreements = new PurchaseAgreementsService(dataSource, orders);
  });

  afterAll(async () => dataSource?.destroy());

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({ legalName: `CQ ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timezone: 'America/Santo_Domingo' }),
    );
    organizationId = org.id;
    const make = async (name: string) =>
      (await dataSource.getRepository(Supplier).save(dataSource.getRepository(Supplier).create({ organizationId, name }))).id;
    supplierA = await make('Papelera Norte');
    supplierB = await make('Papelera Sur');
    supplierC = await make('Papelera Este');
  });

  afterEach(async () => {
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  const approvedRequisition = async () => {
    const requisition = await requisitions.create(
      { notes: 'Papelería', lines: [{ description: 'Resma A4', quantity: 10, estimatedUnitPrice: 250 }, { description: 'Tóner', quantity: 2, estimatedUnitPrice: 3_500 }] },
      organizationId,
      BUYER,
    );
    await requisitions.submit(requisition.id, organizationId);
    await requisitions.approve(requisition.id, organizationId, APPROVER);
    return requisition;
  };

  const sentRfq = async () => {
    const requisition = await approvedRequisition();
    const rfq = await rfqs.create({ title: 'Papelería del trimestre', requisitionId: requisition.id, supplierIds: [supplierA, supplierB, supplierC] }, organizationId, BUYER);
    await rfqs.send(rfq.id, organizationId);
    return { rfq, requisition };
  };

  describe('requests for quotation', () => {
    it('takes its lines from an approved requisition, and refuses one that is not approved', async () => {
      const { rfq } = await sentRfq();
      expect(rfq.number).toMatch(/^RFQ-\d{4}-\d{6}$/);
      expect(rfq.lines.map((l) => [l.description, Number(l.quantity)])).toEqual([['Resma A4', 10], ['Tóner', 2]]);

      const draft = await requisitions.create({ lines: [{ description: 'Grapas', quantity: 1, estimatedUnitPrice: 50 }] }, organizationId, BUYER);
      await expect(
        rfqs.create({ title: 'x', requisitionId: draft.id, supplierIds: [supplierA] }, organizationId, BUYER),
      ).rejects.toMatchObject({ messageKey: 'procurement.rfq_requisition_not_approved' });
    });

    it('records a quotation only from an invited supplier, for its own lines, totalled by the server', async () => {
      const { rfq } = await sentRfq();
      const [paper, toner] = rfq.lines;
      const stranger = (await dataSource.getRepository(Supplier).save(dataSource.getRepository(Supplier).create({ organizationId, name: 'Ajeno' }))).id;
      await expect(
        rfqs.recordQuote(rfq.id, { supplierId: stranger, validUntil: iso(30), lines: [{ rfqLineId: paper.id, unitPrice: 1 }] }, organizationId),
      ).rejects.toMatchObject({ messageKey: 'procurement.quote_supplier_not_invited' });
      await expect(
        rfqs.recordQuote(rfq.id, { supplierId: supplierA, validUntil: iso(30), lines: [{ rfqLineId: paper.id, unitPrice: 1 }, { rfqLineId: paper.id, unitPrice: 2 }] }, organizationId),
      ).rejects.toMatchObject({ messageKey: 'procurement.quote_line_repeated' });

      const quote = await rfqs.recordQuote(
        rfq.id,
        { supplierId: supplierA, validUntil: iso(30), lines: [{ rfqLineId: paper.id, unitPrice: 240, taxRate: 0.18 }, { rfqLineId: toner.id, unitPrice: 3_400, taxRate: 0.18 }] },
        organizationId,
      );
      // 10 × 240 + 2 × 3,400 = 9,200; 18 % = 1,656.
      expect(quote).toMatchObject({ subtotal: 9_200, taxTotal: 1_656, total: 10_856 });

      // Recorded again, it is replaced: one quotation per supplier.
      await rfqs.recordQuote(rfq.id, { supplierId: supplierA, validUntil: iso(30), lines: [{ rfqLineId: paper.id, unitPrice: 230 }, { rfqLineId: toner.id, unitPrice: 3_400 }] }, organizationId);
      const full = await rfqs.findOne(rfq.id, organizationId);
      expect(full.quotes).toHaveLength(1);
      expect(Number(full.quotes[0].subtotal)).toBe(9_100);
    });

    it('ranks the quotations: an incomplete or expired one is not eligible, the cheapest eligible wins', async () => {
      const { rfq } = await sentRfq();
      const [paper, toner] = rfq.lines;
      await rfqs.recordQuote(rfq.id, { supplierId: supplierA, validUntil: iso(30), lines: [{ rfqLineId: paper.id, unitPrice: 250 }, { rfqLineId: toner.id, unitPrice: 3_500 }] }, organizationId);
      // Cheaper, but only for the paper.
      await rfqs.recordQuote(rfq.id, { supplierId: supplierB, validUntil: iso(30), lines: [{ rfqLineId: paper.id, unitPrice: 100 }] }, organizationId);
      // Cheapest of all, but it no longer holds.
      await rfqs.recordQuote(rfq.id, { supplierId: supplierC, receivedOn: iso(-20), validUntil: iso(-1), lines: [{ rfqLineId: paper.id, unitPrice: 50 }, { rfqLineId: toner.id, unitPrice: 50 }] }, organizationId);

      const comparison = await rfqs.comparison(rfq.id, organizationId);
      const of = (supplierId: string) => comparison.quotes.find((q) => q.supplierId === supplierId)!;
      expect(of(supplierA)).toMatchObject({ eligible: true, cheapest: true });
      expect(of(supplierB)).toMatchObject({ complete: false, eligible: false });
      expect(of(supplierC)).toMatchObject({ current: false, eligible: false });
      expect(comparison.lines[0].offers.find((o) => o.lowest)?.supplierId).toBe(supplierC);
    });

    it('awards once, at the quoted prices: the order, the declined quotations and the requisition follow', async () => {
      const { rfq, requisition } = await sentRfq();
      const [paper, toner] = rfq.lines;
      const winner = await rfqs.recordQuote(rfq.id, { supplierId: supplierA, validUntil: iso(30), leadTimeDays: 5, lines: [{ rfqLineId: paper.id, unitPrice: 240, taxRate: 0.18 }, { rfqLineId: toner.id, unitPrice: 3_400, taxRate: 0.18 }] }, organizationId);
      const loser = await rfqs.recordQuote(rfq.id, { supplierId: supplierB, validUntil: iso(30), lines: [{ rfqLineId: paper.id, unitPrice: 260 }, { rfqLineId: toner.id, unitPrice: 3_600 }] }, organizationId);

      const order = await rfqs.award(rfq.id, { quoteId: winner.id }, organizationId, APPROVER);
      expect(order).toMatchObject({ status: PurchaseOrderStatus.DRAFT, supplierId: supplierA, rfqId: rfq.id, supplierQuoteId: winner.id, requisitionId: requisition.id });
      expect(order.lines.map((l) => [Number(l.quantity), Number(l.unitPrice), Number(l.taxRate)])).toEqual([[10, 240, 0.18], [2, 3_400, 0.18]]);
      expect(Number(order.total)).toBe(10_856);

      const after = await rfqs.findOne(rfq.id, organizationId);
      expect(after).toMatchObject({ status: RfqStatus.AWARDED, awardedQuoteId: winner.id, awardedOrderId: order.id });
      expect(after.quotes.find((q) => q.id === loser.id)?.status).toBe(SupplierQuoteStatus.DECLINED);
      expect((await requisitions.findOne(requisition.id, organizationId)).status).toBe(PurchaseRequisitionStatus.CONVERTED_TO_PO);

      await expect(rfqs.award(rfq.id, { quoteId: loser.id, reason: 'otra vez' }, organizationId, APPROVER)).rejects.toMatchObject({
        messageKey: 'procurement.rfq_not_open_for_quotes',
      });
      // The order carries the quotation's terms.
      await expect(
        orders.update(order.id, { lines: [{ description: 'Resma A4', quantity: 10, unitPrice: 999 }] }, organizationId),
      ).rejects.toMatchObject({ messageKey: 'procurement.order_terms_from_source_document' });
    });

    it('awards a dearer quotation only with a reason, and never an expired one or a blocked supplier', async () => {
      const { rfq } = await sentRfq();
      const [paper, toner] = rfq.lines;
      await rfqs.recordQuote(rfq.id, { supplierId: supplierA, validUntil: iso(30), lines: [{ rfqLineId: paper.id, unitPrice: 240 }, { rfqLineId: toner.id, unitPrice: 3_400 }] }, organizationId);
      const dearer = await rfqs.recordQuote(rfq.id, { supplierId: supplierB, validUntil: iso(30), leadTimeDays: 1, lines: [{ rfqLineId: paper.id, unitPrice: 260 }, { rfqLineId: toner.id, unitPrice: 3_600 }] }, organizationId);
      const expired = await rfqs.recordQuote(rfq.id, { supplierId: supplierC, receivedOn: iso(-20), validUntil: iso(-1), lines: [{ rfqLineId: paper.id, unitPrice: 1 }, { rfqLineId: toner.id, unitPrice: 1 }] }, organizationId);

      await expect(rfqs.award(rfq.id, { quoteId: expired.id, reason: 'barata' }, organizationId, APPROVER)).rejects.toMatchObject({ messageKey: 'procurement.quote_expired' });
      await expect(rfqs.award(rfq.id, { quoteId: dearer.id }, organizationId, APPROVER)).rejects.toMatchObject({ messageKey: 'procurement.award_not_cheapest_needs_reason' });
      await dataSource.getRepository(Supplier).update({ id: supplierB }, { status: SupplierStatus.BLOCKED });
      await expect(rfqs.award(rfq.id, { quoteId: dearer.id, reason: 'Entrega en 1 día' }, organizationId, APPROVER)).rejects.toMatchObject({ messageKey: 'procurement.quote_supplier_blocked' });
      await dataSource.getRepository(Supplier).update({ id: supplierB }, { status: SupplierStatus.ACTIVE });

      const order = await rfqs.award(rfq.id, { quoteId: dearer.id, reason: 'Entrega en 1 día' }, organizationId, APPROVER);
      expect(order.supplierId).toBe(supplierB);
      expect((await rfqs.findOne(rfq.id, organizationId)).awardReason).toBe('Entrega en 1 día');
    });
  });

  describe('purchase agreements', () => {
    const activeAgreement = async (over: { maxAmount?: number; validFrom?: string; validTo?: string } = {}) => {
      const agreement = await agreements.create(
        {
          title: 'Papel 2026',
          supplierId: supplierA,
          validFrom: over.validFrom ?? iso(-10),
          validTo: over.validTo ?? iso(180),
          maxAmount: over.maxAmount,
          lines: [
            { description: 'Resma A4', unitPrice: 230, taxRate: 0.18, maxQuantity: 10 },
            { description: 'Tóner', unitPrice: 3_300 },
          ],
        },
        organizationId,
        BUYER,
      );
      expect(agreement.number).toMatch(/^CTR-\d{4}-\d{6}$/);
      // A company of one person: there is nobody else to activate it.
      return agreements.activate(agreement.id, organizationId, BUYER);
    };

    it('releases orders at the agreed prices, and holds the line ceiling across releases', async () => {
      const agreement = await activeAgreement();
      const [paper, toner] = agreement.lines;
      const first = await agreements.release(agreement.id, { lines: [{ agreementLineId: paper.id, quantity: 6 }, { agreementLineId: toner.id, quantity: 3 }] }, organizationId, BUYER);
      expect(first).toMatchObject({ status: PurchaseOrderStatus.DRAFT, agreementId: agreement.id, supplierId: supplierA });
      expect(first.lines.map((l) => [Number(l.quantity), Number(l.unitPrice), l.agreementLineId])).toEqual([[6, 230, paper.id], [3, 3_300, toner.id]]);

      await expect(
        agreements.release(agreement.id, { lines: [{ agreementLineId: paper.id, quantity: 5 }] }, organizationId, BUYER),
      ).rejects.toMatchObject({ messageKey: 'procurement.agreement_line_exhausted' });

      const view = await agreements.findOne(agreement.id, organizationId);
      expect(view.usage.find((u) => u.agreementLineId === paper.id)).toMatchObject({ usedQuantity: 6, remainingQuantity: 4 });
      // A cancelled release gives its units back: usage is read from the orders, never counted.
      await orders.cancel(first.id, organizationId, 'Se pidió de más');
      expect((await agreements.findOne(agreement.id, organizationId)).usage.find((u) => u.agreementLineId === paper.id)?.usedQuantity).toBe(0);

      await expect(
        orders.update(first.id, { lines: [{ description: 'Resma A4', quantity: 1, unitPrice: 1 }] }, organizationId),
      ).rejects.toBeDefined();
    });

    it('lets two releases at the same moment take the last units only once', async () => {
      const agreement = await activeAgreement();
      const [paper] = agreement.lines;
      const results = await Promise.allSettled([
        agreements.release(agreement.id, { lines: [{ agreementLineId: paper.id, quantity: 6 }] }, organizationId, BUYER),
        agreements.release(agreement.id, { lines: [{ agreementLineId: paper.id, quantity: 6 }] }, organizationId, BUYER),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.objectContaining({ messageKey: 'procurement.agreement_line_exhausted' }) });
      expect((await agreements.findOne(agreement.id, organizationId)).usage[0].usedQuantity).toBe(6);
    });

    it('holds the overall ceiling, the validity, and a closed agreement', async () => {
      const capped = await activeAgreement({ maxAmount: 5_000 });
      const toner = capped.lines[1];
      await agreements.release(capped.id, { lines: [{ agreementLineId: toner.id, quantity: 1 }] }, organizationId, BUYER);
      await expect(
        agreements.release(capped.id, { lines: [{ agreementLineId: toner.id, quantity: 1 }] }, organizationId, BUYER),
      ).rejects.toMatchObject({ messageKey: 'procurement.agreement_amount_exhausted' });

      const future = await activeAgreement({ validFrom: iso(30), validTo: iso(60) });
      await expect(
        agreements.release(future.id, { lines: [{ agreementLineId: future.lines[0].id, quantity: 1 }] }, organizationId, BUYER),
      ).rejects.toMatchObject({ messageKey: 'procurement.agreement_outside_validity' });

      const closed = await agreements.close(capped.id, organizationId, 'Se cambió de proveedor');
      expect(closed.status).toBe(PurchaseAgreementStatus.CLOSED);
      await expect(
        agreements.release(capped.id, { lines: [{ agreementLineId: toner.id, quantity: 1 }] }, organizationId, BUYER),
      ).rejects.toMatchObject({ messageKey: 'procurement.agreement_not_active' });
    });
  });
});
