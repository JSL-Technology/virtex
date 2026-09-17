export * from './lib/permissions.util';
// `is-rnc.decorator` used to be exported here: a decorator implementing the DGII's modulus-11 and
// the JCE's Luhn rules, with its rejection message as a Spanish literal, on the public surface of
// a library called `util-auth`. It had no importers — the only reference was this line — but it
// was a third copy of two algorithms that already live in `tax-id-validators.ts`, sitting where
// the next module needing to validate an identifier would find it first. Its replacement is
// `IsTaxIdValidForCountry()` for a tenant's own identifier and `IdentityDocumentService` for
// everybody else's; both know which country they are validating for.
export * from './lib/interfaces/authenticated-request.interface';
