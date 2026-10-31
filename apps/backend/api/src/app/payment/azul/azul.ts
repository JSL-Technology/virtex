import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { ConfigService } from '@nestjs/config';

/**
 * Azul (Banco Popular Dominicano's acquirer): the hosted Payment Page for the first charge, and the
 * JSON web service for renewals against the card token it keeps (DataVault), voids and refunds.
 *
 * Everything that depends on Azul's published integration guide — field names, the order the hash
 * concatenates them in, the endpoints — is in this file, so a revision of the guide is a change
 * here and nowhere else.
 *
 * *Verificar con Azul:* the field order of `AuthHash` and the web-service payload follow the
 * Payment Page and Web Services guides Azul hands merchants at onboarding. Azul's test environment
 * (`pruebas.azul.com.do`) with the merchant's test credentials is the conformance test; run one
 * approved, one declined and one cancelled payment before enabling production.
 */

export interface AzulSettings {
  environment: 'test' | 'production';
  merchantId: string;
  merchantName: string;
  merchantType: string;
  /** The Payment Page's private key: signs requests and verifies responses. */
  authKey: string;
  /** Web service credentials (headers `Auth1`/`Auth2`) and the client certificate Azul issued. */
  auth1: string | null;
  auth2: string | null;
  certificatePath: string | null;
  keyPath: string | null;
  /** The public base URL of the API, for the URLs Azul sends the buyer back to. */
  publicApiUrl: string;
}

export function azulSettings(config: ConfigService): AzulSettings | null {
  const merchantId = config.get<string>('AZUL_MERCHANT_ID');
  const authKey = config.get<string>('AZUL_AUTH_KEY');
  if (!merchantId || !authKey) return null;
  return {
    environment: config.get<string>('AZUL_ENVIRONMENT') === 'production' ? 'production' : 'test',
    merchantId,
    merchantName: config.get<string>('AZUL_MERCHANT_NAME') ?? 'VIRTEEX',
    merchantType: config.get<string>('AZUL_MERCHANT_TYPE') ?? 'ECommerce',
    authKey,
    auth1: config.get<string>('AZUL_AUTH1') ?? null,
    auth2: config.get<string>('AZUL_AUTH2') ?? null,
    certificatePath: config.get<string>('AZUL_CERT_PATH') ?? null,
    keyPath: config.get<string>('AZUL_KEY_PATH') ?? null,
    publicApiUrl: (config.get<string>('PUBLIC_API_URL') ?? config.get<string>('FRONTEND_URL') ?? '').replace(/\/+$/, ''),
  };
}

export function paymentPageUrl(settings: AzulSettings): string {
  return settings.environment === 'production'
    ? 'https://pagos.azul.com.do/PaymentPage/'
    : 'https://pruebas.azul.com.do/PaymentPage/';
}

export function webServiceUrl(settings: AzulSettings, operation?: 'ProcessVoid'): string {
  const base =
    settings.environment === 'production'
      ? 'https://pagos.azul.com.do/webservices/JSON/Default.aspx'
      : 'https://pruebas.azul.com.do/webservices/JSON/Default.aspx';
  return operation ? `${base}?${operation}` : base;
}

/** An amount in minor units, as Azul writes it: digits only, no separator (`118000` = 1,180.00). */
export function azulAmount(minor: number): string {
  return String(Math.round(minor));
}

/** The fields the Payment Page receives, in the order its hash concatenates them. */
export interface PaymentPageRequest {
  MerchantId: string;
  MerchantName: string;
  MerchantType: string;
  CurrencyCode: string;
  OrderNumber: string;
  Amount: string;
  ITBIS: string;
  ApprovedUrl: string;
  DeclinedUrl: string;
  CancelUrl: string;
  UseCustomField1: string;
  CustomField1Label: string;
  CustomField1Value: string;
  UseCustomField2: string;
  CustomField2Label: string;
  CustomField2Value: string;
}

const REQUEST_HASH_ORDER: Array<keyof PaymentPageRequest> = [
  'MerchantId', 'MerchantName', 'MerchantType', 'CurrencyCode', 'OrderNumber', 'Amount', 'ITBIS',
  'ApprovedUrl', 'DeclinedUrl', 'CancelUrl', 'UseCustomField1', 'CustomField1Label',
  'CustomField1Value', 'UseCustomField2', 'CustomField2Label', 'CustomField2Value',
];

