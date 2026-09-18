import { Customer } from '../../customers/entities/customer.entity';
import { TaxpayerType } from '../../localization/fiscal/withholding-regimes';
import { TaxpayerKind } from '../../localization/fiscal/tax-id-validators';
import { regimeDocumentCode } from '../../localization/fiscal/identity-document-catalogue';

/**
 * The buyer's document type as an e-invoicing regime names it, read from the catalogue.
 *
 * The NF-e, AFIP and SUNAT builders used to answer "is this buyer a CNPJ or a CPF, a CUIT or a DNI,
 * a RUC or a DNI?" by counting the digits of `taxId`. A mistyped number then collides with a real
 * one of another kind, and the document goes to the authority declared as the wrong type. The
 * customer now records WHICH document it holds — `identityDocumentTypeCode` against the same
 * catalogue every other module validates against — so the builder can state the type instead of
 * inferring it (A-02).
 *
 * Resolution order: the recorded document type's `regimeCodes` entry, then — for a legacy record
 * that has a taxpayer kind but no document type — that kind's default invoicing document for the
 * country. Null when neither is known, which the caller renders as its regime's "unidentified party"
 * (AFIP `99`, SUNAT `0`).
 */
export function buyerRegimeDocumentCode(
  regime: string,
  customer: Pick<
    Customer,
    'identityDocumentTypeCode' | 'identityDocumentCountry' | 'taxpayerType'
  >,
  fallbackCountry: string,
): string | null {
  return regimeDocumentCode(regime, {
    countryCode: customer.identityDocumentCountry ?? fallbackCountry,
    code: customer.identityDocumentTypeCode,
    kind: taxpayerKindOf(customer.taxpayerType),
  });
}

/**
 * The catalogue's person/company axis for a customer's fiscal classification.
 *
 * `TaxpayerType` also carries designations that are not a kind of person — a withholding agent and a
 * government body are both juridical persons and file under a company identifier, so they map to
 * `COMPANY`. `FOREIGN` (and an unset value) map to null: a foreign buyer holds no domestic document
 * type, and the caller treats them as unidentified for its regime.
 */
function taxpayerKindOf(type: TaxpayerType | null | undefined): TaxpayerKind | null {
  switch (type) {
    case TaxpayerType.INDIVIDUAL:
      return TaxpayerKind.INDIVIDUAL;
    case TaxpayerType.COMPANY:
    case TaxpayerType.WITHHOLDING_AGENT:
    case TaxpayerType.GOVERNMENT:
      return TaxpayerKind.COMPANY;
    default:
      return null;
  }
}
