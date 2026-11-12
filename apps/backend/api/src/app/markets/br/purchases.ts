// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPurchases, MarketReceivedDocument, ReceivedDocumentCheck } from '../contracts';
import { receivedDocumentResult } from '../kit/purchases';

/** NF-e access key: the 44th digit is a modulus-11 check over the first 43, weights 2…9 from the right. */
export function nfeCheckDigitOk(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) {
    sum += Number(key[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const digit = rest < 2 ? 0 : 11 - rest;
  return digit === Number(key[43]);
}

/** The NF-e access key printed on the DANFE, checked by its own check digit. */
function checkAccessKey(raw: string): ReceivedDocumentCheck {
  const text = (raw ?? '').trim();
  if (!text) return receivedDocumentResult('NFE_KEY', { status: 'missing' });
  const normalized = text.replace(/\D/g, '');
  if (normalized.length !== 44) return receivedDocumentResult('NFE_KEY', { status: 'invalid', normalized, error: 'format' });
  return nfeCheckDigitOk(normalized)
    ? receivedDocumentResult('NFE_KEY', { normalized })
    : receivedDocumentResult('NFE_KEY', { status: 'invalid', normalized, error: 'check_digit' });
}

const RECEIVED_DOCUMENT: MarketReceivedDocument = {
  kind: 'NFE_KEY',
  labelKey: 'localization.country_pack.supplier_document.nfe_key',
  description: 'the NF-e "chave de acesso": 44 digits, often printed in groups of four',
  example: '35260111222333000181550010000000123456789017',
  check: checkAccessKey,
};

/** Brazil: what a supplier's document carries, and how a purchase is recorded. */
export const purchases: MarketPurchases = {
  supplierFiscalNumber: false,
  purchaseClassification: false,
  receivedDocument: RECEIVED_DOCUMENT,
  // Beyond the document and the amounts, the authority asks nothing of a purchase here.
  fiscalAttributes: [],
};