/** The fields Azul returns to `ApprovedUrl`/`DeclinedUrl`, in the order its hash concatenates them. */
const RESPONSE_HASH_ORDER = [
  'OrderNumber', 'Amount', 'AuthorizationCode', 'DateTime', 'ResponseCode', 'IsoCode',
  'ResponseMessage', 'ErrorDescription', 'RRN',
] as const;

function hmac(key: string, text: string): string {
  return createHmac('sha512', key).update(text, 'utf8').digest('hex');
}

/** `AuthHash` of a Payment Page request: HMAC-SHA512 of the fields plus the key, keyed with it. */
export function requestHash(fields: PaymentPageRequest, authKey: string): string {
  return hmac(authKey, REQUEST_HASH_ORDER.map((name) => fields[name] ?? '').join('') + authKey);
}

/** Whether a Payment Page response came from Azul unaltered. */
export function responseHashValid(query: Record<string, string | undefined>, authKey: string): boolean {
  const given = (query['AuthHash'] ?? '').toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(given)) return false;
  const expected = hmac(authKey, RESPONSE_HASH_ORDER.map((name) => query[name] ?? '').join('') + authKey);
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

/** The auto-submitting page that takes the buyer to Azul with the signed request. */
export function paymentPageForm(settings: AzulSettings, fields: PaymentPageRequest, extra: Record<string, string>): string {
  const all: Record<string, string> = { ...fields, ...extra, AuthHash: requestHash(fields, settings.authKey) };
  const inputs = Object.entries(all)
    .map(([name, value]) => `<input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(value)}">`)
    .join('');
  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="robots" content="noindex">' +
    '<title>Azul</title></head><body>' +
    `<form id="azul" method="post" action="${escapeAttr(paymentPageUrl(settings))}">${inputs}` +
    '<noscript><button type="submit">Continuar al pago</button></noscript></form>' +
    '<script>document.getElementById("azul").submit()</script></body></html>'
  );
}

/** What the web service answered. `IsoCode` `00` is an approval. */
export interface AzulWebServiceResponse {
  IsoCode?: string;
  ResponseCode?: string;
  ResponseMessage?: string;
  ErrorDescription?: string;
  AuthorizationCode?: string;
  AzulOrderId?: string;
  RRN?: string;
  DataVaultToken?: string;
  DataVaultBrand?: string;
  [key: string]: unknown;
}

/** A sale against a DataVault token: the renewal of a subscription. */
export function tokenSalePayload(settings: AzulSettings, input: {
  orderNumber: string;
  amountMinor: number;
  taxMinor: number;
  token: string;
}): Record<string, string> {
  return {
    Channel: 'EC',
    Store: settings.merchantId,
    CardNumber: '',
    Expiration: '',
    CVC: '',
    PosInputMode: 'E-Commerce',
    TrxType: 'Sale',
    Amount: azulAmount(input.amountMinor),
    Itbis: azulAmount(input.taxMinor),
    CurrencyPosCode: '$',
    Payments: '1',
    Plan: '0',
    AcquirerRefData: '1',
    OrderNumber: input.orderNumber,
    CustomOrderId: input.orderNumber,
    DataVaultToken: input.token,
    SaveToDataVault: '0',
    ForceNo3DS: '1',
  };
}

/**
 * POST to the web service with the merchant's client certificate (mutual TLS) and `Auth1`/`Auth2`.
 * Throws when it is not configured: a renewal that cannot be attempted must be visible, not skipped.
 */
export function callWebService(
  settings: AzulSettings,
  payload: Record<string, unknown>,
  operation?: 'ProcessVoid',
): Promise<AzulWebServiceResponse> {
  if (!settings.auth1 || !settings.auth2 || !settings.certificatePath || !settings.keyPath) {
    return Promise.reject(new Error('Azul web service is not configured (AZUL_AUTH1, AZUL_AUTH2, AZUL_CERT_PATH, AZUL_KEY_PATH).'));
  }
  const url = new URL(webServiceUrl(settings, operation));
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'POST',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        cert: readFileSync(settings.certificatePath as string),
        key: readFileSync(settings.keyPath as string),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Auth1: settings.auth1 as string,
          Auth2: settings.auth2 as string,
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as AzulWebServiceResponse);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Azul web service timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

function escapeAttr(value: string): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
