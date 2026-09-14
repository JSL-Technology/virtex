# Translations

Every string a person reads in this product is defined here, once.

```
libs/shared/locales/src/
  base/<namespace>.json     one entry per key, all three languages together
  regional/<locale>.json    only the keys a country words differently
  targets.json              which application gets which namespace
  composed-keys.json        key families whose leaf is built at runtime
```

Nothing else is a source. The catalogues under `apps/*/assets/i18n` and
`apps/backend/api/src/app/i18n/messages` are **generated** — do not edit them.

```bash
npm run i18n:build      # regenerate every application's catalogue
npm run i18n:verify     # everything CI checks, locally
npm run i18n:prune      # delete keys nothing references
```

## Adding a string

Put it in the namespace it belongs to, with all three languages:

```json
"accounting.fiscal_year.reopen_blocked": {
  "es": "El año fiscal está cerrado. Reábrelo antes de cambiar sus períodos.",
  "en": "The fiscal year is closed. Reopen it before changing its periods.",
  "pt": "O exercício fiscal está encerrado. Reabra-o antes de alterar os seus períodos."
}
```

Then `npm run i18n:build`, and reference it by name.

## The rules, and why each one is there

**A key is `lower_snake`, English, and describes the element — never the sentence.**
The previous convention was neither: an extractor generated each key by slugifying the Spanish text
it replaced, which produced 1.883 Spanish keys like
`ACCOUNTING.ANO_FISCAL_ARCHIVADO_NO_SE_PUEDE_REABRIR`. A Spanish key sitting beside a Spanish value
is two Spanish strings, and telling which is the identifier means knowing the file. It also meant
rewording a message minted a new key and abandoned the old one. Keys are written by hand now;
`tools/i18n/verify-catalogues.mjs` rejects anything that is not `lower_snake`.

**A key is defined once.** The client and the server each used to have their own catalogue, and 57
keys existed in both — 23 with different Spanish text, so which sentence a reader saw depended on
lookup order. `targets.json` decides which application receives a namespace; a namespace may go to
several, and they get the same entry because there is only one.

**Nothing is derived from anything.** `en.json` and `pt.json` used to be built from `es.json` by
looking each Spanish sentence up in a 3.068-term glossary, so two keys that happened to share a
Spanish value shared an English one whether or not they meant the same thing — 1.680 keys were in
that position. The three languages now sit side by side, and rewording one cannot reach another key.

**`literal` means "the same in every language, on purpose".** A keyboard shortcut, a placeholder
e-mail address, the legal name a tax authority gives a document. Writing the same string three times
is indistinguishable from two missing translations; this says which it is.

**The reader is addressed as "tú".** Not because "usted" is wrong, but because the catalogue had 302
of one and 32 of the other, sometimes on the same screen. The verifier rejects a formal imperative.

## Per-country wording

`es-DO` and `es-MX` read the same catalogue and do not use the same words. The year-end bonus is a
*regalía pascual* in Santo Domingo, an *aguinaldo* in Monterrey, a *prima de navidad* in Bogotá and
a *décimo terceiro* in São Paulo; the tax identifier is an RNC, an RFC, a NIT and a CNPJ.

`base/` holds neutral Latin American Spanish — the `es-419` register Google and Microsoft use — and
`regional/<locale>.json` holds **only the keys that actually differ**: nineteen for the Dominican
Republic out of nearly five thousand.

```json
// regional/es-DO.json
"payroll.runs.type_label.christmas_bonus": "Regalía pascual",
"hcm.employees.form.document_type.cedula": "Cédula"
```

A whole catalogue per market would multiply the translation work by the number of countries to
express that difference, and a country would fall silently behind the base the moment a key was
added. A patch cannot fall behind: what it does not mention, it does not change.

The locale comes from the tenant, resolved server-side — see `LocaleContextContract`. A patch naming
a key the base no longer has is a build failure, not a silent no-op.

## Keys built at runtime

About half of this product's lookups are composed from a value the API returned:

```ts
`accounts_payable.status.${bill.status}`   // 'PARTIALLY_PAID'
composeKey('permissions.groups', group)    // 'journal_entries'
```

No scan for string literals can see those, so `composed-keys.json` declares them. Two things read
it: the verifier counts the family as used (without it the keys look dead, and pruning would delete
exactly the ones whose absence is hardest to notice), and it checks every value in a closed family
resolves to a key that exists.

The values are written the way the SOURCE spells them — `SCREAMING_SNAKE` for a TypeORM enum,
`camelCase` for a DTO field — and `normalizeKey` reconciles the case at lookup, in
`VirtexTranslateStore` on the client and `I18nService` on the server. A call site may compose a key
in whatever case its data arrives in.

**A composed family's leaf is the enum value, not a name anybody chose.** It has to keep matching
what the API sends: renaming `accounting.categories.owners_equity` to `…capital` because the English
label said "Capital" is how the balance sheet ends up rendering a humanised key in all three
languages.

## Who translates what

The browser renders every string a person reads. The API answers a failure with names:

```json
{ "statusCode": 409, "code": "PERIOD_CLOSED",
  "messageKey": "accounting.period_closed", "params": { "period": "2026-03" } }
```

`code` is a stable machine identifier the client branches on — a two-factor challenge and a blocked
account are both 401 and lead to different screens. Nothing in the payload is prose, because the
screen knows the context a sentence needs and the server does not.

The server translates only where there is no browser: transactional e-mail, the invoice PDF, the
account and journal names written into a new tenant's books at provisioning, and stored
notifications. Those are listed under `api` in `targets.json` and nowhere else.
