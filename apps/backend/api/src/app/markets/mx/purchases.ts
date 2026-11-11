// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPurchases, MarketReceivedDocument, ReceivedDocumentCheck } from '../contracts';
import { receivedDocumentResult } from '../kit/purchases';

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

/** The CFDI folio fiscal: the UUID the SAT (through a PAC) stamped on the supplier's document. */
function checkFolioFiscal(raw: string): ReceivedDocumentCheck {
  const text = (raw ?? '').trim();
  if (!text) return receivedDocumentResult('CFDI_UUID', { status: 'missing' });
  const normalized = text.toUpperCase().replace(/\s/g, '');
  return UUID.test(normalized)
    ? receivedDocumentResult('CFDI_UUID', { normalized })
    : receivedDocumentResult('CFDI_UUID', { status: 'invalid', normalized, error: 'format' });
}

const RECEIVED_DOCUMENT: MarketReceivedDocument = {
  kind: 'CFDI_UUID',
  labelKey: 'localization.country_pack.supplier_document.cfdi_uuid',
  description: 'the CFDI "folio fiscal" (UUID, 8-4-4-4-12 hexadecimal characters) stamped by the SAT',
  example: '6F8B1C2A-1234-4ABC-9DEF-0123456789AB',
  check: checkFolioFiscal,
};

/** Mexico: what a supplier's document carries, and how a purchase is recorded. */
export const purchases: MarketPurchases = {
  supplierFiscalNumber: false,
  purchaseClassification: false,
  receivedDocument: RECEIVED_DOCUMENT,
  // Beyond the document and the amounts, the authority asks nothing of a purchase here.
  fiscalAttributes: [],
};
