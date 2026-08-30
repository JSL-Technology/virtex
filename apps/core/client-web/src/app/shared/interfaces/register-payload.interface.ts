/**
 * What the signup form sends.
 *
 * `countryCode`, `taxId` and the fiscal address are required, and that is the point of the type:
 * they used to be optional, and the server treated a missing tax id or region as "skip fiscal
 * validation" — so a client could omit them and create a tenant with no fiscal identity at all.
 * `fiscalRegionId` is deliberately absent: the server derives it from `countryCode` and ignores
 * anything the client sends, so a payload cannot claim one country and be provisioned as another.
 */
export interface RegisterPayload {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    organizationName: string;

    /** ISO 3166-1 alpha-2. Decides the tax-id algorithm, chart of accounts, taxes and invoicing. */
    countryCode: string;
    /**
     * Company or natural person.
     *
     * Required, because nine of the nineteen markets issue a different identifier to each — an
     * EIN versus an SSN/ITIN, a CNPJ versus a CPF, a 12- versus a 13-character RFC — and without
     * it the server has to accept the union of both schemes, which is materially weaker.
     */
    taxpayerKind: 'company' | 'individual';
    /** Validated arithmetically by the server against the country's published check-digit rule. */
    taxId: string;
    /**
     * The country's remaining fiscal data, keyed by the spec the server published.
     *
     * `regimenFiscal` for Mexico, `condicionIva` and `puntoVenta` for Argentina,
     * `responsabilidadesFiscales` for Colombia, `regimeTributario` and `inscricaoEstadual` for
     * Brazil, `giro` and `codigoActividadEconomica` for Chile, `ubigeo` for Peru. The server
     * rejects any key the country did not ask for.
     */
    fiscalProfile?: Record<string, string>;

    /** Fiscal address. Structured because every invoicing regime in these markets stamps it. */
    address: string;
    city: string;
    state: string;
    postalCode?: string;

    recaptchaToken?: string;
    plan?: string;
    industry?: string;
    companySize?: string;
    phone?: string;
    emailVerificationCode?: string;
    phoneVerificationCode?: string;
}
