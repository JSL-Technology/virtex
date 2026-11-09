// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPurchases, MarketReceivedDocument, ReceivedDocumentCheck } from '../contracts';
import { receivedDocumentResult } from '../kit/purchases';

const CUFE = /^[0-9a-f]{96}$/;

/** The CUFE: the SHA-384 the DIAN recomputes from the electronic invoice's own fields. */
function checkCufe(raw: string): ReceivedDocumentCheck {
  const text = (raw ?? '').trim();
  if (!text) return receivedDocumentResult('CUFE', { status: 'missing' });
  const normalized = text.toLowerCase().replace(/\s/g, '');
  return CUFE.test(normalized)
    ? receivedDocumentResult('CUFE', { normalized })
    : receivedDocumentResult('CUFE', { status: 'invalid', normalized, error: 'format' });
}

const RECEIVED_DOCUMENT: MarketReceivedDocument = {
  kind: 'CUFE',
  labelKey: 'localization.country_pack.supplier_document.cufe',
  description: 'the CUFE: 96 hexadecimal characters printed on the electronic invoice',
  check: checkCufe,
};

/** Colombia: what a supplier's document carries, and how a purchase is recorded. */
export const purchases: MarketPurchases = {
  supplierFiscalNumber: false,
  purchaseClassification: false,
  receivedDocument: RECEIVED_DOCUMENT,
};
