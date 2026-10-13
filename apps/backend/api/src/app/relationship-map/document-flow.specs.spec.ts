import * as path from 'path';
import { DataSource } from 'typeorm';
import { FLOW_DOCUMENT_TYPES, isFlowDocumentType } from './contracts/document-flow.contracts';
import { DocumentFlowCatalog } from './document-flow.catalog';
import { EDGE_SPECS, NODE_SPECS, STATUS_MAPS, statusKindOf } from './document-flow.specs';

/**
 * The registry names entities and properties as strings — that is what keeps the map from
 * importing a dozen modules — so nothing but this test notices when one of them stops existing.
 *
 * It loads the real entity metadata (by glob, the way the CLI data source does, so the boundary
 * checker sees no import) without connecting to a database, compiles the catalog against it and
 * requires zero problems.
 */
describe('relationship map registry', () => {
  let catalog: DocumentFlowCatalog;

  beforeAll(async () => {
    const dataSource = new DataSource({
      type: 'postgres',
      entities: [
        path.join(__dirname, '..', '**', '*.entity.{js,ts}'),
        path.join(__dirname, '..', '..', '..', '..', '..', '..', 'libs', '**', '*.entity.{js,ts}'),
      ],
    });
    // Metadata only: `buildMetadatas` reads the decorators and opens no connection.
    await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    catalog = new DocumentFlowCatalog(dataSource);
  }, 120_000);

  it('resolves every node and edge spec against the live entities', () => {
    expect(catalog.problems()).toEqual([]);
    expect(catalog.nodes()).toHaveLength(FLOW_DOCUMENT_TYPES.length);
    expect(catalog.edges()).toHaveLength(EDGE_SPECS.length);
  });

  it('reads every searchable type by a number column', () => {
    for (const node of catalog.nodes()) {
      if (node.spec.searchable) expect(node.selects['number']).toBeDefined();
    }
  });

  it('declares one spec per document type, keyed consistently', () => {
    for (const type of FLOW_DOCUMENT_TYPES) {
      expect(NODE_SPECS[type].type).toBe(type);
      expect(NODE_SPECS[type].typeKey).toBe(`relationship_map.doc.${type.toLowerCase()}`);
    }
  });

  it('refuses prototype keys as document types', () => {
    for (const evil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'sales_invoice']) {
      expect(isFlowDocumentType(evil)).toBe(false);
    }
    expect(isFlowDocumentType('SALES_INVOICE')).toBe(true);
  });
});

/**
 * Every status each enum can hold, as the owning entity declares it. Kept here, not imported, for
 * the same boundary reason; when an enum gains a value the map must be told how to colour it, and
 * this list is where that decision is made visible.
 */
const ENUM_VALUES: Record<keyof typeof STATUS_MAPS, string[]> = {
  quote: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'INVOICED', 'CANCELLED'],
  invoice: ['Draft', 'Pending', 'Paid', 'Partially Paid', 'Void', 'Credit Note'],
  customerPayment: ['POSTED', 'VOID'],
  posSale: ['PAID', 'CANCELLED'],
  ecf: ['PENDING', 'SIGNED', 'SENT', 'ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED', 'CONTINGENCY', 'ERROR'],
  requisition: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED_TO_PO'],
  purchaseOrder: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  goodsReceipt: ['POSTED', 'VOID'],
  vendorBill: ['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID', 'REJECTED'],
  vendorDebitNote: ['POSTED', 'VOIDED'],
  paymentBatch: ['PENDING', 'PROCESSING', 'PAID', 'VOID'],
  journalEntry: ['Draft', 'Pending Approval', 'Posted', 'Modified', 'Void', 'Rejected'],
  inventoryAdjustment: ['DRAFT', 'POSTED', 'CANCELLED'],
  payrollRun: ['DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED'],
  intercompany: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
  fixedAsset: ['IN_USE', 'DISPOSED', 'SOLD'],
  opportunity: [],
};

describe('relationship map statuses', () => {
  it.each(Object.entries(ENUM_VALUES))('maps every %s status explicitly', (name, values) => {
    const map = STATUS_MAPS[name as keyof typeof STATUS_MAPS] as Record<string, string>;
    for (const value of values) expect(map[value]).toBeDefined();
  });

  it('keeps a partially received order and a partially paid invoice open', () => {
    expect(statusKindOf(NODE_SPECS.PURCHASE_ORDER, 'PARTIALLY_RECEIVED')).toBe('open');
    expect(statusKindOf(NODE_SPECS.PURCHASE_ORDER, 'RECEIVED')).toBe('closed');
    expect(statusKindOf(NODE_SPECS.SALES_INVOICE, 'Partially Paid')).toBe('open');
    expect(statusKindOf(NODE_SPECS.VENDOR_BILL, 'PARTIALLY_PAID')).toBe('open');
  });

  it('closes an invoiced quote', () => {
    expect(statusKindOf(NODE_SPECS.SALES_QUOTE, 'INVOICED')).toBe('closed');
  });

  it('never guesses an unknown value', () => {
    expect(statusKindOf(NODE_SPECS.SALES_INVOICE, 'Postponed')).toBe('unknown');
    expect(statusKindOf(NODE_SPECS.SALES_OPPORTUNITY, 'NEGOTIATION')).toBe('open');
    expect(statusKindOf(NODE_SPECS.BANK_TRANSFER, null)).toBe('closed');
  });
});
