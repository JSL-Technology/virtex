import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { PurchaseRequisition, PurchaseRequisitionStatus } from './entities/purchase-requisition.entity';
import { PurchaseOrder, PurchaseOrderStatus } from './entities/purchase-order.entity';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { ProcurementService } from './procurement.service';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Purchasing.
 *
 * The screens showed seven documents invented in the browser — the same four orders and three
 * requisitions for every tenant of the product — and orders had no table at all. These tests are
 * about the two properties that replaced that: the documents are real and numbered by the server,
 * and the lifecycle is a lifecycle rather than a field anybody can set.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('purchasing', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let requisitions: ProcurementService;
  let orders: PurchaseOrdersService;

  let organizationId: string;
  let supplierId: string;

  const REQUESTER = '55555555-5555-4555-8555-555555555555';
  const APPROVER = '66666666-6666-4666-8666-666666666666';

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

    const numbering = new JournalEntryNumberingService();
    requisitions = new ProcurementService(
      dataSource.getRepository(PurchaseRequisition),
      dataSource,
      numbering,
    );
    orders = new PurchaseOrdersService(
      dataSource.getRepository(PurchaseOrder),
      dataSource,
      numbering,
      requisitions,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `PU ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    const supplier = await dataSource.getRepository(Supplier).save(
      dataSource.getRepository(Supplier).create({ organizationId, name: 'OfiSuministros SRL' }),
    );
    supplierId = supplier.id;
  });

  const newRequisition = () =>
    requisitions.create(
      {
        notes: 'Reposición de papelería',
        lines: [
          { description: 'Resma de papel A4', quantity: 10, estimatedUnitPrice: 250 },
          { description: 'Tóner negro', quantity: 2, estimatedUnitPrice: 3_500 },
        ],
      },
      organizationId,
      REQUESTER,
    );

  describe('requisitions', () => {
    it('numbers itself and totals itself from its own lines', async () => {
      const requisition = await newRequisition();

      expect(requisition.number).toMatch(/^REQ-\d{4}-\d{6}$/);
      // 10 × 250 + 2 × 3,500. A total a client could set independently of what it is buying is a
      // number an approver signs that means nothing.
      expect(requisition.totalAmount).toBe(9_500);
      expect(requisition.lines).toHaveLength(2);
      expect(requisition.status).toBe(PurchaseRequisitionStatus.DRAFT);
    });

    it('gives consecutive numbers, not the id of whoever asked first', async () => {
      const first = await newRequisition();
      const second = await newRequisition();
      expect(Number(second.number.slice(-6))).toBe(Number(first.number.slice(-6)) + 1);
    });

    it('recomputes the total when the lines change', async () => {
      const requisition = await newRequisition();
      const updated = await requisitions.update(
        requisition.id,
        { lines: [{ description: 'Resma de papel A4', quantity: 4, estimatedUnitPrice: 250 }] },
        organizationId,
      );
      expect(updated.totalAmount).toBe(1_000);
      expect(updated.lines).toHaveLength(1);
    });

    it('refuses to change under the approver once it is submitted', async () => {
      const requisition = await newRequisition();
      await requisitions.submit(requisition.id, organizationId);

      await expect(
        requisitions.update(requisition.id, { notes: 'otra cosa' }, organizationId),
      ).rejects.toThrow();
    });

    it('records who decided and why, not just that it was decided', async () => {
      const requisition = await newRequisition();
      await requisitions.submit(requisition.id, organizationId);
      const rejected = await requisitions.reject(
        requisition.id,
        organizationId,
        APPROVER,
        'Fuera de presupuesto este trimestre',
      );

      expect(rejected.status).toBe(PurchaseRequisitionStatus.REJECTED);
      expect(rejected.decidedByUserId).toBe(APPROVER);
      expect(rejected.decidedAt).toBeTruthy();
      expect(rejected.rejectionReason).toBe('Fuera de presupuesto este trimestre');
    });

    it('refuses a transition the lifecycle does not allow', async () => {
      const requisition = await newRequisition();
      // Straight from draft to approved skips the review the approval is supposed to be.
      await expect(
        requisitions.approve(requisition.id, organizationId, APPROVER),
      ).rejects.toThrow();
    });

    it('keeps a decided requisition even when somebody deletes it', async () => {
      const requisition = await newRequisition();
      await requisitions.submit(requisition.id, organizationId);
      await requisitions.approve(requisition.id, organizationId, APPROVER);

      // It is part of the record of what the business decided.
      await expect(requisitions.remove(requisition.id, organizationId)).rejects.toThrow();
    });
  });

  describe('orders', () => {
    const newOrder = () =>
      orders.create(
        {
          supplierId,
          lines: [
            { description: 'Resma de papel A4', quantity: 10, unitPrice: 230, taxRate: 0.18 },
            { description: 'Tóner negro', quantity: 2, unitPrice: 3_400 },
          ],
        },
        organizationId,
        REQUESTER,
      );

    it('totals itself, tax and all, from the agreed prices', async () => {
      const order = await newOrder();

      expect(order.number).toMatch(/^PO-\d{4}-\d{6}$/);
      expect(order.subtotal).toBe(9_100); // 10 × 230 + 2 × 3,400
      expect(order.taxTotal).toBe(414); // 18 % of the paper only
      expect(order.total).toBe(9_514);
    });

    it('posts nothing to the ledger: an order is a commitment, not a transaction', async () => {
      await newOrder();

      const [{ count }] = await dataSource.query(
        `SELECT COUNT(*) AS count FROM "journal_entries" WHERE "organization_id" = $1`,
        [organizationId],
      );
      expect(Number(count)).toBe(0);
    });

    it('cannot be edited once the supplier has seen it', async () => {
      const order = await newOrder();
      await orders.submit(order.id, organizationId);
      await orders.approve(order.id, organizationId, APPROVER);
      await orders.send(order.id, organizationId);

      await expect(
        orders.update(order.id, { notes: 'cambio de precio' }, organizationId),
      ).rejects.toThrow();
    });

    it('tracks what is still outstanding as deliveries arrive', async () => {
      const order = await newOrder();
      await orders.submit(order.id, organizationId);
      await orders.approve(order.id, organizationId, APPROVER);
      const sent = await orders.send(order.id, organizationId);

      const partial = await orders.receive(
        order.id,
        { lines: [{ lineId: sent.lines[0].id, quantity: 4 }] },
        organizationId,
      );
      expect(partial.status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
      expect(partial.lines.find((l) => l.id === sent.lines[0].id)?.receivedQuantity).toBe(4);

      const complete = await orders.receive(
        order.id,
        {
          lines: [
            { lineId: sent.lines[0].id, quantity: 6 },
            { lineId: sent.lines[1].id, quantity: 2 },
          ],
        },
        organizationId,
      );
      expect(complete.status).toBe(PurchaseOrderStatus.RECEIVED);
    });

    it('refuses a delivery larger than what was ordered', async () => {
      const order = await newOrder();
      await orders.submit(order.id, organizationId);
      await orders.approve(order.id, organizationId, APPROVER);
      const sent = await orders.send(order.id, organizationId);

      await expect(
        orders.receive(order.id, { lines: [{ lineId: sent.lines[0].id, quantity: 11 }] }, organizationId),
      ).rejects.toThrow();
    });

    it('refuses to receive against an order the supplier has not been sent', async () => {
      const order = await newOrder();
      await expect(
        orders.receive(order.id, { lines: [{ lineId: order.lines[0].id, quantity: 1 }] }, organizationId),
      ).rejects.toThrow();
    });

    it('carries an approved requisition across, and keeps the two attached', async () => {
      const requisition = await newRequisition();
      await requisitions.submit(requisition.id, organizationId);
      await requisitions.approve(requisition.id, organizationId, APPROVER);

      const order = await orders.createFromRequisition(
        requisition.id,
        supplierId,
        organizationId,
        REQUESTER,
      );

      expect(order.lines).toHaveLength(2);
      // The requester's estimate opens the negotiation; the buyer edits it to what was agreed.
      expect(order.subtotal).toBe(9_500);
      expect(order.requisitionId).toBe(requisition.id);

      const converted = await requisitions.findOne(requisition.id, organizationId);
      expect(converted.status).toBe(PurchaseRequisitionStatus.CONVERTED_TO_PO);
      expect(converted.purchaseOrderId).toBe(order.id);
    });

    it('refuses to order from a requisition nobody approved', async () => {
      const requisition = await newRequisition();
      await expect(
        orders.createFromRequisition(requisition.id, supplierId, organizationId, REQUESTER),
      ).rejects.toThrow();
    });
  });
});
